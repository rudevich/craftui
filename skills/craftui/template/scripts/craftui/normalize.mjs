// raw Figma data → craftlog/figma/spec.json (one schema for every kind and source).
// Sources: raw/plugin.json (Chrome, Plugin API) or raw/metadata.xml + design-context/*.tsx + variables.json (Figma MCP).
import fs from 'node:fs';
import path from 'node:path';
import { appendHistory, camel, config, fail, findEntity, readJson, slug, writeJson } from './lib.mjs';
import { defaultTarget, targetDiffs } from './digest.mjs';
import { fromMcp } from './normalize-mcp.mjs';
import { describeSlots, markSlotContent, suggestSlots } from './slots.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const px = (v) => `${r2(v)}px`;

export function run(ref, { summary, keep }) {
  const e = findEntity(ref);
  // Pages have a pipeline of their own: breakpoint frames, parts, components used on the page.
  if (e.kind === 'page') return import('./normalize-page.mjs').then((m) => m.run(e, { summary, keep }));
  const raw = path.join(e.craftlog, 'figma', 'raw');
  const previous = readJson(e.specFile);
  if (summary) {
    if (!previous) fail(`нет ${e.specFile} — сначала npm run craftui -- normalize ${e.name}`);
    return printSummary(previous);
  }
  // Decisions about nested components survive re-normalization: inline ones are expanded into this component's tree.
  const resolutions = new Map((previous?.instances ?? []).filter((i) => i.resolution).map((i) => [i.key, i.resolution]));
  const ctx = { prefix: config().tokenPrefix ?? '', resolutions, inline: new Set([...resolutions].filter(([, r]) => r === 'inline').map(([k]) => k)), keep, previous };
  let spec;
  if (fs.existsSync(path.join(raw, 'plugin.json'))) spec = fromPlugin(readJson(path.join(raw, 'plugin.json')), e, ctx);
  else if (fs.existsSync(path.join(raw, 'metadata.xml'))) spec = fromMcp(raw, e, ctx);
  else fail(`нет сырых данных в ${raw} (plugin.json или metadata.xml) — шаг extract`);
  if (keep && previous) spec = keepManualEdits(spec, previous);
  const slotWarnings = markSlotContent(spec);
  spec.suggestedSlots = suggestSlots(spec);
  // Instances met only inside slot content (a sample icon) are not dependencies: the consumer passes their own.
  const inSlot = new Set();
  const collect = (n, on) => {
    if (on || n.slot) inSlot.add(n.figmaId);
    n.children?.forEach((c) => collect(c, on || Boolean(n.slot)));
  };
  spec.targets.forEach((t) => collect(t.tree, false));
  for (const i of spec.instances) if (!i.resolution && i.nodeIds.every((id) => inSlot.has(id))) i.resolution = 'content';
  writeJson(e.specFile, spec);
  writeNodeMap(e, spec);
  appendHistory(e, `spec.json: ${spec.targets.length} targets, ${spec.props.length} свойств, ${spec.tokens.length} токенов`);
  printSummary(spec);
  for (const w of slotWarnings) console.log(`⚠ ${w}`);
}

// ── Plugin API (Chrome) ───────────────────────────────────────────────────────

function fromPlugin(raw, e, ctx) {
  const tokens = buildTokens(raw, ctx);
  const sources = raw.sources ?? [raw.root];
  const props = buildProps(mergeDefinitions(sources, raw.variants), raw.variants);
  if (ctx.keep) mergeProps(props, ctx.previous); // targets below then follow the edited maps
  const assets = new Map();
  const fonts = new Map();
  const instances = new Map(); // direct dependencies only: instances inside instances belong to those components
  // Layers our BOOLEAN props switch off stay in the tree (hidden): Caption is off in every variant, its style is still needed.
  const boolKeys = new Set(props.filter((p) => p.type === 'BOOLEAN').flatMap((p) => p.keys ?? [p.key]));
  for (const v of raw.variants) v.normTree = normNode(v.tree, 'root', { ...ctx, tokens, assets, fonts, instances, boolKeys });
  const label = raw.variants.length ? syntheticTextProp(props, raw.variants[0].normTree) : null;
  if (label) props.push(label);

  const targets = [];
  const used = new Set();
  for (const v of raw.variants) {
    const base = targetId(v.variantProperties, props) || 'default';
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    const sizing = { h: v.tree.layoutSizingHorizontal, v: v.tree.layoutSizingVertical };
    const frame = {};
    if (sizing.h && sizing.h !== 'HUG') frame.width = r2(v.width);
    if (sizing.v && sizing.v !== 'HUG') frame.height = r2(v.height);
    targets.push({
      id,
      title: targetTitle(v.variantProperties, props) || v.name,
      figmaNodeId: v.id,
      source: v.source ?? 0,
      variant: v.variantProperties ?? null,
      size: { width: r2(v.width), height: r2(v.height) },
      ...(Object.keys(frame).length ? { frame } : {}),
      ...targetProps(v, props),
      tree: v.normTree,
    });
  }
  boolContent(props, targets);
  // The label of a variant whose cell Figma did not load: the text of another variant from the same set.
  for (const p of props.filter((x) => x.synthetic && x.role === 'text')) {
    for (const t of targets.filter((x) => x.props[p.react] === undefined)) {
      const twin = targets.find((x) => x.source === t.source && x.props[p.react] !== undefined) ?? targets.find((x) => x.props[p.react] !== undefined);
      if (twin) t.props[p.react] = twin.props[p.react];
    }
  }

  return {
    version: 1,
    kind: e.kind,
    name: e.name,
    source: 'chrome',
    figma: {
      fileKey: raw.meta.fileKey,
      nodeId: raw.root.id,
      nodeType: raw.root.type,
      nodeName: raw.root.name,
      key: raw.root.key ?? null,
      keys: sources.map((x) => x.key).filter(Boolean),
      description: raw.root.description || undefined,
    },
    props,
    targets,
    tokens: tokens.list,
    instances: [...instances.values()].map((i) => {
      const as = ctx.previous?.twins?.[i.name.trim()];
      return { ...raw.instances.find((r) => r.key === i.key), ...i, resolution: ctx.resolutions.get(i.key) ?? (as ? `entity:component/${as}` : null), ...(as ? { as } : {}) };
    }),
    ...(ctx.previous?.twins ? { twins: ctx.previous.twins } : {}),
    assets: [...assets.values()],
    fonts: [...fonts.values()],
    truncated: raw.meta.truncated || undefined,
  };
}

// ── tokens ────────────────────────────────────────────────────────────────────

const color = ({ r, g, b, a = 1 }, opacity = 1) => {
  const [R, G, B] = [r, g, b].map((x) => Math.round(x * 255));
  const A = r2(a * opacity);
  if (A >= 1) return `#${[R, G, B].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${R}, ${G}, ${B}, ${A})`;
};
const UNITLESS_SCOPES = ['FONT_WEIGHT', 'OPACITY'];

export function buildTokens(raw, ctx) {
  const vars = new Map(raw.variables.map((v) => [v.id, v]));
  const cols = new Map(raw.collections.map((c) => [c.id, c]));
  // "01. Theme" → "Theme": kits number their collections; copies of a library collection share the name.
  const colName = (c) => (c?.name ?? 'mode').replace(/^[\d\s.]+/, '') || c?.name;
  const nameOf = (v) => `--${ctx.prefix}${v.codeSyntax?.WEB?.match(/--([\w-]+)/)?.[1] ?? slug(v.name)}`;
  const byVariable = new Map(raw.variables.map((v) => [v.id, nameOf(v)]));
  const figmaCssNames = new Map();
  for (const v of raw.variables) {
    for (const n of [v.name.replace(/[\s/]+/g, '-'), v.name.replace(/\//g, '-'), v.codeSyntax?.WEB?.match(/--([\w-]+)/)?.[1]]) {
      if (n) figmaCssNames.set(n, byVariable.get(v.id));
    }
  }

  // Value of a variable for chosen modes (by collection name), following aliases to a concrete value.
  const resolve = (v, modes, depth = 0) => {
    const c = cols.get(v.collectionId);
    const wanted = c && modes[colName(c)];
    const modeId = (wanted && c.modes?.find((m) => m.name === wanted)?.modeId) ?? c?.defaultModeId ?? Object.keys(v.valuesByMode)[0];
    const value = v.valuesByMode[modeId] ?? Object.values(v.valuesByMode)[0];
    if (value?.type === 'VARIABLE_ALIAS') {
      const target = vars.get(value.id);
      return target && depth < 10 ? resolve(target, modes, depth + 1) : null;
    }
    return { value, type: v.resolvedType, scopes: v.scopes };
  };
  const toCss = (r) =>
    r.type === 'COLOR' ? color(r.value) : r.type === 'FLOAT' ? (r.scopes?.some((s) => UNITLESS_SCOPES.includes(s)) ? String(r.value) : px(r.value)) : String(r.value);
  const collectionsOf = (v, depth = 0) => {
    const out = cols.get(v.collectionId) ? [cols.get(v.collectionId)] : [];
    for (const x of Object.values(v.valuesByMode)) {
      if (x?.type === 'VARIABLE_ALIAS' && vars.get(x.id) && depth < 10) out.push(...collectionsOf(vars.get(x.id), depth + 1));
    }
    return out;
  };

  // One token per CSS name. Layered kits alias a variable to a same-named one in another collection
  // (SubTheme → Theme): the outer one (not an alias target of its namesake) defines the token.
  const aliasTargets = new Set(raw.variables.flatMap((v) => Object.values(v.valuesByMode).filter((x) => x?.type === 'VARIABLE_ALIAS').map((x) => x.id)));
  const byName = new Map();
  for (const v of raw.variables) {
    const name = byVariable.get(v.id);
    const cur = byName.get(name);
    if (!cur || (aliasTargets.has(cur.id) && !aliasTargets.has(v.id))) byName.set(name, v);
  }

  const list = [];
  for (const [name, v] of byName) {
    if (v.resolvedType === 'BOOLEAN') continue;
    const base = resolve(v, {});
    if (!base || base.value === undefined) continue;
    const values = { default: toCss(base) };
    const seen = new Set();
    for (const c of collectionsOf(v)) {
      const cn = colName(c);
      if (seen.has(cn)) continue;
      seen.add(cn);
      for (const m of c.modes ?? []) {
        if (m.modeId === c.defaultModeId) continue;
        const r = resolve(v, { [cn]: m.name });
        if (r && toCss(r) !== values.default) values[`${slug(cn)}=${slug(m.name)}`] = toCss(r);
      }
    }
    list.push({ name, figma: v.name, collection: colName(cols.get(v.collectionId)), type: v.resolvedType, defaultMode: 'default', values, source: 'variable' });
  }

  const byStyle = new Map(); // style id → { cssProp: token }
  for (const s of raw.styles ?? []) {
    const base = slug(s.name);
    if (s.type === 'PAINT' && s.paints?.length === 1 && s.paints[0].type === 'SOLID') {
      const name = `--${ctx.prefix}${base.startsWith('color') ? base : `color-${base}`}`;
      list.push({ name, figma: s.name, type: 'COLOR', values: { default: color(s.paints[0].color, s.paints[0].opacity) }, defaultMode: 'default', source: 'style' });
      byStyle.set(s.id, { color: name });
    } else if (s.type === 'EFFECT' && s.effects?.length) {
      const shadow = s.effects.filter((x) => x.visible !== false && /SHADOW/.test(x.type)).map(boxShadow).join(', ');
      if (shadow) {
        const name = `--${ctx.prefix}shadow-${base}`;
        list.push({ name, figma: s.name, type: 'SHADOW', values: { default: shadow }, defaultMode: 'default', source: 'style' });
        byStyle.set(s.id, { 'box-shadow': name });
      }
    } else if (s.type === 'TEXT') {
      const t = typography(s);
      const map = {};
      for (const [prop, value] of Object.entries(t)) {
        const name = `--${ctx.prefix}font-${base}-${prop.replace(/^font-/, '')}`;
        list.push({ name, figma: `${s.name} (${prop})`, type: 'TYPOGRAPHY', values: { default: value }, defaultMode: 'default', source: 'style' });
        map[prop] = name;
      }
      byStyle.set(s.id, map);
    }
  }
  return { list, byVariable, byStyle, figmaCssNames };
}

function boxShadow(fx) {
  const inset = fx.type === 'INNER_SHADOW' ? 'inset ' : '';
  return `${inset}${px(fx.offset?.x ?? 0)} ${px(fx.offset?.y ?? 0)} ${px(fx.radius ?? 0)} ${px(fx.spread ?? 0)} ${color(fx.color)}`;
}

function typography(t) {
  const out = {};
  if (t.fontName?.family) out['font-family'] = `'${t.fontName.family}'`;
  if (typeof t.fontSize === 'number') out['font-size'] = px(t.fontSize);
  const weight = t.fontWeight ?? fontWeight(t.fontName?.style);
  if (weight) out['font-weight'] = String(weight);
  const lh = lineHeight(t.lineHeight, t.fontSize);
  if (lh) out['line-height'] = lh;
  const ls = letterSpacing(t.letterSpacing, t.fontSize);
  if (ls) out['letter-spacing'] = ls;
  return out;
}

const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
function fontWeight(style) {
  if (!style || typeof style !== 'string') return undefined;
  const key = style.toLowerCase().replace(/italic|[\s-]/g, '');
  return WEIGHTS[key] ?? (Number.parseInt(key, 10) || undefined);
}
function lineHeight(lh, size) {
  if (!lh || typeof lh !== 'object') return undefined;
  if (lh.unit === 'PIXELS') return px(lh.value);
  if (lh.unit === 'PERCENT' && typeof size === 'number') return px((size * lh.value) / 100);
  return undefined;
}
function letterSpacing(ls, size) {
  if (!ls || typeof ls !== 'object' || !ls.value) return undefined;
  if (ls.unit === 'PIXELS') return px(ls.value);
  if (ls.unit === 'PERCENT' && typeof size === 'number') return px((size * ls.value) / 100);
  return undefined;
}

// ── props ─────────────────────────────────────────────────────────────────────

const STATE_PROP = /^(state|states|status|interaction|состояние)$/i;
const STATE_ROLE = [
  [/^(default|enabled|rest|normal|idle|base|static)$/i, null],
  [/^(hover|hovered|is[\s-]?hover)$/i, { pseudo: 'hover' }],
  [/^(pressed|press|active|actived|click|clicked|tap)$/i, { pseudo: 'active' }],
  [/^(focus|focused|focus[\s-]?visible|keyboard[\s-]?focus)$/i, { pseudo: 'focus-visible' }],
  [/^(disabled|inactive|disable)$/i, { flag: 'disabled' }],
  [/^(loading|busy|progress)$/i, { flag: 'loading' }],
];
const BOOL_OPTIONS = [['true', 'false'], ['yes', 'no'], ['on', 'off']];
const TRUE = /^(true|yes|on)$/i;
const EMPTY = /^(none|false|no|off|empty|нет)$/i;
// Variant axes that say whether extra content is shown (ContentLeft=True, ContentRight=Icon/Value) become ReactNode slots.
const SLOT_PROP = /^(content|icon|prefix|suffix|addon|before|after|left|right|start|end)/i;

/** Variant axes of all sources: own definitions plus axes added by sources (Size=M), options in order of appearance. */
const BOOL_SYNONYMS = { yes: 'true', no: 'false', on: 'true', off: 'false' };
const canonValue = (v) => BOOL_SYNONYMS[String(v).toLowerCase()] ?? String(v).toLowerCase();

export function mergeDefinitions(sources, variants) {
  const defs = {};
  const byName = new Map();
  for (const s of sources) {
    for (const [k, d] of Object.entries(s.componentPropertyDefinitions ?? {})) {
      // TEXT/BOOLEAN/INSTANCE_SWAP keys carry the set's node id (Caption#33:12): one prop per name, every key kept.
      const name = k.replace(/#[\d:]+$/, '');
      const same = byName.get(name);
      if (same) {
        if (!same.keys.includes(k)) same.keys.push(k);
        continue;
      }
      defs[k] = { ...d, variantOptions: d.variantOptions ? [...d.variantOptions] : undefined, keys: [k] };
      byName.set(name, defs[k]);
    }
  }
  // Sets of one kit spell values differently (Selected=true / True, Today=No / False): one option, the first spelling.
  // Variants get that spelling too, so targets map through the same option.
  for (const v of variants) {
    for (const [k, value] of Object.entries(v.variantProperties ?? {})) {
      defs[k] ??= { type: 'VARIANT', defaultValue: value, variantOptions: [] };
      if (defs[k].type !== 'VARIANT') continue;
      const same = defs[k].variantOptions.find((o) => canonValue(o) === canonValue(value));
      if (same === undefined) defs[k].variantOptions.push(value);
      else v.variantProperties[k] = same;
    }
  }
  return defs;
}

export function buildProps(definitions, variants) {
  const props = [];
  const textProps = Object.values(definitions).filter((d) => d.type === 'TEXT').length;
  for (const [key, def] of Object.entries(definitions)) {
    const figma = key.replace(/#[\d:]+$/, '');
    const p = { figma, key, type: def.type, default: def.defaultValue };
    if (def.keys?.length > 1) p.keys = def.keys; // the same prop in other sets of the entity
    if (def.type === 'VARIANT') {
      p.options = def.variantOptions ?? [...new Set(variants.map((v) => v.variantProperties?.[figma]).filter(Boolean))];
      const lower = p.options.map((o) => o.toLowerCase()).sort();
      const isBool = BOOL_OPTIONS.some((b) => b.slice().sort().join() === lower.join());
      const stateByName = isBool && STATE_ROLE.find(([re]) => re.test(figma));
      if (STATE_PROP.test(figma)) {
        p.role = 'state';
        p.map = Object.fromEntries(
          p.options.map((o) => {
            const hit = STATE_ROLE.find(([re]) => re.test(o));
            return [o, hit ? hit[1] : { unknown: true }];
          }),
        );
        p.react = null;
      } else if (stateByName && stateByName[1]) {
        // Hovered=True / Disabled=True: a state axis per state.
        p.role = 'state';
        p.map = Object.fromEntries(p.options.map((o) => [o, TRUE.test(o) ? stateByName[1] : null]));
        p.react = null;
      } else if (SLOT_PROP.test(figma) && p.options.some((o) => EMPTY.test(o))) {
        p.role = 'slot';
        p.react = camel(figma);
        p.reactType = 'ReactNode';
        p.map = Object.fromEntries(p.options.map((o) => [o, EMPTY.test(o) ? null : TRUE.test(o) ? 'content' : slug(o)]));
      } else if (isBool) {
        p.role = 'prop';
        p.react = camel(figma);
        p.reactType = 'boolean';
        p.map = Object.fromEntries(p.options.map((o) => [o, TRUE.test(o)]));
      } else {
        p.role = 'prop';
        p.react = camel(figma);
        p.map = Object.fromEntries(p.options.map((o) => [o, slug(o) || o]));
        p.reactType = Object.values(p.map).map((x) => `'${x}'`).join(' | ');
      }
    } else if (def.type === 'TEXT') {
      p.role = 'text';
      p.react = textProps === 1 ? 'children' : camel(figma);
      p.reactType = textProps === 1 ? 'ReactNode' : 'string';
    } else if (def.type === 'BOOLEAN') {
      p.role = 'bool';
      p.react = camel(figma);
      p.reactType = 'boolean';
    } else if (def.type === 'INSTANCE_SWAP') {
      p.role = 'slot';
      p.react = camel(figma);
      p.reactType = 'ReactNode';
      p.preferredValues = def.preferredValues;
    }
    props.push(p);
  }
  return props;
}

/** Title for the demo: only axes that differ from the defaults (`View=Accent, Hovered=True`), `Default` when none. */
export function targetTitle(variantProperties, props) {
  if (!variantProperties) return '';
  const parts = props
    .filter((p) => p.type === 'VARIANT' && variantProperties[p.figma] !== undefined && variantProperties[p.figma] !== p.default)
    .map((p) => `${p.figma}=${variantProperties[p.figma]}`);
  return parts.join(', ') || 'Default';
}

/** Short readable id: only values that differ from the defaults (`accent-hovered`, `fixed`), `default` when none. */
export function targetId(variantProperties, props) {
  if (!variantProperties) return '';
  const parts = [];
  for (const p of props.filter((x) => x.type === 'VARIANT')) {
    const value = variantProperties[p.figma];
    if (value === undefined || value === p.default) continue;
    if (TRUE.test(value)) parts.push(slug(p.figma));
    else if (EMPTY.test(value)) parts.push(`no-${slug(p.figma)}`);
    else parts.push(p.role === 'slot' ? `${slug(p.figma)}-${slug(value)}` : slug(value));
  }
  return parts.join('-') || 'default';
}

function targetProps(variant, props) {
  const out = { props: {} };
  const pseudo = [];
  for (const p of props) {
    if (p.type === 'VARIANT') {
      const value = variant.variantProperties?.[p.figma];
      if (value === undefined) continue;
      if (p.role === 'state') {
        const role = p.map[value];
        if (role?.pseudo) pseudo.push(role.pseudo);
        if (role?.flag) out.props[role.flag] = true;
      } else if (p.role === 'slot') {
        // Marker for the demo: scaffold turns it into a placeholder element to replace with the real content.
        if (p.map[value]) out.props[p.react] = `$slot:${p.map[value]}`;
      } else if (p.react) out.props[p.react] = p.map[value];
    } else if (p.role === 'text' && p.react) {
      const n = p.synthetic
        ? (findByKey(variant.normTree, p.nodeKey) ?? findText(variant.normTree, p.figma))
        : findReferenced(variant.tree, 'characters', p.keys ?? [p.key]);
      const text = n?.characters ?? n?.text?.characters;
      if (text !== undefined || !p.synthetic) out.props[p.react] = text ?? p.default;
    } else if (p.role === 'bool' && p.react) {
      const n = findReferenced(variant.tree, 'visible', p.keys ?? [p.key]);
      out.props[p.react] = n ? n.visible !== false : p.default;
    }
  }
  if (pseudo.length) out.pseudo = pseudo;
  return out;
}

/**
 * A BOOLEAN that shows an icon or a text is content, not a flag: ContentLeft → contentLeft?: ReactNode (slot),
 * Caption → caption?: ReactNode (the text). Targets get the content where the layer is on.
 */
export function boolContent(props, targets) {
  for (const p of props.filter((x) => x.type === 'BOOLEAN' && x.react && ['bool', 'slot', 'text'].includes(x.role))) {
    const keys = p.keys ?? [p.key];
    const found = targets.map((t) => ({ t, nodes: allReferenced(t.tree, 'visible', keys) }));
    const nodes = found.flatMap((f) => f.nodes);
    if (!nodes.length) continue;
    const isText = (n) => n.type === 'TEXT' || (n.children?.length === 1 && isText(n.children[0]));
    const textOf = (n) => (n.type === 'TEXT' ? n.text?.characters : n.children?.length === 1 ? textOf(n.children[0]) : undefined);
    // An icon, or a frame around exactly one icon (ContentRight → IconAction).
    const icon = (n) => Boolean(n.asset) || (n.children?.length === 1 && icon(n.children[0]));
    if (nodes.every(icon)) Object.assign(p, { role: 'slot', reactType: 'ReactNode', content: [...new Set(nodes.map((n) => n.key))], fromBool: true });
    else if (nodes.every(isText)) Object.assign(p, { role: 'text', reactType: 'ReactNode', nodeKeys: [...new Set(nodes.map((n) => n.key))], fromBool: true });
    else continue;
    for (const { t, nodes: own } of found) {
      const on = own.find((n) => !n.hidden);
      if (p.role === 'text' && on) t.props[p.react] = textOf(on) ?? p.figma;
      else delete t.props[p.react]; // slots are filled by markSlotContent
    }
  }
}

function allReferenced(node, field, keys, out = []) {
  if (keys.includes(node.propRefs?.[field])) out.push(node);
  node.children?.forEach((c) => allReferenced(c, field, keys, out));
  return out;
}

function findReferenced(node, field, keys) {
  if (keys.includes(node.componentPropertyReferences?.[field])) return node;
  for (const c of node.children ?? []) {
    const f = findReferenced(c, field, keys);
    if (f) return f;
  }
  return null;
}

function findText(node, name) {
  if (!node) return null;
  if (node.type === 'TEXT' && node.name === name) return node;
  for (const c of node.children ?? []) {
    const f = findText(c, name);
    if (f) return f;
  }
  return null;
}

function findByKey(node, key) {
  if (!node) return null;
  if (node.key === key) return node;
  for (const c of node.children ?? []) {
    const f = findByKey(c, key);
    if (f) return f;
  }
  return null;
}

/** Without a TEXT property the label is a plain text layer: offer it as `children` when there is exactly one. */
function syntheticTextProp(props, firstTree) {
  if (props.some((p) => p.role === 'text')) return null;
  const texts = [];
  const walk = (n) => {
    if (n.hidden) return; // a layer a BOOLEAN switches on (Caption) is not the label
    if (n.type === 'TEXT') texts.push(n);
    n.children?.forEach(walk); // only inline instances have children in the normalized tree
  };
  walk(firstTree);
  const label = texts.length === 1 ? texts[0] : texts.find((t) => /^(label|text|title|caption|подпись|текст)$/i.test(t.name));
  if (!label) return null;
  return { figma: label.name, key: null, nodeKey: label.key, type: 'TEXT', synthetic: true, role: 'text', react: 'children', reactType: 'ReactNode', default: label.text?.characters };
}

// ── nodes ─────────────────────────────────────────────────────────────────────

const VECTOR = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'POLYGON']);
const SHAPE = new Set([...VECTOR, 'RECTANGLE', 'GROUP', 'FRAME', 'INSTANCE', 'COMPONENT']);

// Auto-layout with padding or gap makes a frame a UI container (a button body), not a picture.
const hasLayout = (n) =>
  Boolean(n.layoutMode && n.layoutMode !== 'NONE') &&
  (['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].some((k) => (n[k] ?? 0) > 0) || (n.itemSpacing ?? 0) > 0);

function isGraphic(n) {
  if (n.image) return false; // a picture (photo, avatar) is a PNG, not a vector asset
  if (VECTOR.has(n.type)) return true;
  if (!SHAPE.has(n.type) || !n.children?.length) return false;
  // A variant itself is never an asset (an icon-only button has no text, only frames and vectors).
  if (n.type === 'COMPONENT' || hasLayout(n)) return false;
  const visible = n.children.filter((c) => c.visible !== false);
  return visible.length > 0 && visible.every((c) => SHAPE.has(c.type) && (VECTOR.has(c.type) || c.type === 'RECTANGLE' || isGraphic(c))) && visible.some((c) => VECTOR.has(c.type) || isGraphic(c));
}

const BOUND_TO_CSS = {
  itemSpacing: 'gap',
  counterAxisSpacing: 'row-gap',
  paddingTop: 'padding-top',
  paddingRight: 'padding-right',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-left',
  topLeftRadius: 'border-top-left-radius',
  topRightRadius: 'border-top-right-radius',
  bottomLeftRadius: 'border-bottom-left-radius',
  bottomRightRadius: 'border-bottom-right-radius',
  width: 'width',
  height: 'height',
  minWidth: 'min-width',
  maxWidth: 'max-width',
  strokeWeight: 'border-width',
  opacity: 'opacity',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  lineHeight: 'line-height',
  letterSpacing: 'letter-spacing',
  fontFamily: 'font-family',
};

function nodeTokens(n, ctx) {
  const out = {};
  const ref = (alias) => (alias?.type === 'VARIABLE_ALIAS' ? ctx.tokens.byVariable.get(alias.id) : undefined);
  for (const [field, alias] of Object.entries(n.boundVariables ?? {})) {
    const a = Array.isArray(alias) ? alias[0] : alias;
    const css = BOUND_TO_CSS[field];
    if (css && ref(a)) out[css] = ref(a);
  }
  const fill = (n.fills ?? []).find((f) => f.visible !== false && f.boundVariables?.color);
  if (fill && ref(fill.boundVariables.color)) out[n.type === 'TEXT' ? 'color' : 'background-color'] = ref(fill.boundVariables.color);
  const stroke = (n.strokes ?? []).find((f) => f.visible !== false && f.boundVariables?.color);
  if (stroke && ref(stroke.boundVariables.color)) out['border-color'] = ref(stroke.boundVariables.color);
  const styled = (id, mapper) => {
    const s = typeof id === 'string' ? ctx.tokens.byStyle.get(id) : undefined;
    if (s) Object.assign(out, mapper(s));
  };
  styled(n.fillStyleId, (s) => (s.color ? { [n.type === 'TEXT' ? 'color' : 'background-color']: s.color } : {}));
  styled(n.strokeStyleId, (s) => (s.color ? { 'border-color': s.color } : {}));
  styled(n.effectStyleId, (s) => s);
  styled(n.textStyleId, (s) => s);
  return out;
}

function mapCssVars(css, ctx) {
  const out = {};
  for (const [k, v] of Object.entries(css ?? {})) {
    out[k] = String(v).replace(/var\(--([\w-]+)(\s*,\s*([^()]*(\([^()]*\))?[^()]*))?\)/g, (m, name) => {
      const ours = ctx.tokens.figmaCssNames.get(name);
      return ours ? `var(${ours})` : m;
    });
  }
  return out;
}

function solidFill(n) {
  const fills = (n.fills ?? []).filter((f) => f.visible !== false);
  if (fills.length !== 1 || fills[0].type !== 'SOLID') return undefined;
  return color(fills[0].color, fills[0].opacity ?? 1);
}

// Values comparable with getComputedStyle() in the browser (used by the style-check).
function expectations(n) {
  const x = {};
  if (n.type === 'TEXT') {
    Object.assign(x, typography(n));
    delete x['font-family'];
    if (n.fontName?.family && n.fontName !== 'mixed') x['font-family'] = n.fontName.family;
    const c = solidFill(n);
    if (c) x.color = c;
  } else {
    if (typeof n.width === 'number') x.width = px(n.width);
    if (typeof n.height === 'number') x.height = px(n.height);
    if (n.layoutMode && n.layoutMode !== 'NONE') {
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) x[`padding-${side.toLowerCase()}`] = px(n[`padding${side}`] ?? 0);
      // Gap only matters between two or more children.
      const kids = (n.children ?? []).filter((c) => c.visible !== false).length;
      if (kids > 1 && n.primaryAxisAlignItems !== 'SPACE_BETWEEN' && n.itemSpacing) x[n.layoutMode === 'HORIZONTAL' ? 'column-gap' : 'row-gap'] = px(n.itemSpacing);
    }
    const half = Math.min(n.width ?? 0, n.height ?? 0) / 2;
    for (const [field, prop] of [['topLeftRadius', 'border-top-left-radius'], ['topRightRadius', 'border-top-right-radius'], ['bottomLeftRadius', 'border-bottom-left-radius'], ['bottomRightRadius', 'border-bottom-right-radius']]) {
      const v = typeof n[field] === 'number' ? n[field] : typeof n.cornerRadius === 'number' ? n.cornerRadius : 0;
      // A pill can be written with any radius ≥ half the height, so it is not checked.
      if (v > 0 && v < half) x[prop] = px(v);
    }
    const bg = solidFill(n);
    if (bg && !VECTOR.has(n.type)) x['background-color'] = bg;
  }
  if (typeof n.opacity === 'number' && n.opacity < 1) x.opacity = String(r2(n.opacity));
  return x;
}

function isWrapper(n, child) {
  // Shells (the variant's own frame, instance shells, groups) and plain frames without gap. A frame with gap carries
  // layout for variants where it has more children (BasicButton content: icon + label), so it stays.
  const shell = ['COMPONENT', 'INSTANCE', 'GROUP'].includes(n.type) || (n.type === 'FRAME' && !(n.itemSpacing > 0));
  if (!shell || typeof n.width !== 'number' || typeof child.width !== 'number') return false;
  if (Math.abs(n.width - child.width) > 0.5 || Math.abs(n.height - child.height) > 0.5) return false;
  const paints = [...(n.fills ?? []), ...(n.strokes ?? []), ...(n.effects ?? [])].filter((p) => p.visible !== false);
  const padding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].some((k) => (n[k] ?? 0) !== 0);
  const radius = typeof n.cornerRadius === 'number' && n.cornerRadius > 0;
  return !paints.length && !padding && !radius && !n.clipsContent; // its opacity moves to the child
}

// Takes no room in the layout: absolute, or a zero-size frame that only holds an overflowing layer (a spinner placeholder).
const isOverlay = (c) => c.layoutPositioning === 'ABSOLUTE' || (typeof c.width === 'number' && (c.width < 0.5 || c.height < 0.5));

// A layer named by its text (a whole legal paragraph) must not become a key of hundreds of characters.
const keyOf = (name) => {
  const s = slug(name);
  return s.length > 60 ? s.slice(0, 60).replace(/-[^-]*$/, '') : s;
};

function normChildren(children, key, ctx, seen = new Map()) {
  return children.map((c) => {
    const base = keyOf(c.name) || c.type.toLowerCase();
    const i = (seen.get(base) ?? 0) + 1;
    seen.set(base, i);
    return normNode(c, `${key}/${i > 1 ? `${base}-${i}` : base}`, ctx);
  });
}

export function normNode(n, key, ctx) {
  const node = { key, name: n.name, type: n.type, figmaId: n.id };
  if (typeof n.width === 'number') node.box = { x: r2(n.x ?? 0), y: r2(n.y ?? 0), w: r2(n.width), h: r2(n.height) };
  if (n.layoutPositioning === 'ABSOLUTE') node.absolute = true;
  if (n.css) node.css = mapCssVars(n.css, ctx);
  // Figma lays text lines out on whole pixels: 16px at 140% is 22px there, a browser would give 22.4px.
  // getCSSAsync writes it as "140% /* 22.4px */"; a token in its place stays.
  const lh = /^(\d+(?:\.\d+)?)%(\s*\/\*.*\*\/)?$/.exec(node.css?.['line-height'] ?? '')?.[1];
  const size = /^(\d+(?:\.\d+)?)px$/.exec(n.css?.['font-size'] ?? '')?.[1];
  if (lh && size) node.css['line-height'] = `${Math.round((size * lh) / 100)}px`;
  const tokens = nodeTokens(n, ctx);
  if (Object.keys(tokens).length) node.tokens = tokens;
  node.expect = expectations(n);
  // A zero-size frame only holds an overflowing layer (a spinner placeholder): its size is not a design value.
  if (isOverlay(n) && n.layoutPositioning !== 'ABSOLUTE') {
    delete node.expect.width;
    delete node.expect.height;
  }
  if (n.type === 'TEXT') {
    // Figma writes Shift+Enter as U+2028 (line separator); browsers do not break lines on it, a line feed does.
    node.text = { characters: n.characters?.replace(/[\u2028\u2029]/g, '\n') };
    if (node.text.characters?.includes('\n')) node.css = { ...(node.css ?? {}), 'white-space': 'pre-line' };
    if (n.segments) node.text.segments = n.segments.length;
    if (n.fontName?.family) ctx.fonts.set(`${n.fontName.family}`, { family: n.fontName.family, styles: [...new Set([...(ctx.fonts.get(n.fontName.family)?.styles ?? []), n.fontName.style])] });
  }
  if (n.componentPropertyReferences) node.propRefs = n.componentPropertyReferences;
  if (n.image) node.image = true; // filled with a picture: a page renders it as <img>
  if (n.type === 'INSTANCE' && n.instanceOf) {
    node.instance = {
      key: n.instanceOf.set?.key ?? n.instanceOf.key,
      name: n.instanceOf.set?.name ?? n.instanceOf.name,
      variant: n.variantProperties ?? undefined,
      props: n.componentProperties
        ? Object.fromEntries(Object.entries(n.componentProperties).map(([k, v]) => [k.replace(/#[\d:]+$/, ''), v.value]))
        : undefined,
    };
    // A label typed over a text layer (no TEXT property): the parent passes it to the component as a text prop by layer name.
    const texts = {};
    const walk = (c) => {
      if (c.visible === false) return;
      if (c.type === 'TEXT' && !(c.name in texts)) texts[c.name] = c.characters?.replace(/[\u2028\u2029]/g, '\n');
      if (c.type !== 'INSTANCE') c.children?.forEach(walk);
    };
    n.children?.forEach(walk);
    if (Object.keys(texts).length) node.instance.texts = texts;
    const dep = ctx.instances.get(node.instance.key) ?? { key: node.instance.key, name: node.instance.name, nodeIds: [] };
    dep.nodeIds.push(n.id);
    ctx.instances.set(node.instance.key, dep);
  }
  if (isGraphic(n)) {
    if (node.instance) ctx.instances.get(node.instance.key).graphic = true;
    // A plain frame is known only by its name: "Content" 24×24 and "Content" 16×16 hold different icons.
    const assetKey = node.instance?.key ?? (isOverlay(n) ? n.name : `${n.name} ${r2(n.width)}×${r2(n.height)}`);
    if (!ctx.assets.has(assetKey)) {
      const base = slug(node.instance?.name ?? n.name) || 'graphic';
      const taken = [...ctx.assets.values()].some((a) => a.file === `assets/${base}.svg`);
      const file = `assets/${taken ? `${base}-${Math.round(n.width)}x${Math.round(n.height)}` : base}.svg`;
      ctx.assets.set(assetKey, { key: assetKey, name: n.name, nodeId: n.id, file });
    }
    node.asset = ctx.assets.get(assetKey).file;
    return node; // graphics are exported as SVG, their inner vectors do not matter
  }
  // A library component Figma did not load into this file: an instance without children. The PNG export still draws it.
  if (n.type === 'INSTANCE' && n.instanceOf?.remote && !n.children?.length) node.unloaded = true;
  // A nested component owns its internals, unless it was resolved inline (then it is part of this component).
  if (n.type === 'INSTANCE' && !ctx.inline.has(node.instance?.key)) return node;
  const children = (n.children ?? []).filter((c) => c.visible !== false);
  const toggled = (n.children ?? []).filter((c) => c.visible === false && ctx.boolKeys?.has(c.componentPropertyReferences?.visible));
  const hide = (list, from) => list.forEach((c, i) => from[i].visible === false && markHidden(c, from[i].componentPropertyReferences.visible));
  // Wrapper without own styles around a same-size child (component frame, inline instance shell): skip it,
  // so layer keys stay the same across variants and component sets nested differently. Overlays beside the child
  // (the loading spinner) move into it, the wrapper's opacity (disabled) multiplies the child's.
  const flow = children.filter((c) => !isOverlay(c));
  if (flow.length === 1 && isWrapper(n, flow[0]) && !(flow.length < children.length && isGraphic(flow[0]))) {
    const inner = normNode(flow[0], key, ctx);
    inner.wrappers = [n.name, ...(inner.wrappers ?? [])];
    if (node.instance && !inner.instance) inner.via = node.instance.name;
    const opacity = (n.opacity ?? 1) * (flow[0].opacity ?? 1);
    if (opacity < 1) inner.expect = { ...inner.expect, opacity: String(r2(opacity)) };
    const extra = [...children.filter(isOverlay), ...toggled];
    if (extra.length) {
      const seen = new Map((inner.children ?? []).map((c) => [c.key.slice(key.length + 1), 1]));
      const added = normChildren(extra, key, ctx, seen);
      hide(added, extra);
      inner.children = [...(inner.children ?? []), ...added];
    }
    return inner;
  }
  const all = (n.children ?? []).filter((c) => children.includes(c) || toggled.includes(c));
  if (all.length) {
    node.children = normChildren(all, key, ctx);
    hide(node.children, all);
  }
  return node;
}

// Shown only when its BOOLEAN prop is on: no element in the default render, nothing for style-check to compare.
function markHidden(node, ref) {
  node.hidden = ref.replace(/#[\d:]+$/, '');
  const strip = (x) => {
    delete x.expect;
    x.children?.forEach(strip);
  };
  strip(node);
}

// ── manual edits, node map, summary ───────────────────────────────────────────

// Figma props match by their key; synthetic and manual ones (key null) only by name.
const sameProp = (x, p) => (p.key ? x.key === p.key || (Boolean(x.key) && x.figma === p.figma) : !x.key && x.figma === p.figma);

/** Manual decisions on props win; options that appeared since (a new size, a new view) are added to the map. */
export function mergeProps(props, previous) {
  // Props the agent added by hand (an extra React prop for one Figma value, like hint) survive re-normalization.
  for (const old of previous?.props ?? []) {
    if (old.key) continue;
    const same = props.findIndex((p) => sameProp(old, p) || p.react === old.react);
    if (same === -1) props.push(old);
    else if (old.manual && props[same].synthetic) props[same] = old; // a decision by hand beats a guess
  }
  for (const p of props) {
    const old = previous?.props?.find((x) => sameProp(x, p));
    if (!old) continue;
    // Edited values only for options Figma still has: View=Secondary Outline is gone once Outline became its own axis.
    const kept = Object.fromEntries(Object.entries(old.map ?? {}).filter(([k]) => !p.map || k in p.map));
    Object.assign(p, { react: old.react, reactType: old.reactType, role: old.role, map: { ...p.map, ...kept } });
    if (p.role === 'prop' && p.reactType !== 'boolean') {
      // True/False of another set maps to booleans: the prop stays boolean, not the strings 'true' | 'false'.
      const values = [...new Set(Object.values(p.map))];
      p.reactType = values.every((x) => typeof x === 'boolean') ? 'boolean' : values.map((x) => `'${x}'`).join(' | ');
    }
  }
  return props;
}

function keepManualEdits(spec, previous) {
  mergeProps(spec.props, previous);
  const manual = new Set(spec.props.filter((p) => !p.key && p.react).map((p) => p.react));
  for (const t of spec.targets) {
    const old = previous.targets?.find((x) => x.figmaNodeId === t.figmaNodeId);
    if (!old) continue;
    // Edited values win for props the target still has and for manual props; keys the new mapping dropped stay dropped.
    const props = { ...t.props };
    for (const [k, v] of Object.entries(old.props ?? {})) {
      if (!(k in t.props) && !manual.has(k)) continue;
      // A value the prop no longer has (API changed: secondary-outline → outline) is not a manual edit to keep.
      const prop = spec.props.find((p) => p.react === k && p.role === 'prop' && p.map);
      if (prop && typeof v === 'string' && !Object.values(prop.map).includes(v)) continue;
      props[k] = v;
    }
    Object.assign(t, { id: old.id, title: old.title, props, pseudo: old.pseudo, frame: old.frame });
  }
  for (const i of spec.instances) {
    const old = previous.instances?.find((x) => x.key === i.key);
    if (old?.resolution) i.resolution = old.resolution;
  }
  return spec;
}

// Proposed CSS-module class per layer key; the agent may edit node-map.json, normalize keeps existing entries.
export function writeNodeMap(e, spec) {
  const file = path.join(e.craftlog, 'figma', 'node-map.json');
  // Keys no target has any more (layers renamed, wrappers collapsed) are dropped.
  const keys = new Set();
  const collect = (node) => (keys.add(node.key), node.children?.forEach(collect));
  spec.targets.forEach((t) => collect(t.tree));
  const map = Object.fromEntries(Object.entries(readJson(file, {})).filter(([k]) => keys.has(k)));
  const used = new Set(Object.values(map));
  const walk = (node, inSlot = false) => {
    // Slot content (an icon the consumer passes) has no element of its own in the component.
    if (inSlot || node.slot) {
      map[node.key] = null;
      return node.children?.forEach((c) => walk(c, true));
    }
    if (!(node.key in map)) {
      let cls = node.key === 'root' ? 'root' : camel(node.key.split('/').pop()) || 'node';
      if (/^\d/.test(cls)) cls = `n${cls}`;
      const base = cls;
      for (let i = 2; used.has(cls); i++) cls = `${base}${i}`;
      map[node.key] = cls;
      used.add(cls);
    }
    node.children?.forEach((c) => walk(c)); // not forEach(walk): the index would land in inSlot
  };
  spec.targets.forEach((t) => walk(t.tree));
  writeJson(file, map);
}

function printSummary(spec) {
  console.log(`${spec.kind}/${spec.name} ← ${spec.figma.nodeType} "${spec.figma.nodeName}" (${spec.source})`);
  console.log(`\nСвойства (Figma → React):`);
  for (const p of spec.props) {
    const map = p.map ? Object.entries(p.map).map(([k, v]) => `${k}→${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '';
    console.log(`  ${p.figma} [${p.type}] → ${p.react ?? '(состояние)'}${p.reactType ? `: ${p.reactType}` : ''}${map ? `  {${map}}` : ''}`);
  }
  // Each target as its difference from the default one: the full props of every target do not fit a small context.
  const base = defaultTarget(spec);
  const diffs = new Map(targetDiffs(spec).map((d) => [d.id, d.diff]));
  console.log(`\nTargets (${spec.targets.length}), отличия от "${base.id}" ${JSON.stringify(base.props ?? {})}:`);
  for (const t of spec.targets.slice(0, 40)) console.log(`  ${t.id}  ${t.size ? `${t.size.width}×${t.size.height}` : ''}  ${diffs.get(t.id) || '—'}`);
  if (spec.targets.length > 40) console.log(`  … ещё ${spec.targets.length - 40} (все: npm run craftui -- spec ${spec.name})`);
  console.log(`\nТокены: ${spec.tokens.length}${spec.tokens.length ? ` (${spec.tokens.slice(0, 6).map((t) => t.name).join(', ')}${spec.tokens.length > 6 ? ', …' : ''})` : ''}`);
  console.log(`Шрифты: ${spec.fonts.map((f) => `${f.family} ${f.styles.join('/')}`).join('; ') || '—'}`);
  // Sizes repeat the same nested parts under other names: one line per outcome.
  const nested = new Map();
  for (const i of spec.instances) nested.set(i.resolution ?? 'не решено', [...new Set([...(nested.get(i.resolution ?? 'не решено') ?? []), i.name.trim()])]);
  console.log(`Вложенные компоненты: ${[...nested].map(([r, names]) => `${r}: ${names.join(', ')}`).join('; ') || '—'}`);
  console.log(`Ассеты: ${spec.assets.map((a) => a.file).join(', ') || '—'}`);
  const unloaded = new Map();
  const walk = (n, t) => (n.unloaded && unloaded.set(n.instance?.name ?? n.name, [...new Set([...(unloaded.get(n.instance?.name ?? n.name) ?? []), t.id])]), n.children?.forEach((c) => walk(c, t)));
  spec.targets.forEach((t) => walk(t.tree, t));
  if (unloaded.size) {
    console.log(`⚠ Figma не подгрузила содержимое библиотечных компонентов: ${[...unloaded].map(([n, ids]) => `${n.trim()} (${ids.length} targets)`).join('; ')}.`);
    console.log('  Эталоны PNG верные, но стилей этих слоёв в spec нет: бери их из targets, где слой есть, или из инстансов в родительском компоненте.');
  }
  const slots = describeSlots(spec);
  if (slots.length) console.log(`Содержимое слотов (размер задаёт содержимое, не компонент):\n${slots.map((l) => `  ${l}`).join('\n')}`);
  for (const s of spec.suggestedSlots ?? []) {
    console.log(`? «${s.name}» ${s.size ? `${s.size.width}×${s.size.height} ` : ''}есть во всех вариантах — вероятно, содержимое (иконка от потребителя). ` +
      `Согласуй и привяжи: npm run craftui -- slot ${spec.name} ${s.keys.map((k) => `@${k}`).join(' ')} <children|icon>`);
  }
  if (spec.truncated) console.log('⚠ дерево обрезано (слишком много узлов) — импортируй части отдельно.');
}

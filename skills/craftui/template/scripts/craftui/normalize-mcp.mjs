// Figma MCP raw files → spec.json. Structure and variants come from get_metadata (XML),
// styles from get_design_context code (Tailwind classes, best effort), tokens from get_variable_defs.
// shortcut: Tailwind parsing covers common arbitrary-value classes only; extend when a design uses others.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, slug } from './lib.mjs';
import { buildProps, targetId } from './normalize.mjs';

const r2 = (v) => Math.round(v * 100) / 100;

function parseXml(xml) {
  const root = { children: [] };
  const stack = [root];
  for (const m of xml.matchAll(/<(\/?)([\w-]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, selfClose] = m;
    if (close) {
      stack.pop();
      continue;
    }
    const node = { tag, attrs: {}, children: [] };
    for (const a of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) node.attrs[a[1]] = a[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    stack.at(-1).children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children[0];
}

const variantOf = (name) => {
  if (!name?.includes('=')) return null;
  return Object.fromEntries(name.split(/,\s*/).map((p) => p.split('=').map((s) => s.trim())));
};

export function fromMcp(raw, e, ctx) {
  const xml = parseXml(fs.readFileSync(path.join(raw, 'metadata.xml'), 'utf8'));
  if (!xml) throw new Error('metadata.xml: не удалось разобрать');
  const variantNodes = xml.children.filter((c) => variantOf(c.attrs.name));
  const isSet = variantNodes.length > 0;
  const variants = (isSet ? variantNodes : [xml]).map((n) => ({
    id: n.attrs.id,
    name: n.attrs.name,
    variantProperties: isSet ? variantOf(n.attrs.name) : null,
    width: Number(n.attrs.width),
    height: Number(n.attrs.height),
    node: n,
  }));

  const definitions = {};
  for (const v of variants) {
    for (const [k, value] of Object.entries(v.variantProperties ?? {})) {
      definitions[k] ??= { type: 'VARIANT', variantOptions: [], defaultValue: value };
      if (!definitions[k].variantOptions.includes(value)) definitions[k].variantOptions.push(value);
    }
  }
  const props = buildProps(definitions, variants);
  const tokens = mcpTokens(raw, ctx);

  const used = new Set();
  const targets = variants.map((v) => {
    let id = targetId(v.variantProperties, props) || 'default';
    for (let i = 2; used.has(id); i++) id = `${targetId(v.variantProperties, props)}-${i}`;
    used.add(id);
    const classes = designContextClasses(raw, v.id);
    const t = {
      id,
      title: v.name,
      figmaNodeId: v.id,
      variant: v.variantProperties,
      size: { width: r2(v.width), height: r2(v.height) },
      props: {},
      tree: normXml(v.node, 'root', classes),
    };
    for (const p of props) {
      const value = v.variantProperties?.[p.figma];
      if (value === undefined) continue;
      if (p.role === 'state') {
        const role = p.map[value];
        if (role?.pseudo) (t.pseudo ??= []).push(role.pseudo);
        if (role?.flag) t.props[role.flag] = true;
      } else if (p.role === 'slot') {
        if (p.map[value]) t.props[p.react] = `$slot:${p.map[value]}`;
      } else if (p.react) t.props[p.react] = p.map[value];
    }
    return t;
  });

  return {
    version: 1,
    kind: e.kind,
    name: e.name,
    source: 'mcp',
    figma: { fileKey: readJson(path.join(e.craftlog, 'figma', 'source.json'))?.fileKey, nodeId: xml.attrs.id, nodeType: isSet ? 'COMPONENT_SET' : xml.tag.toUpperCase(), nodeName: xml.attrs.name },
    props,
    targets,
    tokens,
    instances: collectInstances(xml),
    assets: [],
    fonts: [],
    note: 'MCP: свойства TEXT/BOOLEAN/INSTANCE_SWAP в metadata нет — добавь их в props вручную по design context.',
  };
}

function normXml(n, key, classes) {
  const node = { key, name: n.attrs.name, type: n.tag.toUpperCase(), figmaId: n.attrs.id };
  if (n.attrs.width) node.box = { x: r2(Number(n.attrs.x ?? 0)), y: r2(Number(n.attrs.y ?? 0)), w: r2(Number(n.attrs.width)), h: r2(Number(n.attrs.height)) };
  const cls = classes.get(n.attrs.id);
  if (cls) {
    node.css = tailwindToCss(cls);
    node.expect = expectFromCss(node.css, node.type);
  }
  if (n.tag === 'instance') return node;
  const seen = new Map();
  if (n.children.length) {
    node.children = n.children.map((c) => {
      const base = slug(c.attrs.name) || c.tag;
      const i = (seen.get(base) ?? 0) + 1;
      seen.set(base, i);
      return normXml(c, `${key}/${i > 1 ? `${base}-${i}` : base}`, classes);
    });
  }
  return node;
}

function collectInstances(xml) {
  const map = new Map();
  const walk = (n) => {
    if (n.tag === 'instance') {
      const name = n.attrs.name;
      const entry = map.get(name) ?? { key: `mcp:${name}`, name, nodeIds: [], resolution: null };
      entry.nodeIds.push(n.attrs.id);
      map.set(name, entry);
    }
    n.children.forEach(walk);
  };
  walk(xml);
  return [...map.values()];
}

// design-context/<id with ":"→"-">.tsx: map data-node-id → className
function designContextClasses(raw, nodeId) {
  const out = new Map();
  const dir = path.join(raw, 'design-context');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.tsx') || f.endsWith('.txt')) : [];
  const own = files.filter((f) => f.startsWith(nodeId.replace(/:/g, '-')));
  for (const f of own.length ? own : files) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of code.matchAll(/<\w+\s([^>]*?)>/g)) {
      const id = m[1].match(/data-node-id="([^"]+)"/)?.[1];
      const cls = m[1].match(/className="([^"]+)"/)?.[1];
      if (id && cls && !out.has(id)) out.set(id, cls);
    }
  }
  return out;
}

const SPACE = (v) => (/^\d+(\.\d+)?$/.test(v) ? `${Number(v) * 4}px` : v);
const arb = (v) => v.replace(/^\[|\]$/g, '').replace(/_/g, ' ');

export function tailwindToCss(className) {
  const css = {};
  const sides = { t: ['top'], r: ['right'], b: ['bottom'], l: ['left'], x: ['left', 'right'], y: ['top', 'bottom'], '': ['top', 'right', 'bottom', 'left'] };
  for (const c of className.split(/\s+/)) {
    let m;
    if ((m = c.match(/^p([trblxy]?)-(.+)$/))) for (const s of sides[m[1]]) css[`padding-${s}`] = SPACE(arb(m[2]));
    else if ((m = c.match(/^gap-([xy]-)?(.+)$/))) {
      const v = SPACE(arb(m[2]));
      if (!m[1] || m[1] === 'x-') css['column-gap'] = v;
      if (!m[1] || m[1] === 'y-') css['row-gap'] = v;
    } else if ((m = c.match(/^(w|h|size|min-w|max-w|min-h|max-h)-\[(.+)\]$/))) {
      const prop = { w: ['width'], h: ['height'], size: ['width', 'height'], 'min-w': ['min-width'], 'max-w': ['max-width'], 'min-h': ['min-height'], 'max-h': ['max-height'] }[m[1]];
      for (const p of prop) css[p] = arb(m[2]);
    } else if ((m = c.match(/^rounded(-(tl|tr|bl|br|t|b|l|r))?-\[(.+)\]$/))) {
      const corners = { tl: ['top-left'], tr: ['top-right'], bl: ['bottom-left'], br: ['bottom-right'], t: ['top-left', 'top-right'], b: ['bottom-left', 'bottom-right'], l: ['top-left', 'bottom-left'], r: ['top-right', 'bottom-right'] }[m[2]] ?? ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
      for (const k of corners) css[`border-${k}-radius`] = arb(m[3]);
    } else if ((m = c.match(/^bg-\[(.+)\]$/))) css['background-color'] = arb(m[1]);
    else if ((m = c.match(/^text-\[(.+)\]$/))) {
      const v = arb(m[1]);
      css[/^(#|rgb|hsl|var\(--[^,]*,\s*#)/.test(v) || v.startsWith('color:') ? 'color' : 'font-size'] = v.replace(/^color:/, '');
    } else if ((m = c.match(/^leading-\[(.+)\]$/))) css['line-height'] = arb(m[1]);
    else if ((m = c.match(/^tracking-\[(.+)\]$/))) css['letter-spacing'] = arb(m[1]);
    else if ((m = c.match(/^font-\[(.+)\]$/))) {
      const v = arb(m[1]);
      if (/^\d+$/.test(v)) css['font-weight'] = v;
      else css['font-family'] = v.replace(/^'|'$/g, '').split(':')[0];
    } else if ((m = c.match(/^opacity-\[?([\d.]+)\]?$/))) css.opacity = String(Number(m[1]) > 1 ? Number(m[1]) / 100 : Number(m[1]));
    else if ((m = c.match(/^border-\[(.+)\]$/))) css['border-color'] = arb(m[1]);
    else if (c === 'flex') css.display = 'flex';
    else if (c === 'flex-col') css['flex-direction'] = 'column';
    else if ((m = c.match(/^items-(start|end|center|stretch|baseline)$/))) css['align-items'] = { start: 'flex-start', end: 'flex-end' }[m[1]] ?? m[1];
    else if ((m = c.match(/^justify-(start|end|center|between)$/))) css['justify-content'] = { start: 'flex-start', end: 'flex-end', between: 'space-between' }[m[1]] ?? m[1];
  }
  // A single-axis flex gap only matters along the main axis.
  if (css.display === 'flex' && !/gap-[xy]-/.test(className)) delete css[css['flex-direction'] === 'column' ? 'column-gap' : 'row-gap'];
  return css;
}

function expectFromCss(css, type) {
  const keep = type === 'TEXT'
    ? ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color']
    : ['width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'column-gap', 'row-gap', 'background-color', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius', 'opacity'];
  const out = {};
  for (const k of keep) {
    if (css[k] === undefined) continue;
    // var(--x, #fff) → fallback value, comparable with computed styles
    out[k] = css[k].replace(/^var\(--[^,]+,\s*(.+)\)$/, '$1');
  }
  return out;
}

function mcpTokens(raw, ctx) {
  const vars = readJson(path.join(raw, 'variables.json'), {});
  return Object.entries(vars).map(([name, value]) => ({
    name: `--${ctx.prefix}${slug(name)}`,
    figma: name,
    type: /^#|rgb/.test(String(value)) ? 'COLOR' : 'FLOAT',
    defaultMode: 'default',
    values: { default: /^-?\d+(\.\d+)?$/.test(String(value)) ? `${value}px` : String(value) },
    source: 'variable',
  }));
}

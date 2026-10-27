// Compact views of spec.json for agents with a small context window: the CSS and markup drafts that scaffold writes,
// the brief for the code step (`craftui brief`) and bounded look-ups (`craftui spec`). spec.json itself is far too big to read.
import path from 'node:path';
import { fail, findEntity, readJson } from './lib.mjs';

const LIMIT = 12000; // characters of one printout: about 4k tokens
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const defaultTarget = (spec) => spec.targets.find((t) => t.id === 'default') ?? spec.targets[0];
export const tagOf = (name, spec) => (/button|btn|кнопк/i.test(`${name} ${spec.figma?.nodeName ?? ''}`) ? 'button' : /link|ссылк/i.test(name) ? 'a' : 'div');

export function load(ref) {
  const e = findEntity(ref);
  const spec = readJson(e.specFile) ?? fail(`нет spec.json — npm run craftui -- normalize ${e.name}`);
  const nodeMap = readJson(path.join(e.craftlog, 'figma', 'node-map.json'), { root: 'root' });
  return { e, spec, nodeMap };
}

// ── axes: what a target differs on ────────────────────────────────────────────

function axesOf(spec) {
  const variants = spec.props.filter((p) => p.role === 'prop' && p.react);
  const flags = [...new Set(spec.props.filter((p) => p.role === 'state').flatMap((p) => Object.values(p.map ?? {}).map((r) => r?.flag).filter(Boolean)))];
  const pseudo = [...new Set(spec.targets.flatMap((t) => t.pseudo ?? []))];
  return { variants, flags, pseudo };
}

// Coordinates of a target, in the order rules are written: variant props, state flags, pseudo-classes.
function coords(t, axes) {
  return [
    ...axes.variants.map((p) => [`v:${p.react}`, t.props?.[p.react]]),
    ...axes.flags.map((f) => [`f:${f}`, Boolean(t.props?.[f])]),
    ...axes.pseudo.map((s) => [`p:${s}`, (t.pseudo ?? []).includes(s)]),
  ];
}

const diffKeys = (t, base, axes) => {
  const b = new Map(coords(base, axes));
  return coords(t, axes).filter(([k, v]) => b.get(k) !== v);
};

function selector(diff, tag) {
  let sel = '.root';
  for (const [k, v] of diff) {
    const [kind, name] = [k.slice(0, 1), k.slice(2)];
    if (kind === 'v') sel += v === true ? `[data-${kebab(name)}]` : v === false ? `:not([data-${kebab(name)}])` : `[data-${kebab(name)}='${v}']`;
    else if (kind === 'f') sel += name === 'disabled' && tag === 'button' ? (v ? ':disabled' : ':not(:disabled)') : v ? `[data-${name}]` : `:not([data-${name}])`;
    else sel += v ? `:${name}` : `:not(:${name})`;
  }
  return sel;
}

const label = (diff) => diff.map(([k, v]) => (k.startsWith('p:') ? `:${k.slice(2)}` : v === true ? k.slice(2) : v === false ? `!${k.slice(2)}` : `${k.slice(2)}=${v}`)).join(', ');

// ── declarations of one node, tokens instead of raw values ────────────────────

const CORNERS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'];

// `frame`: the target is shown in a fixed wrapper (Fill in Figma), so the root fills it instead of a fixed width.
function decls(node, isRoot, frame) {
  const out = {};
  const tok = node.tokens ?? {};
  for (const [p, raw] of Object.entries(node.css ?? {})) {
    if (p === 'font-style' && raw === 'normal') continue;
    if (isRoot && frame?.[p]) {
      out[p] = '100%';
      continue;
    }
    // Text boxes take the size of their text.
    if (node.text && (p === 'width' || p === 'height')) continue;
    let v = String(raw).replace(/\s*\/\*.*?\*\//g, '').trim();
    // A token holds the whole value (a font, a shadow list); a gradient's tokens are only its stops.
    const corner = p === 'border-radius' && CORNERS.every((c) => tok[c] && tok[c] === tok[CORNERS[0]]) ? tok[CORNERS[0]] : undefined;
    const token = corner ?? (v.includes('gradient(') ? undefined : (tok[p] ?? (p === 'background' ? tok['background-color'] : undefined)));
    if (token) v = `var(${token})`;
    out[p] = v;
  }
  // Figma keeps layer opacity out of its CSS; a fixed wrapper means the root fills it even without a width in Figma.
  const opacity = node.expect?.opacity;
  if (opacity !== undefined && Number(opacity) !== 1 && !('opacity' in out)) out.opacity = String(opacity);
  if (isRoot) for (const p of ['width', 'height']) if (frame?.[p] && !(p in out)) out[p] = '100%';
  return out;
}

// Declarations per class in a target. Layers sharing a class (a wrapper and its text) add up, the first one wins a clash.
// Slot content and hidden layers belong elsewhere.
function classDecls(target, nodeMap) {
  const out = {};
  const walk = (node, isRoot) => {
    if (node.hidden || node.slot) return;
    const cls = nodeMap[node.key];
    if (cls) out[cls] = { ...decls(node, isRoot, isRoot && target.frame), ...(out[cls] ?? {}) };
    for (const child of node.children ?? []) walk(child, false);
  };
  walk(target.tree, true);
  return out;
}

const applyTo = (into, over) => {
  for (const [cls, d] of Object.entries(over)) into[cls] = { ...(into[cls] ?? {}), ...d };
  return into;
};

// What `actual` sets differently from `expected`, per class present in both (absent → unset).
function residual(actual, expected, { requireBoth = true } = {}) {
  const out = {};
  for (const [cls, d] of Object.entries(actual)) {
    const e = expected[cls];
    if (!e && requireBoth) {
      out[cls] = { ...d };
      continue;
    }
    const r = {};
    for (const [p, v] of Object.entries(d)) if (e?.[p] !== v) r[p] = v;
    for (const p of Object.keys(e ?? {})) if (!(p in d)) r[p] = 'unset';
    if (Object.keys(r).length) out[cls] = r;
  }
  return out;
}

// Keeps only values all the given rule sets agree on.
function consensus(sets) {
  if (sets.length === 1) return sets[0];
  const out = {};
  for (const [cls, d] of Object.entries(sets[0])) {
    for (const [p, v] of Object.entries(d)) if (sets.every((s) => s[cls]?.[p] === v)) (out[cls] ??= {})[p] = v;
  }
  return out;
}

/**
 * Base rules from the default target, then what each axis value changes on its own (targets that differ from the
 * default in that value only), then what combinations still change beyond the sum of their parts.
 */
export function analyze(spec, nodeMap, tag) {
  const axes = axesOf(spec);
  const base = defaultTarget(spec);
  const baseDecls = classDecls(base, nodeMap);
  const byTarget = spec.targets.map((t) => ({ t, diff: diffKeys(t, base, axes), decls: classDecls(t, nodeMap) }));

  const single = new Map(); // "k=v" → { diff, rules }
  for (const x of byTarget.filter((x) => x.diff.length === 1)) {
    const key = JSON.stringify(x.diff);
    single.set(key, [...(single.get(key) ?? []), residual(x.decls, baseDecls)]);
  }
  const singles = [...single].map(([key, sets]) => ({ diff: JSON.parse(key), rules: consensus(sets) }));

  const order = coords(base, axes).map(([k]) => k);
  const combo = new Map();
  let unresolved = 0;
  for (const x of byTarget.filter((x) => x.diff.length > 1)) {
    const expected = structuredClone(baseDecls);
    for (const [k, v] of [...x.diff].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))) {
      const s = singles.find((s) => s.diff[0][0] === k && s.diff[0][1] === v);
      if (s) applyTo(expected, s.rules);
      else unresolved++;
    }
    const key = JSON.stringify(x.diff);
    combo.set(key, [...(combo.get(key) ?? []), residual(x.decls, expected)]);
  }
  const combos = [...combo]
    .map(([key, sets]) => ({ diff: JSON.parse(key), rules: consensus(sets) }))
    .filter((c) => Object.keys(c.rules).length)
    .sort((a, b) => a.diff.length - b.diff.length);

  const rank = (r) => order.indexOf(r.diff[0][0]);
  return { axes, base, baseDecls, singles: singles.sort((a, b) => rank(a) - rank(b)), combos, unresolved, selector: (d) => selector(d, tag) };
}

// ── CSS draft ─────────────────────────────────────────────────────────────────

const block = (sel, d) => `${sel} {\n${Object.entries(d).map(([p, v]) => `  ${p}: ${v};\n`).join('')}}\n`;
const childSel = (rootSel, cls) => (cls === 'root' ? rootSel : `${rootSel} .${cls}`);

export function cssDraft(name, spec, nodeMap, tag) {
  const a = analyze(spec, nodeMap, tag);
  const classes = [...new Set(Object.values(nodeMap).filter(Boolean))];
  const out = [
    `/* ${name}: черновик из craftlog/figma/spec.json (scaffold). База — target "${a.base.id}", ниже — что меняет каждое значение и сочетание. */`,
    '/* Правь по npm run craftui -- verify: черновик не знает про слоты, логику и платформу (фокус, disabled). */',
    '/* Figma sizes include padding and borders. */',
    '.root,\n.root *,\n.root *::before,\n.root *::after {\n  box-sizing: border-box;\n}\n',
  ];
  // A class with no base rules still gets an empty block when nothing else defines it: styles.<cls> must exist.
  const elsewhere = new Set([...a.singles, ...a.combos].flatMap((r) => Object.keys(r.rules)));
  // A native <button> brings its own border and cursor; Figma draws neither.
  const root = { ...(tag === 'button' ? { border: '0', cursor: 'pointer' } : {}), ...(a.baseDecls.root ?? {}) };
  for (const cls of classes) {
    const d = cls === 'root' ? root : (a.baseDecls[cls] ?? {});
    if (Object.keys(d).length || !elsewhere.has(cls)) out.push(block(`.${cls}`, d));
  }
  for (const r of [...a.singles, ...a.combos]) {
    const rules = Object.entries(r.rules).filter(([, d]) => Object.keys(d).length);
    if (!rules.length) continue;
    out.push(`/* ${label(r.diff)} */`);
    for (const [cls, d] of rules) out.push(block(childSel(a.selector(r.diff), cls), d));
  }
  return out.join('\n');
}

// ── markup draft ──────────────────────────────────────────────────────────────

// The text prop a text layer shows: bound by nodeKey, or the prop whose value in the target is that text.
function textProp(node, spec, target) {
  const props = spec.props.filter((p) => p.role === 'text' && p.react);
  return (props.find((p) => p.nodeKey === node.key) ?? props.find((p) => !p.nodeKey && target.props?.[p.react] === node.text?.characters))?.react;
}

export function markupDraft(spec, nodeMap, indent = '      ') {
  const t = defaultTarget(spec);
  // Where each slot sits: bound layers carry `slot`, targets list the layer of every slot they show.
  const slotAt = new Map(spec.targets.flatMap((x) => Object.entries(x.slots ?? {}).map(([prop, s]) => [s.key, prop])));
  const lines = [];
  const walk = (node, depth) => {
    const slot = node.slot ?? slotAt.get(node.key);
    if (slot) return lines.push(`${indent}${'  '.repeat(depth)}{${slot}}`);
    if (node.hidden) return;
    const cls = node.key === t.tree.key ? null : nodeMap[node.key];
    const pad = `${indent}${'  '.repeat(depth)}`;
    const content = node.text ? `{${textProp(node, spec, t) ?? JSON.stringify(node.text.characters ?? '')}}` : null;
    if (!cls) {
      if (content && node.key !== t.tree.key) lines.push(`${pad}${content}`);
      for (const c of node.children ?? []) walk(c, depth);
      return;
    }
    const kids = node.children ?? [];
    if (content || !kids.length) return lines.push(`${pad}<span className={styles.${cls}}>${content ?? ''}</span>`);
    lines.push(`${pad}<span className={styles.${cls}}>`);
    for (const c of kids) walk(c, depth + 1);
    lines.push(`${pad}</span>`);
  };
  for (const c of t.tree.children ?? []) walk(c, 0);
  return lines;
}

// ── brief and look-ups ────────────────────────────────────────────────────────

const cap = (lines, limit = LIMIT, hint = '') => {
  const out = [];
  let size = 0;
  for (const [i, l] of lines.entries()) {
    if (size + l.length > limit) {
      out.push(`… ещё ${lines.length - i} строк${hint ? ` — ${hint}` : ''}`);
      break;
    }
    out.push(l);
    size += l.length + 1;
  }
  return out.join('\n');
};

const oneLine = (d) => Object.entries(d).map(([p, v]) => `${p}: ${v}`).join('; ');

export function brief(ref) {
  const { e, spec, nodeMap } = load(ref);
  return briefOf(e.name, spec, nodeMap);
}

/** The brief for the code step, bounded to about 4k tokens however big the spec is. */
export function briefOf(n, spec, nodeMap) {
  const tag = tagOf(n, spec);
  const a = analyze(spec, nodeMap, tag);
  const lines = [
    `${n}: бриф для шага code. spec.json и figma/raw не открывай — всё нужное здесь; детали: npm run craftui -- spec ${n} [<target>] [<слой>].`,
    '',
    `Корень: <${tag} className={cx(styles.root, className)}>. Варианты — data-атрибуты на корне:`,
    ...a.axes.variants.map((p) => `  data-${kebab(p.react)}: ${p.reactType ?? ''}${p.default !== undefined ? ` (по умолчанию ${JSON.stringify(p.map?.[p.default] ?? p.default)})` : ''}`),
    ...(a.axes.flags.length ? [`  флаги: ${a.axes.flags.map((f) => (f === 'disabled' && tag === 'button' ? 'disabled → :disabled' : `${f} → data-${f}`)).join(', ')}`] : []),
    ...(a.axes.pseudo.length ? [`  псевдоклассы: ${a.axes.pseudo.map((p) => `:${p}`).join(', ')} (без пропсов)`] : []),
    '',
    'Пропсы-содержимое:',
    ...spec.props
      .filter((p) => p.react && (p.role === 'text' || p.role === 'slot'))
      .map((p) => `  ${p.react}: ${p.role === 'slot' ? 'слот (ReactNode, размер задаёт содержимое)' : `текст${p.nodeKey ? ` → слой ${p.nodeKey}` : ''}${p.default !== undefined ? `, в макете ${JSON.stringify(p.default)}` : ''}`}`),
    '',
    `Разметка target "${a.base.id}" (класс ← слой; черновик уже в ${n}.tsx):`,
    ...markupDraft(spec, nodeMap, '  '),
  ];
  const inBase = new Set(Object.keys(a.baseDecls));
  const elsewhere = [...new Set(Object.values(nodeMap).filter(Boolean))].filter((c) => !inBase.has(c));
  if (elsewhere.length) {
    const where = (cls) => spec.targets.filter((t) => classDecls(t, nodeMap)[cls]).map((t) => t.id).slice(0, 3).join(', ');
    lines.push('', 'Слои, которых нет в default (показывать по условию):', ...elsewhere.map((c) => `  .${c} — в ${where(c)}`));
  }
  lines.push(
    '',
    `Стили: черновик в styles.module.css — база, ${a.singles.length} правил на отдельные значения, ${a.combos.length} на сочетания.`,
    ...(a.unresolved ? [`  ${a.unresolved} сочетаний без «чистого» target для одной из осей — проверь их по verify.`] : []),
    `Токены: ${[...new Set(spec.targets.flatMap((t) => collectTokens(t.tree)))].slice(0, 40).join(', ')}`,
    '',
    `Дальше: доведи ${n}.tsx (логика, пропсы, доступность) и стили, затем npm run gen && npm run typecheck && npm run craftui -- verify ${n}.`,
  );
  return cap(lines, LIMIT, `полный список — npm run craftui -- spec ${n}`);
}

function collectTokens(node, out = []) {
  if (node.hidden || node.slot) return out;
  out.push(...Object.values(node.tokens ?? {}));
  for (const c of node.children ?? []) collectTokens(c, out);
  return out;
}

/** How each target differs from the default one, e.g. "size=xl, :hover" — short enough for summaries. */
export function targetDiffs(spec) {
  const axes = axesOf(spec);
  const base = defaultTarget(spec);
  return spec.targets.map((t) => ({ id: t.id, diff: label(diffKeys(t, base, axes)) }));
}

/** One target's layer subtree with classes and token-resolved CSS; without a target — the list of targets. */
export function query(ref, targetId, nodeKey, depth = 3) {
  const { e, spec, nodeMap } = load(ref);
  if (!targetId) {
    const axes = axesOf(spec);
    const base = defaultTarget(spec);
    return cap(
      [`${e.name}: ${spec.targets.length} targets (отличия от "${base.id}")`, ...spec.targets.map((t) => `  ${t.id}: ${label(diffKeys(t, base, axes)) || '—'}`)],
      LIMIT,
      'сузь запрос: spec <Name> <target>',
    );
  }
  const t = spec.targets.find((x) => x.id === targetId) ?? fail(`нет target "${targetId}" — список: npm run craftui -- spec ${e.name}`);
  const find = (node) => (node.key === nodeKey ? node : (node.children ?? []).map(find).find(Boolean));
  const start = nodeKey ? (find(t.tree) ?? fail(`нет слоя "${nodeKey}" в ${targetId}`)) : t.tree;
  const lines = [];
  const walk = (node, d) => {
    const cls = nodeMap[node.key];
    const flags = [node.hidden && 'скрыт', node.slot && `слот ${node.slot}`, node.text && JSON.stringify(node.text.characters)].filter(Boolean).join(', ');
    lines.push(`${'  '.repeat(d)}${node.key}${cls ? ` .${cls}` : ''} [${node.type} ${node.box?.w}×${node.box?.h}]${flags ? ` ${flags}` : ''}`);
    const css = oneLine(decls(node, node === t.tree, node === t.tree && t.frame));
    if (css) lines.push(`${'  '.repeat(d + 1)}{ ${css} }`);
    if (d < depth) for (const c of node.children ?? []) walk(c, d + 1);
    else if (node.children?.length) lines.push(`${'  '.repeat(d + 1)}… ${node.children.length} вложенных — spec ${e.name} ${targetId} ${node.children[0].key}`);
  };
  walk(start, 0);
  return cap(lines, LIMIT, 'сузь: укажи слой или --depth');
}

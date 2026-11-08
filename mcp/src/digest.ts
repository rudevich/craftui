// Compact views of spec.json for agents with a small context window: the CSS and markup drafts that scaffold writes,
// the brief for the code step (`craftui brief`) and bounded look-ups (`craftui spec`). spec.json itself is far too big to read.
import path from 'node:path';
import { fail, findEntity, printLimit, readJson } from './lib.ts';
import type { Css, Entity, NodeMap, Prop, Spec, SpecNode, Target } from './types.ts';

/** CSS declarations per class: { root: { padding: '8px' }, label: { … } }. */
export type ClassDecls = Record<string, Css>;
/** One axis a target sits on: [`v:size`, 'm'], [`f:disabled`, true], [`p:hover`, false]. */
type Coord = [string, unknown];
type Rule = { diff: Coord[]; rules: ClassDecls };

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const defaultTarget = (spec: Pick<Spec, 'targets'>): Target => spec.targets.find((t) => t.id === 'default') ?? spec.targets[0];
export const tagOf = (name: string, spec: Pick<Spec, 'figma'>) => (/button|btn|кнопк/i.test(`${name} ${spec.figma?.nodeName ?? ''}`) ? 'button' : /link|ссылк/i.test(name) ? 'a' : 'div');

export function load(ref: string | undefined): { e: Entity; spec: Spec; nodeMap: NodeMap } {
  const e = findEntity(ref);
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — craftui spec {"action":"normalize","entity":"${e.name}"}`);
  const nodeMap = readJson<NodeMap>(path.join(e.craftlog, 'figma', 'node-map.json'), { root: 'root' });
  return { e, spec, nodeMap };
}

// ── axes: what a target differs on ────────────────────────────────────────────

type Axes = { variants: (Prop & { react: string })[]; flags: string[]; pseudo: string[] };

function axesOf(spec: Spec): Axes {
  const variants = spec.props.filter((p): p is Prop & { react: string } => p.role === 'prop' && Boolean(p.react));
  const flagOf = (r: unknown) => (r && typeof r === 'object' && 'flag' in r ? (r as { flag?: string }).flag : undefined);
  const flags = [...new Set(spec.props.filter((p) => p.role === 'state').flatMap((p) => Object.values(p.map ?? {}).map(flagOf).filter((f): f is string => Boolean(f))))];
  const pseudo = [...new Set(spec.targets.flatMap((t) => t.pseudo ?? []))];
  return { variants, flags, pseudo };
}

// Coordinates of a target, in the order rules are written: variant props, state flags, pseudo-classes.
function coords(t: Target, axes: Axes): Coord[] {
  return [
    ...axes.variants.map((p): Coord => [`v:${p.react}`, t.props?.[p.react]]),
    ...axes.flags.map((f): Coord => [`f:${f}`, Boolean(t.props?.[f])]),
    ...axes.pseudo.map((s): Coord => [`p:${s}`, (t.pseudo ?? []).includes(s)]),
  ];
}

const diffKeys = (t: Target, base: Target, axes: Axes): Coord[] => {
  const b = new Map(coords(base, axes));
  return coords(t, axes).filter(([k, v]) => b.get(k) !== v);
};

function selector(diff: Coord[], tag: string): string {
  let sel = '.root';
  for (const [k, v] of diff) {
    const [kind, name] = [k.slice(0, 1), k.slice(2)];
    if (kind === 'v') sel += v === true ? `[data-${kebab(name)}]` : v === false ? `:not([data-${kebab(name)}])` : `[data-${kebab(name)}='${v}']`;
    else if (kind === 'f') sel += name === 'disabled' && tag === 'button' ? (v ? ':disabled' : ':not(:disabled)') : v ? `[data-${name}]` : `:not([data-${name}])`;
    else sel += v ? `:${name}` : `:not(:${name})`;
  }
  return sel;
}

const label = (diff: Coord[]) => diff.map(([k, v]) => (k.startsWith('p:') ? `:${k.slice(2)}` : v === true ? k.slice(2) : v === false ? `!${k.slice(2)}` : `${k.slice(2)}=${v}`)).join(', ');

// ── declarations of one node, tokens instead of raw values ────────────────────

const CORNERS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'];

// `frame`: the target is shown in a fixed wrapper (Fill in Figma), so the root fills it instead of a fixed width.
export function decls(node: SpecNode, isRoot: boolean, frame: Target['frame'] | false | undefined): Css {
  const out: Css = {};
  const tok = node.tokens ?? {};
  for (const [p, raw] of Object.entries(node.css ?? {})) {
    if (p === 'font-style' && raw === 'normal') continue;
    if (isRoot && frame && frame[p as 'width' | 'height']) {
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
  if (isRoot && frame) for (const p of ['width', 'height'] as const) if (frame[p] && !(p in out)) out[p] = '100%';
  return out;
}

// Declarations per class in a target. Layers sharing a class (a wrapper and its text) add up, the first one wins a clash.
// Slot content and hidden layers belong elsewhere.
export function classDecls(target: Target, nodeMap: NodeMap): ClassDecls {
  const out: ClassDecls = {};
  const walk = (node: SpecNode, isRoot: boolean) => {
    if (node.hidden || node.slot) return;
    const cls = nodeMap[node.key];
    if (cls) out[cls] = { ...decls(node, isRoot, isRoot && target.frame), ...(out[cls] ?? {}) };
    for (const child of node.children ?? []) walk(child, false);
  };
  walk(target.tree, true);
  return out;
}

const applyTo = (into: ClassDecls, over: ClassDecls) => {
  for (const [cls, d] of Object.entries(over)) into[cls] = { ...(into[cls] ?? {}), ...d };
  return into;
};

// What `actual` sets differently from `expected`, per class present in both (absent → unset).
export function residual(actual: ClassDecls, expected: ClassDecls, { requireBoth = true } = {}): ClassDecls {
  const out: ClassDecls = {};
  for (const [cls, d] of Object.entries(actual)) {
    const e = expected[cls];
    if (!e && requireBoth) {
      out[cls] = { ...d };
      continue;
    }
    const r: Css = {};
    for (const [p, v] of Object.entries(d)) if (e?.[p] !== v) r[p] = v;
    for (const p of Object.keys(e ?? {})) if (!(p in d)) r[p] = 'unset';
    if (Object.keys(r).length) out[cls] = r;
  }
  return out;
}

// Keeps only values all the given rule sets agree on.
function consensus(sets: ClassDecls[]): ClassDecls {
  if (sets.length === 1) return sets[0];
  const out: ClassDecls = {};
  for (const [cls, d] of Object.entries(sets[0])) {
    for (const [p, v] of Object.entries(d)) if (sets.every((s) => s[cls]?.[p] === v)) (out[cls] ??= {})[p] = v;
  }
  return out;
}

/**
 * Base rules from the default target, then what each axis value changes on its own (targets that differ from the
 * default in that value only), then what combinations still change beyond the sum of their parts.
 */
export function analyze(spec: Spec, nodeMap: NodeMap, tag: string) {
  const axes = axesOf(spec);
  const base = defaultTarget(spec);
  const baseDecls = classDecls(base, nodeMap);
  const byTarget = spec.targets.map((t) => ({ t, diff: diffKeys(t, base, axes), decls: classDecls(t, nodeMap) }));

  const single = new Map<string, ClassDecls[]>(); // diff → rule sets of the targets that differ by it alone
  for (const x of byTarget.filter((x) => x.diff.length === 1)) {
    const key = JSON.stringify(x.diff);
    single.set(key, [...(single.get(key) ?? []), residual(x.decls, baseDecls)]);
  }
  const singles: Rule[] = [...single].map(([key, sets]) => ({ diff: JSON.parse(key) as Coord[], rules: consensus(sets) }));

  const order = coords(base, axes).map(([k]) => k);
  const combo = new Map<string, ClassDecls[]>();
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
  const combos: Rule[] = [...combo]
    .map(([key, sets]) => ({ diff: JSON.parse(key) as Coord[], rules: consensus(sets) }))
    .filter((c) => Object.keys(c.rules).length)
    .sort((a, b) => a.diff.length - b.diff.length);

  const rank = (r: Rule) => order.indexOf(r.diff[0][0]);
  return { axes, base, baseDecls, singles: singles.sort((a, b) => rank(a) - rank(b)), combos, unresolved, selector: (d: Coord[]) => selector(d, tag) };
}

// ── CSS draft ─────────────────────────────────────────────────────────────────

export const block = (sel: string, d: Css) => `${sel} {\n${Object.entries(d).map(([p, v]) => `  ${p}: ${v};\n`).join('')}}\n`;
const childSel = (rootSel: string, cls: string) => (cls === 'root' ? rootSel : `${rootSel} .${cls}`);

export function cssDraft(name: string, spec: Spec, nodeMap: NodeMap, tag: string): string {
  const a = analyze(spec, nodeMap, tag);
  // Layers resolved into imported entities are rendered by that entity: the draft carries neither their markup nor styles.
  const entityLayers = entityLayersOf(spec);
  const skip = new Set<string>();
  for (const t of spec.targets) {
    const walk = (n: SpecNode) => {
      if (entityLayers.has(n.figmaId)) {
        const c = nodeMap[n.key];
        if (c) skip.add(c);
      }
      n.children?.forEach(walk);
    };
    walk(t.tree);
  }
  const classes = [...new Set(Object.values(nodeMap).filter((c): c is string => Boolean(c)))].filter((c) => !skip.has(c));
  const out = [
    `/* ${name}: черновик из craftlog/figma/spec.json (scaffold). База — target "${a.base.id}", ниже — что меняет каждое значение и сочетание. */`,
    '/* Правь по craftui verify: черновик не знает про слоты, логику и платформу (фокус, disabled). */',
    '/* Figma sizes include padding and borders. */',
    '.root,\n.root *,\n.root *::before,\n.root *::after {\n  box-sizing: border-box;\n}\n',
  ];
  // A class with no base rules still gets an empty block when nothing else defines it: styles.<cls> must exist.
  const elsewhere = new Set([...a.singles, ...a.combos].flatMap((r) => Object.keys(r.rules)));
  // A native <button> brings its own border and cursor; Figma draws neither.
  const root: Css = { ...(tag === 'button' ? { border: '0', cursor: 'pointer' } : {}), ...(a.baseDecls.root ?? {}) };
  for (const cls of classes) {
    const d = cls === 'root' ? root : (a.baseDecls[cls] ?? {});
    if (Object.keys(d).length || !elsewhere.has(cls)) out.push(block(`.${cls}`, d));
  }
  for (const r of [...a.singles, ...a.combos]) {
    const rules = Object.entries(r.rules).filter(([cls, d]) => !skip.has(cls) && Object.keys(d).length);
    if (!rules.length) continue;
    out.push(`/* ${label(r.diff)} */`);
    for (const [cls, d] of rules) out.push(block(childSel(a.selector(r.diff), cls), d));
  }
  return out.join('\n');
}

// ── markup draft ──────────────────────────────────────────────────────────────

// The text prop a text layer shows: bound by nodeKey, or the prop whose value in the target is that text.
function textProp(node: SpecNode, spec: Spec, target: Target): string | undefined {
  const props = spec.props.filter((p) => p.role === 'text' && p.react);
  return (props.find((p) => p.nodeKey === node.key) ?? props.find((p) => !p.nodeKey && target.props?.[p.react!] === node.text?.characters))?.react ?? undefined;
}

/** figmaId → entity name for instances resolved into imported entities: the drafts place them, not their layers. */
function entityLayersOf(spec: Spec): Map<string, string> {
  const map = new Map<string, string>();
  for (const i of spec.instances ?? []) {
    if (!i.resolution?.startsWith('entity:')) continue;
    const name = i.resolution.slice('entity:'.length).split('/')[1] ?? '';
    if (!name) continue;
    for (const id of i.nodeIds) map.set(id, name);
  }
  return map;
}

/** data-* attributes of the modes a layer switches (Theme=Dark → data-theme="dark"): tokens.css keys its values by them. */
export const modeAttrs = (modes: Record<string, string> | undefined) => Object.entries(modes ?? {}).map(([a, v]) => ` ${a}="${v}"`).join('');

export function markupDraft(spec: Spec, nodeMap: NodeMap, indent = '      '): string[] {
  const t = defaultTarget(spec);
  // Where each slot sits: bound layers carry `slot`, targets list the layer of every slot they show.
  const slotAt = new Map(spec.targets.flatMap((x) => Object.entries(x.slots ?? {}).map(([prop, s]) => [s.key, prop])));
  const entityAt = entityLayersOf(spec);
  const lines: string[] = [];
  // The tree root itself can be an instance (a composite): the component assembles from it, the layers below are its surroundings.
  const rootEntity = entityAt.get(t.tree.figmaId);
  if (rootEntity) lines.push(`${indent}{/* Корень — <${rootEntity} />: рендерь его композицию; слои ниже — окружение */}`);
  const walk = (node: SpecNode, depth: number): number | void => {
    const slot = node.slot ?? slotAt.get(node.key);
    if (slot) return lines.push(`${indent}${'  '.repeat(depth)}{${slot}}`);
    if (node.hidden) return;
    const entity = entityAt.get(node.figmaId);
    if (entity) return lines.push(`${indent}${'  '.repeat(depth)}{/* <${entity} /> */}`);
    const cls = node.key === t.tree.key ? null : nodeMap[node.key];
    const pad = `${indent}${'  '.repeat(depth)}`;
    const content = node.text ? `{${textProp(node, spec, t) ?? JSON.stringify(node.text.characters ?? '')}}` : null;
    const modes = node.key === t.tree.key ? '' : modeAttrs(node.modes);
    if (!cls && !modes) {
      if (content && node.key !== t.tree.key) lines.push(`${pad}${content}`);
      for (const c of node.children ?? []) walk(c, depth);
      return;
    }
    // A layer without a class that switches a mode still needs an element to carry it; it takes no box.
    const own = cls ? ` className={styles.${cls}}${modes}` : `${modes} style={{ display: 'contents' }}`;
    const kids = node.children ?? [];
    if (content || !kids.length) return lines.push(`${pad}<span${own}>${content ?? ''}</span>`);
    lines.push(`${pad}<span${own}>`);
    for (const c of kids) walk(c, depth + 1);
    lines.push(`${pad}</span>`);
  };
  for (const c of t.tree.children ?? []) walk(c, 0);
  return lines;
}

// ── brief and look-ups ────────────────────────────────────────────────────────

// One printout stays within the model's window budget: craftui.config.json → context (small ≈ 4k tokens).
export const cap = (lines: string[], limit = printLimit(), hint = '') => {
  const out: string[] = [];
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

const oneLine = (d: Css) => Object.entries(d).map(([p, v]) => `${p}: ${v}`).join('; ');

export async function brief(ref: string | undefined): Promise<string> {
  const { e, spec, nodeMap } = load(ref);
  if (e.kind === 'page') return (await import('./digest-page.ts')).pageBrief(e, spec, nodeMap);
  return briefOf(e.name, spec, nodeMap);
}

/** The brief for the code step, bounded to about 4k tokens however big the spec is. */
export function briefOf(n: string, spec: Spec, nodeMap: NodeMap): string {
  const tag = tagOf(n, spec);
  const a = analyze(spec, nodeMap, tag);
  const lines = [
    `${n}: бриф для шага code. spec.json и figma/raw не открывай — всё нужное здесь; детали: craftui digest {"action":"spec","entity":"${n}","target":"<target>","layer":"<слой>"}.`,
    '',
    `Корень: <${tag} className={cx(styles.root, className)}>. Варианты — data-атрибуты на корне:`,
    ...a.axes.variants.map((p) => `  data-${kebab(p.react)}: ${p.reactType ?? ''}${p.default !== undefined ? ` (по умолчанию ${JSON.stringify(p.map?.[String(p.default)] ?? p.default)})` : ''}`),
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
  // Resolved instances: what the component composes from, and container-shaped repeats.
  const entities = (spec.instances ?? []).filter((i) => i.resolution?.startsWith('entity:'));
  if (entities.length) {
    lines.push('', 'Инстансы:', ...entities.map((i) => `  ${i.name} ×${i.nodeIds.length} → ${i.resolution!.slice('entity:'.length)}`));
    const containers = entities.filter((i) => i.nodeIds.length >= 3);
    if (containers.length) lines.push(`  ×N однотипных инстансов (${containers.map((i) => i.name).join(', ')}) — вероятный контейнер слотов: продумай children/slot API.`);
  }
  // Unloaded library content: the spec does not hold what those instances render.
  const unloaded = new Set<string>();
  for (const t of spec.targets) {
    const walk = (x: SpecNode) => {
      if (x.unloaded) unloaded.add(x.instance?.name ?? x.name);
      x.children?.forEach(walk);
    };
    walk(t.tree);
  }
  if (unloaded.size) lines.push('', `⚠ Содержимое не подгрузилось у: ${[...unloaded].join(', ')} — состав айтемов/иконок сверяй с эталонами PNG и уточни у пользователя.`);
  const inBase = new Set(Object.keys(a.baseDecls));
  const elsewhere = [...new Set(Object.values(nodeMap).filter((c): c is string => Boolean(c)))].filter((c) => !inBase.has(c));
  if (elsewhere.length) {
    const where = (cls: string) => spec.targets.filter((t) => classDecls(t, nodeMap)[cls]).map((t) => t.id).slice(0, 3).join(', ');
    lines.push('', 'Слои, которых нет в default (показывать по условию):', ...elsewhere.map((c) => `  .${c} — в ${where(c)}`));
  }
  lines.push(
    '',
    `Стили: черновик в styles.module.css — база, ${a.singles.length} правил на отдельные значения, ${a.combos.length} на сочетания.`,
    ...(a.unresolved ? [`  ${a.unresolved} сочетаний без «чистого» target для одной из осей — проверь их по verify.`] : []),
    `Токены: ${[...new Set(spec.targets.flatMap((t) => collectTokens(t.tree)))].slice(0, 40).join(', ')}`,
    '',
    `Дальше: доведи ${n}.tsx (логика, пропсы, доступность) и стили, затем npm run gen && npm run typecheck && craftui verify {"entity":"${n}"}.`,
  );
  return cap(lines, printLimit(), `полный список — craftui digest {"action":"spec","entity":"${n}"}`);
}

function collectTokens(node: SpecNode, out: string[] = []): string[] {
  if (node.hidden || node.slot) return out;
  out.push(...Object.values(node.tokens ?? {}));
  for (const c of node.children ?? []) collectTokens(c, out);
  return out;
}

/** How each target differs from the default one, e.g. "size=xl, :hover" — short enough for summaries. */
export function targetDiffs(spec: Spec): { id: string; diff: string }[] {
  const axes = axesOf(spec);
  const base = defaultTarget(spec);
  return spec.targets.map((t) => ({ id: t.id, diff: label(diffKeys(t, base, axes)) }));
}

/** One target's layer subtree with classes and token-resolved CSS; without a target — the list of targets. */
export function query(ref: string | undefined, targetId: string | undefined, nodeKey: string | undefined, depth = 3): string {
  const { e, spec, nodeMap } = load(ref);
  if (!targetId) {
    const axes = axesOf(spec);
    const base = defaultTarget(spec);
    return cap(
      [`${e.name}: ${spec.targets.length} targets (отличия от "${base.id}")`, ...spec.targets.map((t) => `  ${t.id}: ${label(diffKeys(t, base, axes)) || '—'}`)],
      printLimit(),
      'сузь запрос: spec <Name> <target>',
    );
  }
  const t = spec.targets.find((x) => x.id === targetId) ?? fail(`нет target "${targetId}" — список: craftui digest {"action":"spec","entity":"${e.name}"}`);
  const find = (node: SpecNode): SpecNode | undefined => (node.key === nodeKey ? node : (node.children ?? []).map(find).find(Boolean));
  const start = nodeKey ? (find(t.tree) ?? fail(`нет слоя "${nodeKey}" в ${targetId}`)) : t.tree;
  const lines: string[] = [];
  const walk = (node: SpecNode, d: number) => {
    const cls = nodeMap[node.key];
    const flags = [node.hidden && 'скрыт', node.slot && `слот ${node.slot}`, node.text && JSON.stringify(node.text.characters)].filter(Boolean).join(', ');
    lines.push(`${'  '.repeat(d)}${node.key}${cls ? ` .${cls}` : ''} [${node.type} ${node.box?.w}×${node.box?.h}]${flags ? ` ${flags}` : ''}`);
    const css = oneLine(decls(node, node === t.tree, node === t.tree && t.frame));
    if (css) lines.push(`${'  '.repeat(d + 1)}{ ${css} }`);
    if (d < depth) for (const c of node.children ?? []) walk(c, d + 1);
    else if (node.children?.length) lines.push(`${'  '.repeat(d + 1)}… ${node.children.length} вложенных — spec ${e.name} ${targetId} ${node.children[0].key}`);
  };
  walk(start, 0);
  return cap(lines, printLimit(), 'сузь: укажи слой или --depth');
}

// Drafts and brief of a page: the layers of every breakpoint frame together, mobile-first CSS with container queries
// at the borders of craftui.config.json → pages.breakpoints, components from src/components and inner parts.
import path from 'node:path';
import { breakpointRanges, camel, config, describeBreakpoints, kindDirs, readJson } from './lib.mjs';
import { block, cap, classDecls, modeAttrs } from './digest.mjs';
import { partFolder } from './normalize-page.mjs';

const localOf = (cls) => cls.split('/').pop();
const findKey = (node, key) => (node.key === key ? node : (node.children ?? []).map((c) => findKey(c, key)).find(Boolean));
const folderOf = (cls) => (cls.includes('/') ? cls.split('/')[0] : null);

/** One tree with the layers of all breakpoints: the widest frame's order, layers only narrower frames have slot in after their sibling. */
export function unionTree(targets) {
  const byKey = new Map();
  const visit = (n) => {
    if (!byKey.has(n.key)) byKey.set(n.key, { node: n, children: [] });
    const entry = byKey.get(n.key);
    let at = 0;
    for (const c of n.children ?? []) {
      const i = entry.children.indexOf(c.key);
      if (i === -1) entry.children.splice(at++, 0, c.key);
      else at = i + 1;
    }
    n.children?.forEach(visit);
  };
  [...targets].sort((a, b) => b.size.width - a.size.width).forEach((t) => visit(t.tree));
  const build = (key) => ({ ...byKey.get(key).node, children: byKey.get(key).children.map(build) });
  return byKey.has('root') ? build('root') : null;
}

// ── CSS draft ─────────────────────────────────────────────────────────────────

// What a page may set on a component it uses: its place in the layout. The component styles itself.
const PLACEMENT = new Set(['align-self', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'grid-column', 'grid-row']);

/** Classes of layers that are imported components (only placement) and pictures (an <img>), from every breakpoint. */
function layerKinds(spec, nodeMap) {
  const components = new Set();
  const pictures = new Set();
  // An instance laid out inline (a part made from a kit header) keeps its own styles.
  const imported = new Set((spec.instances ?? []).filter((i) => i.resolution?.startsWith('entity:')).map((i) => i.key));
  const walk = (n) => {
    const cls = nodeMap[n.key];
    if (cls && imported.has(n.instance?.key)) components.add(cls);
    if (cls && n.picture) pictures.add(cls);
    n.children?.forEach(walk);
  };
  spec.targets.forEach((t) => walk(t.tree));
  return { components, pictures };
}

// A wide layer of fixed width in a frame (a content column) stretches instead, up to its width in the design.
// Components keep only their placement; a picture is an <img> that covers its box instead of a background.
function adapt(declsByClass, frameWidth, kinds) {
  for (const [cls, d] of Object.entries(declsByClass)) {
    if (kinds.components.has(cls)) for (const p of Object.keys(d)) if (!PLACEMENT.has(p)) delete d[p];
    if (kinds.pictures.has(cls)) {
      if (/url\(/.test(d.background ?? '')) delete d.background;
      d['object-fit'] = 'cover';
    }
    const w = /^(\d+(?:\.\d+)?)px$/.exec(d.width ?? '')?.[1];
    if (w && Number(w) >= frameWidth / 2) Object.assign(d, { width: '100%', 'max-width': `${w}px` });
  }
  return declsByClass;
}

/** CSS text per file: `''` — the page's styles.module.css, `<PartFolder>` — the part's. */
export function pageCss(name, spec, nodeMap, bp = config().pages.breakpoints) {
  const ranges = breakpointRanges(bp);
  const targets = [...spec.targets].sort((a, b) => a.size.width - b.size.width);
  const all = [...new Set(Object.values(nodeMap).filter(Boolean))];
  const files = new Map([['', [
    `/* ${name}: черновик из craftlog/figma/spec.json (scaffold). Mobile-first: база — ${targets[0]?.id}, шире — @container (min-width) по границам из craftui.config.json. */`,
    '/* Правь по npm run craftui -- verify. Границы брейкпоинтов не меняй: они общие для всех страниц. */',
    '.root,\n.root *,\n.root *::before,\n.root *::after {\n  box-sizing: border-box;\n}\n',
    // The page is the container its breakpoints query: it lays out by its own width, in the demo frame and in an app.
    // Unnamed on purpose: CSS Modules make a container name local to its file, and the parts' files must reach it too.
    block('.root', { 'container-type': 'inline-size', width: '100%' }),
  ]]]);
  const out = (f) => {
    if (!files.has(f)) files.set(f, [`/* ${f}: часть страницы ${name}, черновик из spec.json. Правила шире — @container (min-width), как у страницы: контейнер — корень страницы. */`, '']);
    return files.get(f);
  };

  const kinds = layerKinds({ ...spec, targets }, nodeMap);
  let current = {};
  targets.forEach((t, i) => {
    const actual = adapt(classDecls(t, nodeMap), t.size.width, kinds);
    const rules = {};
    for (const cls of all) {
      const a = actual[cls];
      const c = current[cls];
      if (!a) {
        // Not in this frame: hidden here, shown again where it is.
        if (c && c.display !== 'none') rules[cls] = { display: 'none' };
        else if (!c && i === 0) rules[cls] = { display: 'none' };
        continue;
      }
      const shown = c?.display === 'none' && !a.display ? { display: 'revert' } : {};
      const diff = Object.fromEntries(Object.entries({ ...a, ...shown }).filter(([p, v]) => c?.[p] !== v));
      for (const p of Object.keys(c ?? {})) if (!(p in a) && p !== 'display') diff[p] = 'unset';
      if (Object.keys(diff).length) rules[cls] = diff;
    }
    for (const [cls, d] of Object.entries(rules)) current[cls] = { ...(current[cls] ?? {}), ...d };
    if (!Object.keys(rules).length) return;
    const min = ranges.find((r) => r.name === t.breakpoint)?.min ?? t.size.width;
    const byFile = new Map();
    for (const [cls, d] of Object.entries(rules)) byFile.set(folderOf(cls) ?? '', [...(byFile.get(folderOf(cls) ?? '') ?? []), block(`.${localOf(cls)}`, d)]);
    for (const [f, blocks] of byFile) {
      const lines = out(f);
      if (i === 0 || min === 0) lines.push(...blocks);
      else lines.push(`/* ${t.breakpoint ?? t.id}: ${t.size.width}px в макете */`, `@container (min-width: ${min}px) {`, ...blocks.map((b) => b.replace(/^/gm, '  ').replace(/ +$/gm, '')), '}', '');
    }
  });
  // A class used in markup must exist in its module, even with no rules: style-check finds elements by it.
  const written = (f) => files.get(f)?.join('\n') ?? '';
  for (const cls of all) {
    const f = folderOf(cls) ?? '';
    if (!new RegExp(`\\.${localOf(cls)}\\s*\\{`).test(written(f))) out(f).splice(f === '' ? 4 : 2, 0, block(`.${localOf(cls)}`, {}));
  }
  return new Map([...files].map(([f, lines]) => [f, lines.join('\n')]));
}

// ── markup draft ──────────────────────────────────────────────────────────────

const compDir = () => path.basename(kindDirs().component);

/** <Button size="m" view="accent">Купить</Button>: Figma values of the instance through the component's own spec. */
export function componentJsx(inst, compName, compSpec, className, modes) {
  const attrs = [...(className ? [`className={styles.${className}}`] : []), ...(modes ? [modes.trim()] : [])];
  let children = null;
  for (const p of compSpec?.props ?? []) {
    const figmaValue = inst.variant?.[p.figma] ?? inst.props?.[p.figma];
    // A state the design shows as a flag (Disabled=True → disabled); hover and pressed are the browser's business.
    if (p.role === 'state' && figmaValue !== undefined && p.map?.[figmaValue]?.flag) attrs.push(p.map[figmaValue].flag);
    if (!p.react) continue;
    if (p.role === 'prop' && figmaValue !== undefined) {
      const v = p.map?.[figmaValue] ?? figmaValue;
      if (v === true) attrs.push(p.react);
      else if (v !== false && v !== null && v !== undefined && v !== p.map?.[p.default]) attrs.push(`${p.react}=${JSON.stringify(String(v))}`);
    }
    if (p.role === 'text') {
      // A TEXT property, else (a label without one) the text the instance has in that layer. A boolean is a caption switched off.
      const own = inst.props?.[p.figma] ?? (p.synthetic ? inst.texts?.[p.figma] : undefined);
      const text = typeof own === 'string' ? own : p.default;
      if (typeof text !== 'string') continue;
      if (p.react === 'children') children = text;
      else attrs.push(`${p.react}=${JSON.stringify(String(text))}`);
    }
  }
  const open = [compName, ...attrs].join(' ');
  return children === null ? `<${open} />` : `<${open}>{${JSON.stringify(children)}}</${compName}>`;
}

/**
 * Markup of a subtree (the page from its frame, or a part from its layer): classes from the node map, components,
 * pictures and parts. Collects what the file must import.
 */
export function markup(node, ctx, depth = 0) {
  const pad = `${ctx.indent}${'  '.repeat(depth)}`;
  if (node.hidden) return [];
  if (depth > 0 && ctx.parts.has(node.key)) {
    const { folder, shared } = ctx.parts.get(node.key);
    ctx.imports[shared ? 'shared' : 'parts'].add(folder);
    return [`${pad}<${folder} />`];
  }
  const cls = ctx.nodeMap[node.key] ? localOf(ctx.nodeMap[node.key]) : null;
  const { modes, modeNote } = modesAt(node.key, ctx, pad);
  if (node.instance && !node.asset) {
    const inst = ctx.spec.instances.find((i) => i.key === node.instance.key);
    const entity = /^entity:component\/(\w+)$/.exec(inst?.resolution ?? '')?.[1];
    if (entity) {
      ctx.imports.components.add(entity);
      // Props come from the narrowest frame (mobile first); a prop that changes with the width is a decision for the code step.
      const byWidth = [...ctx.spec.targets]
        .sort((a, b) => a.size.width - b.size.width)
        .map((t) => ({ t, inst: findKey(t.tree, node.key)?.instance }))
        .filter((x) => x.inst);
      const jsx = byWidth.map(({ inst }) => componentJsx(inst, entity, ctx.compSpec(entity), cls, modes));
      const note = new Set(jsx).size > 1 ? [`${pad}{/* ${entity} меняется с шириной: ${byWidth.map(({ t }, i) => `${t.id} ${jsx[i].replace(/^<\w+\s?|\s?\/?>.*$/g, '').replace(/className=\{[^}]+\}\s?/, '') || 'по умолчанию'}`).join('; ')} — выбери проп или переключай по ширине */}`] : [];
      if (note.length) ctx.notes.push(`${entity} (${node.key}): пропсы зависят от ширины`);
      return [...modeNote, ...note, `${pad}${jsx[0] ?? componentJsx(node.instance, entity, ctx.compSpec(entity), cls, modes)}`];
    }
    if (inst?.resolution !== 'inline') return [`${pad}{/* TODO: ${node.instance.name.trim()} — npm run craftui -- deps ${ctx.spec.name} */}`];
  }
  const own = `${cls ? ` className={styles.${cls}}` : ''}${modes}`;
  if (node.picture) {
    const img = camel(`img ${path.basename(node.picture, '.png')}`);
    ctx.imports.images.set(img, node.picture);
    return [...modeNote, `${pad}<img${own} src={${img}} alt="" />`];
  }
  if (node.asset) {
    const img = camel(`graphic ${path.basename(node.asset, '.svg')}`);
    ctx.imports.images.set(img, node.asset);
    return [...modeNote, `${pad}<img${own} src={${img}} alt="" />`];
  }
  if (node.text) return [...modeNote, own ? `${pad}<span${own}>{${JSON.stringify(node.text.characters ?? '')}}</span>` : `${pad}{${JSON.stringify(node.text.characters ?? '')}}`];
  const kids = node.children ?? [];
  if (!cls && !modes) return kids.flatMap((c) => markup(c, ctx, depth));
  // A layer without a class that switches a mode still needs an element to carry it; it takes no box.
  const box = cls ? own : `${modes} style={{ display: 'contents' }}`;
  if (!kids.length) return [...modeNote, `${pad}<div${box} />`];
  return [...modeNote, `${pad}<div${box}>`, ...kids.flatMap((c) => markup(c, ctx, depth + 1)), `${pad}</div>`];
}

/**
 * Modes a layer switches, from the narrowest frame that has it (mobile first). A mode some widths do not set
 * (the title in Typography=ExtraSmallScreens on mobile only) is a note for the code step, as width-bound props are.
 */
function modesAt(key, ctx, pad) {
  const byWidth = [...ctx.spec.targets].sort((a, b) => a.size.width - b.size.width).map((t) => ({ t, n: findKey(t.tree, key) })).filter((x) => x.n);
  const attrs = byWidth.map(({ n }) => modeAttrs(n.modes));
  const modes = attrs[0] ?? '';
  if (new Set(attrs).size < 2) return { modes, modeNote: [] };
  ctx.notes.push(`режим переменных ${key}: ${byWidth.map(({ t }, i) => `${t.id}${attrs[i] || ' по умолчанию'}`).join('; ')}`);
  return { modes, modeNote: [`${pad}{/* режим меняется с шириной: ${byWidth.map(({ t }, i) => `${t.id}${attrs[i] || ' по умолчанию'}`).join('; ')} — атрибут с самого узкого; шире — значения токенов в @container */}`] };
}

/** Long text literals of a markup line cut to their start: `{"1. Подписывая…" +6400 симв.}`. */
export const shortTexts = (line, max = 100) =>
  line.replace(/\{"((?:[^"\\]|\\.)*)"\}/g, (m, body) => (body.length > max ? `{"${body.slice(0, max).replace(/\\$/, '')}…" +${body.length - max} симв.}` : m));

export function markupContext(spec, nodeMap, indent) {
  const specs = new Map();
  return {
    spec,
    nodeMap,
    indent,
    parts: new Map((spec.parts ?? []).map((p) => [p.key, { folder: partFolder(spec.name, p), shared: Boolean(p.shared) }])),
    imports: { components: new Set(), parts: new Set(), shared: new Set(), images: new Map() },
    notes: [],
    compSpec: (name) => {
      if (!specs.has(name)) specs.set(name, readJson(path.join(kindDirs().component, name, 'craftlog', 'figma', 'spec.json')));
      return specs.get(name);
    },
  };
}

/**
 * Import lines for a file `up` folders below src/ (a page: 2, its part: 4, a shared part: 3); images live in `toAssets`.
 * Shared parts are in src/pages/parts/, one folder up from a page.
 */
export function importLines(imports, up, toAssets) {
  const root = '../'.repeat(up);
  return [
    ...[...imports.components].sort().map((c) => `import { ${c} } from '${root}${compDir()}/${c}';`),
    ...[...imports.parts].sort().map((p) => `import { ${p} } from './parts/${p}';`),
    ...[...(imports.shared ?? [])].sort().map((p) => `import { ${p} } from '${'../'.repeat(up - 1)}parts/${p}';`),
    ...[...imports.images].map(([v, file]) => `import ${v} from '${toAssets}${path.basename(file)}';`),
  ];
}

// ── brief ─────────────────────────────────────────────────────────────────────

export function pageBrief(e, spec, nodeMap) {
  const bp = config().pages.breakpoints;
  const ranges = breakpointRanges(bp);
  const ctx = markupContext(spec, nodeMap, '  ');
  const tree = unionTree(spec.targets);
  const lines = [
    `${e.name}: бриф страницы для шага code. spec.json и figma/raw не открывай; детали: npm run craftui -- spec ${e.name} <target> <слой>.`,
    '',
    `Брейкпоинты (craftui.config.json): ${describeBreakpoints(bp)}`,
    ...ranges.map((r) => {
      const t = spec.targets.find((x) => x.breakpoint === r.name);
      return `  ${r.name}: ${t ? `фрейм ${t.size.width}px → target ${t.id}` : 'фрейма нет — верстай по соседним'}`;
    }),
    'Вёрстка mobile-first: .root — контейнер (container-type: inline-size), правила шире — @container (min-width: <граница>px). Границы не меняй.',
    '',
    `Части (parts/<Имя>/; общие — src/pages/parts/<Имя>/): ${(spec.parts ?? []).map((p) => `${partFolder(e.name, p)}${p.shared ? ' (общая)' : ''} ← ${p.key}`).join(', ') || 'нет'}`,
    '',
    'Разметка всех брейкпоинтов вместе (черновик уже в файлах; слой, которого нет на брейкпоинте, скрыт в CSS):',
    // A legal text of thousands of characters is in the draft already; the brief shows where it goes.
    ...(tree ? markup(tree, ctx) : []).map((l) => shortTexts(l)),
    '',
    `Компоненты из ${kindDirs().component}: ${[...ctx.imports.components].join(', ') || 'нет'} — их API не меняй, положение задаёт страница через className.`,
    ...ctx.notes.map((n) => `⚠ ${n} — в разметке значение самого узкого брейкпоинта`),
    ...(spec.instances.filter((i) => !i.resolution).length ? [`Не решено (сначала craftui deps ${e.name}): ${spec.instances.filter((i) => !i.resolution).map((i) => i.name.trim()).join(', ')}`] : []),
    `Картинки и графика: ${spec.assets.map((a) => a.file).join(', ') || 'нет'} (копии — в assets/ страницы; alt — по смыслу, декоративные — alt="").`,
    ...(spec.warnings ?? []).map((w) => `⚠ ${w}`),
    '',
    `Дальше: доведи ${e.name}.tsx, части и стили (семантика header / main / section / footer, без фиксированной ширины страницы), затем npm run gen && npm run typecheck && npm run craftui -- verify ${e.name}.`,
  ];
  return cap(lines, undefined, `разметку по частям: npm run craftui -- spec ${e.name} <target> <слой>`);
}

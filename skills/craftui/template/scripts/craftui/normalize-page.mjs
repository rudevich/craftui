// raw/plugin.json of a page (one frame per breakpoint) → craftlog/figma/spec.json.
// Shares the layer and token code with components (normalize.mjs); targets are breakpoints from craftui.config.json.
import path from 'node:path';
import { appendHistory, breakpointOf, breakpointRanges, config, describeBreakpoints, fail, findEntity, pascal, readJson, slug, writeJson } from './lib.mjs';
import { buildTokens, normNode, writeNodeMap } from './normalize.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function run(e, { summary, keep }) {
  const previous = readJson(e.specFile);
  if (summary) return printSummary(previous ?? fail(`нет ${e.specFile} — сначала npm run craftui -- normalize ${e.name}`));
  const rawFile = path.join(e.craftlog, 'figma', 'raw', 'plugin.json');
  const raw = readJson(rawFile) ?? fail(`нет ${rawFile} — шаг extract (страницы пока только через Chrome MCP)`);
  const bp = config().pages.breakpoints ?? fail('брейкпоинты страниц не заданы: npm run craftui -- breakpoints mobile=767 tablet=1279 desktop=');

  const resolutions = new Map((previous?.instances ?? []).filter((i) => i.resolution).map((i) => [i.key, i.resolution]));
  const ctx = {
    prefix: config().tokenPrefix ?? '',
    resolutions,
    inline: new Set([...resolutions].filter(([, r]) => r === 'inline').map(([k]) => k)),
    keep,
    previous,
    assets: new Map(),
    fonts: new Map(),
    instances: new Map(),
    boolKeys: new Set(),
  };
  ctx.tokens = buildTokens(raw, ctx);

  // Mobile first: targets go from the narrowest frame, each named by the range its width falls into.
  const warnings = [];
  const frames = [...raw.variants].sort((a, b) => a.width - b.width);
  const used = new Map();
  const targets = frames.map((v) => {
    const range = breakpointOf(v.width, bp);
    if (!range) warnings.push(`фрейм «${v.name}» ${Math.round(v.width)}px вне брейкпоинтов (${describeBreakpoints(bp)})`);
    const base = range ? kebab(range) : `w${Math.round(v.width)}`;
    used.set(base, (used.get(base) ?? 0) + 1);
    return { v, range, base };
  }).map(({ v, range, base }) => {
    if (used.get(base) > 1) warnings.push(`в диапазоне ${range ?? base} несколько фреймов — оставь один источник на брейкпоинт`);
    const id = used.get(base) > 1 ? `${base}-${Math.round(v.width)}` : base;
    return {
      id,
      title: `${range ?? 'вне диапазонов'} · ${Math.round(v.width)}px`,
      figmaNodeId: v.id,
      source: v.source ?? 0,
      breakpoint: range ?? null,
      size: { width: r2(v.width), height: r2(v.height) },
      frame: { width: Math.round(v.width) },
      props: {},
      tree: normNode(v.tree, 'root', ctx),
    };
  });
  for (const r of breakpointRanges(bp)) if (!targets.some((t) => t.breakpoint === r.name)) warnings.push(`для ${r.name} фрейма в макете нет — сверстай по соседним брейкпоинтам`);

  // Pictures: one PNG per picture name, exported from its widest occurrence.
  const images = new Map();
  const walk = (node) => {
    if (node.image) {
      const base = slug(node.name) || 'image';
      const img = images.get(base) ?? { key: `image:${base}`, name: node.name, file: `assets/${base}.png`, format: 'png', nodeId: node.figmaId, width: 0 };
      if ((node.box?.w ?? 0) > img.width) Object.assign(img, { nodeId: node.figmaId, width: node.box?.w ?? 0 });
      images.set(base, img);
      node.picture = img.file;
    }
    node.children?.forEach(walk);
  };
  targets.forEach((t) => walk(t.tree));

  const widest = targets.at(-1);
  const spec = {
    version: 1,
    kind: 'page',
    name: e.name,
    source: 'chrome',
    figma: { fileKey: raw.meta.fileKey, nodeId: raw.root.id, nodeType: raw.root.type, nodeName: raw.root.name, key: raw.root.key ?? null, keys: [] },
    props: [],
    targets,
    tokens: ctx.tokens.list,
    instances: [...ctx.instances.values()].map((i) => {
      const as = previous?.twins?.[i.name.trim()];
      return { ...raw.instances.find((r) => r.key === i.key), ...i, resolution: resolutions.get(i.key) ?? (as ? `entity:component/${as}` : null), ...(as ? { as } : {}) };
    }),
    ...(previous?.twins ? { twins: previous.twins } : {}),
    assets: [...ctx.assets.values(), ...[...images.values()].map(({ width, ...a }) => a)],
    fonts: [...ctx.fonts.values()],
    // Parts agreed with the user survive re-normalization; suggestions are the top-level layers of the widest frame.
    parts: (previous?.parts ?? []).filter((p) => targets.some((t) => findKey(t.tree, p.key))),
    suggestedParts: (widest?.tree.children ?? []).filter((c) => !c.hidden && !c.instance).map((c) => ({ key: c.key, name: pascal(c.name) || 'Part' })),
    warnings,
    truncated: raw.meta.truncated || undefined,
  };
  writeJson(e.specFile, spec);
  writePageMap(e, spec);
  appendHistory(e, `spec.json: ${targets.length} брейкпоинтов (${targets.map((t) => t.id).join(', ')}), ${spec.instances.length} компонентов, ${images.size} картинок`);
  printSummary(spec);
}

function findKey(node, key) {
  if (node.key === key) return node;
  for (const c of node.children ?? []) {
    const found = findKey(c, key);
    if (found) return found;
  }
  return null;
}

/** Folder (and CSS-module prefix) of a part: the page name first, so demo classes never clash with a component's. */
export const partFolder = (page, part) => `${page}${part}`;

// node-map of a page: the frame layer is .frame (the root element is the container), layers of a part are "<Part>/<class>".
export function writePageMap(e, spec) {
  writeNodeMap(e, spec);
  const file = path.join(e.craftlog, 'figma', 'node-map.json');
  const map = readJson(file, {});
  if (map.root === 'root') map.root = 'frame';
  const owner = (key) => [...(spec.parts ?? [])].sort((a, b) => b.key.length - a.key.length).find((p) => key === p.key || key.startsWith(`${p.key}/`));
  for (const [key, cls] of Object.entries(map)) {
    if (!cls) continue;
    const local = cls.includes('/') ? cls.split('/').pop() : cls;
    const part = owner(key);
    map[key] = part ? `${partFolder(e.name, part.name)}/${local}` : local;
  }
  writeJson(file, map);
}

/** `craftui part <Page> <layer> <Name> [--remove]`: the layer becomes an inner component of the page (or stops being one). */
export function part([ref, key, name], remove) {
  const e = findEntity(ref);
  if (e.kind !== 'page') fail(`${e.name} — не страница`);
  const spec = readJson(e.specFile) ?? fail(`нет spec.json — npm run craftui -- normalize ${e.name}`);
  if (!key) fail('usage: part <Page> <слой> <Имя> [--remove]; слои: npm run craftui -- spec <Page> <target>');
  spec.parts ??= [];
  if (remove) spec.parts = spec.parts.filter((p) => p.key !== key);
  else {
    if (!spec.targets.some((t) => findKey(t.tree, key))) fail(`нет слоя "${key}" — смотри npm run craftui -- spec ${e.name} <target>`);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name ?? '')) fail('имя части — PascalCase латиницей, например Header');
    spec.parts = [...spec.parts.filter((p) => p.key !== key && p.name !== name), { key, name }];
  }
  writeJson(e.specFile, spec);
  writePageMap(e, spec);
  appendHistory(e, remove ? `часть убрана: ${key}` : `часть ${name} ← ${key}`);
  console.log(`✓ части ${e.name}: ${spec.parts.map((p) => `${partFolder(e.name, p.name)} ← ${p.key}`).join(', ') || 'нет'}`);
}

function printSummary(spec) {
  const bp = config().pages.breakpoints;
  console.log(`page/${spec.name} ← ${spec.targets.length} фреймов (${spec.source})`);
  console.log(`\nБрейкпоинты конфига: ${bp ? describeBreakpoints(bp) : 'не заданы'}`);
  for (const t of spec.targets) console.log(`  ${t.id}  ${t.size.width}×${t.size.height}  «${t.title}»  figma ${t.figmaNodeId}`);
  const parts = spec.parts ?? [];
  console.log(`\nЧасти: ${parts.length ? parts.map((p) => `${partFolder(spec.name, p.name)} ← ${p.key}`).join(', ') : 'не выбраны'}`);
  const suggested = (spec.suggestedParts ?? []).filter((s) => !parts.some((p) => p.key === s.key));
  if (suggested.length) console.log(`  предложено: ${suggested.map((s) => `${s.name} ← ${s.key}`).join(', ')} (npm run craftui -- part ${spec.name} <слой> <Имя>)`);
  const nested = new Map();
  for (const i of spec.instances) nested.set(i.resolution ?? 'не решено', [...new Set([...(nested.get(i.resolution ?? 'не решено') ?? []), `${i.name.trim()} ×${i.nodeIds.length}`])]);
  console.log(`Компоненты на странице: ${[...nested].map(([r, names]) => `${r}: ${names.join(', ')}`).join('; ') || '—'}`);
  const pictures = spec.assets.filter((a) => a.format === 'png');
  console.log(`Картинки: ${pictures.length ? pictures.map((a) => a.file).join(', ') : '—'}; графика: ${spec.assets.length - pictures.length}`);
  console.log(`Токены: ${spec.tokens.length}; шрифты: ${spec.fonts.map((f) => f.family).join(', ') || '—'}`);
  for (const w of spec.warnings ?? []) console.log(`⚠ ${w}`);
  if (spec.truncated) console.log('⚠ дерево обрезано (слишком много слоёв) — раздели страницу на источники поменьше.');
}

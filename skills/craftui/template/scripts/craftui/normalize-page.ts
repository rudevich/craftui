// raw/plugin.json of a page (one frame per breakpoint) → craftlog/figma/spec.json.
// Shares the layer and token code with components (normalize.ts); targets are breakpoints from craftui.config.json.
import fs from 'node:fs';
import path from 'node:path';
import { appendHistory, breakpointOf, breakpointRanges, config, describeBreakpoints, fail, findEntity, kindDirs, pascal, readJson, slug, writeJson } from './lib.ts';
import { buildTokens, normNode, writeNodeMap, type NormCtx } from './normalize.ts';
import type { Asset, Entity, Instance, NodeMap, Part, Raw, SharedPart, Spec, SpecNode, Target } from './types.ts';

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A frame without auto-layout (layers placed by x/y, common in product screens) becomes a column in reading order:
 * children by y, gaps as margin-top, each aligned in the content column (left, right, centre or full width).
 * The narrowest breakpoint keeps its side padding; on wider ones a column centred in the frame keeps its design width
 * and never gets closer to the edges than `minSide` (the side padding of the narrowest frame).
 * Layers overlapping the one above stay absolute.
 */
export function flowLayout(node: SpecNode, { minSide, frameWidth }: { minSide?: number; frameWidth: number }): SpecNode {
  const kids = (node.children ?? []).filter((c) => c.box && !c.hidden);
  if (!kids.length || (node.css?.display && !node.free) || node.asset || node.text) {
    node.children?.forEach((c) => flowLayout(c, { frameWidth: c.box?.w ?? frameWidth }));
    return node;
  }
  // Figma's guess for a frame without auto-layout goes; the column below replaces it.
  if (node.free) for (const k of ['display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'row-gap', 'column-gap', 'padding']) delete node.css?.[k];
  const W = node.box?.w ?? frameWidth;
  const boxes = kids.map((c) => c.box!);
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const column = r2(right - left);
  const top = Math.min(...boxes.map((b) => b.y));
  const sorted = [...node.children!].sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0));
  let bottom = top;
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  for (const c of sorted) {
    if (!c.box || c.hidden) continue;
    c.css = { ...(c.css ?? {}) };
    if (c.box.y < bottom - 1) {
      Object.assign(c.css, { position: 'absolute', left: `${r2(c.box.x)}px`, top: `${r2(c.box.y)}px` });
      node.css = { ...(node.css ?? {}), position: 'relative' };
      continue;
    }
    const gap = r2(c.box.y - bottom);
    if (bottom !== top && gap > 0) c.css['margin-top'] = `${gap}px`;
    const full = c.box.w >= column - 2;
    const align = full ? 'stretch' : near(c.box.x, left) ? 'flex-start' : near(c.box.x + c.box.w, right) ? 'flex-end' : near(c.box.x + c.box.w / 2, (left + right) / 2) ? 'center' : 'flex-start';
    c.css['align-self'] = align;
    if (full) delete c.css.width;
    bottom = c.box.y + c.box.h;
    flowLayout(c, { frameWidth: c.box.w });
  }
  node.children = sorted;
  const side = r2(left);
  const isFrame = node.key === 'root';
  const centred = minSide !== undefined && near(left, W - right) && side > minSide;
  const inline = centred ? `max(${minSide}px, calc((100% - ${column}px) / 2))` : `${side}px`;
  node.css = {
    ...(node.css ?? {}),
    display: 'flex',
    'flex-direction': 'column',
    // A layer wider than its frame (a picture that hangs out) gives no negative padding: it just overflows.
    'padding-top': `${r2(Math.max(0, top))}px`,
    'padding-right': isFrame ? inline : `${r2(Math.max(0, W - right))}px`,
    'padding-bottom': `${r2(Math.max(0, (node.box?.h ?? bottom) - bottom))}px`,
    'padding-left': isFrame ? inline : `${Math.max(0, side)}px`,
  };
  delete node.css.height; // the content sets the height of a column
  return node;
}
/**
 * Device chrome a mockup draws (an iOS status bar, a browser bar) is not part of the page: confirm drops it with
 * `craftui mockup`. A dropped layer at the top edge of the frame takes its height off the layers it sat in (fixed
 * heights, positions below it; auto-layout reflows by itself). Returns that cut: the target's mockTop, verify compares
 * the reference below it.
 */
export function dropLayers(node: SpecNode, skip: Set<string>, top = 0, dropped = new Set<string>()): number {
  if (!node.children?.length) return 0;
  const al = Boolean(node.css?.display);
  const atTop = (c: SpecNode) => Boolean(c.box && top + c.box.y <= 1);
  const ids = (n: SpecNode): string[] => [n.figmaId, ...(n.children ?? []).flatMap(ids)];
  let cut = 0;
  node.children = node.children.filter((c) => {
    if (!skip.has(c.key)) return true;
    ids(c).forEach((id) => dropped.add(id));
    if (atTop(c)) cut = Math.max(cut, c.box!.h + (al ? parseFloat(node.css?.gap ?? '') || 0 : 0));
    return false;
  });
  for (const c of node.children) {
    const inner = dropLayers(c, skip, top + (c.box?.y ?? 0), dropped);
    if (atTop(c)) cut = Math.max(cut, inner);
  }
  if (!cut) return 0;
  for (const c of node.children) {
    if (!al && c.box && c.box.y >= cut - 1) c.box.y = r2(c.box.y - cut);
    const t = /^(-?[\d.]+)px$/.exec(c.css?.top ?? '')?.[1];
    if (al && c.css?.position === 'absolute' && t) c.css.top = `${r2(Number(t) - cut)}px`;
  }
  if (node.box) node.box.h = r2(node.box.h - cut);
  for (const o of [node.css, node.expect]) {
    const h = /^([\d.]+)px$/.exec(o?.height ?? '')?.[1];
    if (o && h) o.height = `${r2(Number(h) - cut)}px`;
  }
  return cut;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function run(e: Entity, { summary, keep }: { summary?: boolean; keep?: boolean }) {
  const previous = readJson<Spec>(e.specFile);
  if (summary) return printSummary(previous ?? fail(`нет ${e.specFile} — сначала npm run craftui -- normalize ${e.name}`));
  const rawFile = path.join(e.craftlog, 'figma', 'raw', 'plugin.json');
  const raw = readJson<Raw>(rawFile) ?? fail(`нет ${rawFile} — шаг extract (страницы пока только через Chrome MCP)`);
  const bp = config().pages.breakpoints ?? fail('брейкпоинты страниц не заданы: npm run craftui -- breakpoints mobile=767 tablet=1279 desktop=');

  const resolutions = new Map((previous?.instances ?? []).filter((i) => i.resolution).map((i) => [i.key, i.resolution!] as const));
  const prefix = config().tokenPrefix ?? '';
  const ctx: NormCtx = {
    prefix,
    tokens: buildTokens(raw, { prefix }),
    resolutions,
    inline: new Set([...resolutions].filter(([, r]) => r === 'inline').map(([k]) => k)),
    keep,
    previous,
    assets: new Map(),
    fonts: new Map(),
    instances: new Map(),
    boolKeys: new Set(),
  };

  // Mobile first: targets go from the narrowest frame, each named by the range its width falls into.
  const warnings: string[] = [];
  const frames = [...raw.variants].sort((a, b) => a.width - b.width);
  const used = new Map<string, number>();
  const targets = frames.map((v) => {
    const range = breakpointOf(v.width, bp);
    if (!range) warnings.push(`фрейм «${v.name}» ${Math.round(v.width)}px вне брейкпоинтов (${describeBreakpoints(bp)})`);
    const base = range ? kebab(range) : `w${Math.round(v.width)}`;
    used.set(base, (used.get(base) ?? 0) + 1);
    return { v, range, base };
  }).map(({ v, range, base }): Target => {
    const many = (used.get(base) ?? 0) > 1;
    if (many) warnings.push(`в диапазоне ${range ?? base} несколько фреймов — оставь один источник на брейкпоинт`);
    const id = many ? `${base}-${Math.round(v.width)}` : base;
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
  // Frames drawn without auto-layout: reading order and alignment instead of x/y (see flowLayout).
  const skip = new Set(previous?.skip ?? []);
  const dropped = new Set<string>();
  for (const t of targets) {
    const cut = dropLayers(t.tree, skip, 0, dropped);
    if (cut) Object.assign(t, { mockTop: cut, size: { ...t.size, height: r2(t.size.height - cut) } });
  }
  const usedAssets = new Set<string>();
  const collect = (n: SpecNode) => {
    if (n.asset) usedAssets.add(n.asset);
    n.children?.forEach(collect);
  };
  targets.forEach((t) => collect(t.tree));
  let minSide: number | undefined;
  for (const t of targets) {
    if (t.tree.css?.display && !t.tree.free) continue;
    flowLayout(t.tree, { minSide, frameWidth: t.size.width });
    minSide ??= parseFloat(t.tree.css!['padding-left']);
    t.flow = true;
  }
  if (targets.some((t) => t.flow)) warnings.push('фреймы без auto-layout: раскладка переведена в колонку по положению слоёв (порядок по y, выравнивание по колонке) — проверь по verify');

  // Pictures: one PNG per picture name, exported from its widest occurrence.
  const images = new Map<string, Asset & { width: number }>();
  const walk = (node: SpecNode) => {
    if (node.image) {
      const base = slug(node.name) || 'image';
      const img = images.get(base) ?? { key: `image:${base}`, name: node.name, file: `assets/${base}.png`, format: 'png' as const, nodeId: node.figmaId, width: 0 };
      if ((node.box?.w ?? 0) > img.width) Object.assign(img, { nodeId: node.figmaId, width: node.box?.w ?? 0 });
      images.set(base, img);
      node.picture = img.file;
    }
    node.children?.forEach(walk);
  };
  targets.forEach((t) => walk(t.tree));

  const widest = targets[targets.length - 1];
  const spec: Spec = {
    version: 1,
    kind: 'page',
    name: e.name,
    source: 'chrome',
    figma: { fileKey: raw.meta.fileKey, nodeId: raw.root.id, nodeType: raw.root.type, nodeName: raw.root.name, key: raw.root.key ?? null, keys: [] },
    props: [],
    targets,
    tokens: ctx.tokens.list,
    // A component that is only vector graphics (a logo, an icon) is a picture of the page, not a dependency.
    // A dropped status bar is not a dependency (a wrapper collapsed into its child still is).
    instances: [...ctx.instances.values()].filter((i) => !i.nodeIds.every((id) => dropped.has(id))).map((i) => {
      const as = previous?.twins?.[i.name.trim()];
      return { ...raw.instances.find((r) => r.key === i.key), ...i, resolution: (resolutions.get(i.key) ?? (as ? `entity:component/${as}` : i.graphic ? 'graphic' : null)) as Instance['resolution'], ...(as ? { as } : {}) };
    }),
    ...(previous?.twins ? { twins: previous.twins } : {}),
    assets: [...ctx.assets.values()].filter((a) => usedAssets.has(a.file)).concat([...images.values()].map(({ width, ...a }) => a)),
    fonts: [...ctx.fonts.values()],
    // Parts agreed with the user survive re-normalization; suggestions are the top-level layers of the widest frame.
    parts: (previous?.parts ?? []).filter((p) => targets.some((t) => findKey(t.tree, p.key))),
    ...(skip.size ? { skip: [...skip] } : {}),
    suggestedParts: suggestParts(targets, widest),
    warnings,
    truncated: raw.meta.truncated || undefined,
  };
  writeJson(e.specFile, spec);
  writePageMap(e, spec);
  appendHistory(e, `spec.json: ${targets.length} брейкпоинтов (${targets.map((t) => t.id).join(', ')}), ${spec.instances.length} компонентов, ${images.size} картинок`);
  printSummary(spec);
}

/**
 * Parts to offer on confirm: top-level layers of every breakpoint that are containers (a header, a block of cards) or
 * library instances (a header the kit draws), never a lone text or picture. A layer an existing shared part was made
 * from (same instance or layer name) is offered as that part.
 */
function suggestParts(targets: Target[], widest: Target | undefined): Part[] {
  const shared = sharedParts();
  const seen = new Map<string, SpecNode>();
  for (const t of [widest, ...targets]) for (const c of t?.tree.children ?? []) if (!seen.has(c.key)) seen.set(c.key, c);
  return [...seen.values()]
    .filter((c) => !c.hidden && !c.text && !c.picture && !c.asset && (c.instance || (c.children?.length ?? 0) > 0))
    .map((c) => {
      const same = shared.find((p) => (p.instance && p.instance === c.instance?.key) || slug(p.layer) === slug(c.name));
      return same ? { key: c.key, name: same.name, shared: true } : { key: c.key, name: pascal(c.name.split(/\s+/).slice(0, 3).join(' ')).slice(0, 24) || 'Part' };
    });
}

function findKey(node: SpecNode, key: string): SpecNode | null {
  if (node.key === key) return node;
  for (const c of node.children ?? []) {
    const found = findKey(c, key);
    if (found) return found;
  }
  return null;
}

/**
 * Folder (and CSS-module prefix) of a part: the page name first, so demo classes never clash with a component's.
 * A shared part (several pages draw it: a header, a stepper) keeps its own name in src/pages/parts/<Name>/.
 */
export const partFolder = (page: string, part: Pick<Part, 'name' | 'shared'>): string => (part.shared ? part.name : `${page}${part.name}`);

export const sharedPartsDir = () => path.join(kindDirs().page, 'parts');

/** Shared parts made so far: part.json of each — { name, page, key, layer, instance } (the page and layer it came from). */
export function sharedParts(): SharedPart[] {
  const dir = sharedPartsDir();
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => readJson<SharedPart>(path.join(dir, n, 'part.json'))).filter((p): p is SharedPart => Boolean(p)) : [];
}

// node-map of a page: the frame layer is .frame (the root element is the container), layers of a part are "<Part>/<class>".
export function writePageMap(e: Entity, spec: Spec) {
  writeNodeMap(e, spec);
  const file = path.join(e.craftlog, 'figma', 'node-map.json');
  const map = readJson<NodeMap>(file, {});
  if (map.root === 'root') map.root = 'frame';
  const owner = (key: string) => [...(spec.parts ?? [])].sort((a, b) => b.key.length - a.key.length).find((p) => key === p.key || key.startsWith(`${p.key}/`));
  // A shared part another page made: its classes are that page's, found by the path inside the part.
  const borrowed = new Map<string, Map<string, string | null>>();
  for (const p of (spec.parts ?? []).filter((x) => x.shared)) {
    const made = readJson<SharedPart>(path.join(sharedPartsDir(), p.name, 'part.json'));
    if (!made || made.page === e.name) continue;
    const theirs = readJson<NodeMap>(path.join(kindDirs().page, made.page, 'craftlog', 'figma', 'node-map.json'), {});
    borrowed.set(p.key, new Map(Object.entries(theirs).filter(([k]) => k === made.key || k.startsWith(`${made.key}/`)).map(([k, v]) => [k.slice(made.key.length), v])));
  }
  for (const [key, cls] of Object.entries(map)) {
    if (!cls) continue;
    const local = cls.slice(cls.lastIndexOf('/') + 1);
    const part = owner(key);
    if (part && borrowed.has(part.key)) map[key] = borrowed.get(part.key)!.get(key.slice(part.key.length)) ?? null;
    else map[key] = part ? `${partFolder(e.name, part)}/${local}` : local;
  }
  writeJson(file, map);
}

/**
 * `craftui part <Page> <layer> <Name> [--shared] [--remove]`: the layer becomes an inner component of the page (or stops
 * being one). --shared puts it in src/pages/parts/<Name>/ for other pages; one that exists already is reused as it is.
 * A library instance as a part is laid out from its layers: it turns inline and normalize runs again to take them in.
 */
export async function part([ref, key, name]: (string | undefined)[], { remove = false, shared = false } = {}) {
  const e = findEntity(ref);
  if (e.kind !== 'page') fail(`${e.name} — не страница`);
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — npm run craftui -- normalize ${e.name}`);
  if (!key) return fail('usage: part <Page> <слой> <Имя> [--remove]; слои: npm run craftui -- spec <Page> <target>');
  spec.parts ??= [];
  if (remove) spec.parts = spec.parts.filter((p) => p.key !== key);
  else {
    if (!spec.targets.some((t) => findKey(t.tree, key))) fail(`нет слоя "${key}" — смотри npm run craftui -- spec ${e.name} <target>`);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name ?? '')) fail('имя части — PascalCase латиницей, например Header');
    // A shared part's classes are "<Name>__<class>" in the demo, as a component's would be.
    if (shared && fs.existsSync(path.join(kindDirs().component, name!))) fail(`${name} уже есть среди компонентов — дай части другое имя`);
    spec.parts = [...spec.parts.filter((p) => p.key !== key && p.name !== name), { key, name: name!, ...(shared ? { shared: true } : {}) }];
  }
  const inst = !remove && spec.targets.map((t) => findKey(t.tree, key)).find((n) => n?.instance)?.instance;
  const dep = inst && spec.instances.find((i) => i.key === inst.key && i.resolution !== 'inline');
  if (dep) dep.resolution = 'inline';
  writeJson(e.specFile, spec);
  writePageMap(e, spec);
  appendHistory(e, remove ? `часть убрана: ${key}` : `часть ${name}${shared ? ' (общая)' : ''} ← ${key}`);
  console.log(`✓ части ${e.name}: ${spec.parts.map((p) => `${partFolder(e.name, p)}${p.shared ? ' (общая, src/pages/parts)' : ''} ← ${p.key}`).join(', ') || 'нет'}`);
  if (dep) {
    console.log(`${dep.name.trim()} — экземпляр библиотеки: часть верстается из его слоёв (inline), normalize заново:`);
    await run(e, {});
  }
}

/** `craftui mockup <Page> <layer> [--remove]`: a mockup layer (status bar, browser bar) stays out of the page. */
export async function skipLayer([ref, key]: (string | undefined)[], remove: boolean) {
  const e = findEntity(ref);
  if (e.kind !== 'page') fail(`${e.name} — не страница`);
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — npm run craftui -- normalize ${e.name}`);
  if (!key) return fail('usage: mockup <Page> <слой> [--remove]; слои: npm run craftui -- spec <Page> <target>');
  const raw = new Set(spec.skip ?? []);
  if (remove) raw.delete(key);
  else {
    if (!spec.targets.some((t) => findKey(t.tree, key))) fail(`нет слоя "${key}" — смотри npm run craftui -- spec ${e.name} <target>`);
    raw.add(key);
  }
  spec.skip = [...raw];
  writeJson(e.specFile, spec);
  appendHistory(e, remove ? `слой вернулся: ${key}` : `слой макета убран: ${key}`);
  console.log(`✓ убраны из вёрстки: ${spec.skip.join(', ') || 'нет'}. normalize заново:`);
  await run(e, {});
}

function printSummary(spec: Spec) {
  const bp = config().pages.breakpoints;
  console.log(`page/${spec.name} ← ${spec.targets.length} фреймов (${spec.source})`);
  console.log(`\nБрейкпоинты конфига: ${bp ? describeBreakpoints(bp) : 'не заданы'}`);
  for (const t of spec.targets) console.log(`  ${t.id}  ${t.size.width}×${t.size.height}  «${t.title}»  figma ${t.figmaNodeId}${t.mockTop ? `  (без ${t.mockTop}px макета сверху)` : ''}`);
  if (spec.skip?.length) console.log(`  убраны из вёрстки (макет устройства): ${spec.skip.join(', ')}`);
  const parts = spec.parts ?? [];
  console.log(`\nЧасти: ${parts.length ? parts.map((p) => `${partFolder(spec.name, p)}${p.shared ? ' (общая)' : ''} ← ${p.key}`).join(', ') : 'не выбраны'}`);
  const suggested = (spec.suggestedParts ?? []).filter((s) => !parts.some((p) => p.key === s.key));
  const [same, other] = [suggested.filter((s) => s.shared), suggested.filter((s) => !s.shared)];
  if (same.length) console.log(`  общие части, уже сделанные: ${same.map((s) => `npm run craftui -- part ${spec.name} ${s.key} ${s.name} --shared`).join('; ')}`);
  if (other.length) console.log(`  предложено: ${other.map((s) => `${s.name} ← ${s.key}`).join(', ')} (npm run craftui -- part ${spec.name} <слой> <Имя> [--shared — повторится на других страницах])`);
  const nested = new Map<string, string[]>();
  for (const i of spec.instances) nested.set(i.resolution ?? 'не решено', [...new Set([...(nested.get(i.resolution ?? 'не решено') ?? []), `${i.name.trim()} ×${i.nodeIds.length}`])]);
  console.log(`Компоненты на странице: ${[...nested].map(([r, names]) => `${r}: ${names.join(', ')}`).join('; ') || '—'}`);
  const pictures = spec.assets.filter((a) => a.format === 'png');
  console.log(`Картинки: ${pictures.length ? pictures.map((a) => a.file).join(', ') : '—'}; графика: ${spec.assets.length - pictures.length}`);
  console.log(`Токены: ${spec.tokens.length}; шрифты: ${spec.fonts.map((f) => f.family).join(', ') || '—'}`);
  for (const w of spec.warnings ?? []) console.log(`⚠ ${w}`);
  if (spec.truncated) console.log('⚠ дерево обрезано (слишком много слоёв) — раздели страницу на источники поменьше.');
}

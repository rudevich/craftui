// Figma nodes an entity is built from. A UI kit often splits one component into several component sets
// (one per size, an outline set…): each source adds axes to its variants (`variant`) and can limit them (`filter`).
import fs from 'node:fs';
import path from 'node:path';
import { appendHistory, fail, findEntity, parseFigmaUrl, readJson, writeJson } from './lib.mjs';

/** "Size=M, View=Secondary Outline" → { Size: 'M', View: 'Secondary Outline' } */
export function parseVariant(text) {
  if (!text || text === true) return {};
  return Object.fromEntries(
    String(text)
      .split(',')
      .map((pair) => pair.split('=').map((s) => s.trim()))
      .filter(([k, v]) => k && v !== undefined),
  );
}

/** Filter: JSON array of partial variant objects (inline or a file path); a variant matches any of them. */
export function readFilter(value) {
  if (!value || value === true) return undefined;
  const text = fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : value;
  let filter;
  try {
    filter = JSON.parse(text);
  } catch {
    fail(`--filter: не JSON и не файл: ${value}`);
  }
  if (!Array.isArray(filter) || filter.some((f) => typeof f !== 'object')) fail('--filter: нужен массив объектов, например [{"View":"Accent"}]');
  return filter;
}

export function sourceEntry(url, { variant, filter } = {}) {
  const figma = parseFigmaUrl(url ?? '');
  if (!figma?.nodeId) fail(`нужна ссылка Figma с node-id: ${url}`);
  return { url: figma.url, fileKey: figma.fileKey, nodeId: figma.nodeId, variant: parseVariant(variant), ...(filter ? { filter } : {}) };
}

export function sourcesOf(e) {
  const source = readJson(path.join(e.craftlog, 'figma', 'source.json'));
  return { source, sources: source.sources ?? [{ url: source.url, fileKey: source.fileKey, nodeId: source.nodeId, variant: {} }] };
}

export function run(args, flag) {
  const [ref, action, ...rest] = args;
  const e = findEntity(ref);
  const file = path.join(e.craftlog, 'figma', 'source.json');
  const { source, sources } = sourcesOf(e);

  if (action === 'add') {
    const entry = sourceEntry(rest[0], { variant: flag('variant'), filter: readFilter(flag('filter')) });
    sources.push(entry);
    appendHistory(e, `источник добавлен: ${entry.nodeId} ${JSON.stringify(entry.variant)}`);
  } else if (action === 'filter') {
    const i = rest[0] === 'all' ? null : Number(rest[0]);
    const filter = readFilter(rest[1]);
    for (const [j, s] of sources.entries()) if (i === null || i === j) s.filter = filter;
    appendHistory(e, `фильтр вариантов: источник ${rest[0]}, ${filter?.length ?? 0} условий`);
  } else if (action === 'variant') {
    sources[Number(rest[0])].variant = parseVariant(rest[1]);
  } else if (action !== 'list' && action !== undefined) {
    fail('source <Name> list | add <url> [--variant "Size=M"] [--filter <json|file>] | filter <i|all> <json|file> | variant <i> "Size=M"');
  }
  if (action && action !== 'list') writeJson(file, { ...source, sources });
  sources.forEach((s, i) => {
    const v = Object.entries(s.variant ?? {}).map(([k, x]) => `${k}=${x}`).join(', ');
    console.log(`${i}: ${s.nodeId}${v ? `  + ${v}` : ''}${s.filter ? `  фильтр: ${s.filter.length} условий` : '  все варианты'}`);
  });
  // An axis added by --variant becomes a prop only if every source sets it (Outline=True here, Outline=False there).
  if (sources.length > 1) {
    const raw = readJson(path.join(e.craftlog, 'figma', 'raw', 'plugin.json'));
    const native = new Set((raw?.sources ?? []).flatMap((s) => Object.keys(s.componentPropertyDefinitions ?? {}).map((k) => k.replace(/#[\d:]+$/, ''))));
    const axes = new Set(sources.flatMap((s) => Object.keys(s.variant ?? {})).filter((a) => !native.has(a))); // overriding a set's own axis is fine
    for (const axis of axes) {
      const missing = sources.map((s, i) => (s.variant?.[axis] === undefined ? i : null)).filter((i) => i !== null);
      if (missing.length) console.log(`⚠ ось ${axis} не задана у источников ${missing.join(', ')}: задай её всем (craftui source ${e.name} variant <i> "…, ${axis}=…")`);
    }
  }
}

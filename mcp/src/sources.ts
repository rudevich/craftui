// Figma nodes an entity is built from. A UI kit often splits one component into several component sets
// (one per size, an outline set…): each source adds axes to its variants (`variant`) and can limit them (`filter`).
import fs from 'node:fs';
import path from 'node:path';
import { appendHistory, fail, findEntity, parseFigmaUrl, readJson, writeJson } from './lib.ts';
import type { Entity, Raw, Source, SourceFile, VariantFilter } from './types.ts';

/** "Size=M, View=Secondary Outline" → { Size: 'M', View: 'Secondary Outline' } */
export function parseVariant(text: string | true | undefined): Record<string, string> {
  if (!text || text === true) return {};
  return Object.fromEntries(
    String(text)
      .split(',')
      .map((pair) => pair.split('=').map((s) => s.trim()))
      .filter(([k, v]) => k && v !== undefined),
  );
}

/** Filter: JSON array of partial variant objects (inline or a file path); a variant matches any of them. */
export function readFilter(value: string | true | undefined): VariantFilter | undefined {
  if (!value || value === true) return undefined;
  const text = fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : value;
  let filter: unknown;
  try {
    filter = JSON.parse(text);
  } catch {
    fail(`--filter: не JSON и не файл: ${value}`);
  }
  if (!Array.isArray(filter) || filter.some((f) => typeof f !== 'object')) fail('--filter: нужен массив объектов, например [{"View":"Accent"}]');
  return filter as VariantFilter;
}

export function sourceEntry(url: string | undefined, { variant, filter }: { variant?: string | true; filter?: VariantFilter } = {}): Source {
  const figma = parseFigmaUrl(url ?? '');
  if (!figma?.nodeId) return fail(`нужна ссылка Figma с node-id: ${url}`);
  return { url: figma.url, fileKey: figma.fileKey, nodeId: figma.nodeId, variant: parseVariant(variant), ...(filter ? { filter } : {}) };
}

export function sourcesOf(e: Entity): { source: SourceFile; sources: Source[] } {
  const source = readJson<SourceFile>(path.join(e.craftlog, 'figma', 'source.json')) ?? fail(`нет source.json у ${e.name}`);
  return { source, sources: source.sources ?? [{ url: source.url, fileKey: source.fileKey, nodeId: source.nodeId, variant: {} }] };
}

export function run({ entity, action, url, variant, filter, index }: { entity: string; action?: 'list' | 'add' | 'filter' | 'variant'; url?: string; variant?: string; filter?: string; index?: number | 'all' }) {
  const e = findEntity(entity);
  const file = path.join(e.craftlog, 'figma', 'source.json');
  const { source, sources } = sourcesOf(e);

  if (action === 'add') {
    const entry = sourceEntry(url, { variant, filter: readFilter(filter) });
    sources.push(entry);
    appendHistory(e, `источник добавлен: ${entry.nodeId} ${JSON.stringify(entry.variant)}`);
  } else if (action === 'filter') {
    const i = index === 'all' ? null : Number(index);
    const parsed = readFilter(filter);
    for (const [j, s] of sources.entries()) if (i === null || i === j) s.filter = parsed;
    appendHistory(e, `фильтр вариантов: источник ${index}, ${parsed?.length ?? 0} условий`);
  } else if (action === 'variant') {
    sources[Number(index)].variant = parseVariant(variant);
  } else if (action !== 'list' && action !== undefined) {
    fail('sources: action list | add (url, variant, filter) | filter (index | "all", filter) | variant (index, variant)');
  }
  if (action && action !== 'list') writeJson(file, { ...source, sources });
  sources.forEach((s, i) => {
    const v = Object.entries(s.variant ?? {}).map(([k, x]) => `${k}=${x}`).join(', ');
    console.log(`${i}: ${s.nodeId}${v ? `  + ${v}` : ''}${s.filter ? `  фильтр: ${s.filter.length} условий` : '  все варианты'}`);
  });
  // An axis added by --variant becomes a prop only if every source sets it (Outline=True here, Outline=False there).
  if (sources.length > 1) {
    const raw = readJson<Raw>(path.join(e.craftlog, 'figma', 'raw', 'plugin.json'));
    const native = new Set((raw?.sources ?? []).flatMap((s) => Object.keys((s.componentPropertyDefinitions as object | undefined) ?? {}).map((k) => k.replace(/#[\d:]+$/, ''))));
    const axes = new Set(sources.flatMap((s) => Object.keys(s.variant ?? {})).filter((a) => !native.has(a))); // overriding a set's own axis is fine
    for (const axis of axes) {
      const missing = sources.map((s, i) => (s.variant?.[axis] === undefined ? i : null)).filter((i) => i !== null);
      if (missing.length) console.log(`⚠ ось ${axis} не задана у источников ${missing.join(', ')}: задай её всем — sources {"entity":"${e.name}","action":"variant","index":<i>,"variant":"…, ${axis}=…"}`);
    }
  }
}

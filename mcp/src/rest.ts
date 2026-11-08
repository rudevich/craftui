// Fallback for references: PNG of every target via the Figma REST API (needs FIGMA_TOKEN in the environment).
// PNGs are cached per nodeId: a resync (re-extract, new metadata.xml) changes the stamp and invalidates the cache.
import fs from 'node:fs';
import path from 'node:path';
import { appendHistory, config, fail, findEntity, readJson, writeJson } from './lib.ts';
import type { Entity, Raw, SourceFile, Spec } from './types.ts';

export async function run(ref: string | undefined, { fresh = false }: { fresh?: boolean } = {}) {
  const e = findEntity(ref);
  const token = process.env.FIGMA_TOKEN;
  if (!token) fail('нет FIGMA_TOKEN в окружении — используй другой способ из figma-mcp.md');
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — craftui spec {"action":"normalize","entity":"${e.name}"}`);
  const fileKey = spec.figma.fileKey ?? readJson<SourceFile>(path.join(e.craftlog, 'figma', 'source.json'))?.fileKey;
  const dir = path.join(e.craftlog, 'figma', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const scale = config().scale;
  // The stamp ties cached etalons to the extraction: a resync re-extracts and the cache starts over.
  const stamp = extractStamp(e);
  const cacheFile = path.join(dir, '.cache.json');
  const cache = readJson<Record<string, { stamp: string; scale: number }>>(cacheFile) ?? {};
  const fileOf = (t: { id: string }) => path.join(dir, `${t.id}.png`);
  const usable = (t: { id: string; figmaNodeId: string }) => {
    const entry = cache[t.figmaNodeId];
    return !fresh && entry?.stamp === stamp && entry.scale === scale && fs.existsSync(fileOf(t));
  };
  const reuse = spec.targets.filter(usable);
  const need = spec.targets.filter((t) => !usable(t));
  for (const t of reuse) console.log(`  ⤵ ${t.id}: из кэша (ресинка не было)`);
  let saved = 0;
  if (need.length) {
    const url = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(need.map((t) => t.figmaNodeId).join(','))}&format=png&scale=${scale}&use_absolute_bounds=true`;
    const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
    if (!res.ok) fail(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { images = {}, err } = (await res.json()) as { images?: Record<string, string | null>; err?: string };
    if (err) fail(`Figma API: ${err}`);
    await Promise.all(
      need.map(async (t) => {
        const src = images[t.figmaNodeId];
        if (!src) {
          console.log(`  ✗ ${t.id}: Figma не отдала изображение`);
          return;
        }
        const png = Buffer.from(await (await fetch(src)).arrayBuffer());
        fs.writeFileSync(fileOf(t), png);
        cache[t.figmaNodeId] = { stamp, scale };
        saved++;
      }),
    );
    console.log(`  ⇣ ${saved}/${need.length}: скачано с Figma API`);
  }
  writeJson(cacheFile, cache);
  appendHistory(e, `rest-images: ${reuse.length} из кэша, ${saved} скачано`);
  console.log(`✓ эталоны: ${reuse.length + saved}/${spec.targets.length} в ${dir}`);
}

/** When the raw data was last taken from Figma: meta.extractedAt (chrome) or the metadata.xml mtime (figma source). */
function extractStamp(e: Entity): string {
  const meta = readJson<Raw>(path.join(e.craftlog, 'figma', 'raw', 'plugin.json'))?.meta;
  if (meta?.extractedAt) return meta.extractedAt;
  const metaFile = path.join(e.craftlog, 'figma', 'raw', 'metadata.xml');
  return fs.existsSync(metaFile) ? `mtime:${fs.statSync(metaFile).mtimeMs}` : 'none';
}

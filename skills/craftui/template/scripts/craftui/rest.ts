// Fallback for references: PNG of every target via the Figma REST API (needs FIGMA_TOKEN in the environment).
import fs from 'node:fs';
import path from 'node:path';
import { appendHistory, config, fail, findEntity, readJson } from './lib.ts';
import type { SourceFile, Spec } from './types.ts';

export async function run(ref: string | undefined) {
  const e = findEntity(ref);
  const token = process.env.FIGMA_TOKEN;
  if (!token) fail('нет FIGMA_TOKEN в окружении — используй другой способ из figma-mcp.md');
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — npm run craftui -- normalize ${e.name}`);
  const fileKey = spec.figma.fileKey ?? readJson<SourceFile>(path.join(e.craftlog, 'figma', 'source.json'))?.fileKey;
  const ids = spec.targets.map((t) => t.figmaNodeId);
  const url = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(ids.join(','))}&format=png&scale=${config().scale}&use_absolute_bounds=true`;
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) fail(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { images = {}, err } = (await res.json()) as { images?: Record<string, string | null>; err?: string };
  if (err) fail(`Figma API: ${err}`);
  const dir = path.join(e.craftlog, 'figma', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  let saved = 0;
  for (const t of spec.targets) {
    const src = images[t.figmaNodeId];
    if (!src) {
      console.log(`  ✗ ${t.id}: Figma не отдала изображение`);
      continue;
    }
    const png = Buffer.from(await (await fetch(src)).arrayBuffer());
    fs.writeFileSync(path.join(dir, `${t.id}.png`), png);
    saved++;
  }
  appendHistory(e, `rest-images: ${saved}/${spec.targets.length}`);
  console.log(`✓ эталоны: ${saved}/${spec.targets.length} в ${dir}`);
}

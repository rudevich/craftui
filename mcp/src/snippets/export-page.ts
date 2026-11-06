// Runs in the Figma page (Chrome mode): PNG references of the breakpoint frames, pictures and graphics → the receiver.
import type { SnippetParams } from '../types.ts';
import { errorText, requireFigma, saver } from './lib/plugin.ts';

export default async function run(CU: SnippetParams) {
  const figma = await requireFigma();
  const save = saver(CU);
  const done: string[] = [];
  const failed: string[] = [];
  // One reference per breakpoint frame, at the page scale (pages.scale): a full screen at 2x would be huge.
  for (const t of CU.targets ?? []) {
    try {
      const node = (await figma.getNodeByIdAsync(t.nodeId)) as SceneNode | null;
      if (!node) throw new Error('not found');
      await save(`screenshots/${t.id}.png`, await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: CU.scale ?? 1 }, useAbsoluteBounds: true }));
      done.push(t.id);
    } catch (err) {
      failed.push(`${t.id}: ${errorText(err)}`);
    }
  }
  await save('screenshots/bounds.json', '{}');
  // Pictures as PNG at 2x (sharp on dense screens), vector graphics as SVG.
  for (const a of CU.assets ?? []) {
    try {
      const node = (await figma.getNodeByIdAsync(a.nodeId)) as SceneNode | null;
      if (!node) throw new Error('not found');
      const bytes = a.format === 'png'
        ? await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })
        : await node.exportAsync({ format: 'SVG_STRING', svgOutlineText: true, svgIdAttribute: false });
      await save(a.file, bytes);
      done.push(a.file);
    } catch (err) {
      failed.push(`${a.file}: ${errorText(err)}`);
    }
  }
  return { saved: done.length, failed };
}

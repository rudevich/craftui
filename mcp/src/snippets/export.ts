// Runs in the Figma page (Chrome mode): PNG references of the component targets and SVG assets → the receiver.
import type { SnippetParams } from '../types.ts';
import { errorText, requireFigma, saver } from './lib/plugin.ts';

const r2 = (v: number) => Math.round(v * 100) / 100;

export default async function run(CU: SnippetParams) {
  const figma = await requireFigma();
  const save = saver(CU);
  const done: string[] = [];
  const failed: string[] = [];
  const bounds: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const t of CU.targets ?? []) {
    try {
      const node = (await figma.getNodeByIdAsync(t.nodeId)) as SceneNode | null;
      if (!node) throw new Error('not found');
      // Usually the node box, same as the element box Playwright captures. A layer drawn outside it (a dropdown under
      // the field, a shadow) is part of the state: then the render area, and its offset from the node goes to bounds.json.
      const box = node.absoluteBoundingBox;
      const drawn = 'absoluteRenderBounds' in node ? node.absoluteRenderBounds : null;
      const outside = Boolean(box && drawn && (drawn.x < box.x - 0.5 || drawn.y < box.y - 0.5 || drawn.x + drawn.width > box.x + box.width + 0.5 || drawn.y + drawn.height > box.y + box.height + 0.5));
      const png = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: CU.scale ?? 2 }, useAbsoluteBounds: !outside });
      if (outside && box && drawn) bounds[t.id] = { x: r2(drawn.x - box.x), y: r2(drawn.y - box.y), w: r2(drawn.width), h: r2(drawn.height) };
      await save(`screenshots/${t.id}.png`, png);
      done.push(t.id);
    } catch (err) {
      failed.push(`${t.id}: ${errorText(err)}`);
    }
  }
  await save('screenshots/bounds.json', JSON.stringify(bounds, null, 2));
  for (const a of CU.assets ?? []) {
    try {
      const node = (await figma.getNodeByIdAsync(a.nodeId)) as SceneNode | null;
      if (!node) throw new Error('not found');
      await save(a.file, await node.exportAsync({ format: 'SVG_STRING', svgOutlineText: true, svgIdAttribute: false }));
      done.push(a.file);
    } catch (err) {
      failed.push(`${a.file}: ${errorText(err)}`);
    }
  }
  // Every target exported without failures is the screenshots step complete: the receiver closes it.
  if (!failed.length) await save('screenshots/.done', '', 'screenshots');
  return { saved: done.length, failed, ...(failed.length ? {} : { stepClosed: 'screenshots' }), ...(Object.keys(bounds).length ? { outsideNode: Object.keys(bounds) } : {}) };
}

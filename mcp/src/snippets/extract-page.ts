// Runs in the Figma page (Chrome mode): the breakpoint frames of a page → raw/plugin.json through the receiver.
import type { Raw, RawSource, RawVariant, SnippetParams } from '../types.ts';
import { core } from './lib/core.ts';

export default async function run(CU: SnippetParams) {
  const c = await core(CU);
  const { figma, ser } = c;

  // Each source is the frame of one breakpoint (mobile, tablet, desktop…), or a group / section with those frames.
  // Instances keep their children here; normalize-page drops them for components imported as entities.
  const sources: RawSource[] = [];
  const variants: RawVariant[] = [];
  for (const s of CU.sources ?? []) {
    const node = await figma.getNodeByIdAsync(s.nodeId);
    if (!node) throw new Error(`node ${s.nodeId} not found`);
    if (!('width' in node)) {
      throw new Error(`${node.name} (${node.type}): нужен фрейм брейкпоинта или группа с фреймами экрана, а не страница Figma — craftui extract {"action":"snippet","url":"<ссылка>","step":"probe"} покажет фреймы`);
    }
    // A group or section that holds the screen at several widths: every frame in it is a breakpoint.
    const frames: SceneNode[] = node.type === 'GROUP' || node.type === 'SECTION'
      ? node.children.filter((f) => f.visible !== false && (f.type === 'FRAME' || f.type === 'COMPONENT' || f.type === 'INSTANCE'))
      : [node as SceneNode];
    if (!frames.length) throw new Error(`${node.name} (${node.type}): внутри нет фреймов`);
    sources.push({ id: node.id, name: node.name, type: node.type, key: (node as ComponentNode).key, width: node.width, height: node.height });
    for (const f of frames) variants.push({ id: f.id, name: f.name, source: sources.length - 1, width: f.width, height: f.height, tree: await ser(f) });
  }

  const { variables, collections, styles } = await c.variablesAndStyles();
  const data: Raw = {
    meta: { source: 'chrome-plugin-api', kind: 'page', fileKey: figma.fileKey ?? CU.fileKey, nodeId: CU.nodeId ?? '', editorType: figma.editorType, extractedAt: new Date().toISOString(), truncated: c.truncated },
    root: sources[0],
    sources,
    variants,
    variables,
    collections,
    styles,
    instances: [...c.instances.values()],
    images: c.images,
  };
  const bytes = await c.saveRaw(data);
  return {
    saved: `${CU.craftlog}/figma/raw/plugin.json`,
    bytes,
    frames: variants.map((v) => `${v.name} ${Math.round(v.width)}×${Math.round(v.height)}`),
    nodes: c.count,
    images: c.images.length,
    components: data.instances.map((i) => `${i.name} ×${i.nodeIds.length}`),
    truncated: c.truncated,
  };
}

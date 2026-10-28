(async () => {
  const CU = __CU__;
  /*@core*/

  // Each source is the frame of one breakpoint (mobile, tablet, desktop…), or a group / section with those frames.
  // Instances keep their children here; normalize-page drops them for components imported as entities.
  const sources = [];
  const variants = [];
  for (const s of CU.sources) {
    const node = await figma.getNodeByIdAsync(s.nodeId);
    if (!node) throw new Error(`node ${s.nodeId} not found`);
    if (!('width' in node) || node.type === 'PAGE') {
      throw new Error(`${node.name} (${node.type}): нужен фрейм брейкпоинта или группа с фреймами экрана, а не страница Figma — npm run craftui -- snippet <ссылка> probe покажет фреймы`);
    }
    // A group or section that holds the screen at several widths: every frame in it is a breakpoint.
    const frames = node.type === 'GROUP' || node.type === 'SECTION'
      ? node.children.filter((c) => c.visible !== false && (c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'INSTANCE'))
      : [node];
    if (!frames.length) throw new Error(`${node.name} (${node.type}): внутри нет фреймов`);
    sources.push({ id: node.id, name: node.name, type: node.type, key: node.key, width: node.width, height: node.height });
    for (const f of frames) variants.push({ id: f.id, name: f.name, source: sources.length - 1, width: f.width, height: f.height, tree: await ser(f) });
  }

  const { variables, collections, styles } = await variablesAndStyles();
  const data = {
    meta: { source: 'chrome-plugin-api', kind: 'page', fileKey: figma.fileKey ?? CU.fileKey, nodeId: CU.nodeId, editorType: figma.editorType, extractedAt: new Date().toISOString(), truncated },
    root: sources[0],
    sources,
    variants,
    variables,
    collections,
    styles,
    instances: [...instances.values()],
    images,
  };
  const bytes = await saveRaw(data);
  return {
    saved: `${CU.craftlog}/figma/raw/plugin.json`,
    bytes,
    frames: variants.map((v) => `${v.name} ${Math.round(v.width)}×${Math.round(v.height)}`),
    nodes: count,
    images: images.length,
    components: data.instances.map((i) => `${i.name} ×${i.nodeIds.length}`),
    truncated,
  };
})()

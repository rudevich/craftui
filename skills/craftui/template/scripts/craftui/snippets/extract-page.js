(async () => {
  const CU = __CU__;
  /*@core*/

  // Each source is the frame of one breakpoint (mobile, tablet, desktop…): a screen as Figma draws it at that width.
  // Instances keep their children here; normalize-page drops them for components imported as entities.
  const sources = [];
  const variants = [];
  for (const s of CU.sources) {
    const node = await figma.getNodeByIdAsync(s.nodeId);
    if (!node) throw new Error(`node ${s.nodeId} not found`);
    if (!('width' in node) || node.type === 'PAGE' || node.type === 'SECTION') {
      throw new Error(`${node.name} (${node.type}): нужен фрейм одного брейкпоинта, а не секция или страница — npm run craftui -- snippet <ссылка> probe покажет фреймы`);
    }
    sources.push({ id: node.id, name: node.name, type: node.type, key: node.key, width: node.width, height: node.height });
    variants.push({ id: node.id, name: node.name, source: sources.length - 1, width: node.width, height: node.height, tree: await ser(node) });
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

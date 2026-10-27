(async () => {
  const CU = __CU__;
  /*@core*/
  const MAX_VARIANTS = 80;

  // Each source is a component set (or component); its `variant` adds or overrides axes (Size=M, View=Secondary Outline),
  // its `filter` keeps only matching variants — big UI-kit sets have hundreds of them.
  // Kits mix the spelling of values between sets (Disclosure=false / False, Today=No / False): compare without case,
  // yes/no and on/off count as true/false.
  const BOOL = { yes: 'true', no: 'false', on: 'true', off: 'false' };
  const canon = (v) => BOOL[String(v).toLowerCase()] ?? String(v).toLowerCase();
  const same = (a, b) => canon(a) === canon(b);
  const matches = (vp, filter) => !filter || filter.some((f) => Object.entries(f).every(([k, v]) => same(vp?.[k], v)));
  const sources = [];
  const warnings = [];
  const variants = [];
  for (const [index, s] of (CU.sources?.length ? CU.sources : [{ nodeId: CU.nodeId, variant: {} }]).entries()) {
    const node = await figma.getNodeByIdAsync(s.nodeId);
    if (!node) throw new Error(`node ${s.nodeId} not found`);
    const info = { id: node.id, name: node.name, type: node.type, key: node.key, width: node.width, height: node.height, variant: s.variant ?? {}, filter: s.filter };
    try {
      info.componentPropertyDefinitions = plain(node.componentPropertyDefinitions);
    } catch {}
    if ('description' in node) info.description = node.description;
    if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') info.parentSet = { id: node.parent.id, name: node.parent.name };
    sources.push(info);
    const picked = (node.type === 'COMPONENT_SET' ? node.children : [node]).filter((v) => matches(v.variantProperties, s.filter));
    if (!picked.length) {
      const axes = Object.entries(info.componentPropertyDefinitions ?? {}).filter(([, d]) => d.type === 'VARIANT').map(([k, d]) => `${k}: ${d.variantOptions.join('/')}`);
      warnings.push(`источник ${index} «${node.name}»: фильтр не нашёл вариантов (оси: ${axes.join('; ') || '—'}) — npm run craftui -- source ${CU.name} filter ${index} …`);
    }
    if (picked.length > MAX_VARIANTS) {
      throw new Error(`${node.name}: ${picked.length} вариантов — задай фильтр (npm run craftui -- source ${CU.name} filter …), не больше ${MAX_VARIANTS} за раз`);
    }
    for (const v of picked) {
      const own = plain(v.variantProperties ?? null);
      variants.push({ id: v.id, name: v.name, source: index, ownVariantProperties: own, variantProperties: own || Object.keys(info.variant).length ? { ...own, ...info.variant } : null, width: v.width, height: v.height, tree: await ser(v) });
    }
  }
  const root = sources[0];

  const { variables, collections, styles } = await variablesAndStyles();
  const data = {
    meta: { source: 'chrome-plugin-api', fileKey: figma.fileKey ?? CU.fileKey, nodeId: CU.nodeId, editorType: figma.editorType, extractedAt: new Date().toISOString(), truncated },
    root,
    sources,
    variants,
    variables,
    collections,
    styles,
    instances: [...instances.values()],
  };
  const bytes = await saveRaw(data);
  return {
    saved: `${CU.craftlog}/figma/raw/plugin.json`,
    bytes,
    node: `${root.type} "${root.name}"`,
    variants: variants.length,
    nodes: count,
    variables: variables.length,
    styles: styles.length,
    instances: data.instances.map((i) => `${i.name} ×${i.nodeIds.length}${i.remote ? ' (library)' : ''}`),
    truncated,
    ...(warnings.length ? { warnings } : {}),
  };
})()

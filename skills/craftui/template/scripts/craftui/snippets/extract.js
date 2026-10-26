(async () => {
  const CU = __CU__;
  // Figma creates the Plugin API lazily on first access to window.figma, so poll for it.
  const figma = await (async () => {
    for (let i = 0; i < 50; i++) {
      const f = window.figma;
      if (f && typeof f.getNodeByIdAsync === 'function') return f;
      await new Promise((r) => setTimeout(r, 200));
    }
    return undefined;
  })();
  if (typeof figma === 'undefined') throw new Error('Plugin API (figma) недоступен на этой странице — см. figma-chrome.md');
  const MAX_NODES = 5000;
  const MAX_VARIANTS = 80;

  const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, x) => (x === figma.mixed ? 'mixed' : x))));
  const variableIds = new Set();
  const styleIds = new Set();
  const instances = new Map();
  let count = 0;
  let truncated = false;

  const collectAliases = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.type === 'VARIABLE_ALIAS' && v.id) variableIds.add(v.id);
    for (const x of Array.isArray(v) ? v : Object.values(v)) collectAliases(x);
  };

  const PROPS = [
    'visible', 'opacity', 'blendMode', 'x', 'y', 'width', 'height', 'rotation',
    'layoutMode', 'layoutWrap', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'counterAxisAlignContent',
    'primaryAxisSizingMode', 'counterAxisSizingMode', 'itemSpacing', 'counterAxisSpacing', 'itemReverseZIndex',
    'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'layoutAlign', 'layoutGrow', 'layoutPositioning',
    'layoutSizingHorizontal', 'layoutSizingVertical', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'clipsContent',
    'constraints', 'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'strokeTopWeight', 'strokeRightWeight',
    'strokeBottomWeight', 'strokeLeftWeight', 'dashPattern', 'cornerRadius', 'topLeftRadius', 'topRightRadius',
    'bottomLeftRadius', 'bottomRightRadius', 'effects', 'boundVariables',
    'characters', 'fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textCase', 'textDecoration',
    'textAlignHorizontal', 'textAlignVertical', 'textAutoResize', 'textTruncation', 'maxLines',
    'fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId', 'componentPropertyReferences',
  ];

  async function ser(n) {
    if (++count > MAX_NODES) {
      truncated = true;
      return { id: n.id, name: n.name, type: n.type, truncated: true };
    }
    const o = { id: n.id, name: n.name, type: n.type };
    for (const p of PROPS) {
      if (!(p in n)) continue;
      try {
        const v = plain(n[p]);
        if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) o[p] = v;
      } catch {}
    }
    collectAliases(o.boundVariables);
    collectAliases(o.fills);
    collectAliases(o.strokes);
    collectAliases(o.effects);
    for (const p of ['fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId']) {
      if (typeof o[p] === 'string' && o[p] && o[p] !== 'mixed') styleIds.add(o[p]);
    }
    if (n.type === 'TEXT') {
      try {
        const segments = n.getStyledTextSegments(['fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fills', 'textCase', 'textDecoration', 'textStyleId', 'boundVariables']);
        if (segments.length > 1) o.segments = plain(segments);
        segments.forEach((s) => {
          collectAliases(s.boundVariables);
          collectAliases(s.fills);
          if (s.textStyleId) styleIds.add(s.textStyleId);
        });
      } catch {}
    }
    if (n.type === 'INSTANCE') {
      try {
        const main = await n.getMainComponentAsync();
        const set = main?.parent?.type === 'COMPONENT_SET' ? main.parent : null;
        o.instanceOf = main && {
          id: main.id,
          key: main.key,
          name: main.name,
          remote: main.remote,
          set: set && { id: set.id, key: set.key, name: set.name },
        };
        o.variantProperties = plain(n.variantProperties);
        o.componentProperties = plain(n.componentProperties);
        if (main) {
          const k = set?.key ?? main.key;
          const entry = instances.get(k) ?? { key: k, componentKey: main.key, setKey: set?.key ?? null, name: set?.name ?? main.name, mainId: set?.id ?? main.id, remote: main.remote, nodeIds: [] };
          entry.nodeIds.push(n.id);
          instances.set(k, entry);
        }
      } catch {}
    }
    try {
      o.css = await n.getCSSAsync();
    } catch {}
    if ('children' in n && n.children.length) o.children = await Promise.all(n.children.map(ser));
    return o;
  }

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

  // Variables (and their aliases) used anywhere in the tree.
  const variables = [];
  const collections = new Map();
  const queue = [...variableIds];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) continue;
      let c = collections.get(v.variableCollectionId);
      if (!c) {
        const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
        c = col ? { id: col.id, name: col.name, defaultModeId: col.defaultModeId, modes: plain(col.modes) } : { id: v.variableCollectionId };
        collections.set(v.variableCollectionId, c);
      }
      const valuesByMode = plain(v.valuesByMode);
      collectAliases(valuesByMode);
      for (const x of Object.values(valuesByMode)) if (x?.type === 'VARIABLE_ALIAS') queue.push(x.id);
      variables.push({ id: v.id, key: v.key, name: v.name, collectionId: v.variableCollectionId, resolvedType: v.resolvedType, scopes: v.scopes, codeSyntax: v.codeSyntax, remote: v.remote, valuesByMode });
    } catch {}
  }

  const styles = [];
  for (const id of styleIds) {
    try {
      const s = await figma.getStyleByIdAsync(id);
      if (!s) continue;
      const o = { id: s.id, key: s.key, name: s.name, type: s.type, remote: s.remote };
      if (s.type === 'PAINT') o.paints = plain(s.paints);
      if (s.type === 'EFFECT') o.effects = plain(s.effects);
      if (s.type === 'TEXT') Object.assign(o, plain({ fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textCase: s.textCase, textDecoration: s.textDecoration }));
      styles.push(o);
    } catch {}
  }

  const data = {
    meta: { source: 'chrome-plugin-api', fileKey: figma.fileKey ?? CU.fileKey, nodeId: CU.nodeId, editorType: figma.editorType, extractedAt: new Date().toISOString(), truncated },
    root,
    sources,
    variants,
    variables,
    collections: [...collections.values()],
    styles,
    instances: [...instances.values()],
  };
  const body = JSON.stringify(data);
  const res = await fetch(`${CU.receiver}/save?path=${encodeURIComponent(`${CU.craftlog}/figma/raw/plugin.json`)}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`receiver: ${res.status} ${await res.text()}`);
  return {
    saved: `${CU.craftlog}/figma/raw/plugin.json`,
    bytes: body.length,
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

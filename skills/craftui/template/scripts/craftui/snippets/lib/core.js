  // Shared by extract.js and extract-page.js: snippets.mjs puts this in place of the core marker.
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
  const MAX_NODES = CU.maxNodes ?? 5000;

  const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, x) => (x === figma.mixed ? 'mixed' : x))));
  const variableIds = new Set();
  const styleIds = new Set();
  const modeCollections = new Set(); // collections whose mode a layer sets (dark theme on a card, typography of a title)
  const instances = new Map();
  const images = []; // layers filled with a picture: exported as PNG for pages
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
    'fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId', 'componentPropertyReferences', 'explicitVariableModes',
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
    for (const id of Object.keys(o.explicitVariableModes ?? {})) modeCollections.add(id);
    // A layer filled with a picture (photo, illustration): exported as PNG, rendered as <img> on a page.
    if (Array.isArray(o.fills) && o.fills.some((f) => f.type === 'IMAGE' && f.visible !== false)) {
      o.image = true;
      images.push({ id: n.id, name: n.name, width: n.width, height: n.height });
    }
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

  async function variablesAndStyles() {
    // Styles first: a text style binds its size and line height to variables (typography modes), they are fetched too.
    const styles = [];
    for (const id of styleIds) {
      try {
        const s = await figma.getStyleByIdAsync(id);
        if (!s) continue;
        const o = { id: s.id, key: s.key, name: s.name, type: s.type, remote: s.remote };
        if (s.type === 'PAINT') o.paints = plain(s.paints);
        if (s.type === 'EFFECT') o.effects = plain(s.effects);
        if (s.type === 'TEXT') Object.assign(o, plain({ fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textCase: s.textCase, textDecoration: s.textDecoration, boundVariables: s.boundVariables }));
        collectAliases(o.boundVariables);
        styles.push(o);
      } catch {}
    }

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

    // Collections a layer switches the mode of: their names and modes give the data-* attribute of that layer.
    for (const id of modeCollections) {
      if (collections.has(id)) continue;
      try {
        const col = await figma.variables.getVariableCollectionByIdAsync(id);
        if (col) collections.set(id, { id: col.id, name: col.name, defaultModeId: col.defaultModeId, modes: plain(col.modes) });
      } catch {}
    }
    return { variables, collections: [...collections.values()], styles };
  }

  async function saveRaw(data) {
    const body = JSON.stringify(data);
    const res = await fetch(`${CU.receiver}/save?path=${encodeURIComponent(`${CU.craftlog}/figma/raw/plugin.json`)}`, { method: 'POST', body });
    if (!res.ok) throw new Error(`receiver: ${res.status} ${await res.text()}`);
    return body.length;
  }


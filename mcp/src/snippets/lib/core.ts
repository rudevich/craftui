// The layer serializer of extract and extract-page: Plugin API nodes → raw/plugin.json (RawNode), with the variables,
// styles and nested components they use. snippets.ts puts it in place of the import.
import type { Raw, RawCollection, RawNode, RawStyle, RawVariable, SnippetParams } from '../../types.ts';
import { requireFigma, saver } from './plugin.ts';

type Dict = Record<string, unknown>;

export async function core(CU: SnippetParams) {
  const figma = await requireFigma();
  const MAX_NODES = CU.maxNodes ?? 5000;

  const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v, (k, x) => (x === figma.mixed ? 'mixed' : x))));
  const variableIds = new Set<string>();
  const styleIds = new Set<string>();
  const modeCollections = new Set<string>(); // collections whose mode a layer sets (dark theme on a card, typography of a title)
  const instances = new Map<string, Raw['instances'][number]>();
  const images: NonNullable<Raw['images']> = []; // layers filled with a picture: exported as PNG for pages
  let count = 0;
  let truncated = false;

  const collectAliases = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    const x = v as { type?: string; id?: string };
    if (x.type === 'VARIABLE_ALIAS' && x.id) variableIds.add(x.id);
    for (const y of Array.isArray(v) ? v : Object.values(v)) collectAliases(y);
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

  async function ser(n: SceneNode): Promise<RawNode> {
    if (++count > MAX_NODES) {
      truncated = true;
      return { id: n.id, name: n.name, type: n.type, truncated: true };
    }
    const o: RawNode = { id: n.id, name: n.name, type: n.type };
    for (const p of PROPS) {
      if (!(p in n)) continue;
      try {
        const v = plain((n as unknown as Dict)[p]);
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
      const id = o[p];
      if (typeof id === 'string' && id && id !== 'mixed') styleIds.add(id);
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
        o.instanceOf = main ? { id: main.id, key: main.key, name: main.name, remote: main.remote, set: set && { id: set.id, key: set.key, name: set.name } } : undefined;
        o.variantProperties = plain(n.variantProperties);
        o.componentProperties = plain(n.componentProperties) as RawNode['componentProperties'];
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

  async function variablesAndStyles(): Promise<Pick<Raw, 'variables' | 'collections' | 'styles'>> {
    // Styles first: a text style binds its size and line height to variables (typography modes), they are fetched too.
    const styles: RawStyle[] = [];
    for (const id of styleIds) {
      try {
        const s = await figma.getStyleByIdAsync(id);
        if (!s) continue;
        const o = { id: s.id, key: s.key, name: s.name, type: s.type, remote: s.remote } as RawStyle;
        if (s.type === 'PAINT') o.paints = plain(s.paints) as RawStyle['paints'];
        if (s.type === 'EFFECT') o.effects = plain(s.effects) as unknown as RawStyle['effects'];
        if (s.type === 'TEXT') Object.assign(o, plain({ fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textCase: s.textCase, textDecoration: s.textDecoration, boundVariables: s.boundVariables }));
        collectAliases(o.boundVariables);
        styles.push(o);
      } catch {}
    }

    // Variables (and their aliases) used anywhere in the tree.
    const variables: RawVariable[] = [];
    const collections = new Map<string, RawCollection>();
    const queue = [...variableIds];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        const v = await figma.variables.getVariableByIdAsync(id);
        if (!v) continue;
        if (!collections.has(v.variableCollectionId)) {
          const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
          collections.set(v.variableCollectionId, col ? { id: col.id, name: col.name, defaultModeId: col.defaultModeId, modes: plain(col.modes) } : ({ id: v.variableCollectionId } as RawCollection));
        }
        const valuesByMode = plain(v.valuesByMode) as Dict;
        collectAliases(valuesByMode);
        for (const x of Object.values(valuesByMode) as { type?: string; id?: string }[]) if (x?.type === 'VARIABLE_ALIAS' && x.id) queue.push(x.id);
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

  const save = saver(CU);
  async function saveRaw(data: Raw, done?: string): Promise<number> {
    const body = JSON.stringify(data);
    await save('raw/plugin.json', body, done);
    return body.length;
  }

  return {
    figma,
    plain,
    ser,
    variablesAndStyles,
    saveRaw,
    instances,
    images,
    /** Layers serialized so far, and whether MAX_NODES cut the tree. */
    get count() {
      return count;
    },
    get truncated() {
      return truncated;
    },
  };
}

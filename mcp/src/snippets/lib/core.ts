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
  // Truncation is decided by a synchronous pre-order pass (plan) before any serialization: parallel ser() then cannot change the cut.
  const allowed = new Set<string>();
  const mainCache = new Map<string, Promise<ComponentNode | null>>();
  const imported = new Map<string, Promise<ComponentNode | null>>();
  let planned = 0;
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

  /** The main component of an instance, deduped by main id (instances of one component share it). */
  const mainOf = (n: InstanceNode): Promise<ComponentNode | null> => {
    let mainKey = n.id;
    try {
      mainKey = n.mainComponent?.id ?? n.id;
    } catch {}
    const p = mainCache.get(mainKey) ?? n.getMainComponentAsync().catch(() => null);
    mainCache.set(mainKey, p);
    return p;
  };

  /** Library content may not be loaded into the file: importing the main component brings its subtree. */
  const loadMain = (main: ComponentNode): Promise<ComponentNode | null> => {
    if (!imported.has(main.key)) imported.set(main.key, figma.importComponentByKeyAsync(main.key).catch(() => null));
    return imported.get(main.key)!;
  };

  /** The children to serialize for a node: an unloaded instance borrows its main component's subtree. */
  const kidsOf = async (n: SceneNode, main: ComponentNode | null): Promise<readonly SceneNode[]> => {
    if ('children' in n && n.children.length) return n.children;
    if (n.type === 'INSTANCE' && main) return (await loadMain(main))?.children ?? [];
    return [];
  };

  /** Fixes which nodes serialize (MAX_NODES, DFS pre-order over the roots); ser() then serializes exactly them, in any order. */
  async function plan(...roots: SceneNode[]) {
    const visit = async (n: SceneNode) => {
      if (planned >= MAX_NODES) {
        truncated = true;
        return;
      }
      planned++;
      allowed.add(n.id);
      const main = n.type === 'INSTANCE' ? await mainOf(n as InstanceNode) : null;
      for (const c of await kidsOf(n, main)) await visit(c);
    };
    for (const r of roots) await visit(r);
  }

  async function ser(n: SceneNode): Promise<RawNode> {
    // plan() was not run (a caller forgot): fall back to counting here, in call order.
    if (!planned) {
      planned++;
      allowed.add(n.id);
    } else if (!allowed.has(n.id)) return { id: n.id, name: n.name, type: n.type, truncated: true };
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
    let kids: SceneNode[] = [];
    let main: ComponentNode | null = null;
    if (n.type === 'INSTANCE') {
      // Instances share their main component: fetch it once per main id, together with this node's css.
      const [mainLoaded, css] = await Promise.all([mainOf(n as InstanceNode), n.getCSSAsync().catch(() => undefined)] as const);
      main = mainLoaded;
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
      if (css) o.css = css;
    } else {
      try {
        o.css = await n.getCSSAsync();
      } catch {}
    }
    for (const c of await kidsOf(n, main)) kids.push(c);
    if (kids.length) o.children = await Promise.all(kids.map((c) => ser(c)));
    return o;
  }

  async function variablesAndStyles(): Promise<Pick<Raw, 'variables' | 'collections' | 'styles'>> {
    // Styles first: a text style binds its size and line height to variables (typography modes), they are fetched too.
    const styles = (await Promise.all(
      [...styleIds].map(async (id): Promise<RawStyle | null> => {
        try {
          const s = await figma.getStyleByIdAsync(id);
          if (!s) return null;
          const o = { id: s.id, key: s.key, name: s.name, type: s.type, remote: s.remote } as RawStyle;
          if (s.type === 'PAINT') o.paints = plain(s.paints) as RawStyle['paints'];
          if (s.type === 'EFFECT') o.effects = plain(s.effects) as unknown as RawStyle['effects'];
          if (s.type === 'TEXT') Object.assign(o, plain({ fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textCase: s.textCase, textDecoration: s.textDecoration, boundVariables: s.boundVariables }));
          collectAliases(o.boundVariables);
          return o;
        } catch {
          return null;
        }
      }),
    )).filter((s): s is RawStyle => s !== null);

    // Variables (and their aliases) used anywhere in the tree: the alias graph is followed wave by wave, a wave in parallel.
    const variables: RawVariable[] = [];
    const collections = new Map<string, RawCollection>();
    const fetchCollection = async (id: string): Promise<RawCollection> => {
      try {
        const col = await figma.variables.getVariableCollectionByIdAsync(id);
        return col ? { id: col.id, name: col.name, defaultModeId: col.defaultModeId, modes: plain(col.modes) } : ({ id } as RawCollection);
      } catch {
        return { id } as RawCollection;
      }
    };
    const seen = new Set<string>();
    let queue = [...variableIds];
    while (queue.length) {
      const ids = [...new Set(queue)].filter((id) => !seen.has(id));
      queue = [];
      if (!ids.length) break;
      for (const id of ids) seen.add(id);
      const fetched = await Promise.all(ids.map((id) => figma.variables.getVariableByIdAsync(id).catch(() => null)));
      const collectionIds = [...new Set(fetched.filter((v): v is Variable => v !== null).map((v) => v.variableCollectionId))].filter((id) => !collections.has(id));
      const cols = await Promise.all(collectionIds.map(fetchCollection));
      collectionIds.forEach((id, i) => collections.set(id, cols[i]));
      const aliases: string[] = [];
      for (const v of fetched) {
        if (!v) continue;
        const valuesByMode = plain(v.valuesByMode) as Dict;
        collectAliases(valuesByMode);
        for (const x of Object.values(valuesByMode) as { type?: string; id?: string }[]) if (x?.type === 'VARIABLE_ALIAS' && x.id) aliases.push(x.id);
        variables.push({ id: v.id, key: v.key, name: v.name, collectionId: v.variableCollectionId, resolvedType: v.resolvedType, scopes: v.scopes, codeSyntax: v.codeSyntax, remote: v.remote, valuesByMode });
      }
      queue = aliases;
    }

    // Collections a layer switches the mode of: their names and modes give the data-* attribute of that layer.
    await Promise.all(
      [...modeCollections].map(async (id) => {
        if (!collections.has(id)) collections.set(id, await fetchCollection(id));
      }),
    );
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
    plan,
    ser,
    variablesAndStyles,
    saveRaw,
    instances,
    images,
    /** Nodes that will serialize (fixed by plan), and whether MAX_NODES cut the tree. */
    get count() {
      return planned;
    },
    get truncated() {
      return truncated;
    },
  };
}

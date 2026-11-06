// Runs in the Figma page (Chrome mode): the component sets of an entity → raw/plugin.json through the receiver.
import type { Raw, RawSource, RawVariant, SnippetParams, VariantFilter } from '../types.ts';
import { core } from './lib/core.ts';

const MAX_VARIANTS = 80;

// Each source is a component set (or component); its `variant` adds or overrides axes (Size=M, View=Secondary Outline),
// its `filter` keeps only matching variants — big UI-kit sets have hundreds of them.
// Kits mix the spelling of values between sets (Disclosure=false / False, Today=No / False): compare without case,
// yes/no and on/off count as true/false.
const BOOL: Record<string, string> = { yes: 'true', no: 'false', on: 'true', off: 'false' };
const canon = (v: unknown) => BOOL[String(v).toLowerCase()] ?? String(v).toLowerCase();
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const matches = (vp: Record<string, string> | null | undefined, filter: VariantFilter | undefined) =>
  !filter || filter.some((f) => Object.entries(f).every(([k, v]) => same(vp?.[k], v)));

export default async function run(CU: SnippetParams) {
  const c = await core(CU);
  const { figma, plain, ser } = c;
  const sources: RawSource[] = [];
  const warnings: string[] = [];
  const variants: (RawVariant & { ownVariantProperties: Record<string, string> | null })[] = [];
  for (const [index, s] of (CU.sources?.length ? CU.sources : [{ nodeId: CU.nodeId ?? '', variant: {} }]).entries()) {
    const node = await figma.getNodeByIdAsync(s.nodeId);
    if (!node) throw new Error(`node ${s.nodeId} not found`);
    const sized = node as SceneNode;
    const info: RawSource = { id: node.id, name: node.name, type: node.type, key: (node as ComponentNode).key, width: sized.width, height: sized.height, variant: s.variant ?? {}, filter: s.filter };
    try {
      info.componentPropertyDefinitions = plain((node as ComponentSetNode).componentPropertyDefinitions);
    } catch {}
    if ('description' in node) info.description = node.description;
    if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') info.parentSet = { id: node.parent.id, name: node.parent.name };
    sources.push(info);
    const children = (node.type === 'COMPONENT_SET' ? node.children : [node]) as ComponentNode[];
    const picked = children.filter((v) => matches(v.variantProperties, s.filter));
    if (!picked.length) {
      const defs = (info.componentPropertyDefinitions ?? {}) as Record<string, { type: string; variantOptions?: string[] }>;
      const axes = Object.entries(defs).filter(([, d]) => d.type === 'VARIANT').map(([k, d]) => `${k}: ${(d.variantOptions ?? []).join('/')}`);
      warnings.push(`источник ${index} «${node.name}»: фильтр не нашёл вариантов (оси: ${axes.join('; ') || '—'}) — craftui sources {"entity":"${CU.name}","action":"filter","index":${index}}`);
    }
    if (picked.length > MAX_VARIANTS) {
      throw new Error(`${node.name}: ${picked.length} вариантов — задай фильтр (craftui sources {"entity":"${CU.name}","action":"filter"}), не больше ${MAX_VARIANTS} за раз`);
    }
    for (const v of picked) {
      const own = plain(v.variantProperties ?? null);
      const added = (info.variant ?? {}) as Record<string, string>;
      variants.push({ id: v.id, name: v.name, source: index, ownVariantProperties: own, variantProperties: own || Object.keys(added).length ? { ...own, ...added } : null, width: v.width, height: v.height, tree: await ser(v) });
    }
  }
  const root = sources[0];

  const { variables, collections, styles } = await c.variablesAndStyles();
  const data: Raw = {
    meta: { source: 'chrome-plugin-api', fileKey: figma.fileKey ?? CU.fileKey, nodeId: CU.nodeId ?? '', editorType: figma.editorType, extractedAt: new Date().toISOString(), truncated: c.truncated },
    root,
    sources,
    variants,
    variables,
    collections,
    styles,
    instances: [...c.instances.values()],
  };
  const bytes = await c.saveRaw(data);
  return {
    saved: `${CU.craftlog}/figma/raw/plugin.json`,
    bytes,
    node: `${root.type} "${root.name}"`,
    variants: variants.length,
    nodes: c.count,
    variables: variables.length,
    styles: styles.length,
    instances: data.instances.map((i) => `${i.name} ×${i.nodeIds.length}${i.remote ? ' (library)' : ''}`),
    truncated: c.truncated,
    ...(warnings.length ? { warnings } : {}),
  };
}

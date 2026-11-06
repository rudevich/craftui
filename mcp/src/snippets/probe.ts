// Runs in the Figma page (Chrome mode): what the link points at, before anything is extracted — login, Plugin API,
// the node with its variants, frames (breakpoints of a screen) and nested components, the receiver.
import type { SnippetParams } from '../types.ts';
import { errorText, figmaApi } from './lib/plugin.ts';

type Frame = { id: string; name: string; width: number; height: number; range: string };
type Probe = {
  url: string;
  title: string;
  needsLogin?: boolean;
  requestAccess?: boolean;
  pluginApi?: boolean;
  editorType?: string;
  fileKey?: string;
  node?: {
    id: string;
    name: string;
    type: string;
    width?: number;
    height?: number;
    properties?: Record<string, unknown>;
    variants?: number;
    hint?: string;
    frames?: Frame[];
    range?: string;
    main?: string;
    components?: { id: string; name: string; type: string; variants?: number }[];
    nested?: { name: string; remote: boolean; count: number }[];
  } | null;
  nodeError?: string;
  receiver?: boolean | string;
};

export default async function run(CU: SnippetParams) {
  const figma = await figmaApi();
  const out: Probe = { url: location.href, title: document.title };
  out.needsLogin = /\/(login|signup|sign_in)/.test(location.pathname) || Boolean(document.querySelector('input[type="password"]'));
  out.requestAccess = /request access|запросить доступ/i.test(document.body?.innerText?.slice(0, 5000) ?? '');
  out.pluginApi = Boolean(figma);
  if (figma && CU.nodeId) {
    out.editorType = figma.editorType;
    out.fileKey = figma.fileKey;
    try {
      const node = await figma.getNodeByIdAsync(CU.nodeId);
      if (node?.type === 'PAGE') await node.loadAsync(); // pages load lazily in big files
      if (node) {
        // Enough for the import plan: what the node is, its variants and nested components.
        const sized = node as SceneNode;
        const info: NonNullable<Probe['node']> = { id: node.id, name: node.name, type: node.type, width: sized.width, height: sized.height };
        out.node = info;
        if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') {
          try {
            info.properties = Object.fromEntries(
              Object.entries(node.componentPropertyDefinitions).map(([k, d]) => [k.replace(/#[\d:]+$/, ''), d.type === 'VARIANT' ? d.variantOptions : d.type]),
            );
          } catch {}
        }
        if (node.type === 'COMPONENT_SET') info.variants = node.children.length;
        if (node.type === 'PAGE') info.hint = 'страница Figma: для компонента выбери его из components, для экрана — фреймы-брейкпоинты из frames';
        // A screen to import as a page: the frames of its breakpoints and the range each width falls into.
        const bp = CU.breakpoints ?? {};
        const RANGES = (['mobile', 'tablet', 'desktop', 'largeDesktop'] as const).filter((n) => bp[n]).map((n) => ({ name: n, min: bp[n]!.min ?? 0, max: bp[n]!.max ?? Infinity }));
        const range = (w: number) => RANGES.find((r) => w >= r.min && w <= r.max)?.name ?? (RANGES.length ? 'вне диапазонов' : 'брейкпоинты не заданы');
        if ('children' in node && ['PAGE', 'SECTION', 'FRAME', 'GROUP'].includes(node.type)) {
          const frames = (node.children as readonly SceneNode[]).filter((f) => f.type === 'FRAME' || f.type === 'COMPONENT' || f.type === 'INSTANCE').slice(0, 50);
          if (frames.length) info.frames = frames.map((f) => ({ id: f.id, name: f.name, width: Math.round(f.width), height: Math.round(f.height), range: range(f.width) }));
          if ((node.type === 'GROUP' || node.type === 'SECTION') && frames.length > 1) info.hint = 'экран из фреймов-брейкпоинтов: craftui create {"kind":"page","name":"<Имя>","url":"<эта ссылка>"} — каждый фрейм станет своим брейкпоинтом';
        }
        if (node.type === 'FRAME') info.range = range(node.width);
        if (node.type === 'INSTANCE') info.main = (await node.getMainComponentAsync())?.name;
        if ('findAll' in node) {
          if (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE') {
            info.components = node
              .findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })
              .filter((n) => n.type === 'COMPONENT_SET' || n.parent?.type !== 'COMPONENT_SET')
              .slice(0, 100)
              .map((n) => ({ id: n.id, name: n.name, type: n.type, variants: n.type === 'COMPONENT_SET' ? n.children.length : undefined }));
          }
          const nested = new Map<string, { name: string; remote: boolean; count: number }>();
          for (const i of node.findAll((n) => n.type === 'INSTANCE').slice(0, 300) as InstanceNode[]) {
            if (i.parent && i.parent.type === 'INSTANCE') continue;
            const main = await i.getMainComponentAsync();
            const set = main?.parent?.type === 'COMPONENT_SET' ? main.parent : null;
            const name = set?.name ?? main?.name;
            if (name) nested.set(name, { name, remote: Boolean(main?.remote), count: (nested.get(name)?.count ?? 0) + 1 });
          }
          info.nested = [...nested.values()];
        }
      } else out.node = null;
    } catch (err) {
      out.nodeError = String(err);
    }
  }
  try {
    out.receiver = (await fetch(`${CU.receiver}/ping`)).ok;
  } catch (err) {
    out.receiver = `blocked: ${errorText(err)}`;
  }
  return out;
}

import config from '../craftui.config.json';
import type { Demo } from './defineDemo';
import propsJson from './.generated/props.json';

export type PropDoc = {
  name: string;
  type: string;
  kind: string; // enum | boolean | string | number | ReactNode | …
  options?: string[];
  required: boolean;
  defaultValue?: string;
  description?: string;
};

export type Entity = {
  kind: string; // folder under src/ (craftui.config.json → dirs): components, pages
  name: string;
  demo: Demo<any>;
  props: PropDoc[];
  /** Pseudo-classes the design has states for (hover, active…), shown statically in the showcase. */
  pseudo: string[];
};

const dirs: Record<string, string> = { component: 'src/components', page: 'src/pages', ...(config as { dirs?: Record<string, string> }).dirs };
const folder = (dir: string) => dir.split('/').pop() ?? dir;
export const KIND_TITLES: Record<string, string> = { [folder(dirs.component)]: 'Компоненты', [folder(dirs.page)]: 'Страницы' };

const context = import.meta.webpackContext('../src', { recursive: true, regExp: /\.demo\.tsx$/ });
const metaByEntity = propsJson as Record<string, { props: PropDoc[]; pseudo: string[] }>;

export const entities: Entity[] = context
  .keys()
  .filter((key) => key.startsWith('./'))
  .map((key) => {
    const [kind, name] = key.slice(2).split('/');
    const mod = context(key) as { default: Demo<any> };
    const meta = metaByEntity[`${kind}/${name}`];
    return { kind, name, demo: mod.default, props: meta?.props ?? [], pseudo: meta?.pseudo ?? [] };
  })
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

export function craftlogUrl(entity: Entity, file: string) {
  return `/src/${entity.kind}/${entity.name}/craftlog/${file}`;
}

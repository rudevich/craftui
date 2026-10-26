// Controls and JSX code for the demo showcase and playground, built from the docgen metadata (demo/.generated/props.json).
import { isValidElement, type ReactNode } from 'react';
import type { Demo } from './defineDemo';
import type { PropDoc } from './registry';

export type Control =
  | { name: string; kind: 'select'; options: string[]; prop: PropDoc }
  | { name: string; kind: 'boolean' | 'text' | 'number'; prop: PropDoc }
  | { name: string; kind: 'slot'; presets: Record<string, ReactNode>; prop: PropDoc };

type DemoLike = Pick<Demo<any>, 'targets' | 'defaults' | 'slots'>;

/** Base props: demo.defaults, else the "default" target, else the first target. */
export function defaultsOf(demo: DemoLike): Record<string, unknown> {
  return { ...(demo.defaults ?? demo.targets.find((t) => t.id === 'default')?.props ?? demo.targets[0]?.props ?? {}) };
}

export function controlsFor(props: PropDoc[], demo: DemoLike): Control[] {
  return props.flatMap((prop): Control[] => {
    const { name } = prop;
    if (prop.kind === 'enum' && prop.options?.length) return [{ name, kind: 'select', options: prop.options, prop }];
    if (prop.kind === 'boolean') return [{ name, kind: 'boolean', prop }];
    if (prop.kind === 'number') return [{ name, kind: 'number', prop }];
    if (prop.kind === 'string') return [{ name, kind: 'text', prop }];
    if (/ReactNode|ReactElement/.test(prop.kind) || /ReactNode|ReactElement/.test(prop.type)) {
      const presets = (demo.slots as Record<string, Record<string, ReactNode>> | undefined)?.[name];
      // children is a label (text) unless the demo gives presets for it (an IconButton icon)
      if (name === 'children' && !presets) return [{ name, kind: 'text', prop }];
      return [{ name, kind: 'slot', presets: presets ?? {}, prop }];
    }
    return []; // functions and complex objects have no control
  });
}

export function nodeToJsx(node: unknown): string {
  if (typeof node === 'string') return JSON.stringify(node);
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (isValidElement(node)) {
    const type = node.type as string | { displayName?: string; name?: string };
    return `<${typeof type === 'string' ? type : type.displayName || type.name || 'Component'} />`;
  }
  return '…';
}

/** `<Name a="x" b>children</Name>` with only the props that differ from the component defaults. */
export function toJsx(name: string, values: Record<string, unknown>, props: PropDoc[]): string {
  const attrs: string[] = [];
  for (const prop of props) {
    const v = values[prop.name];
    if (prop.name === 'children' || v === undefined || v === null || v === false || v === '') continue;
    if (prop.defaultValue !== undefined && String(v) === prop.defaultValue) continue;
    if (v === true) attrs.push(prop.name);
    else if (typeof v === 'string') attrs.push(`${prop.name}="${v.replace(/"/g, '&quot;')}"`);
    else attrs.push(`${prop.name}={${nodeToJsx(v)}}`);
  }
  const children = values.children;
  const inner =
    children === undefined || children === null || children === ''
      ? ''
      : typeof children === 'string'
        ? children
        : isValidElement(children)
          ? nodeToJsx(children)
          : `{${nodeToJsx(children)}}`;
  const oneLine = `<${[name, ...attrs].join(' ')}${inner ? `>${inner}</${name}>` : ' />'}`;
  if (oneLine.length <= 80) return oneLine;
  const open = `<${name}\n${attrs.map((a) => `  ${a}`).join('\n')}\n`;
  return inner ? `${open}>\n  ${inner}\n</${name}>` : `${open}/>`;
}

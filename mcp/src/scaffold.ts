// Starting files for an entity, generated from spec.json. Existing files are kept unless --force.
import fs from 'node:fs';
import path from 'node:path';
import { cssDraft, markupDraft, tagOf } from './digest.ts';
import { appendHistory, fail, findEntity, readJson, tsLiteral } from './lib.ts';
import type { Entity, NodeMap, Prop, SourceFile, Spec, StateRole, Target } from './types.ts';

// Adds targets that spec.json has but <Name>.demo.tsx does not (new variants, sizes) — keeps manual edits.
function addTargets(e: Entity, spec: Spec) {
  const file = path.join(e.dir, `${e.name}.demo.tsx`);
  if (!fs.existsSync(file)) fail(`нет ${file} — сначала craftui build {"action":"scaffold","entity":"${e.name}"}`);
  let code = fs.readFileSync(file, 'utf8');
  const missing = spec.targets.filter((t) => !code.includes(`id: '${t.id}'`) && !code.includes(`id: "${t.id}"`));
  if (!missing.length) return console.log('все targets уже есть в демо');
  const lines = missing.map((t) => `    ${demoTarget(t)},`).join('\n');
  const end = code.lastIndexOf('  ],');
  if (end === -1) fail('не нашёл конец массива targets (строка "  ],") — добавь вручную');
  code = `${code.slice(0, end)}${lines}\n${code.slice(end)}`;
  if (lines.includes("slot('") && !/const slot =/.test(code)) {
    code = code.replace(/(import[^\n]*\n)(?!import)/, `$1\n// TODO: заменить заглушки слотов на содержимое из макета.\nconst slot = (name: string, width = 24, height = width) => <span data-slot={name} style={{ display: 'inline-block', width, height, borderRadius: 4, background: 'currentColor', opacity: 0.3 }} />;\n`);
  }
  fs.writeFileSync(file, code);
  appendHistory(e, `демо: добавлено targets ${missing.length}`);
  console.log(`добавлено в демо: ${missing.map((t) => t.id).join(', ')}`);
}

// '$slot:…' markers → slot('prop', width, height): a placeholder of the content size from Figma (see spec target.slots).
const slotCode = (code: string, slots: Target['slots'] = {}) =>
  code.replace(/(\w+): '\$slot:[\w-]+'/g, (_, prop: string) => {
    const size = slots[prop]?.size;
    return `${prop}: slot('${prop}'${size ? `, ${size.width}, ${size.height}` : ''})`;
  });

function demoTarget(t: Target): string {
  const target: Pick<Target, 'id' | 'title' | 'figmaNodeId' | 'props' | 'pseudo' | 'frame'> = { id: t.id, title: t.title, figmaNodeId: t.figmaNodeId, props: t.props ?? {} };
  if (t.pseudo?.length) target.pseudo = t.pseudo;
  if (t.frame) target.frame = t.frame;
  return slotCode(tsLiteral(target), t.slots);
}

export function run(ref: string | undefined, force: boolean, addOnly: boolean): void | Promise<void> {
  const e = findEntity(ref);
  if (e.kind === 'page') return import('./scaffold-page.ts').then((m) => m.run(e, force, addOnly));
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — craftui spec {"action":"normalize","entity":"${e.name}"}`);
  if (addOnly) return addTargets(e, spec);
  const nodeMap = readJson<NodeMap>(path.join(e.craftlog, 'figma', 'node-map.json'), { root: 'root' });
  const source = readJson<SourceFile>(path.join(e.craftlog, 'figma', 'source.json')) ?? fail(`нет source.json у ${e.name}`);
  const n = e.name;
  const tag = tagOf(n, spec);
  const element = ({ button: 'HTMLButtonElement', a: 'HTMLAnchorElement', div: 'HTMLDivElement' } as Record<string, string>)[tag];
  const props = spec.props.filter((p): p is Prop & { react: string } => Boolean(p.react));
  const flags = [...new Set(spec.props.filter((p) => p.role === 'state').flatMap((p) => Object.values(p.map ?? {}).map((r) => (r as StateRole | null)?.flag).filter((f): f is string => Boolean(f))))];
  const hasChildren = props.some((p) => p.react === 'children');
  const slotProps = props.filter((p) => p.role === 'slot');
  const markup = markupDraft(spec, nodeMap);

  const files: Record<string, string> = {
    'index.ts': `export { ${n} } from './${n}';\nexport type { ${n}Props } from './types';\n`,

    'types.ts': [
      `import type { ComponentPropsWithRef${props.some((p) => p.reactType === 'ReactNode') ? ', ReactNode' : ''} } from 'react';`,
      '',
      `export type ${n}Props = Omit<ComponentPropsWithRef<'${tag}'>, ${[...new Set(['children', ...props.map((p) => p.react)])].map((k) => `'${k}'`).join(' | ')}> & {`,
      ...props.map((p) => `  /** Figma: ${p.figma}${p.default !== undefined ? ` (по умолчанию ${JSON.stringify(p.default)})` : ''} */\n  ${p.react}?: ${p.reactType ?? 'unknown'};`),
      ...flags.filter((f) => !(tag === 'button' && f === 'disabled')).map((f) => `  ${f}?: boolean;`),
      ...(hasChildren ? [] : ['  children?: never;']),
      '};',
      '',
    ].join('\n'),

    [`${n}.tsx`]: (() => {
      const variantProps = props.filter((p) => p.role === 'prop');
      const defaults = variantProps.map((p) => {
        const d = p.map?.[String(p.default)];
        return d !== undefined ? `${p.react} = ${tsLiteral(d)}` : p.react;
      });
      // State flags that are not native attributes of the tag must not reach the DOM.
      const ownFlags = flags.filter((f) => !(tag === 'button' && f === 'disabled'));
      // A <button> outside a form must not submit it.
      const destructure = [...defaults, ...props.filter((p) => p.role !== 'prop' && p.react !== 'children').map((p) => p.react), ...ownFlags, ...(hasChildren ? ['children'] : []), 'className', ...(tag === 'button' ? ["type = 'button'"] : []), '...rest'];
      const dataAttrs = [
        ...(tag === 'button' ? ['type={type}'] : []),
        // A boolean prop is an attribute that is present or absent: data-outline="false" would still match [data-outline].
        ...variantProps.map((p) => `data-${p.react.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}={${p.react}${p.reactType === 'boolean' ? ' || undefined' : ''}}`),
        ...ownFlags.map((f) => `data-${f}={${f} || undefined}`),
        ...(ownFlags.includes('loading') ? ['aria-busy={loading || undefined}'] : []),
        ...(ownFlags.includes('disabled') ? ['aria-disabled={disabled || undefined}'] : []),
      ];
      return [
        `import { cx } from '../../lib/cx';`,
        `import styles from './styles.module.css';`,
        `import type { ${n}Props } from './types';`,
        '',
        `// Layer → class map: craftlog/figma/node-map.json; values from Figma: craftlog/figma/spec.json.`,
        `export function ${n}({ ${destructure.join(', ')} }: ${n}Props) {`,
        `  return (`,
        `    <${tag} className={cx(styles.root, className)} ${dataAttrs.join(' ')} {...rest}>`,
        // Draft markup from the default target's layers (craftui brief shows the same tree); without mapped layers — children.
        ...(markup.length ? markup : [hasChildren ? '      {children}' : '      {/* TODO: разметка — craftui digest {"action":"brief"} */}']),
        `    </${tag}>`,
        '  );',
        '}',
        '',
      ].join('\n');
    })(),

    'styles.module.css': cssDraft(n, spec, nodeMap, tag),

    [`${n}.demo.tsx`]: [
      `import { defineDemo } from '@demo';`,
      `import { ${n} } from '.';`,
      '',
      ...(slotProps.length || spec.targets.some((t) => JSON.stringify(t.props).includes('$slot:'))
        ? ['// TODO: заменить заглушки слотов на содержимое из макета (иконки: craftui build {"action":"svg"}, вложенные компоненты).', '// Placeholder of the content size from Figma; the component itself must not size slot content.\nconst slot = (name: string, width = 24, height = width) => <span data-slot={name} style={{ display: \'inline-block\', width, height, borderRadius: 4, background: \'currentColor\', opacity: 0.3 }} />;', '']
        : []),
      'export default defineDemo({',
      `  component: ${n},`,
      `  figma: { url: ${tsLiteral(source.url)}, nodeId: ${tsLiteral(source.nodeId)} },`,
      // Base props of the showcase and the playground; slots: choices for ReactNode props there.
      `  defaults: ${slotCode(tsLiteral((spec.targets.find((t) => t.id === 'default') ?? spec.targets[0])?.props ?? {}), (spec.targets.find((t) => t.id === 'default') ?? spec.targets[0])?.slots)},`,
      ...(slotProps.length
        ? [`  slots: { ${slotProps.map((p) => {
            const c = spec.targets.map((t) => t.slots?.[p.react]).find(Boolean);
            const value = c?.kind === 'text' ? tsLiteral(c.name) : `slot('${p.react}'${c?.size ? `, ${c.size.width}, ${c.size.height}` : ''})`;
            return `${p.react}: { 'заглушка': ${value} }`;
          }).join(', ')} },`]
        : []),
      '  targets: [',
      ...spec.targets.map((t) => `    ${demoTarget(t)},`),
      '  ],',
      '});',
      '',
    ].join('\n'),

    [`craftlog/visual/${n}.visual.spec.ts`]: `import { describeVisual } from '../../../../../tests/visual';\n\ndescribeVisual('${n}', '${path.basename(path.dirname(e.dir))}');\n`,

    'craftlog/visual/visual.config.json': `${JSON.stringify({ default: {}, targets: {} }, null, 2)}\n`,

    [`craftlog/tests/${n}.test.tsx`]: (() => {
      const variantProps = props.filter((p) => p.role === 'prop');
      const el = (attrs = '') => (hasChildren ? `<${n}${attrs}>Text</${n}>` : `<${n}${attrs} />`);
      const lines = [
        `import { describe, expect, it } from '@rstest/core';`,
        `import { render } from '@testing-library/react';`,
        `import { createRef } from 'react';`,
        `import { ${n} } from '../..';`,
        '',
        'const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;',
        '',
        `describe('${n}', () => {`,
        `  it('renders with default props', () => {`,
        `    const { container } = render(${el()});`,
        `    expect(root(container)).toBeInTheDocument();`,
        ...(hasChildren ? [`    expect(root(container)).toHaveTextContent('Text');`] : []),
        '  });',
        '',
        `  it('passes ref, className and other attributes to the root element', () => {`,
        `    const ref = createRef<${element}>();`,
        `    const { container } = render(${el(' ref={ref} className="extra" aria-label="label" data-x="1"')});`,
        '    expect(ref.current).toBe(root(container));',
        `    expect(root(container)).toHaveClass('extra');`,
        `    expect(root(container)).toHaveAttribute('aria-label', 'label');`,
        `    expect(root(container)).toHaveAttribute('data-x', '1');`,
        '  });',
      ];
      for (const p of variantProps) {
        const attr = `data-${p.react.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
        if (p.reactType === 'boolean') {
          lines.push(
            '',
            `  it('${p.react} → ${attr} only when true', () => {`,
            `    const { container, rerender } = render(${el(` ${p.react}`)});`,
            `    expect(root(container)).toHaveAttribute('${attr}');`,
            `    rerender(${el(` ${p.react}={false}`)});`,
            `    expect(root(container)).not.toHaveAttribute('${attr}');`,
            '  });',
          );
          continue;
        }
        lines.push(
          '',
          `  it.each(${tsLiteral(Object.values(p.map ?? {}))})('${p.react}=%s → ${attr}', (value) => {`,
          `    const { container } = render(${el(` ${p.react}={value as never}`)});`,
          `    expect(root(container)).toHaveAttribute('${attr}', value);`,
          '  });',
        );
      }
      lines.push('', '  // TODO: состояния и поведение (disabled, loading, клавиатура, слоты) — см. kind-component.md «rstest».', '});', '');
      return lines.join('\n');
    })(),
  };

  const created = [];
  const kept = [];
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(e.dir, rel);
    if (fs.existsSync(file) && (!force || fs.readFileSync(file, 'utf8') === content)) {
      kept.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    created.push(rel);
  }
  appendHistory(e, `scaffold: создано ${created.length}, оставлено ${kept.length}`);
  console.log(`scaffold ${e.dir}: создано ${created.join(', ') || '—'}${kept.length ? `; уже были (не тронуты): ${kept.join(', ')}` : ''}`);
  console.log(`Корневой тег: <${tag}> — поменяй в types.ts и ${n}.tsx, если в макете другая семантика.`);
}

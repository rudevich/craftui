// Starting files of a page, from spec.json: the page, its parts, the demo (one target per breakpoint), tests.
// Markup and CSS are drafts (digest-page.ts) to finish on the code step. Existing files are kept unless --force.
import fs from 'node:fs';
import path from 'node:path';
import { appendHistory, fail, readJson, tsLiteral } from './lib.ts';
import { importLines, markup, markupContext, pageCss, unionTree } from './digest-page.ts';
import { partFolder, sharedPartsDir } from './normalize-page.ts';
import type { Entity, NodeMap, SharedPart, SourceFile, Spec, SpecNode, Target } from './types.ts';

const findKey = (node: SpecNode, key: string): SpecNode | undefined => (node.key === key ? node : (node.children ?? []).map((c) => findKey(c, key)).find(Boolean));

export function run(e: Entity, force: boolean, addOnly: boolean) {
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — craftui spec {"action":"normalize","entity":"${e.name}"}`);
  const nodeMap = readJson<NodeMap>(path.join(e.craftlog, 'figma', 'node-map.json'), {});
  const source = readJson<SourceFile>(path.join(e.craftlog, 'figma', 'source.json')) ?? fail(`нет source.json у ${e.name}`);
  const n = e.name;
  const demoTarget = (t: Target) => tsLiteral({ id: t.id, title: t.title, figmaNodeId: t.figmaNodeId, props: {}, frame: { width: t.frame?.width ?? t.size.width } });
  if (addOnly) return addTargets(e, spec, demoTarget);

  const tree = unionTree(spec.targets) ?? fail('в spec.json нет слоёв');
  const css = pageCss(n, spec, nodeMap);
  const page = markupContext(spec, nodeMap, '      ');
  const body = markup(tree, page);
  const files: Record<string, string> = {
    'index.ts': `export { ${n} } from './${n}';\nexport type { ${n}Props } from './types';\n`,
    'types.ts': [
      `import type { ComponentPropsWithRef } from 'react';`,
      '',
      '/** Native attributes of the root <div> (className, style, aria-*…); the page takes its content from the design. */',
      `export type ${n}Props = ComponentPropsWithRef<'div'>;`,
      '',
    ].join('\n'),
    [`${n}.tsx`]: [
      `import { cx } from '../../lib/cx';`,
      ...importLines(page.imports, 2, './assets/'),
      `import styles from './styles.module.css';`,
      `import type { ${n}Props } from './types';`,
      '',
      '// A page from Figma: one frame per breakpoint (craftlog/figma/spec.json), mobile-first with @container (min-width).',
      `// Layer → class map: craftlog/figma/node-map.json. Draft from scaffold: semantics (header, main, section), alt, logic — on the code step.`,
      `export function ${n}({ className, ...rest }: ${n}Props) {`,
      '  return (',
      `    <div className={cx(styles.root, className)} {...rest}>`,
      ...body,
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n'),
    'styles.module.css': css.get('') ?? '',
    [`${n}.demo.tsx`]: [
      `import { defineDemo } from '@demo';`,
      `import { ${n} } from '.';`,
      '',
      '// One target per breakpoint frame: the frame width is the width of the page, its container queries follow it.',
      'export default defineDemo({',
      `  component: ${n},`,
      `  figma: { url: ${tsLiteral(source.url)}, nodeId: ${tsLiteral(source.nodeId)} },`,
      '  defaults: {},',
      '  targets: [',
      ...spec.targets.map((t) => `    ${demoTarget(t)},`),
      '  ],',
      '});',
      '',
    ].join('\n'),
    [`craftlog/visual/${n}.visual.spec.ts`]: `import { describeVisual } from '../../../../../tests/visual';\n\ndescribeVisual('${n}', '${path.basename(path.dirname(e.dir))}');\n`,
    'craftlog/visual/visual.config.json': `${JSON.stringify({ default: {}, targets: {} }, null, 2)}\n`,
  };

  // Parts: the layer's subtree in parts/<Page><Part>/, its classes in its own CSS module. A shared part goes to
  // src/pages/parts/<Name>/ once, with part.json: the page that made it owns it, later pages import it as it is.
  const parts = (spec.parts ?? []).map((p) => ({ ...p, folder: partFolder(n, p), node: findKey(tree, p.key) })).filter((p): p is typeof p & { node: SpecNode } => Boolean(p.node));
  const reused = [];
  const copies = [...page.imports.images.values()].map((file) => [file, 'assets']);
  for (const p of parts) {
    const made = p.shared && readJson(path.join(sharedPartsDir(), p.name, 'part.json'));
    if (made && made.page !== n) {
      reused.push(p.name);
      continue;
    }
    const dir = p.shared ? path.relative(e.dir, path.join(sharedPartsDir(), p.folder)) : `parts/${p.folder}`;
    const ctx = markupContext({ ...spec, parts: [] }, nodeMap, '      ');
    const lines = markup(p.node, ctx);
    copies.push(...[...ctx.imports.images.values()].map((file) => [file, p.shared ? `${dir}/assets` : 'assets']));
    if (p.shared) files[`${dir}/part.json`] = `${JSON.stringify({ name: p.name, page: n, key: p.key, layer: p.node.name, instance: p.node.instance?.key ?? null }, null, 2)}\n`;
    files[`${dir}/index.ts`] = `export { ${p.folder} } from './${p.folder}';\n`;
    files[`${dir}/${p.folder}.tsx`] = [
      ...(p.shared ? importLines(ctx.imports, 3, './assets/') : importLines(ctx.imports, 4, '../../assets/')),
      `import styles from './styles.module.css';`,
      '',
      p.shared
        ? `// Shared part of pages, made from ${n} (layer ${p.key}); other pages import it as it is. Classes: "${p.folder}/<class>" in ${n}/craftlog/figma/node-map.json.`
        : `// Part of the page ${n}: layer ${p.key}. Classes: "${p.folder}/<class>" in craftlog/figma/node-map.json.`,
      `export function ${p.folder}() {`,
      '  return (',
      '    <>',
      ...lines,
      '    </>',
      '  );',
      '}',
      '',
    ].join('\n');
    files[`${dir}/styles.module.css`] = css.get(p.folder) ?? `/* ${p.folder}: часть страницы ${n}. */\n`;
  }

  files[`craftlog/tests/${n}.test.tsx`] = [
    `import { describe, expect, it } from '@rstest/core';`,
    `import { render } from '@testing-library/react';`,
    `import { createRef } from 'react';`,
    `import { ${n} } from '../..';`,
    '',
    'const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;',
    '',
    `describe('${n}', () => {`,
    `  it('renders the page with its parts and components', () => {`,
    `    const { container } = render(<${n} />);`,
    '    expect(root(container)).toBeInTheDocument();',
    '    expect(container.querySelectorAll(\'img:not([alt])\')).toHaveLength(0);',
    '  });',
    '',
    `  it('passes ref, className and other attributes to the root element', () => {`,
    `    const ref = createRef<HTMLDivElement>();`,
    `    const { container } = render(<${n} ref={ref} className="extra" data-x="1" />);`,
    '    expect(ref.current).toBe(root(container));',
    `    expect(root(container)).toHaveClass('extra');`,
    `    expect(root(container)).toHaveAttribute('data-x', '1');`,
    '  });',
    '',
    '  // TODO: тексты и ссылки страницы, компоненты получают нужные пропсы — см. kind-page.md «rstest».',
    '});',
    '',
  ].join('\n');

  const created = [];
  const kept = [];
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(e.dir, rel);
    if (fs.existsSync(file) && !force) {
      kept.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    created.push(rel);
  }
  // Pictures the markup imports: copies next to the page (a shared part: next to it), so the build does not reach into craftlog/.
  const missing = [];
  copies.push(...spec.assets.filter((a) => a.format === 'png').map((a) => [a.file, 'assets']));
  for (const key of new Set(copies.map(([file, to]) => `${to}\n${file}`))) {
    const [where, file] = key.split('\n');
    const from = path.join(e.craftlog, 'figma', file);
    const to = path.join(e.dir, where, path.basename(file));
    if (!fs.existsSync(from)) missing.push(file);
    else if (force || !fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
  appendHistory(e, `scaffold: создано ${created.length}, оставлено ${kept.length}, частей ${parts.length}${reused.length ? `, общих готовых ${reused.join(', ')}` : ''}`);
  console.log(`scaffold ${e.dir}: создано ${created.join(', ') || '—'}${kept.length ? `; уже были (не тронуты): ${kept.join(', ')}` : ''}`);
  if (reused.length) console.log(`общие части взяты готовыми из ${sharedPartsDir()}: ${reused.join(', ')}`);
  if (missing.length) console.log(`⚠ нет файлов ${missing.join(', ')} — сначала шаг screenshots (snippet ${n} export)`);
}

function addTargets(e: Entity, spec: Spec, demoTarget: (t: Target) => string) {
  const file = path.join(e.dir, `${e.name}.demo.tsx`);
  if (!fs.existsSync(file)) fail(`нет ${file} — сначала craftui build {"action":"scaffold","entity":"${e.name}"}`);
  let code = fs.readFileSync(file, 'utf8');
  const missing = spec.targets.filter((t) => !code.includes(`id: '${t.id}'`));
  if (!missing.length) return console.log('все брейкпоинты уже есть в демо');
  const end = code.lastIndexOf('  ],');
  if (end === -1) fail('не нашёл конец массива targets (строка "  ],") — добавь вручную');
  code = `${code.slice(0, end)}${missing.map((t) => `    ${demoTarget(t)},`).join('\n')}\n${code.slice(end)}`;
  fs.writeFileSync(file, code);
  appendHistory(e, `демо: добавлено брейкпоинтов ${missing.length}`);
  console.log(`добавлено в демо: ${missing.map((t) => t.id).join(', ')}`);
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from '@rstest/core';
import * as api from '../api.ts';
import { applyStep, breakpointsFromArg, newEntity, saveState } from './lib.ts';
import { boolContent, mergeDefinitions, mergeProps, normNode } from './normalize.ts';
import { bundle } from './snippets.ts';
import { markSlotContent, suggestSlots } from './slots.ts';
import { STEPS } from './steps.ts';
import { toTsx } from './svg.ts';
import { sameColor } from './tokens.ts';
import { scanCss, scanTsx } from './units.ts';
import type { State } from './types.ts';

describe('units', () => {
  it('allows px, %, unitless and angles', () => {
    expect(scanCss('.a { width: 100%; padding: 0 12px; line-height: 1.2; transform: rotate(90deg); flex: 1 0 0; }')).toEqual([]);
  });

  it('flags em/rem with the line, also in media queries', () => {
    const found = scanCss('.a {\n  padding: 1rem;\n}\n@media (min-width: 40em) { .b { width: 10px; } }');
    expect(found.map((f) => `${f.line}:${f.value}`)).toEqual(['2:1rem', '4:40em']);
  });

  it('viewport units need a units: reason in the same rule', () => {
    expect(scanCss('.modal { height: 100dvh; }')[0]).toMatchObject({ unit: 'dvh', kind: 'viewport', justified: false });
    expect(scanCss('.modal { /* units: модальное окно на весь экран */ height: 100dvh; }')[0].justified).toBe(true);
  });

  it('ignores urls and hex colours, checks inline styles', () => {
    expect(scanCss('.a { background: url(img/2em.png) #1em; }')).toEqual([]);
    expect(scanTsx(`<div style={{ width: '2rem', height: 24 }} />`).map((f) => f.value)).toEqual(['2rem']);
  });
});

describe('markSlotContent', () => {
  const tree = (withIcon) => ({
    key: 'root',
    children: [
      { key: 'root/content', children: [...(withIcon ? [{ key: 'root/content/icon', name: 'icon', asset: 'assets/icon.svg', box: { w: 24, h: 24 }, expect: { width: '24px' } }] : []), { key: 'root/content/label', type: 'TEXT', expect: {} }] },
    ],
  });
  const spec = () => ({
    props: [{ figma: 'ContentLeft', key: 'ContentLeft', type: 'VARIANT', role: 'slot', react: 'contentLeft', options: ['False', 'True'], map: { False: null, True: 'content' } }],
    targets: [
      { id: 'default', variant: { ContentLeft: 'False', Size: 'M' }, tree: tree(false) },
      { id: 'content-left', variant: { ContentLeft: 'True', Size: 'M' }, tree: tree(true) },
      { id: 'content-left-xl', variant: { ContentLeft: 'True', Size: 'XL' }, tree: tree(true) },
    ],
  });

  it('marks layers that only the slot variant has and drops their style expectations', () => {
    const s = spec();
    expect(markSlotContent(s)).toEqual([]);
    const icon = s.targets[1].tree.children[0].children[0];
    expect(icon).toMatchObject({ slot: 'contentLeft' });
    expect(icon.expect).toBeUndefined();
    expect(s.targets[1].slots.contentLeft).toMatchObject({ key: 'root/content/icon', kind: 'graphic', size: { width: 24, height: 24 } });
  });

  it('reuses found keys when the empty variant was not extracted', () => {
    const s = spec();
    markSlotContent(s); // content-left-xl has no ContentLeft=False sibling (no Size=XL default)
    expect(s.targets[2].slots.contentLeft.key).toBe('root/content/icon');
  });
});

describe('constant slot content (IconButton)', () => {
  const icon = (key, size) => ({ key, name: 'icon', asset: 'assets/icon.svg', box: { w: size, h: size }, expect: { width: `${size}px` } });
  const spec = () => ({
    props: [],
    targets: [
      { id: 'm', tree: { key: 'root', box: { w: 48, h: 48 }, children: [{ ...icon('root/content', 24) }] } },
      // XXS: the Content frame has padding, the icon inside is the slot
      { id: 'xxs', tree: { key: 'root', box: { w: 24, h: 24 }, children: [{ key: 'root/content', box: { w: 24, h: 24 }, expect: {}, children: [icon('root/content/icon', 12)] }] } },
      { id: 'loading', tree: { key: 'root', box: { w: 48, h: 48 }, children: [icon('root/content', 24), { key: 'root/spinner', asset: 'assets/spinner.svg', box: { w: 24, h: 24 } }] } },
    ],
  });

  it('suggests keys that cover every target, leaving out the spinner of one target', () => {
    expect(suggestSlots(spec())).toEqual([{ keys: ['root/content', 'root/content/icon'], name: 'icon', size: { width: 24, height: 24 } }]);
  });

  it('binds several keys: per target the first one that is a slot root', () => {
    const s = spec();
    s.props.push({ figma: '@children', key: null, type: 'SLOT', role: 'slot', react: 'children', content: ['root/content', 'root/content/icon'], manual: true });
    markSlotContent(s);
    expect(s.targets.map((t) => t.slots.children.key)).toEqual(['root/content', 'root/content/icon', 'root/content']);
    expect(s.targets[1].tree.children[0].slot).toBeUndefined(); // the padded frame belongs to the component
    expect(s.targets[0].props.children).toBe('$slot:children');
  });
});

describe('normNode wrappers', () => {
  const ctx = () => ({ prefix: '', tokens: { byVariable: new Map(), byStyle: new Map() }, assets: new Map(), fonts: new Map(), instances: new Map(), inline: new Set(), resolutions: new Map() });
  const frame = (name, extra = {}) => ({ id: name, type: 'FRAME', name, x: 0, y: 0, width: 48, height: 48, visible: true, ...extra });
  const content = { id: 'c', type: 'FRAME', name: 'Content', x: 12, y: 12, width: 24, height: 24, layoutMode: 'HORIZONTAL', paddingTop: 0, children: [{ id: 't', type: 'TEXT', name: 'Label', x: 0, y: 0, width: 24, height: 24, characters: 'A', fills: [] }] };
  const button = () => frame('Button', { layoutMode: 'HORIZONTAL', paddingTop: 12, paddingRight: 12, paddingBottom: 12, paddingLeft: 12, itemSpacing: 6, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], children: [content] });

  it('collapses a plain frame and moves its opacity to the child (disabled)', () => {
    const node = normNode(frame('View=Default, Disabled=True', { type: 'COMPONENT', children: [frame('Button', { opacity: 0.4, children: [button()] })] }), 'root', ctx());
    expect(node.name).toBe('Button');
    expect(node.expect.opacity).toBe('0.4');
    expect(node.children.map((c) => c.key)).toEqual(['root/content']);
  });

  it('collapses past a zero-height spinner placeholder and moves it inside', () => {
    const spinner = frame('Spinner', { y: 48, height: 0.0001, children: [{ id: 's', type: 'ELLIPSE', name: 'Ring', x: 12, y: -36, width: 24, height: 24 }] });
    const node = normNode(frame('Loading=True', { type: 'COMPONENT', children: [button(), spinner] }), 'root', ctx());
    expect(node.children.map((c) => c.key)).toEqual(['root/content', 'root/spinner']);
    expect(node.children[1].expect.height).toBeUndefined(); // the placeholder size is not a design value
  });

  it('keeps a frame with gap: it lays out more children in other variants', () => {
    const node = normNode(frame('Root', { type: 'COMPONENT', children: [frame('Row', { itemSpacing: 8, children: [button()] })] }), 'root', ctx());
    expect(node.name).toBe('Row'); // the component shell collapses into it, the row itself stays
    expect(node.children.map((c) => c.key)).toEqual(['root/button']);
  });
});

describe('tokens and icons', () => {
  it('near-equal colours are a library copy, not a conflict', () => {
    expect(sameColor('#030607', '#030303')).toBe(true);
    expect(sameColor('#030607', '#111c22')).toBe(false);
    // hover 0.42 and active 0.44 of one palette are different tokens: still a conflict
    expect(sameColor('rgba(214, 223, 230, 0.42)', 'rgba(214, 223, 230, 0.44)')).toBe(false);
    expect(sameColor('rgba(214, 223, 230, 0.42)', 'rgba(214, 223, 230, 0.42)')).toBe(true);
  });

  it('a clipPath rect does not make an icon multi-colour', () => {
    const svg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><g clip-path="url(#a)"><path d="M0 0" fill="#109C84"/></g><defs><clipPath id="a"><rect width="12" height="12" fill="white"/></clipPath></defs></svg>';
    const tsx = toTsx(svg, 'IconX');
    expect(tsx).toContain('fill="currentColor"');
    // a clip as big as the icon clips nothing: dropped with its id
    expect(tsx).not.toContain('clipPath');
    expect(tsx).not.toContain('<defs>');
  });

  it('a clip smaller than the icon stays', () => {
    const svg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><g clip-path="url(#a)"><path d="M0 0" fill="#109C84"/></g><defs><clipPath id="a"><rect x="2" width="8" height="12" fill="white"/></clipPath></defs></svg>';
    const tsx = toTsx(svg, 'IconX');
    expect(tsx).toContain('clipPath="url(#a)"');
    expect(tsx).toContain('fill="white"');
  });
});

describe('several sets of one kit', () => {
  it('values that differ only in case are one option, variants get the first spelling', () => {
    const sources = [{ componentPropertyDefinitions: { Selected: { type: 'VARIANT', variantOptions: ['false', 'true'] } } }];
    const variants = [{ variantProperties: { Selected: 'true' } }, { variantProperties: { Selected: 'True' } }];
    expect(mergeDefinitions(sources, variants).Selected.variantOptions).toEqual(['false', 'true']);
    expect(variants[1].variantProperties.Selected).toBe('true');
  });

  it('yes/no of one set and true/false of another are one boolean option', () => {
    const sources = [{ componentPropertyDefinitions: { Today: { type: 'VARIANT', variantOptions: ['False', 'True'] } } }];
    const variants = [{ variantProperties: { Today: 'Yes' } }, { variantProperties: { Today: 'No' } }];
    expect(mergeDefinitions(sources, variants).Today.variantOptions).toEqual(['False', 'True']);
    expect(variants.map((v) => v.variantProperties.Today)).toEqual(['True', 'False']);
  });

  it('a TEXT/BOOLEAN prop of every set is one prop with all its keys', () => {
    const sources = [
      { componentPropertyDefinitions: { 'Caption#1:2': { type: 'BOOLEAN', defaultValue: false } } },
      { componentPropertyDefinitions: { 'Caption#3:4': { type: 'BOOLEAN', defaultValue: false } } },
    ];
    const defs = mergeDefinitions(sources, []);
    expect(Object.keys(defs)).toEqual(['Caption#1:2']);
    expect(defs['Caption#1:2'].keys).toEqual(['Caption#1:2', 'Caption#3:4']);
  });
});

describe('BOOLEAN props that show a layer', () => {
  const ctx = (boolKeys) => ({ prefix: '', tokens: { byVariable: new Map(), byStyle: new Map() }, assets: new Map(), fonts: new Map(), instances: new Map(), inline: new Set(), resolutions: new Map(), boolKeys });
  const text = (name, ref, visible = true) => ({ id: name, type: 'TEXT', name, x: 0, y: 0, width: 50, height: 14, characters: name, visible, componentPropertyReferences: ref ? { visible: ref } : undefined });

  it('a layer off in the variant stays in the tree as hidden, without style expectations', () => {
    const variant = { id: 'v', type: 'COMPONENT', name: 'V', x: 0, y: 0, width: 100, height: 40, layoutMode: 'VERTICAL', itemSpacing: 4, children: [text('Value'), text('Caption', 'Caption#1:2', false), text('Other', 'Foreign#9:9', false)] };
    const node = normNode(variant, 'root', ctx(new Set(['Caption#1:2'])));
    expect(node.children.map((c) => c.key)).toEqual(['root/value', 'root/caption']); // a layer of someone else's prop is dropped
    expect(node.children[1]).toMatchObject({ hidden: 'Caption' });
    expect(node.children[1].expect).toBeUndefined();
  });

  it('an icon becomes a slot, a text becomes a text prop with the text where it is on', () => {
    const props = [
      { figma: 'ContentRight', key: 'ContentRight#1:3', type: 'BOOLEAN', role: 'bool', react: 'contentRight' },
      { figma: 'ContentLeft', key: 'ContentLeft#1:1', type: 'BOOLEAN', role: 'bool', react: 'contentLeft' },
      { figma: 'Caption', key: 'Caption#1:2', type: 'BOOLEAN', role: 'bool', react: 'caption' },
    ];
    const tree = (captionOn) => ({ key: 'root', children: [{ key: 'root/right', propRefs: { visible: 'ContentRight#1:3' }, children: [{ key: 'root/right/icon', asset: 'assets/a.svg' }] }, { key: 'root/icon', asset: 'assets/icon.svg', propRefs: { visible: 'ContentLeft#1:1' } }, { key: 'root/caption', type: 'TEXT', text: { characters: 'Подпись' }, propRefs: { visible: 'Caption#1:2' }, ...(captionOn ? {} : { hidden: 'Caption' }) }] });
    const targets = [{ id: 'a', props: { contentLeft: true, caption: false }, tree: tree(false) }, { id: 'b', props: { contentLeft: true, caption: true }, tree: tree(true) }];
    boolContent(props, targets);
    expect(props[0]).toMatchObject({ role: 'slot', content: ['root/right'] }); // a frame around one icon
    expect(props[1]).toMatchObject({ role: 'slot', reactType: 'ReactNode', content: ['root/icon'] });
    expect(props[2]).toMatchObject({ role: 'text', reactType: 'ReactNode' });
    expect(targets.map((t) => t.props.caption)).toEqual([undefined, 'Подпись']);
  });

  it('a chevron that changes with the state is not offered as a slot', () => {
    const t = (id, asset) => ({ id, source: 0, tree: { key: 'root', box: { w: 280, h: 48 }, children: [{ key: 'root/chevron', asset, box: { w: 24, h: 24 } }] } });
    expect(suggestSlots({ props: [], targets: [t('closed', 'assets/down.svg'), t('open', 'assets/up.svg')] })).toEqual([]);
  });
});

describe('digest: drafts and brief for small context windows', () => {
  const node = (key, css, extra = {}) => ({ key, type: extra.text ? 'TEXT' : 'FRAME', box: { w: 10, h: 10 }, css, ...extra });
  const tree = (bg, padding, size = '16px') => ({
    ...node('root', { display: 'flex', padding, background: `var(--${bg}, #000)` }, { tokens: { 'background-color': `--${bg}` } }),
    children: [node('root/label', { color: 'var(--c)', 'font-size': size, width: '40px' }, { text: { characters: 'Label' } })],
  });
  const spec = {
    figma: { nodeName: 'Button' },
    props: [
      { figma: 'Size', role: 'prop', react: 'size', reactType: "'m' | 'xl'", default: 'M', map: { M: 'm', XL: 'xl' } },
      { figma: 'View', role: 'prop', react: 'view', reactType: "'default' | 'accent'", default: 'Default', map: { Default: 'default', Accent: 'accent' } },
      { figma: 'Hovered', role: 'state', react: null, map: { False: null, True: { pseudo: 'hover' } } },
      { figma: 'Label', role: 'text', react: 'children', nodeKey: 'root/label', default: 'Label' },
    ],
    targets: [
      { id: 'default', props: { size: 'm', view: 'default' }, tree: tree('bg', '11px 20px') },
      { id: 'xl', props: { size: 'xl', view: 'default' }, tree: tree('bg', '0 28px', '18px') },
      { id: 'accent', props: { size: 'm', view: 'accent' }, tree: tree('accent', '11px 20px') },
      { id: 'hovered', props: { size: 'm', view: 'default' }, pseudo: ['hover'], tree: tree('hover', '11px 20px') },
      { id: 'accent-hovered', props: { size: 'm', view: 'accent' }, pseudo: ['hover'], tree: tree('accent-hover', '11px 20px') },
    ],
  };
  const map = { root: 'root', 'root/label': 'label' };

  it('CSS draft: base from default, one rule per value, combinations only for what the parts do not explain', async () => {
    const { cssDraft } = await import('./digest.ts');
    const css = cssDraft('Button', spec, map, 'button');
    expect(css).toContain('.root {\n  border: 0;\n  cursor: pointer;\n  display: flex;\n  padding: 11px 20px;\n  background: var(--bg);\n}');
    expect(css).toContain(".root[data-size='xl'] {\n  padding: 0 28px;\n}");
    expect(css).toContain(".root[data-size='xl'] .label {\n  font-size: 18px;\n}");
    expect(css).toContain(".root[data-view='accent'] {\n  background: var(--accent);\n}");
    expect(css).toContain('.root:hover {\n  background: var(--hover);\n}');
    expect(css).toContain(".root[data-view='accent']:hover {\n  background: var(--accent-hover);\n}");
    expect(css).not.toContain('width: 40px'); // a text box takes the size of its text
  });

  it('markup draft: classes from the node map, the text prop in its layer', async () => {
    const { markupDraft } = await import('./digest.ts');
    expect(markupDraft(spec, map, '')).toEqual(['<span className={styles.label}>{children}</span>']);
  });

  it('brief stays within its budget however big the spec is', async () => {
    const { briefOf } = await import('./digest.ts');
    const many = { ...spec, targets: Array.from({ length: 300 }, (_, i) => ({ ...spec.targets[i % 5], id: `t${i}` })) };
    const bigMap = { ...map, ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`root/x${i}`, `x${i}`])) };
    const text = briefOf('Button', many, bigMap);
    expect(text.length).toBeLessThan(12500);
    expect(text).toContain("data-size: 'm' | 'xl'");
  });

  it('step cards are short enough to replace the references', async () => {
    const { STEPS, instructions } = await import('./steps.ts');
    const e = { name: 'Button', dir: 'src/components/Button', craftlog: 'src/components/Button/craftlog', specFile: 'src/components/Button/craftlog/figma/spec.json' };
    for (const source of ['chrome', 'figma']) {
      for (const [id] of STEPS.component) expect(instructions(e, { source, figma: { url: 'u' } }, id).join('\n').length).toBeLessThan(1000);
    }
  });

  it('SKILL.md stays a short core (references hold the details)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'craftui', 'SKILL.md');
    if (fs.existsSync(file)) expect(fs.statSync(file).size).toBeLessThan(8000);
  });
});

describe('manual props survive normalize --keep', () => {
  it('a prop whose values map to true/false stays boolean', () => {
    const fresh = [{ figma: 'Optional', key: 'Optional', type: 'VARIANT', role: 'prop', react: 'optional', reactType: "'false' | 'true'", map: { False: 'false', True: 'true' } }];
    const previous = { props: [{ ...fresh[0], reactType: "'false' | 'true'", map: { False: false, True: true } }] };
    expect(mergeProps(fresh, previous)[0].reactType).toBe('boolean');
  });
});

describe('data source', () => {
  it('chrome (Chrome MCP) by default, the first value given wins, "mcp" is the old name of figma', async () => {
    const { resolveSource } = await import('./lib.ts');
    expect(resolveSource(undefined, undefined, '')).toBe('chrome');
    expect(resolveSource(undefined, 'figma', 'chrome')).toBe('figma');
    expect(resolveSource('mcp')).toBe('figma');
    expect(resolveSource('Chrome')).toBe('chrome');
    expect(resolveSource('browser')).toBeUndefined();
  });
});

describe('project settings', () => {
  it('nested blocks merge key by key; problems are reported, not thrown', async () => {
    const { withDefaults, configProblems } = await import('./lib.ts');
    const cfg = withDefaults({ dirs: { page: 'src/screens' }, pages: { scale: 2 } });
    expect(cfg.dirs).toEqual({ component: 'src/components', page: 'src/screens' });
    expect(cfg.pages).toMatchObject({ scale: 2, maxDiffRatio: 0.02, export: true, breakpoints: null });
    expect(cfg.context).toBe('small');
    expect(configProblems(cfg)).toEqual([]);
    const bad = configProblems(withDefaults({ dirs: { component: 'src/ui/components' }, defaultKind: 'widget', context: 'huge' }));
    expect(bad.join('\n')).toMatch(/dirs.component/);
    expect(bad.join('\n')).toMatch(/defaultKind/);
    expect(bad.join('\n')).toMatch(/context/);
  });

  it('breakpoints from the answers: empty tablet — none, empty desktop — open-ended, a desktop bound adds large desktop', async () => {
    const { breakpointsFrom, breakpointOf, breakpointProblems, describeBreakpoints } = await import('./lib.ts');
    const bp = breakpointsFrom({ mobile: '767', tablet: '1279', desktop: '' });
    expect(bp).toEqual({ mobile: { max: 767 }, tablet: { min: 768, max: 1279 }, desktop: { min: 1280 }, largeDesktop: null });
    expect(describeBreakpoints(bp)).toBe('mobile ≤ 767px · tablet 768–1279px · desktop ≥ 1280px');
    expect(breakpointsFrom({ mobile: 599, tablet: '', desktop: 1919 })).toEqual({ mobile: { max: 599 }, tablet: null, desktop: { min: 600, max: 1919 }, largeDesktop: { min: 1920 } });
    expect([375, 768, 1279, 1440].map((w) => breakpointOf(w, bp))).toEqual(['mobile', 'tablet', 'tablet', 'desktop']);
    expect(() => breakpointsFrom({ mobile: 700, tablet: 600 })).toThrow(/tablet/);
    expect(breakpointProblems({ mobile: { max: 767 }, desktop: { min: 1000 } })[0]).toMatch(/768/);
  });
});

describe('page drafts', () => {
  const bp = { mobile: { max: 767 }, desktop: { min: 1280 } };
  const node = (key, css, extra = {}) => ({ key, type: 'FRAME', box: { w: 100, h: 10 }, css, ...extra });
  const frame = (w, desktop) => ({
    id: desktop ? 'desktop' : 'mobile',
    breakpoint: desktop ? 'desktop' : 'mobile',
    size: { width: w, height: 800 },
    frame: { width: w },
    props: {},
    tree: node('root', { display: 'flex', padding: desktop ? '32px' : '16px', width: `${w}px` }, {
      children: [
        node('root/hero', { 'flex-direction': desktop ? 'row' : 'column' }),
        ...(desktop ? [node('root/nav', { display: 'flex', gap: '32px' })] : [node('root/menu', { color: 'red' })]),
        node('root/cta', { padding: '12px', 'align-self': 'stretch' }, { instance: { key: 'k', name: 'Button', variant: { Size: desktop ? 'L' : 'M' } } }),
      ],
    }),
  });
  const spec = { name: 'Landing', targets: [frame(1440, true), frame(375, false)], instances: [{ key: 'k', name: 'Button', resolution: 'entity:component/BasicButton' }], parts: [] };
  const map = { root: 'frame', 'root/hero': 'hero', 'root/nav': 'Header/nav', 'root/menu': 'Header/menu', 'root/cta': 'cta' };

  it('mobile first, the borders come from the settings, not from the frame widths', async () => {
    const { pageCss } = await import('./digest-page.ts');
    const css = pageCss('Landing', spec, map, bp);
    const page = css.get('');
    expect(page).toContain('.root {\n  container-type: inline-size;\n  width: 100%;\n}');
    expect(page).toContain('.frame {\n  display: flex;\n  padding: 16px;\n  width: 100%;\n}');
    expect(page).toContain('@container (min-width: 1280px) {');
    expect(page).not.toContain('1440px) {');
    expect(page).toMatch(/\.cta \{\n {2}align-self: stretch;\n\}/); // a component keeps only its placement
    const header = css.get('Header');
    expect(header).toContain('.nav {\n  display: none;\n}');
    expect(header).toMatch(/@container \(min-width: 1280px\) \{[\s\S]*\.menu \{\n {4}display: none;/);
  });

  it('union of the breakpoints in the widest order, a component with props of the narrowest frame', async () => {
    const { markup, markupContext, unionTree } = await import('./digest-page.ts');
    const ctx = markupContext(spec, map, '');
    ctx.compSpec = () => ({ props: [{ figma: 'Size', role: 'prop', react: 'size', default: 'M', map: { M: 'm', L: 'l' } }] });
    const lines = markup(unionTree(spec.targets), ctx);
    expect(lines[0]).toBe('<div className={styles.frame}>');
    // A layer only the narrow frame has comes right after its sibling there (menu after hero), the rest keeps the widest order.
    const at = (cls) => lines.findIndex((l) => l.includes(`styles.${cls}`));
    expect([at('hero') + 1, at('menu') + 1]).toEqual([at('menu'), at('nav')]);
    expect(lines.some((l) => l.includes('меняется с шириной') && l.includes('size="l"'))).toBe(true);
    expect(lines).toContain('  <BasicButton className={styles.cta} />');
    expect([...ctx.imports.components]).toEqual(['BasicButton']);
  });

  it('page cards are within the budget', async () => {
    const { STEPS, instructions } = await import('./steps.ts');
    const e = { kind: 'page', name: 'Landing', dir: 'src/pages/Landing', craftlog: 'src/pages/Landing/craftlog' };
    for (const [id] of STEPS.page) expect(instructions(e, { figma: { url: 'u' } }, id).join('\n').length).toBeLessThan(1000);
  });
});

describe('a real screen: frames without auto-layout, texts, component instances', () => {
  const ctx = () => ({ prefix: '', tokens: { byVariable: new Map(), byStyle: new Map(), figmaCssNames: new Map() }, assets: new Map(), fonts: new Map(), instances: new Map(), inline: new Set(), resolutions: new Map() });
  const text = (name, characters, css = {}) => ({ id: name, type: 'TEXT', name, x: 0, y: 0, width: 100, height: 20, visible: true, characters, fills: [], css });

  it('a frame placed by x/y becomes a column: order by y, gaps as margins, alignment in the column, centred on wide frames', async () => {
    const { flowLayout } = await import('./normalize-page.ts');
    const kid = (key, x, y, w, h) => ({ key, box: { x, y, w, h }, css: { width: `${w}px` } });
    const tree = (W, side) => ({
      key: 'root',
      box: { x: 0, y: 0, w: W, h: 600 },
      css: { width: `${W}px`, height: '600px' },
      children: [kid('root/button', W - side - 100, 400, 100, 40), kid('root/logo', side, 40, 120, 32), kid('root/title', W / 2 - 100, 150, 200, 30), kid('root/text', side, 220, W - 2 * side, 140)],
    });
    const mobile = flowLayout(tree(320, 24), { frameWidth: 320 });
    expect(mobile.children.map((c) => c.key)).toEqual(['root/logo', 'root/title', 'root/text', 'root/button']);
    expect(mobile.css).toMatchObject({ display: 'flex', 'flex-direction': 'column', 'padding-top': '40px', 'padding-left': '24px', 'padding-bottom': '160px' });
    expect(mobile.css.height).toBeUndefined();
    const [logo, title, body, button] = mobile.children.map((c) => c.css);
    expect([logo['align-self'], title['align-self'], body['align-self'], button['align-self']]).toEqual(['flex-start', 'center', 'stretch', 'flex-end']);
    expect([title['margin-top'], body['margin-top'], button['margin-top']]).toEqual(['78px', '40px', '40px']);
    expect(body.width).toBeUndefined();
    const desktop = flowLayout(tree(1920, 320), { minSide: 24, frameWidth: 1920 });
    expect(desktop.css['padding-left']).toBe('max(24px, calc((100% - 1280px) / 2))');
  });

  it('text lines on whole pixels as Figma draws them, Shift+Enter breaks lines', () => {
    const node = normNode(text('Body', 'one  two', { 'font-size': '16px', 'line-height': '140% /* 22.4px */' }), 'root', ctx());
    expect(node.text.characters).toBe('one\n\ntwo');
    expect(node.css).toMatchObject({ 'line-height': '22px', 'white-space': 'pre-line' });
    expect(normNode(text('Small', 'a', { 'font-size': '14px', 'line-height': '140%' }), 'root', ctx()).css['line-height']).toBe('20px');
    expect(normNode(text('Token', 'a', { 'font-size': '14px', 'line-height': 'var(--lh-m)' }), 'root', ctx()).css['line-height']).toBe('var(--lh-m)');
  });

  it('a layer named by a long text gets a short key', () => {
    const long = 'Подписывая настоящую Декларацию Заявитель выражает свое согласие на предоставление сведений';
    const node = normNode({ id: 'f', type: 'FRAME', name: 'Frame', x: 0, y: 0, width: 100, height: 100, children: [text(long, long)] }, 'root', ctx());
    expect(node.children[0].key.length).toBeLessThanOrEqual('root/'.length + 60);
  });

  it('the label typed over an instance layer reaches the component as its text prop', async () => {
    const { componentJsx } = await import('./digest-page.ts');
    const inst = { id: 'i', type: 'INSTANCE', name: 'Button', x: 0, y: 0, width: 200, height: 44, instanceOf: { key: 'k', name: 'Button' }, children: [text('Text', 'Подтвердить')] };
    const node = normNode({ id: 'f', type: 'FRAME', name: 'Frame', x: 0, y: 0, width: 300, height: 100, children: [inst] }, 'root', ctx());
    const button = node.children[0];
    expect(button.instance.texts).toEqual({ Text: 'Подтвердить' });
    const compSpec = { props: [{ figma: 'Text', synthetic: true, role: 'text', react: 'children', default: 'Продолжить' }] };
    expect(componentJsx(button.instance, 'Button', compSpec, 'submit')).toBe('<Button className={styles.submit}>{"Подтвердить"}</Button>');
  });

  it('a component on a page keeps its margins and the height the design stretched it to', async () => {
    const { pageCss } = await import('./digest-page.ts');
    const tree = { key: 'root', type: 'FRAME', box: { w: 320, h: 100 }, css: { display: 'flex' }, children: [{ key: 'root/cta', type: 'INSTANCE', box: { w: 100, h: 44 }, css: { height: '44px', 'margin-top': '32px', padding: '12px', background: 'green' }, instance: { key: 'k', name: 'Button' } }] };
    const spec = { name: 'P', targets: [{ id: 'mobile', breakpoint: 'mobile', size: { width: 320, height: 100 }, frame: { width: 320 }, props: {}, tree }], instances: [{ key: 'k', name: 'Button', resolution: 'entity:component/Button' }], parts: [] };
    expect(pageCss('P', spec, { root: 'frame', 'root/cta': 'cta' }, { mobile: { max: 767 } }).get('')).toContain('.cta {\n  height: 44px;\n  margin-top: 32px;\n}');
  });

  it('the page brief shows the start of a long text, the draft keeps it whole', async () => {
    const { shortTexts } = await import('./digest-page.ts');
    const line = `<span className={styles.text}>{"${'а'.repeat(500)}"}</span>`;
    expect(shortTexts(line)).toBe(`<span className={styles.text}>{"${'а'.repeat(100)}…" +400 симв.}</span>`);
    expect(shortTexts('<b>{"Подтвердить"}</b>')).toBe('<b>{"Подтвердить"}</b>');
  });
});

describe('a screen given as a group: mockups, shared parts, kit instances', () => {
  const ctx = () => ({ prefix: '', tokens: { byVariable: new Map(), byStyle: new Map(), figmaCssNames: new Map() }, assets: new Map(), fonts: new Map(), instances: new Map(), inline: new Set(), resolutions: new Map() });

  it('a min equal to the max before it reads as "wider than"', async () => {
    const { breakpointProblems, breakpointRanges } = await import('./lib.ts');
    const bp = { mobile: { max: 600 }, tablet: { min: 600, max: 1024 }, desktop: { min: 1024 } };
    expect(breakpointRanges(bp).map((r) => [r.min, r.max])).toEqual([[0, 600], [601, 1024], [1025, Infinity]]);
    expect(breakpointProblems(bp)).toEqual([]);
  });

  it('same-named siblings: the instance keeps the plain key, as on the other breakpoints', () => {
    const bar = { id: 'g', type: 'GROUP', name: 'header', x: 0, y: 0, width: 768, height: 60, children: [] };
    const kit = { id: 'i', type: 'INSTANCE', name: 'Header', x: 0, y: 60, width: 768, height: 72, instanceOf: { key: 'h', name: 'Header' }, children: [] };
    const node = normNode({ id: 'f', type: 'FRAME', name: 'Tablet', x: 0, y: 0, width: 768, height: 1000, children: [bar, kit] }, 'root', ctx());
    expect(node.children.map((c) => [c.name, c.key])).toEqual([['header', 'root/header-2'], ['Header', 'root/header']]);
  });

  it('a negative auto-layout spacing becomes a negative margin of the next children', () => {
    const kid = (id, y) => ({ id, type: 'FRAME', name: id, x: 0, y, width: 320, height: 100, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }], children: [] });
    const node = normNode({ id: 'f', type: 'FRAME', name: 'Mobile', layoutMode: 'VERTICAL', itemSpacing: -32, x: 0, y: 0, width: 320, height: 168, css: { display: 'flex', gap: '-32px' }, children: [kid('nav', 0), kid('content', 68)] }, 'root', ctx());
    expect(node.css.gap).toBeUndefined();
    expect(node.children[1].css['margin-top']).toBe('-32px');
    expect(node.children[0].css?.['margin-top']).toBeUndefined();
  });

  it('a mockup at the top edge drops out and takes its height off the page; one elsewhere just goes', async () => {
    const { dropLayers } = await import('./normalize-page.ts');
    const box = (key, y, h, extra = {}) => ({ key, figmaId: key, box: { x: 0, y, w: 320, h }, ...extra });
    const tree = box('root', 0, 812, {
      css: { display: 'flex', height: '812px' },
      children: [
        box('root/nav', 0, 210, { css: { display: 'flex', height: '210px' }, children: [box('root/nav/status', 0, 48), box('root/nav/title', 48, 40), box('root/nav/pic', 78, 132, { css: { position: 'absolute', top: '78px' } })] }),
        box('root/content', 210, 600, { children: [box('root/content/ad', 500, 50)] }),
      ],
    });
    const dropped = new Set();
    expect(dropLayers(tree, new Set(['root/nav/status', 'root/content/ad']), 0, dropped)).toBe(48);
    expect(tree.css.height).toBe('764px');
    expect(tree.children[0].css.height).toBe('162px');
    expect(tree.children[0].children.map((c) => c.key)).toEqual(['root/nav/title', 'root/nav/pic']);
    expect(tree.children[0].children[1].css.top).toBe('30px');
    expect(tree.children[1].children).toEqual([]);
    expect([...dropped].sort()).toEqual(['root/content/ad', 'root/nav/status']);
  });

  it('a frame without auto-layout is laid out by position even if Figma guessed a flex layout in layer order', async () => {
    const { flowLayout } = await import('./normalize-page.ts');
    const tree = {
      key: 'root',
      free: true,
      box: { x: 0, y: 0, w: 1440, h: 1124 },
      css: { display: 'flex', 'flex-direction': 'column', gap: '32px', padding: '24px 120px 100px 120px', 'align-items': 'center' },
      children: [
        { key: 'root/content', box: { x: 426, y: 128, w: 589, h: 896 }, css: {}, children: [{ key: 'root/content/pic', box: { x: -16, y: 0, w: 605, h: 40 }, css: {} }] },
        { key: 'root/header', box: { x: 120, y: 24, w: 1200, h: 72 }, css: {} },
      ],
    };
    flowLayout(tree, { frameWidth: 1440 });
    expect(tree.children.map((c) => c.key)).toEqual(['root/header', 'root/content']);
    expect(tree.css.gap).toBeUndefined();
    expect(tree.css.padding).toBeUndefined();
    expect(tree.children[1].css).toMatchObject({ 'margin-top': '32px', 'align-self': 'center' });
    expect(tree.children[1].css['padding-left']).toBe('0px'); // a picture hanging out gives no negative padding
  });

  it('a kit instance on a page: state flags, its label inside a nested instance, no caption from a boolean', async () => {
    const { componentJsx } = await import('./digest-page.ts');
    const label = { id: 'l', type: 'INSTANCE', name: 'Label', x: 0, y: 0, width: 80, height: 20, instanceOf: { key: 'lab', name: 'Label' }, children: [{ id: 't', type: 'TEXT', name: 'Label', x: 0, y: 0, width: 80, height: 20, characters: 'Продолжить', fills: [] }] };
    const inst = { id: 'b', type: 'INSTANCE', name: 'BasicButton 48 M', x: 0, y: 0, width: 200, height: 48, instanceOf: { key: 'bb', name: 'BasicButton 48 M' }, variantProperties: { View: 'Accent', Disabled: 'True', Hovered: 'False' }, componentProperties: { Caption: { value: false } }, children: [label] };
    const node = normNode({ id: 'f', type: 'FRAME', name: 'F', x: 0, y: 0, width: 300, height: 100, children: [inst] }, 'root', ctx());
    const spec = {
      props: [
        { figma: 'View', role: 'prop', react: 'view', map: { Accent: 'accent' }, default: 'Default' },
        { figma: 'Disabled', role: 'state', react: null, map: { False: null, True: { flag: 'disabled' } } },
        { figma: 'Hovered', role: 'state', react: null, map: { False: null, True: { pseudo: 'hover' } } },
        { figma: 'Caption', role: 'text', react: 'caption', default: false },
        { figma: 'Label', role: 'text', react: 'children', synthetic: true, default: 'Label' },
      ],
    };
    expect(componentJsx(node.children[0].instance, 'BasicButton', spec, 'next')).toBe('<BasicButton className={styles.next} view="accent" disabled>{"Продолжить"}</BasicButton>');
  });

  it('graphic instances: one SVG per variant and property values, not per size', () => {
    const step = (id, variant, w) => ({ id, type: 'INSTANCE', name: 'Step', x: 0, y: 0, width: w, height: 36, instanceOf: { id: `main-${variant}`, key: 'step', name: 'Step' }, variantProperties: { State: variant }, children: [{ id: `${id}v`, type: 'VECTOR', name: 'v', x: 0, y: 0, width: 10, height: 10 }] });
    const c = ctx();
    const title = { id: 't', type: 'TEXT', name: 'Title', x: 0, y: 0, width: 100, height: 20, characters: 'Детали', fills: [] };
    normNode({ id: 'f', type: 'FRAME', name: 'F', x: 0, y: 0, width: 600, height: 40, children: [title, step('a', 'Done', 110), step('b', 'Done', 120), step('c', 'Current', 110)] }, 'root', c);
    expect([...c.assets.values()].map((a) => a.file)).toEqual(['assets/step.svg', 'assets/step-110x36.svg']);
  });

  it('a shared part keeps its name and is imported from src/pages/parts', async () => {
    const { partFolder } = await import('./normalize-page.ts');
    const { importLines } = await import('./digest-page.ts');
    expect(partFolder('Claim', { name: 'Header', shared: true })).toBe('Header');
    expect(partFolder('Claim', { name: 'Hero' })).toBe('ClaimHero');
    const imports = { components: new Set(), parts: new Set(['ClaimHero']), shared: new Set(['Header']), images: new Map() };
    expect(importLines(imports, 2, './assets/')).toEqual([`import { ClaimHero } from './parts/ClaimHero';`, `import { Header } from '../parts/Header';`]);
    expect(importLines({ ...imports, parts: new Set() }, 4, '../../assets/')).toEqual([`import { Header } from '../../../parts/Header';`]);
  });
});

describe('variable modes a layer switches (dark theme, typography)', () => {
  const raw = {
    collections: [
      { id: 'th', name: '01. Theme', defaultModeId: 'light', modes: [{ modeId: 'light', name: '🌕 Light' }, { modeId: 'dark', name: '🌑 Dark' }] },
      { id: 'ty', name: '03. Typography', defaultModeId: 'l', modes: [{ modeId: 'l', name: 'LargeScreen' }, { modeId: 'xs', name: 'ExtraSmallScreens' }] },
    ],
    variables: [
      { id: 'size', name: 'Header/H2/Font Size', collectionId: 'ty', resolvedType: 'FLOAT', scopes: ['FONT_SIZE'], valuesByMode: { l: 32, xs: 24 } },
      { id: 'lh', name: 'Header/H2/lineHeight', collectionId: 'ty', resolvedType: 'FLOAT', scopes: ['LINE_HEIGHT'], valuesByMode: { l: 32, xs: 24 } },
    ],
    styles: [
      { id: 'h2', name: 'Header/H2 B', type: 'TEXT', fontName: { family: 'SB Sans Display', style: 'Bold' }, fontSize: 32, lineHeight: { unit: 'PIXELS', value: 32 }, letterSpacing: { unit: 'PERCENT', value: -4 }, boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'size' }, lineHeight: { type: 'VARIABLE_ALIAS', id: 'lh' } } },
      { id: 'body', name: 'Body M', type: 'TEXT', fontName: { family: 'SB Sans Display', style: 'Regular' }, fontSize: 16, lineHeight: { unit: 'PERCENT', value: 140 } },
    ],
  };
  const tokens = async () => (await import('./normalize.ts')).buildTokens(raw, { prefix: '' });
  const ctx = async () => ({ prefix: '', tokens: await tokens(), assets: new Map(), fonts: new Map(), instances: new Map(), inline: new Set(['btn']), resolutions: new Map() });

  it('a mode is the attribute tokens.css keys it by; the default mode needs none', async () => {
    const { modeAttr } = await tokens();
    expect(modeAttr('th', 'dark')).toEqual(['data-theme', 'dark']);
    expect(modeAttr('ty', 'xs')).toEqual(['data-typography', 'extra-small-screens']);
    expect(modeAttr('th', 'light')).toBeNull();
  });

  it('a text style bound to variables follows their modes; a percent line height is whole pixels', async () => {
    const { list } = await tokens();
    const value = (name) => list.find((t) => t.name === name)?.values;
    expect(value('--font-header-h2-b-size')).toEqual({ default: '32px', 'typography=extra-small-screens': '24px' });
    expect(value('--font-header-h2-b-line-height')).toEqual({ default: '32px', 'typography=extra-small-screens': '24px' });
    expect(value('--font-body-m-line-height')).toEqual({ default: '22px' });
    // -4 % of the size: the spacing follows the size's modes, 0.32px per letter adds up over a title
    expect(value('--font-header-h2-b-letter-spacing')).toEqual({ default: '-1.28px', 'typography=extra-small-screens': '-0.96px' });
  });

  it('the brief names the tokens a layer\'s mode changes, to give back on wider screens', async () => {
    const { modeTokens } = await import('./digest-page.ts');
    const { list } = await tokens();
    const title = { key: 'root/title', modes: { 'data-typography': 'extra-small-screens' }, tokens: { 'font-size': '--font-header-h2-b-size', 'font-weight': '--font-header-h2-b-weight', 'letter-spacing': '--font-header-h2-b-letter-spacing' } };
    const lines = modeTokens({ tokens: list, targets: [{ id: 'mobile', tree: { key: 'root', children: [title] } }] });
    expect(lines).toEqual(['ⓘ mobile: root/title в data-typography="extra-small-screens" меняет --font-header-h2-b-size, --font-header-h2-b-letter-spacing; один элемент на все ширины — шире верни их: --font-header-h2-b-size: inherit; --font-header-h2-b-letter-spacing: inherit']);
  });

  it('a layer keeps its modes, also when its wrapper collapses into it', async () => {
    const c = await ctx();
    const text = { id: 't', type: 'TEXT', name: 'Title', x: 0, y: 0, width: 200, height: 24, characters: 'Опишите подробности', fills: [], explicitVariableModes: { ty: 'xs' } };
    const label = { id: 'c', type: 'FRAME', name: 'Content', x: 0, y: 0, width: 140, height: 24, layoutMode: 'HORIZONTAL', children: [{ id: 'l', type: 'TEXT', name: 'Label', x: 0, y: 0, width: 140, height: 24, characters: 'Назад', fills: [] }] };
    const back = { id: 'b', type: 'INSTANCE', name: 'Back', x: 0, y: 30, width: 140, height: 24, instanceOf: { key: 'btn', name: 'Back' }, explicitVariableModes: { th: 'dark' }, children: [label] };
    const node = normNode({ id: 'f', type: 'FRAME', name: 'F', x: 0, y: 0, width: 320, height: 100, layoutMode: 'VERTICAL', children: [text, back] }, 'root', c);
    expect(node.children[0].modes).toEqual({ 'data-typography': 'extra-small-screens' });
    expect(node.children[1].modes).toEqual({ 'data-theme': 'dark' });
  });

  it('drafts carry the attributes: on the element, on a component, a mode some widths do not set is a note', async () => {
    const { markup, markupContext, componentJsx } = await import('./digest-page.ts');
    const { markupDraft } = await import('./digest.ts');
    const frame = (id, w, modes) => ({ id, breakpoint: id, size: { width: w, height: 400 }, frame: { width: w }, props: {}, tree: { key: 'root', type: 'FRAME', box: { w, h: 400 }, children: [{ key: 'root/title', type: 'TEXT', text: { characters: 'Опишите подробности' }, ...(modes ? { modes } : {}) }] } });
    const spec = { name: 'P', targets: [frame('desktop', 1440), frame('mobile', 320, { 'data-typography': 'extra-small-screens' })], instances: [], parts: [] };
    const ctx = markupContext(spec, { root: 'frame', 'root/title': 'title' }, '');
    const lines = markup(spec.targets[1].tree.children[0], ctx);
    expect(lines.at(-1)).toBe('<span className={styles.title} data-typography="extra-small-screens">{"Опишите подробности"}</span>');
    expect(lines[0]).toMatch(/режим меняется с шириной: mobile data-typography="extra-small-screens"; desktop по умолчанию/);
    expect(ctx.notes).toHaveLength(1);
    expect(componentJsx({ variant: {} }, 'BasicButton', { props: [] }, 'back', ' data-theme="dark"')).toBe('<BasicButton className={styles.back} data-theme="dark" />');
    const comp = { props: [], targets: [{ id: 'default', props: {}, tree: { key: 'root', children: [{ key: 'root/badge', text: { characters: 'Web' }, modes: { 'data-theme': 'dark' } }, { key: 'root/wrap', modes: { 'data-theme': 'dark' }, children: [{ key: 'root/wrap/dot', children: [] }] }] } }] };
    expect(markupDraft(comp, { root: 'root', 'root/badge': 'badge', 'root/wrap/dot': 'dot' }, '')).toEqual([
      '<span className={styles.badge} data-theme="dark">{"Web"}</span>',
      `<span data-theme="dark" style={{ display: 'contents' }}>`,
      '  <span className={styles.dot}></span>',
      '</span>',
    ]);
  });
});

describe('snippets bundle', () => {
  it('probe-extract: default imports rename the imported run, one entry run remains', () => {
    const code = bundle(new URL('./snippets/probe-extract.ts', import.meta.url).pathname, { nodeId: '1:2', fileKey: 'f', receiver: 'http://127.0.0.1:4601' });
    expect(code).toContain('async function probeRun');
    expect(code).toContain('async function extractRun');
    expect(code).not.toMatch(/^import\b/m);
    expect(code.match(/^async function run\(/gm)).toHaveLength(1);
    expect(code).toContain('return await run(CU);');
  });
});

describe('breakpointsFromArg', () => {
  it('parses 1–3 upper bounds, an empty slot is no range, garbage throws', () => {
    expect(breakpointsFromArg('767')).toEqual({ mobile: { max: 767 }, tablet: null, desktop: { min: 768 }, largeDesktop: null });
    expect(breakpointsFromArg('600,1024')).toEqual({ mobile: { max: 600 }, tablet: { min: 601, max: 1024 }, desktop: { min: 1025 }, largeDesktop: null });
    expect(breakpointsFromArg('600,,1500')).toEqual({ mobile: { max: 600 }, tablet: null, desktop: { min: 601, max: 1500 }, largeDesktop: { min: 1501 } });
    expect(breakpointsFromArg('')).toBeUndefined();
    expect(breakpointsFromArg(undefined)).toBeUndefined();
    expect(() => breakpointsFromArg('abc')).toThrow();
  });
});

describe('applyStep', () => {
  const state = () => ({ version: 1, steps: [{ id: 'tokens', title: 'Токены', status: 'pending' }] }) as State;

  it('marks a step once; repeating the same status is a no-op', () => {
    const st = state();
    expect(applyStep(st, 'tokens', 'done')).toBe(true);
    expect(applyStep(st, 'tokens', 'done')).toBe(false);
    expect(st.steps[0].updatedAt).toBeTruthy();
    expect(applyStep(st, 'tokens', 'failed', 'упс')).toBe(true);
    expect(st.steps[0].lastError).toBe('упс');
    // A later done clears the error and stays idempotent.
    expect(applyStep(st, 'tokens', 'done')).toBe(true);
    expect(st.steps[0].lastError).toBeNull();
  });
});

describe('tool steps close themselves', () => {
  let root: string;
  let prev: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'craftui-auto-'));
    fs.writeFileSync(path.join(root, 'craftui.config.json'), '{}\n');
    prev = process.cwd();
    process.chdir(root);
  });
  afterAll(() => {
    process.chdir(prev);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const state = (): State => ({
    version: 1,
    kind: 'component',
    name: 'Demo',
    source: 'chrome',
    figma: { fileKey: 'KEY', nodeId: '1:2', url: 'https://www.figma.com/design/KEY/?node-id=1-2' },
    status: 'in-progress',
    steps: STEPS.component.map(([id, title]) => ({ id, title, status: 'pending' })),
    createdAt: '2026-11-08T00:00:00Z',
  });
  const entity = (specOver: Record<string, unknown> = {}, tokensCss?: string) => {
    const e = newEntity('component', 'Demo');
    fs.mkdirSync(path.join(e.craftlog, 'figma'), { recursive: true });
    saveState(e, state());
    fs.writeFileSync(e.specFile, JSON.stringify({ tokens: [], props: [], targets: [], instances: [], figma: { fileKey: 'KEY', nodeId: '1:2' }, ...specOver }));
    if (tokensCss !== undefined) fs.writeFileSync('src/tokens.css', tokensCss);
    return e;
  };

  it('build tokens closes the step; a value conflict leaves it open', async () => {
    const e = entity();
    await api.mergeTokens('Demo');
    expect(e.state.steps.find((s) => s.id === 'tokens')!.status).toBe('done');

    const e2 = entity({ tokens: [{ name: '--x', values: { Default: 'red' }, defaultMode: 'Default' }] }, ':root {\n  --x: blue;\n}\n');
    const out = await api.mergeTokens('Demo');
    expect(out).toContain('не закрыт');
    expect(e2.state.steps.find((s) => s.id === 'tokens')!.status).toBe('pending');
  });

  it('spec deps closes when everything resolves; unresolved instances keep it open', async () => {
    const e = entity({ instances: [{ key: '1:9', name: 'Icon', nodeIds: ['1:9'], resolution: 'inline' }] });
    await api.entityDeps({ entity: 'Demo' });
    expect(e.state.steps.find((s) => s.id === 'deps')!.status).toBe('done');

    const e2 = entity({ instances: [{ key: '1:9', name: 'Icon', nodeIds: ['1:9'], resolution: null }] });
    const out = await api.entityDeps({ entity: 'Demo' });
    expect(out).toContain('НЕ импортирован');
    expect(e2.state.steps.find((s) => s.id === 'deps')!.status).toBe('pending');
    process.exitCode = undefined; // deps.run signals unresolved via exit code; the server resets it per call
  });

  it('normalize without raw data fails loudly and the step stays open', async () => {
    const e = entity();
    let error: unknown;
    try {
      await api.normalize({ entity: 'Demo' });
    } catch (err) {
      error = err;
    }
    expect(String(error)).toContain('сырых данных');
    expect(e.state.steps.find((s) => s.id === 'normalize')!.status).toBe('pending');
  });

  it('manual step done on a done step is a no-op, not a reopen', async () => {
    const e = entity();
    await api.mergeTokens('Demo');
    const out = await api.step({ entity: 'Demo', action: 'done', step: 'tokens' });
    expect(out).toContain('уже done');
    expect(e.state.steps.find((s) => s.id === 'tokens')!.status).toBe('done');
  });
});

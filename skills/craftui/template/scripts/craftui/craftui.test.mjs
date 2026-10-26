import { describe, expect, it } from '@rstest/core';
import { boolContent, mergeDefinitions, normNode } from './normalize.mjs';
import { markSlotContent, suggestSlots } from './slots.mjs';
import { toTsx } from './svg.mjs';
import { sameColor } from './tokens.mjs';
import { scanCss, scanTsx } from './units.mjs';

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

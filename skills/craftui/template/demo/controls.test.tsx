import { describe, expect, it } from '@rstest/core';
import { controlsFor, defaultsOf, toJsx } from './controls';
import type { PropDoc } from './registry';

const prop = (p: Partial<PropDoc> & { name: string; kind: string }): PropDoc => ({ type: p.kind, required: false, ...p });

function Icon() {
  return <svg />;
}

const props = [
  prop({ name: 'view', kind: 'enum', options: ['default', 'accent'], defaultValue: 'default' }),
  prop({ name: 'loading', kind: 'boolean' }),
  prop({ name: 'contentLeft', kind: 'ReactNode' }),
  prop({ name: 'children', kind: 'ReactNode' }),
  prop({ name: 'onClick', kind: '(event: MouseEvent) => void' }),
];

describe('defaultsOf', () => {
  const targets = [{ id: 'accent', props: { view: 'accent' } }, { id: 'default', props: { view: 'default' } }];
  it('prefers demo.defaults, then the "default" target, then the first target', () => {
    expect(defaultsOf({ targets, defaults: { view: 'x' } })).toEqual({ view: 'x' });
    expect(defaultsOf({ targets })).toEqual({ view: 'default' });
    expect(defaultsOf({ targets: [targets[0]] })).toEqual({ view: 'accent' });
  });
});

describe('controlsFor', () => {
  it('maps prop kinds to controls and skips functions', () => {
    const controls = controlsFor(props, { targets: [], slots: { contentLeft: { Icon: <Icon /> } } });
    expect(controls.map((c) => `${c.name}:${c.kind}`)).toEqual(['view:select', 'loading:boolean', 'contentLeft:slot', 'children:text']);
    const slot = controls.find((c) => c.kind === 'slot');
    expect(slot && 'presets' in slot && Object.keys(slot.presets)).toEqual(['Icon']);
  });

  it('children with presets (an icon button) is a slot, not a text field', () => {
    const controls = controlsFor(props, { targets: [], slots: { children: { Icon: <Icon /> } } });
    expect(controls.find((c) => c.name === 'children')?.kind).toBe('slot');
  });
});

describe('toJsx', () => {
  it('omits defaults and false, writes true as a bare attribute', () => {
    expect(toJsx('Button', { view: 'default', loading: false, children: 'Go' }, props)).toBe('<Button>Go</Button>');
    expect(toJsx('Button', { view: 'accent', loading: true, children: 'Go' }, props)).toBe('<Button view="accent" loading>Go</Button>');
  });

  it('writes elements by component name and self-closes without children', () => {
    expect(toJsx('Button', { contentLeft: <Icon /> }, props)).toBe('<Button contentLeft={<Icon />} />');
    expect(toJsx('Button', { children: <Icon /> }, props)).toBe('<Button><Icon /></Button>');
  });

  it('breaks long tags into lines', () => {
    const code = toJsx('Button', { view: 'accent', loading: true, contentLeft: <Icon />, children: 'A rather long label text here' }, props);
    expect(code.split('\n')).toEqual(['<Button', '  view="accent"', '  loading', '  contentLeft={<Icon />}', '>', '  A rather long label text here', '</Button>']);
  });
});

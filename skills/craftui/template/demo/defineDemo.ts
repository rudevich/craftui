import type { ComponentType, ReactNode } from 'react';

export type Pseudo = 'hover' | 'active' | 'focus' | 'focus-visible';

/** One snapshot of an entity: a Figma variant for components (a breakpoint for pages later). */
export type DemoTarget<P> = {
  /** Same id as the Figma reference file craftlog/figma/screenshots/<id>.png */
  id: string;
  title?: string;
  props: P;
  /** Forced pseudo-classes, e.g. ['hover'] for a Figma "State=Hover" variant. */
  pseudo?: Pseudo[];
  /** Real focus on an element inside the target, for Figma "Focused" of an inner part (an input): a CSS selector. */
  focus?: string;
  /** Fixed wrapper size in CSS px, for components that fill their container. */
  frame?: { width?: number; height?: number };
  figmaNodeId?: string;
};

export type Demo<P> = {
  component: ComponentType<P>;
  figma?: { url: string; nodeId?: string };
  /** Page background behind targets, e.g. for light components. */
  background?: string;
  targets: DemoTarget<P>[];
  /** Base props for the showcase and the playground. Default: props of target "default", else of the first target. */
  defaults?: Partial<P>;
  /** Choices for ReactNode props in the showcase and the playground, e.g. { contentLeft: { Иконка: <Icon /> } }. */
  slots?: { [K in keyof P]?: Record<string, ReactNode> };
};

export function defineDemo<P>(demo: Demo<P>): Demo<P> {
  return demo;
}

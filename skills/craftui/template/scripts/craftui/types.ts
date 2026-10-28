// Shapes of the data the craftui scripts write and read. Read this file instead of the code that builds them:
// craftlog/figma/spec.json (Spec), craftlog/state.json (State), craftui.config.json (Config), raw/plugin.json (Raw).

export type Kind = 'component' | 'page';
export type Css = Record<string, string>;

// ── craftui.config.json ──────────────────────────────────────────────────────

export type Range = { min?: number; max?: number };
export type BreakpointName = 'mobile' | 'tablet' | 'desktop' | 'largeDesktop';
export type Breakpoints = Partial<Record<BreakpointName, Range | null>>;
/** A breakpoint with both bounds inclusive; max is Infinity for the last one. */
export type ResolvedRange = { name: BreakpointName; min: number; max: number };

export type Config = {
  source: 'chrome' | 'figma' | string;
  defaultKind: Kind;
  dirs: Record<Kind, string>;
  context: 'small' | 'large';
  verifyIterations: number;
  demoFonts: string[];
  scale: number;
  maxDiffRatio: number;
  tokenPrefix: string;
  pages: { breakpoints: Breakpoints | null; scale: number; maxDiffRatio: number; export: boolean };
  port: number;
  receiverPort: number;
  /** Restarts the agent after API failures: the agent to run and its command line per agent ({prompt} is replaced). */
  autopilot?: { agent?: string; commands?: Record<string, string> };
};

// ── entities and craftlog/state.json ─────────────────────────────────────────

export type StepStatus = 'pending' | 'in-progress' | 'done' | 'failed' | 'skipped';
export type Step = { id: string; title: string; status: StepStatus; attempts?: number; lastError?: string | null; updatedAt?: string };
export type ImportVersion = { version: number; at: string; reason: string };

export type State = {
  version: number;
  kind: Kind;
  name: string;
  source: string;
  figma: FigmaRef;
  status: 'in-progress' | 'blocked' | 'failed' | 'done';
  awaitingUser?: string | null;
  blockedBy?: string[];
  usedBy?: string[];
  steps: Step[];
  createdAt: string;
  updatedAt?: string;
  imports?: ImportVersion[];
  pendingReason?: string | null;
};

/** A component or a page: its folder, craftlog and files; `state` reads state.json each time. */
export type Entity = {
  kind: Kind;
  name: string;
  dir: string;
  craftlog: string;
  stateFile: string;
  logFile: string;
  specFile: string;
  readonly state: State;
};

export type FigmaRef = { fileKey: string; nodeId: string | null; url: string };

/** craftlog/figma/source.json: where the entity comes from (one component set, or the frames of a page). */
export type Source = { nodeId: string; url?: string; fileKey?: string; variant?: Record<string, string>; filter?: VariantFilter };
/** Variants to keep: each object a partial variant ({ View: 'Accent' }); a variant matches any of them. */
export type VariantFilter = Record<string, string>[];
/** A CLI flag: its value, true when given without one, undefined when absent. */
export type Flag = (name: string) => string | true | undefined;
export type SourceFile = { kind: Kind; name: string; source: string; fileKey: string; nodeId: string; url: string; sources?: Source[]; createdAt?: string };

// ── craftlog/figma/spec.json ─────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };

/** One layer of a target after normalize; `key` is its path of slugged names, the same across targets. */
export type SpecNode = {
  key: string;
  name: string;
  type: string;
  figmaId: string;
  box?: Box;
  css?: Css;
  /** Values style-check compares with the rendered element. */
  expect?: Css;
  /** CSS property → token (var name) the value comes from. */
  tokens?: Css;
  text?: { characters: string; segments?: number };
  /** Figma component property references (visible, characters…). */
  propRefs?: Record<string, string>;
  instance?: InstanceRef;
  /** SVG of a graphic layer (logo, icon), assets/<file>.svg. */
  asset?: string;
  /** PNG of a picture fill, assets/<file>.png (pages). */
  picture?: string;
  image?: boolean;
  /** The prop whose content this layer is (slot). */
  slot?: string;
  /** Off in this target: the BOOLEAN prop that shows it. */
  hidden?: string | boolean;
  absolute?: boolean;
  /** Laid out by x/y in Figma (no auto-layout). */
  free?: boolean;
  unloaded?: boolean;
  wrappers?: string[];
  via?: string;
  /** data-* attributes of the variable modes this layer switches: { 'data-theme': 'dark' }. */
  modes?: Record<string, string>;
  children?: SpecNode[];
};

/** A component instance in a layer: which component, its variant, property values and the texts typed over it. */
export type InstanceRef = {
  key: string;
  name: string;
  variant?: Record<string, string>;
  props?: Record<string, string | boolean>;
  texts?: Record<string, string>;
};

/** A nested component and what to do with it (deps): another entity, inline, a picture, slot content. */
export type Instance = {
  key: string;
  name: string;
  componentKey?: string;
  setKey?: string | null;
  mainId?: string;
  remote?: boolean;
  nodeIds: string[];
  resolution: Resolution | null;
  graphic?: boolean;
  as?: string;
};
export type Resolution = 'inline' | 'content' | 'graphic' | `entity:${string}`;

/** A state value of a variant property: a flag (disabled, loading) or a pseudo-class (hover, active). */
export type StateRole = { flag: string; pseudo?: undefined } | { pseudo: string; flag?: undefined } | { unknown: true; flag?: undefined; pseudo?: undefined };
export type PropRole = 'prop' | 'state' | 'slot' | 'text' | 'bool';

export type Prop = {
  figma: string;
  key?: string | null;
  keys?: string[];
  type?: 'VARIANT' | 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP' | string;
  role: PropRole;
  /** React prop name; null — not a prop (a state, an unused axis). */
  react: string | null;
  reactType?: string;
  options?: string[];
  /** Figma value → React value (or a state role, or a slot marker). */
  map?: Record<string, string | boolean | null | StateRole>;
  default?: string | boolean | null;
  nodeKey?: string;
  nodeKeys?: string[];
  content?: string[];
  synthetic?: boolean;
  fromBool?: boolean;
  manual?: boolean;
  preferredValues?: unknown;
};

export type Target = {
  id: string;
  title: string;
  figmaNodeId: string;
  source?: number;
  variant?: Record<string, string> | null;
  /** Page: the breakpoint the frame width falls into. */
  breakpoint?: BreakpointName | null;
  size: { width: number; height: number };
  frame?: { width?: number; height?: number };
  props: Record<string, unknown>;
  pseudo?: string[];
  /** Slot prop → the layer that is its content in this target. */
  slots?: Record<string, SlotContent>;
  /** Page: height of the device chrome cut off the top of the frame (craftui mockup). */
  mockTop?: number;
  /** Page: the frame was laid out by x/y and turned into a column. */
  flow?: boolean;
  tree: SpecNode;
};

/** One CSS custom property: its value per mode ("default", "theme=dark", "typography=extra-small-screens"). */
export type SlotContent = { key: string; name: string; kind: 'graphic' | 'text' | 'mixed'; size?: { width: number; height: number }; asset?: string };
/** An icon in every variant that looks like what the consumer passes in (normalize suggests it as a slot). */
export type SuggestedSlot = { keys: string[]; name: string; size?: { width: number; height: number } };

export type Token = {
  name: string;
  figma?: string;
  collection?: string;
  type: string;
  defaultMode: string;
  values: Record<string, string>;
  source: 'variable' | 'style';
};

export type Asset = { key: string; name: string; nodeId: string; file: string; format?: 'svg' | 'png' };
export type Part = { key: string; name: string; shared?: boolean };

export type Spec = {
  version: number;
  kind: Kind;
  name: string;
  source: string;
  figma: { fileKey: string; nodeId: string; nodeType?: string; nodeName?: string; key?: string | null; keys?: string[]; description?: string };
  props: Prop[];
  targets: Target[];
  tokens: Token[];
  instances: Instance[];
  twins?: Record<string, string>;
  assets: Asset[];
  fonts: { family: string; styles: string[] }[];
  suggestedSlots?: SuggestedSlot[];
  truncated?: boolean;
  // pages
  parts?: Part[];
  suggestedParts?: Part[];
  skip?: string[];
  warnings?: string[];
};

/** craftlog/figma/node-map.json: layer key → CSS-module class ("Part/class" for a page part, null — no element). */
export type NodeMap = Record<string, string | null>;

/** src/pages/parts/<Name>/part.json: the page and layer a shared part was made from. */
export type SharedPart = { name: string; page: string; key: string; layer: string; instance: string | null };

// ── craftlog/figma/raw/plugin.json (snippets, Plugin API) ────────────────────

export type Alias = { type: 'VARIABLE_ALIAS'; id: string };
export type Rgba = { r: number; g: number; b: number; a?: number };
export type Paint = { type: string; visible?: boolean; color?: Rgba; opacity?: number; boundVariables?: Record<string, Alias>; gradientStops?: unknown[]; [k: string]: unknown };

/** A layer as the snippets serialize it: Plugin API properties plus getCSSAsync. Only the fields the scripts read are named. */
export type RawNode = {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  css?: Css;
  children?: RawNode[];
  characters?: string;
  fontName?: { family: string; style: string };
  fontSize?: number;
  fills?: Paint[];
  strokes?: Paint[];
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  itemSpacing?: number;
  instanceOf?: { id: string; key: string; name: string; remote?: boolean; set?: { id: string; key: string; name: string } | null };
  variantProperties?: Record<string, string> | null;
  componentProperties?: Record<string, { value: string | boolean; type?: string }>;
  componentPropertyReferences?: Record<string, string>;
  boundVariables?: Record<string, Alias | Alias[]>;
  explicitVariableModes?: Record<string, string>;
  [prop: string]: unknown;
};

export type RawVariable = {
  id: string;
  key?: string;
  name: string;
  collectionId: string;
  /** COLOR, FLOAT, STRING, BOOLEAN; newer Figma has more (EASING), they are not tokens. */
  resolvedType: string;
  scopes?: string[];
  codeSyntax?: { WEB?: string };
  remote?: boolean;
  valuesByMode: Record<string, unknown>;
};
export type RawCollection = { id: string; name: string; defaultModeId: string; modes: { modeId: string; name: string }[] };
export type RawStyle = {
  id: string;
  key?: string;
  name: string;
  type: 'PAINT' | 'EFFECT' | 'TEXT' | 'GRID';
  remote?: boolean;
  paints?: Paint[];
  effects?: { type: string; visible?: boolean; color?: Rgba; offset?: { x: number; y: number }; radius?: number; spread?: number }[];
  fontName?: { family: string; style: string };
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: { unit: 'PIXELS' | 'PERCENT' | 'AUTO'; value?: number };
  letterSpacing?: { unit: 'PIXELS' | 'PERCENT'; value: number };
  textCase?: string;
  textDecoration?: string;
  boundVariables?: Record<string, Alias>;
};

export type RawVariant = { id: string; name: string; source?: number; width: number; height: number; variantProperties?: Record<string, string> | null; tree: RawNode; normTree?: SpecNode };
export type RawSource = { id: string; name: string; type: string; key?: string; width?: number; height?: number; description?: string; [prop: string]: unknown };

export type Raw = {
  meta: { source: string; kind?: Kind; fileKey: string; nodeId: string; editorType?: string; extractedAt?: string; truncated?: boolean };
  root: RawSource;
  sources?: RawSource[];
  variants: RawVariant[];
  variables: RawVariable[];
  collections: RawCollection[];
  styles: RawStyle[];
  instances: { key: string; componentKey?: string; setKey?: string | null; name: string; mainId?: string; remote?: boolean; nodeIds: string[] }[];
  images?: { id: string; name: string; width: number; height: number }[];
};

/** What the snippets get from snippets.ts as CU (the __CU__ placeholder). */
export type SnippetParams = {
  kind?: Kind;
  name?: string;
  nodeId: string | null;
  fileKey: string;
  craftlog?: string;
  receiver: string;
  scale?: number;
  breakpoints?: Breakpoints | null;
  maxNodes?: number;
  sources?: Source[];
  targets?: { id: string; nodeId: string }[];
  assets?: { nodeId: string; file: string; format?: string }[];
};

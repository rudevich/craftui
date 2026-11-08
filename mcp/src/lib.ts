// Shared helpers for the craftui CLI: entities, state.json, craftui.log.md.
import fs from 'node:fs';
import path from 'node:path';
import type { BreakpointName, Breakpoints, Config, Entity, Kind, ResolvedRange, State, Step } from './types.ts';

export const KINDS: Kind[] = ['component', 'page'];
export const KIND_ALIASES: Record<string, Kind> = { component: 'component', components: 'component', page: 'page', pages: 'page' };
export const isKind = (k: unknown): k is Kind => KINDS.includes(k as Kind);

/** JSON file → T (the caller names the shape), or the fallback when there is no file. */
export function readJson<T = any>(file: string): T | undefined;
export function readJson<T = any>(file: string, fallback: T): T;
export function readJson<T>(file: string, fallback?: T): T | undefined {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : fallback;
}
export const writeJson = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

// ── project settings (craftui.config.json) ───────────────────────────────────

const DEFAULTS: Config = {
  source: 'chrome',
  defaultKind: 'component',
  // One level under src/: generated code imports src/lib through ../../
  dirs: { component: 'src/components', page: 'src/pages' },
  // small: outputs for a ~64k window (brief, spec); large: more detail per printout
  context: 'small',
  verifyIterations: 5,
  demoFonts: [],
  scale: 2,
  maxDiffRatio: 0.01,
  tokenPrefix: '',
  maxExtractVariants: 80,
  pages: { breakpoints: null, scale: 1, maxDiffRatio: 0.02, export: true },
  port: 4600,
  receiverPort: 4601,
};

/** Settings with defaults; the nested blocks merge key by key, so a project may set only what it changes. */
export const withDefaults = (raw: Partial<Config> = {}): Config => ({ ...DEFAULTS, ...raw, dirs: { ...DEFAULTS.dirs, ...raw.dirs }, pages: { ...DEFAULTS.pages, ...raw.pages } });
export const config = (): Config => withDefaults(readJson<Partial<Config>>('craftui.config.json', {}));

/** What is wrong in the settings, one line each (`craftui status` shows them). */
export function configProblems(cfg: Config): string[] {
  const out: string[] = [];
  for (const [kind, dir] of Object.entries(cfg.dirs)) {
    if (!isKind(kind)) out.push(`dirs.${kind}: такого вида нет (есть ${KINDS.join(', ')})`);
    else if (!/^src\/[a-z][a-z0-9-]*$/.test(dir)) out.push(`dirs.${kind}: "${dir}" — нужна папка вида src/<имя> на один уровень`);
  }
  if (new Set(Object.values(cfg.dirs)).size !== Object.keys(cfg.dirs).length) out.push('dirs: у видов должны быть разные папки');
  if (!isKind(cfg.defaultKind)) out.push(`defaultKind: "${cfg.defaultKind}" — ${KINDS.join(' или ')}`);
  if (!['small', 'large'].includes(cfg.context)) out.push(`context: "${cfg.context}" — small или large`);
  if (cfg.pages.breakpoints) out.push(...breakpointProblems(cfg.pages.breakpoints));
  return out;
}

/** Kind → folder, from the settings. */
export function kindDirs(): Record<Kind, string> {
  const cfg = config();
  const bad = configProblems(cfg).filter((p) => p.startsWith('dirs'));
  if (bad.length) fail(`craftui.config.json: ${bad.join('; ')}`);
  return cfg.dirs;
}

/** Output limit of one printout (brief, spec): about 4k tokens for a small window. */
export const printLimit = () => (config().context === 'large' ? 40000 : 12000);

// ── page breakpoints (pages.breakpoints) ──────────────────────────────────────

export const BREAKPOINTS: BreakpointName[] = ['mobile', 'tablet', 'desktop', 'largeDesktop'];

/**
 * Enabled ranges in order, both bounds inclusive: [{ name, min, max }], max is Infinity for the last one.
 * A min equal to the max before it reads as "wider than" (tablet 600 after mobile ≤ 600 starts at 601), as people write it by hand.
 */
export const breakpointRanges = (bp: Breakpoints | null | undefined): ResolvedRange[] =>
  BREAKPOINTS.filter((n) => bp?.[n]).reduce<ResolvedRange[]>((out, n) => {
    const before = out.at(-1);
    const range = bp![n]!;
    const min = range.min ?? 0;
    return [...out, { name: n, min: before && min === before.max ? min + 1 : min, max: range.max ?? Infinity }];
  }, []);

/** Ranges as the snippets take them (JSON has no Infinity). */
export const breakpointsForSnippet = (bp: Breakpoints | null | undefined): Breakpoints | null | undefined => bp && Object.fromEntries(breakpointRanges(bp).map((r) => [r.name, { min: r.min, ...(r.max === Infinity ? {} : { max: r.max }) }]));

export function breakpointProblems(bp: Breakpoints): string[] {
  const ranges = breakpointRanges(bp);
  if (!ranges.length) return ['pages.breakpoints: нет ни одного диапазона'];
  const out: string[] = [];
  ranges.forEach((r, i) => {
    if (r.min > r.max) out.push(`pages.breakpoints.${r.name}: min больше max`);
    if (i > 0 && r.min !== ranges[i - 1].max + 1) out.push(`pages.breakpoints.${r.name}: должен начинаться с ${ranges[i - 1].max + 1} (сразу после ${ranges[i - 1].name})`);
    if (i < ranges.length - 1 && r.max === Infinity) out.push(`pages.breakpoints.${r.name}: без max может быть только последний диапазон`);
  });
  if (ranges[0].min !== 0) out.push(`pages.breakpoints.${ranges[0].name}: первый диапазон начинается с 0 (без min)`);
  const last = ranges[ranges.length - 1];
  if (last.max !== Infinity) out.push(`pages.breakpoints.${last.name}: у последнего диапазона нет max`);
  return out;
}

/**
 * Ranges from the user's answers: the upper bound of each one, inclusive. Empty tablet: no tablet;
 * empty desktop: desktop has no upper bound and there is no large desktop.
 */
type Bound = string | number | null | undefined;
export function breakpointsFrom({ mobile, tablet, desktop }: { mobile?: Bound; tablet?: Bound; desktop?: Bound }): Breakpoints {
  const num = (v: Bound) => (v === undefined || v === null || String(v).trim() === '' ? null : Number(v));
  const [m, t, d] = [num(mobile), num(tablet), num(desktop)];
  if (m === null || !Number.isInteger(m) || m <= 0) throw new Error('mobile — граница в px, например 767');
  for (const [name, v] of [['tablet', t], ['desktop', d]] as const) if (v !== null && !Number.isInteger(v)) throw new Error(`${name} — целое число px или пусто`);
  if (t !== null && t <= m) throw new Error('tablet должен быть больше mobile');
  if (d !== null && d <= (t ?? m)) throw new Error('desktop должен быть больше tablet и mobile');
  const top = t ?? m;
  return {
    mobile: { max: m },
    tablet: t !== null ? { min: m + 1, max: t } : null,
    desktop: d !== null ? { min: top + 1, max: d } : { min: top + 1 },
    largeDesktop: d !== null ? { min: d + 1 } : null,
  };
}

/** The range a frame of this width belongs to, or undefined. */
export const breakpointOf = (width: number, bp: Breakpoints | null | undefined): BreakpointName | undefined => breakpointRanges(bp).find((r) => width >= r.min && width <= r.max)?.name;

/** Breakpoints from a create argument: "767" / "767,1279" / "767,,1500" — the upper bounds, an empty slot = no range. */
export function breakpointsFromArg(value: string | undefined): Breakpoints | undefined {
  if (!value || !value.trim()) return undefined;
  const [m, t, d] = value.split(',').map((s) => s.trim());
  return breakpointsFrom({ mobile: m, tablet: t, desktop: d });
}

export const describeBreakpoints = (bp: Breakpoints | null | undefined) =>
  breakpointRanges(bp)
    .map((r) => `${r.name} ${r.min === 0 ? `≤ ${r.max}` : r.max === Infinity ? `≥ ${r.min}` : `${r.min}–${r.max}`}px`)
    .join(' · ');
export const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

/**
 * Where the Figma data comes from: chrome (Chrome MCP: Claude in Chrome, chrome-devtools-mcp) or figma (Figma MCP).
 * The first value given wins, chrome by default; "mcp" is the old name of figma. Unknown → undefined.
 */
export function resolveSource(...values: unknown[]): 'chrome' | 'figma' | undefined {
  const value = (values.find((v) => typeof v === 'string' && v.trim()) as string | undefined) ?? 'chrome';
  const source = value.trim().toLowerCase() === 'mcp' ? 'figma' : value.trim().toLowerCase();
  return source === 'chrome' || source === 'figma' ? source : undefined;
}

/** Stops the operation with a message; the server layer turns it into an error result for the agent. */
export function fail(message: string): never {
  throw new Error(message);
}

export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null; url: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const i = parts.findIndex((p) => ['design', 'file', 'proto', 'board', 'make'].includes(p));
  if (i === -1 || !parts[i + 1]) return null;
  let fileKey = parts[i + 1];
  // Branch links: /design/<fileKey>/branch/<branchKey>/<name> — the API works with the branch key.
  if (parts[i + 2] === 'branch' && parts[i + 3]) fileKey = parts[i + 3];
  const rawNode = u.searchParams.get('node-id');
  const nodeId = rawNode ? decodeURIComponent(rawNode).replace(/-/g, ':') : null;
  return { fileKey, nodeId, url };
}

export const slug = (s: unknown): string =>
  translit(String(s))
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** TS/JS literal with single quotes and bare keys: { tone: 'neutral', children: 'Badge' }. */
export function tsLiteral(v: unknown): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (Array.isArray(v)) return `[${v.map(tsLiteral).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : tsLiteral(k)}: ${tsLiteral(x)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

export const camel = (s: unknown): string => slug(s).replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const pascal = (s: unknown): string => camel(s).replace(/^./, (c) => c.toUpperCase());

const RU = 'а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:h ц:ts ч:ch ш:sh щ:sch ъ: ы:y ь: э:e ю:yu я:ya';
const RU_MAP: Record<string, string> = Object.fromEntries(RU.split(' ').map((p) => p.split(':')));
function translit(s: string): string {
  return s.replace(/[а-яё]/gi, (ch) => {
    const lower = ch.toLowerCase();
    const t = RU_MAP[lower] ?? '';
    return ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1);
  });
}

const SAVE_PATH = /^src\/[a-z][a-z0-9-]*\/[A-Za-z0-9]+\/craftlog\/[\w./-]+$/;

/** Normalized relative path if it points inside some src/<kind>/<Name>/craftlog/, else null. */
export function safeCraftlogPath(p: unknown): string | null {
  const rel = path.posix.normalize(String(p ?? '').replace(/\\/g, '/'));
  if (rel.startsWith('/') || rel.split('/').includes('..') || !SAVE_PATH.test(rel)) return null;
  return rel;
}

// ── entities ──────────────────────────────────────────────────────────────────

export function entityDir(kind: Kind, name: string): string {
  const dir = kindDirs()[kind];
  if (!dir) fail(`unknown kind "${kind}" (known: ${KINDS.join(', ')})`);
  return path.join(dir, name);
}

export function listEntities(): Entity[] {
  const out: Entity[] = [];
  for (const [kind, dir] of Object.entries(kindDirs()) as [Kind, string][]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const stateFile = path.join(dir, name, 'craftlog', 'state.json');
      if (fs.existsSync(stateFile)) out.push(entity(kind, name));
    }
  }
  return out;
}

function entity(kind: Kind, name: string): Entity {
  const dir = entityDir(kind, name);
  const craftlog = path.join(dir, 'craftlog');
  return {
    kind,
    name,
    dir,
    craftlog,
    stateFile: path.join(craftlog, 'state.json'),
    logFile: path.join(craftlog, 'craftui.log.md'),
    specFile: path.join(craftlog, 'figma', 'spec.json'),
    get state(): State {
      return readJson<State>(this.stateFile)!;
    },
  };
}

/** Finds an entity by "Name" or "kind/Name". */
export function findEntity(ref: string | undefined): Entity {
  if (!ref) fail('entity name is required');
  const [a, b] = ref.split('/');
  const kind = b ? (KIND_ALIASES[a] ?? a) : null;
  const name = b ?? a;
  const found = listEntities().filter((e) => e.name === name && (!kind || e.kind === kind));
  if (!found.length) fail(`entity "${ref}" not found — create it with: craftui create {"kind":"component","name":"${name}","url":"<ссылка Figma>"}`);
  if (found.length > 1) fail(`"${name}" is ambiguous, use kind/Name: ${found.map((e) => `${e.kind}/${e.name}`).join(', ')}`);
  return found[0];
}

export function newEntity(kind: Kind, name: string): Entity {
  return entity(kind, name);
}

// ── state ─────────────────────────────────────────────────────────────────────

export function saveState(e: Entity, state: State) {
  state.updatedAt = new Date().toISOString();
  const steps = state.steps;
  if (steps.every((s) => s.status === 'done' || s.status === 'skipped')) state.status = 'done';
  else if (steps.some((s) => s.status === 'failed')) state.status = 'failed';
  else if (openBlockers(state).length) state.status = 'blocked'; // nested entities not done yet
  else state.status = 'in-progress';
  writeJson(e.stateFile, state);
  renderLogSections(e, state);
}

export function getStep(state: State, id: string): Step {
  const step = state.steps.find((s) => s.id === id);
  if (!step) return fail(`unknown step "${id}" (steps: ${state.steps.map((s) => s.id).join(', ')})`);
  return step;
}

/** Entities this one waits for that are not done yet. */
export function openBlockers(state: State): string[] {
  const done = new Set(listEntities().filter((x) => x.state.status === 'done').map((x) => x.name));
  return (state.blockedBy ?? []).filter((n) => !done.has(n));
}

// ── log ───────────────────────────────────────────────────────────────────────

const ICON: Record<string, string> = { pending: '⏳', 'in-progress': '🔄', done: '✅', failed: '❌', skipped: '➖' };

export function appendHistory(e: Entity, line: string) {
  fs.appendFileSync(e.logFile, `- ${now()} — ${line}\n`);
}

export function replaceSection(file: string, marker: string, body: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const start = `<!-- craftui:${marker} -->`;
  const end = `<!-- /craftui:${marker} -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1) return;
  fs.writeFileSync(file, `${text.slice(0, i + start.length)}\n${body}\n${text.slice(j)}`);
}

export function renderLogSections(e: Entity, state: State) {
  const steps = state.steps
    .map((s) => {
      const extra = [(s.attempts ?? 0) > 1 ? `попыток: ${s.attempts}` : '', s.lastError ? `ошибка: ${s.lastError}` : '']
        .filter(Boolean)
        .join(', ');
      return `- ${ICON[s.status] ?? '?'} \`${s.id}\` ${s.title}${extra ? ` (${extra})` : ''}`;
    })
    .join('\n');
  const head = [`Статус: **${state.status}**`];
  const waiting = openBlockers(state);
  if (waiting.length) head.push(`ждёт: ${waiting.join(', ')}`);
  if (state.awaitingUser) head.push(`ждёт ответа пользователя: ${state.awaitingUser}`);
  replaceSection(e.logFile, 'steps', `${head.join(' · ')}\n\n${steps}`);
}

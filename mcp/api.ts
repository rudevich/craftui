// The command core of the craftui MCP server: typed operations over the project in cwd.
// The texts are the ones the CLI printed; console.log inside the modules is captured and returned as the tool result.
import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import * as deps from './src/deps.ts';
import * as digest from './src/digest.ts';
import * as hooks from './src/hooks.ts';
import * as normalizeModule from './src/normalize.ts';
import * as normalizePage from './src/normalize-page.ts';
import * as readme from './src/readme.ts';
import * as receiver from './src/receiver.ts';
import * as rest from './src/rest.ts';
import * as scaffold from './src/scaffold.ts';
import * as snippets from './src/snippets.ts';
import * as slots from './src/slots.ts';
import * as sourcesModule from './src/sources.ts';
import * as svg from './src/svg.ts';
import * as tokensModule from './src/tokens.ts';
import * as units from './src/units.ts';
import * as verify from './src/verify.ts';
import {
  applyStep, appendHistory, breakpointsFrom, breakpointsFromArg, config, configProblems, describeBreakpoints, fail, findEntity, getStep, isKind, KIND_ALIASES, KINDS, listEntities, newEntity,
  now, openBlockers, parseFigmaUrl, readJson, replaceSection, resolveSource, saveState, slug, writeJson,
} from './src/lib.ts';
import { importsOf, writeReadme } from './src/readme.ts';
import { readFilter, sourceEntry } from './src/sources.ts';
import { AUTO_CHROME_ONLY, AUTO_STEPS, instructions, STEPS } from './src/steps.ts';
import type { Breakpoints, Config, Entity, FigmaRef, Kind, Prop, Spec, State, StepStatus } from './src/types.ts';

/** Runs fn with console.log redirected to a buffer; the buffer is the tool result the agent reads. */
async function capture(fn: () => unknown): Promise<string> {
  const log = console.log;
  const buf: string[] = [];
  console.log = (...parts: unknown[]) => void buf.push(format(...parts));
  try {
    await fn();
    return buf.join('\n');
  } finally {
    console.log = log;
  }
}

// ── flow: status, next, step transitions ─────────────────────────────────────

export const status = () => capture(() => {
  const problems = configProblems(config());
  if (problems.length) console.log(`⚠ craftui.config.json:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  const entities = listEntities();
  if (!entities.length) return console.log('Пока нет сущностей. Новый импорт: craftui create {"kind":"component","name":"<Name>","url":"<ссылка Figma>"}');
  for (const e of entities) {
    const s = e.state;
    const current = s.steps.find((x) => x.status !== 'done' && x.status !== 'skipped');
    const blockers = openBlockers(s);
    // The saved status may predate a nested entity finishing: blocked is only what is still open.
    const state = s.status === 'blocked' && !blockers.length ? 'in-progress' : s.status;
    const parts = [`${e.kind}/${e.name}: ${state}`];
    if (current) parts.push(`шаг ${current.id} (${current.status})`);
    if (blockers.length) parts.push(`ждёт ${blockers.join(', ')}`);
    if (s.awaitingUser) parts.push(`ждёт ответа: ${s.awaitingUser}`);
    console.log(`- ${parts.join(' · ')}`);
  }
  const pending = entities.filter((e) => e.state.status !== 'done');
  console.log(pending.length ? '\nДальше: craftui next' : '\nВсё импортировано.');
});

/** The next-step card with exact tool calls; any agent resumes from it. */
export const next = (ref?: string) => capture(() => nextCard(ref));

function nextCard(ref?: string) {
  let e = ref ? findEntity(ref) : pickNext();
  if (!e) return console.log('Незавершённой работы нет.');
  let s = e.state;
  const blockers = openBlockers(s);
  if (blockers.length) {
    console.log(`${e.name} ждёт вложенные: ${blockers.join(', ')} — сначала они.`);
    e = findEntity(blockers[0]);
    s = e.state;
  }
  if (s.awaitingUser) {
    console.log(`${e.name}: ждём ответа пользователя — ${s.awaitingUser}`);
    console.log(`Когда ответ получен: craftui step {"entity":"${e.name}","action":"resume"}`);
    return;
  }
  const step = s.steps.find((x) => x.status !== 'done' && x.status !== 'skipped');
  if (!step) return console.log(`${e.name}: все шаги выполнены.`);
  console.log(`${e.kind}/${e.name} · шаг ${step.id}: ${step.title}${step.status === 'failed' ? ` (ошибка: ${step.lastError})` : ''}`);
  if ((step.attempts ?? 0) >= 3) console.log('Шаг уже падал 3 раза: опиши проблему пользователю и спроси, как быть (или skip).');
  console.log(`Начало: craftui step {"entity":"${e.name}","action":"begin","step":"${step.id}"}`);
  for (const line of instructions(e, s, step.id)) console.log(`  ${line}`);
  // Tools and the receiver close auto steps themselves; the manual line only for what the agent must close by hand.
  const auto = AUTO_STEPS[step.id];
  if (auto && (s.source === 'chrome' || !AUTO_CHROME_ONLY.includes(step.id))) console.log(`Закроется сам: ${auto}`);
  else console.log(`Готово: craftui step {"entity":"${e.name}","action":"done","step":"${step.id}"}   Ошибка: action "fail" с полем text`);
  // The two steps after this one, so an agent can chain without calling next between them.
  const idx = s.steps.indexOf(step);
  const upcoming = s.steps.slice(idx + 1).filter((x) => x.status !== 'skipped').slice(0, 2);
  if (upcoming.length) console.log(`Дальше: ${upcoming.map((x) => `${x.id} — ${x.title}`).join('; ')}`);
}

export type StepAction = 'begin' | 'done' | 'fail' | 'skip' | 'reopen' | 'wait' | 'resume';

export function step({ entity, action, step: stepId, text }: { entity: string; action: StepAction; step?: string; text?: string }): Promise<string> {
  if (action === 'reopen') return reopen({ entity, step: stepId ?? '', reason: text });
  if (action === 'wait') return wait({ entity, question: text ?? '' });
  if (action === 'resume') return resume({ entity });
  return mark({ entity, status: action, step: stepId ?? '', text });
}

function mark({ entity, status, step: stepId, text }: { entity: string; status: Exclude<StepAction, 'reopen' | 'wait' | 'resume'>; step: string; text?: string }): Promise<string> {
  return capture(() => {
    const state = { begin: 'in-progress', done: 'done', fail: 'failed', skip: 'skipped' }[status] as StepStatus;
    const e = findEntity(entity);
    const s = e.state;
    // One mutation path for manual marks, tools and the receiver; a step marked its own status changes nothing.
    const changed = applyStep(s, stepId, state, text);
    if (state === 'in-progress') getStep(s, stepId).attempts = (getStep(s, stepId).attempts ?? 0) + 1;
    if (!changed) return console.log(`✓ ${e.name} · ${stepId}: уже ${state} — ничего не менял.`);
    // A finished report closes an import cycle: version 1 is the first import, every reopen + report adds one.
    const finished = stepId === 'report' && state === 'done';
    if (finished) {
      const imports = importsOf(e, s);
      imports.push({ version: imports.length + 1, at: now(), reason: imports.length ? (s.pendingReason ?? 'обновление') : 'первый импорт' });
      s.pendingReason = null;
    }
    saveState(e, s);
    const label = ({ 'in-progress': 'начат', done: 'выполнен', failed: 'ошибка', skipped: 'пропущен', pending: 'открыт' } as Record<StepStatus, string>)[state];
    appendHistory(e, `шаг ${stepId} ${label}${text ? `: ${text}` : ''}`);
    if (finished) {
      const version = importsOf(e, s).at(-1)?.version;
      appendHistory(e, `версия импорта ${version}`);
      console.log(`README: ${writeReadme(e)} (версия импорта ${version})`);
    }
    if (state === 'done' && s.status === 'done') {
      for (const parentName of s.usedBy ?? []) {
        const p = listEntities().find((x) => x.name === parentName);
        if (p) appendHistory(p, `вложенный ${e.name} готов`);
      }
    }
    console.log(`✓ ${e.name} · ${stepId}: ${state}`);
    // The card of the next step right in the done response: the agent chains steps without calling next.
    if (state === 'done') {
      const nx = s.steps.find((x) => x.status !== 'done' && x.status !== 'skipped');
      if (nx) nextCard(`${e.kind}/${e.name}`);
      else console.log('Все шаги выполнены.');
    } else console.log('Дальше: craftui next');
  });
}

/** Tool-executed steps close themselves on success: the agent skips the manual begin/done pair. Manual step done stays as the fallback. */
function autoDone(entity: string, stepId: string) {
  const e = findEntity(entity);
  const step = e.state.steps.find((x) => x.id === stepId);
  if (!step || step.status === 'done' || step.status === 'skipped') return;
  mark({ entity, status: 'done', step: stepId });
}

/** Resync or extension (new sources, sizes): the step and everything after it run again. */
function reopen({ entity, step: stepId, reason }: { entity: string; step: string; reason?: string }): Promise<string> {
  return capture(() => {
    const e = findEntity(entity);
    const s = e.state;
    const from = s.steps.indexOf(getStep(s, stepId));
    for (const step of s.steps.slice(from)) {
      step.status = 'pending';
      step.lastError = null;
    }
    importsOf(e, s); // fix the history before a new cycle starts
    if (reason) s.pendingReason = [s.pendingReason, reason].filter(Boolean).join('; ');
    saveState(e, s);
    appendHistory(e, `шаги с ${stepId} открыты заново${reason ? `: ${reason}` : ''}`);
    console.log(`✓ ${e.name}: шаги ${s.steps.slice(from).map((x) => x.id).join(', ')} снова pending. Дальше: craftui next ${e.name}`);
  });
}

function wait({ entity, question }: { entity: string; question: string }): Promise<string> {
  return capture(() => {
    const e = findEntity(entity);
    const s = e.state;
    s.awaitingUser = question || 'ответ пользователя';
    saveState(e, s);
    appendHistory(e, `ждём пользователя: ${s.awaitingUser}`);
    console.log(`✓ ${e.name}: ожидание ответа отмечено. Заверши ход вопросом пользователю.`);
  });
}

function resume({ entity }: { entity: string }): Promise<string> {
  return capture(() => {
    const e = findEntity(entity);
    const s = e.state;
    s.awaitingUser = null;
    saveState(e, s);
    appendHistory(e, 'ответ получен, продолжаем');
    console.log(`✓ ${e.name}: продолжаем. craftui next ${e.name}`);
  });
}

export function log({ entity, action = 'note', text = '' }: { entity?: string; action?: 'note' | 'shortcuts'; text?: string }): Promise<string> {
  return capture(() => {
    if (action === 'shortcuts') return shortcuts(entity);
    const e = findEntity(entity);
    appendHistory(e, text);
    console.log('✓ записано');
  });
}

function shortcuts(ref?: string) {
  const entities = ref ? [findEntity(ref)] : listEntities();
  for (const e of entities) {
    const found = [];
    for (const file of walk(e.dir)) {
      if (file.includes(`${path.sep}craftlog${path.sep}`)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/shortcut:/g)) {
        // Block comment (/* … */) runs to */, a line comment (//) to the end of the line.
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const block = text.slice(lineStart, m.index).includes('/*');
        const from = m.index + m[0].length;
        const to = block ? text.indexOf('*/', from) : text.indexOf('\n', from);
        const note = text.slice(from, to === -1 ? undefined : to).replace(/\s*\*\s*/g, ' ').replace(/\s+/g, ' ').trim();
        found.push(`- \`${path.relative(e.dir, file)}:${text.slice(0, m.index).split('\n').length}\` ${note}`);
      }
    }
    replaceSection(e.logFile, 'shortcuts', found.join('\n') || '_нет_');
    console.log(`${e.name}: ${found.length ? `\n${found.join('\n')}` : 'компромиссов нет'}`);
  }
}

// ── config: page breakpoints ─────────────────────────────────────────────────

export function setBreakpoints({ mobile, tablet, desktop }: { mobile?: number | string; tablet?: number | string | null; desktop?: number | string | null } = {}): Promise<string> {
  return capture(() => {
    const given = Object.fromEntries(Object.entries({ mobile, tablet, desktop }).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
    if (!Object.keys(given).length) {
      const bp = config().pages.breakpoints;
      return console.log(bp ? `Брейкпоинты страниц: ${describeBreakpoints(bp)}` : 'Брейкпоинты страниц не заданы: config {"mobile":767,"tablet":1279,"desktop":null} (null — диапазон не нужен)');
    }
    let bp: Breakpoints;
    try {
      bp = breakpointsFrom(given);
    } catch (err) {
      fail((err as Error).message);
    }
    const raw = readJson<{ pages?: Partial<Config['pages']>; [key: string]: unknown }>('craftui.config.json', {});
    raw.pages = { ...raw.pages, breakpoints: bp };
    writeJson('craftui.config.json', raw);
    console.log(`✓ брейкпоинты страниц: ${describeBreakpoints(bp)}`);
  });
}

// ── figma: url, create, sources, extract helpers ─────────────────────────────

export function figmaUrl(url: string): Promise<string> {
  return capture(() => {
    const parsed = parseFigmaUrl(url);
    if (!parsed) fail('не похоже на ссылку Figma');
    console.log(JSON.stringify(parsed, null, 2));
    if (!parsed.nodeId) console.log('Нет node-id: попроси пользователя ссылку на слой (ПКМ → Copy link to selection).');
  });
}

export function create({ kind, name, url, source, parent, variant, filter, breakpoints }: { kind?: string; name: string; url: string; source?: string; parent?: string; variant?: string; filter?: string; breakpoints?: string }): Promise<string> {
  return capture(() => {
    // The kind may be left out: defaultKind of the settings (component unless changed).
    const kindArg = kind ?? config().defaultKind;
    const resolvedKind = KIND_ALIASES[kindArg] ?? kindArg;
    if (!isKind(resolvedKind)) fail(`вид должен быть: ${KINDS.join(', ')}`);
    // A page may bring its breakpoints (from probe's frame widths): they are written to the config if not set yet.
    const argBreakpoints = breakpointsFromArg(breakpoints);
    if (resolvedKind === 'page' && argBreakpoints && !config().pages.breakpoints) {
      const raw = readJson<{ pages?: Partial<Config['pages']>; [key: string]: unknown }>('craftui.config.json', {});
      raw.pages = { ...raw.pages, breakpoints: argBreakpoints };
      writeJson('craftui.config.json', raw);
      console.log(`✓ брейкпоинты страниц из аргумента: ${describeBreakpoints(argBreakpoints)}`);
    }
    if (resolvedKind === 'page' && !config().pages.breakpoints) {
      fail('брейкпоинты страниц не заданы. Ширины фреймов есть в probe — передай их: create {"kind":"page",…,"breakpoints":"767,1279"} ' +
        '(mobile, tablet, desktop — верхние границы, пустой сегмент — диапазона нет). Или спроси пользователя и вызови config {"mobile":767,"tablet":1279,"desktop":null}');
    }
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) fail('имя — PascalCase латиницей, например BasicButton');
    const figma = parseFigmaUrl(url);
    if (!figma?.nodeId) fail('нужна ссылка Figma с node-id');
    const resolvedSource = resolveSource(source, typeof parent === 'string' ? findEntity(parent).state.source : undefined, config().source);
    if (!resolvedSource) fail('источник: "chrome" (Chrome MCP, по умолчанию) или "figma" (Figma MCP); так же "source" в craftui.config.json');
    if (resolvedKind === 'page' && resolvedSource !== 'chrome') fail('страницы пока импортируются только через Chrome MCP: source "chrome"');
    const e = newEntity(resolvedKind, name);
    if (fs.existsSync(e.stateFile)) fail(`${name} уже есть — продолжай: craftui next ${name}`);

    for (const d of ['figma/raw', 'figma/screenshots', 'figma/assets', 'visual', 'tests']) fs.mkdirSync(`${e.craftlog}/${d}`, { recursive: true });
    const first = sourceEntry(url, { variant, filter: readFilter(filter) });
    writeJson(`${e.craftlog}/figma/source.json`, { kind: resolvedKind, name, source: resolvedSource, ...figma, sources: [first], createdAt: new Date().toISOString() });
    fs.writeFileSync(e.logFile, logTemplate(resolvedKind, name, figma, resolvedSource));
    const state: State = {
      version: 1, kind: resolvedKind, name, source: resolvedSource, figma, status: 'in-progress', awaitingUser: null, blockedBy: [],
      usedBy: typeof parent === 'string' ? [parent] : [],
      steps: STEPS[resolvedKind].map(([id, title]) => ({ id, title, status: 'pending', attempts: 0, lastError: null })),
      createdAt: new Date().toISOString(),
    };
    saveState(e, state);
    appendHistory(e, `создано (${resolvedSource})${parent ? `, вложенный в ${parent}` : ''}`);

    if (typeof parent === 'string') {
      const p = findEntity(parent);
      const ps = p.state;
      ps.blockedBy = [...new Set([...(ps.blockedBy ?? []), name])];
      saveState(p, ps);
      appendHistory(p, `ждёт вложенный ${name}`);
    }
    console.log(`✓ ${e.dir}/craftlog создан. Дальше: craftui next ${name}`);
  });
}

export function sources(opts: { entity: string; action?: 'list' | 'add' | 'filter' | 'variant'; url?: string; variant?: string; filter?: string; index?: number | 'all' }): Promise<string> {
  return capture(() => sourcesModule.run(opts));
}

export function snippet({ entity, url, step: name, inline = false }: { entity?: string; url?: string; step: 'probe' | 'probe-extract' | 'extract' | 'export'; inline?: boolean }): Promise<string> {
  return capture(() => snippets.run([entity ?? url, name], { inline }));
}

export function putFile({ entity, path: rel, content, base64 = false }: { entity: string; path: string; content: string; base64?: boolean }): Promise<string> {
  return capture(() => console.log(snippets.putFile(entity, rel, content, base64)));
}

export const receiverStart = ({ port }: { port?: number } = {}) => receiver.start({ port });

export const receiverStop = () => receiver.stop();

export const restImages = (entity: string, fresh = false) => capture(() => rest.run(entity, { fresh }));

// ── spec: normalize, deps, confirm-stage edits ───────────────────────────────

export function normalize({ entity, keep = false, summary = false }: { entity: string; keep?: boolean; summary?: boolean }): Promise<string> {
  return capture(async () => {
    await normalizeModule.run(entity, { summary, keep });
    // The summary prints the existing spec without building one: the step stays open.
    if (!summary) autoDone(entity, 'normalize');
  });
}

export function entityDeps({ entity, inline, inlineAll = false, same }: { entity: string; inline?: string; inlineAll?: boolean; same?: { instance: string; entity: string } }): Promise<string> {
  return capture(async () => {
    const unresolved = await deps.run(entity, inline, { all: inlineAll, same: same ? [same.instance, same.entity] : null });
    // Unresolved instances mean decisions are still needed: the step stays open (deps.run returns their count).
    if (unresolved === 0) autoDone(entity, 'deps');
  });
}

export function prop({ entity, figma, react, type, role, default: defaultValue, state }: { entity: string; figma: string; react?: string; type?: string; role?: Prop['role']; default?: string; state?: string }): Promise<string> {
  return capture(() => {
    const e = findEntity(entity);
    const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — вызови spec {"action":"normalize","entity":"${e.name}"}`);
    if (!react && !state) fail('нужны react (имя React-пропа или "-") или state (disabled|loading|hover|active…); новое свойство — с role');
    const manualState = state ?? null;
    let p = spec.props.find((x) => x.figma === figma);
    // An MCP export does not show TEXT, BOOLEAN and INSTANCE_SWAP properties: they are added by hand with a role.
    if (!p && role) spec.props.push((p = { figma, role, react: null, ...(defaultValue !== undefined ? { default: defaultValue } : {}) }));
    if (!p) return fail(`нет свойства "${figma}" (новое — с role). Есть: ${spec.props.map((x) => x.figma).join(', ')}`);
    if (manualState) {
      // A variant value that is a state (Property 1=Disabled): a flag (native disabled, data-loading) or a pseudo-class, not a prop.
      const pseudo = ['hover', 'active', 'focus', 'focus-visible'].includes(manualState);
      const hit = (p.options ?? Object.keys(p.map ?? {})).find((o) => slug(o) === slug(manualState));
      if (!hit) return fail(`у "${figma}" нет значения ${manualState} (есть: ${(p.options ?? Object.keys(p.map ?? {})).join(', ')})`);
      const was = p.react;
      Object.assign(p, { role: 'state', react: null, reactType: undefined, map: Object.fromEntries((p.options ?? Object.keys(p.map ?? {})).map((o) => [o, o === hit ? (pseudo ? { pseudo: manualState } : { flag: manualState }) : null])) });
      for (const t of spec.targets) {
        const on = (t.variant?.[p.figma] ?? (was ? t.props?.[was] : undefined)) === hit || (was ? t.props?.[was] : undefined) === slug(hit);
        if (was) delete t.props[was];
        if (!on) continue;
        if (pseudo) t.pseudo = [...new Set([...(t.pseudo ?? []), manualState])];
        else t.props[manualState] = true;
      }
      writeJson(e.specFile, spec);
      appendHistory(e, `confirm: ${figma}=${hit} → ${pseudo ? `:${manualState}` : `состояние ${manualState}`}`);
      return console.log(`✓ ${figma}=${hit} → ${pseudo ? `псевдокласс :${manualState}` : `флаг ${manualState}`}. Затем: spec {"action":"normalize","entity":"${e.name}","keep":true}`);
    }
    const was = p.react;
    p.react = react === '-' ? null : react!;
    if (type) p.reactType = type;
    for (const t of spec.targets) {
      if (!was || !(was in (t.props ?? {}))) continue;
      if (p.react) t.props[p.react] = t.props[was];
      delete t.props[was];
    }
    writeJson(e.specFile, spec);
    appendHistory(e, `confirm: ${figma} → ${p.react ?? '(не проп)'}${type ? `: ${type}` : ''}`);
    console.log(`✓ ${figma} → ${p.react ?? '(не проп)'}${type ? `: ${type}` : ''}. Затем: spec {"action":"normalize","entity":"${e.name}","keep":true}`);
  });
}

export const slot = ({ entity, target, prop: prop_ }: { entity: string; target: string[]; prop: string }) =>
  capture(() => slots.bindSlot([entity, ...target, prop_]));

export const mockup = ({ page, layer, remove = false }: { page: string; layer: string; remove?: boolean }) =>
  capture(() => normalizePage.skipLayer([page, layer], remove));

export const part = ({ page, layer, name, shared = false, remove = false }: { page: string; layer: string; name?: string; shared?: boolean; remove?: boolean }) =>
  capture(() => normalizePage.part([page, layer, name], { remove, shared }));

// ── digest: brief and spec lookups ───────────────────────────────────────────

export const brief = (entity: string) => capture(async () => console.log(await digest.brief(entity)));

export const specQuery = ({ entity, target, layer, depth = 3 }: { entity: string; target?: string; layer?: string; depth?: number }) =>
  capture(() => console.log(digest.query(entity, target, layer, depth)));

// ── code: tokens, scaffold, svg, units, readme ───────────────────────────────

export const mergeTokens = (entity: string) =>
  capture(async () => {
    const conflicts = await tokensModule.run(entity);
    // Conflicting values are decided with the user: the step stays open until they are resolved.
    if (conflicts === 0) autoDone(entity, 'tokens');
    else console.log('Шаг tokens не закрыт: реши конфликты значений с пользователем (craftui log, история).');
  });;

export function scaffoldFiles({ entity, force = false, addTargets = false }: { entity: string; force?: boolean; addTargets?: boolean }): Promise<string> {
  return capture(async () => {
    await scaffold.run(entity, force, addTargets);
    autoDone(entity, 'scaffold');
  });
}

export const svgIcon = ({ entity, asset, name }: { entity: string; asset: string; name?: string }) => capture(() => svg.run([entity, asset, name]));

export const unitsCheck = (entity?: string) => capture(() => units.run(entity));

export const writeReadmes = (entity?: string) => capture(() => readme.run(entity));

// ── verify ───────────────────────────────────────────────────────────────────

export function verifyEntity({ entity, grep, unit = true, visual = true }: { entity: string; grep?: string; unit?: boolean; visual?: boolean }): Promise<string> {
  return capture(() => verify.run(entity, { grep, unit, visual }));
}

// ── hooks and autopilot ──────────────────────────────────────────────────────

export const installHooks = ({ claude = false, codex = false }: { claude?: boolean; codex?: boolean } = {}) => capture(() => hooks.install({ claude, codex }));

export const autopilot = ({ agent, max = 10 }: { agent?: string; max?: number } = {}) => capture(() => hooks.autopilot({ agent, max }));

// ── hook entries (the client runs node <mcp>/hook.ts stop|session) ───────────

/** SessionStart after compaction: the card of the current step goes back into the fresh context. */
export async function projectCard(): Promise<string | null> {
  const cwd = process.env.CLAUDE_PROJECT_DIR;
  if (cwd && fs.existsSync(`${cwd}/craftui.config.json`)) process.chdir(cwd);
  if (!fs.existsSync('craftui.config.json') || !listEntities().some((e) => e.state.status !== 'done')) return null;
  return capture(() => {
    console.log('craftui: контекст сжат, продолжай с текущего шага. spec.json и figma/raw не открывай — данные: вызов digest {"action":"brief","entity":"<Name>"}.');
    nextCard();
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Unfinished entity to work on now: blockers first, then the oldest one.
function pickNext(): Entity | null {
  const open = listEntities().filter((e) => e.state.status !== 'done');
  if (!open.length) return null;
  const waiting = open.find((e) => e.state.awaitingUser);
  if (waiting) return waiting;
  return open.find((e) => !openBlockers(e.state).length) ?? open[0];
}

function* walk(dir: string): Generator<string> {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(d.name)) yield p;
  }
}

function logTemplate(kind: Kind, name: string, figma: FigmaRef, source: string): string {
  return `# ${name} — craftui

| | |
|---|---|
| Вид | ${kind} |
| Макет | ${figma.url} |
| fileKey / nodeId | \`${figma.fileKey}\` / \`${figma.nodeId}\` |
| Источник данных | ${source} |
| Создан | ${now()} |

## Шаги
<!-- craftui:steps -->
<!-- /craftui:steps -->

## Свойства (Figma → React)
_заполняется на шаге confirm_

## Targets
<!-- craftui:targets -->
_заполняется командой verify_
<!-- /craftui:targets -->

## Зависимости
_использует / используется в_

## Токены и ассеты

## Отклонения от макета

## Компромиссы
<!-- craftui:shortcuts -->
_нет_
<!-- /craftui:shortcuts -->

## История
`;
}

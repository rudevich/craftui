// Headless import driver: Figma link → ready drafts, PNG references and a verify report without a single LLM call.
// Runs the same api.ts functions the MCP tools call, plus a thin CDP client that executes the snippets
// in the user's Figma tab instead of the agent. The code step stays out of scope: the run ends with the
// verify summary — an agent with the craftui skill (or a human) takes over at `next` → code.
import fs from 'node:fs';
import * as api from '../api.ts';
import { fail, findEntity, listEntities, pascal, readJson } from './lib.ts';
import { renderSnippet } from './snippets.ts';
import { runSnippet } from './chrome-client.ts';
import type { Entity, Instance, Spec, StepStatus } from './types.ts';

const DEFAULT_CDP = '9222';
const SNIPPET_TIMEOUT = 10 * 60_000;
const MAX_DEPTH = 4;

type Args = { url?: string; name?: string; kind: string; breakpoints?: string; inlineGraphic?: boolean; fresh?: boolean; cdp: string; timeoutMs: number };

export function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`неожиданный аргумент ${a} — форма: node mcp/auto.ts --url <ссылка> --name <Name> [--kind component|page] [--breakpoints "767,1279"] [--inline-graphic] [--fresh] [--cdp 9222]`);
    const key = a.slice(2);
    if (['inline-graphic', 'fresh'].includes(key)) args[key] = true;
    else args[key] = argv[++i] ?? '';
  }
  return {
    url: args.url as string | undefined,
    name: args.name as string | undefined,
    kind: (args.kind as string) ?? 'component',
    breakpoints: args.breakpoints as string | undefined,
    inlineGraphic: Boolean(args['inline-graphic']),
    fresh: Boolean(args.fresh),
    cdp: (args.cdp as string) || DEFAULT_CDP,
    timeoutMs: args.timeoutMs ? Number(args.timeoutMs) * 1000 : SNIPPET_TIMEOUT,
  };
}

const status = (e: Entity, id: string): StepStatus | null => e.state.steps.find((s) => s.id === id)?.status ?? null;
const say = (text: string) => console.log(text.trimEnd());

/** Free entity name for a child: the base, or the base with the next numeric suffix. */
export function childName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
  return name;
}

/** Instance name → valid entity name: PascalCase without a leading digit ("24 / Arrows / …" → "Arrows24…"). */
export function entityName(instance: string): string {
  return pascal(instance).replace(/^[0-9]+/, '') || 'Entity';
}

/** The entity by name and url: creates it when missing, resumes the existing one otherwise. */
async function ensureEntity(kind: string, name: string, url: string, parent: string | undefined, args: Args): Promise<Entity> {
  const existing = listEntities().find((x) => x.name === name && x.kind === kind);
  if (existing) return existing;
  say(await api.create({ kind, name, url, parent, breakpoints: args.breakpoints }));
  return findEntity(`${kind}/${name}`);
}

/** One entity: extract → normalize → confirm(skip) → screenshots → deps → tokens → scaffold. */
async function importEntity(kind: string, name: string, url: string, parent: string | undefined, args: Args): Promise<Entity> {
  const e = await ensureEntity(kind, name, url, parent, args);
  say(`— ${kind}/${name}`);

  if (status(e, 'extract') !== 'done') {
    const code = renderSnippet(e, 'probe-extract');
    const summary = (await runSnippet(args.cdp, code, { fileKey: e.state.figma.fileKey, timeoutMs: args.timeoutMs })) as { warnings?: string[]; variants?: number } | undefined;
    if (summary?.warnings?.length) throw new Error(`${summary.warnings.join('\n')}\nзадай фильтры (sources {"action":"filter"}) и перезапусти — сущность продолжится с места остановки`);
    if (typeof summary?.variants === 'number') say(`  extract: ${summary.variants} вариантов, шаг закрыт receiver-ом`);
  }
  if (status(e, 'normalize') !== 'done') say(await api.normalize({ entity: name }));
  if (status(e, 'confirm') === 'pending') await api.step({ entity: name, action: 'skip', step: 'confirm', text: 'headless: эвристики normalize, проверь на шаге code' });

  if (status(e, 'screenshots') !== 'done' && status(e, 'screenshots') !== 'skipped') {
    if (process.env.FIGMA_TOKEN) {
      say(await api.restImages(name, args.fresh));
      await api.step({ entity: name, action: 'done', step: 'screenshots', text: 'headless: rest-images' });
    } else {
      const summary = (await runSnippet(args.cdp, renderSnippet(e, 'export'), { fileKey: e.state.figma.fileKey, timeoutMs: args.timeoutMs })) as { failed?: string[]; saved?: number } | undefined;
      if (summary?.failed?.length) throw new Error(`export: не удалось снять ${summary.failed.length} targets:\n${summary.failed.join('\n')}`);
      say(`  screenshots: ${summary?.saved ?? 0} PNG через сниппет export`);
    }
  }

  // The first deps call prints instances and writes null resolutions; the recursion imports the children.
  say(await api.entityDeps({ entity: name }));
  await resolveDeps(e, args, 0);
  await finishResolved(e, args);

  say(await api.mergeTokens(name));
  say(await api.scaffoldFiles({ entity: name }));
  return e;
}

const PRE_CODE = ['extract', 'normalize', 'confirm', 'screenshots', 'deps', 'tokens', 'scaffold'];
const preCodeOpen = (e: Entity): boolean => e.state.steps.some((s) => PRE_CODE.includes(s.id) && s.status !== 'done' && s.status !== 'skipped');

/** Children imported by an earlier stopped run can still have open pre-code steps: finish their pipelines too
 *  (importEntity is resume-safe — done steps are skipped, the recursion covers grandchildren). */
async function finishResolved(e: Entity, args: Args): Promise<void> {
  const resolved = (readJson<Spec>(e.specFile)?.instances ?? []).filter((i) => i.resolution?.startsWith('entity:'));
  for (const i of resolved) {
    const child = findEntity(i.resolution!.slice('entity:'.length));
    if (preCodeOpen(child)) await importEntity(child.kind, child.name, '', undefined, args);
  }
}

/** Import-all policy: every unresolved instance with a mainId becomes a child entity (the same cycle, depth-limited);
 *  graphic instances optionally inline. What is left after that needs a human: a printed stop list. */
async function resolveDeps(e: Entity, args: Args, depth: number): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`глубина вложенности больше ${MAX_DEPTH} — разреши остаток руками (craftui spec {"action":"deps"})`);
  const unresolved = (): Instance[] => (readJson<Spec>(e.specFile)?.instances ?? []).filter((i) => i.resolution === null);
  let open = unresolved();
  if (!open.length) return;

  if (args.inlineGraphic) {
    for (const i of open.filter((i) => i.graphic)) say(await api.entityDeps({ entity: e.name, inline: i.name }));
    open = unresolved();
    if (!open.length) return;
  }

  const spec = readJson<Spec>(e.specFile)!;
  const noMain = open.filter((i) => !i.mainId);
  if (noMain.length) throw new Error(`нет mainId у ${noMain.map((i) => i.name).join(', ')} — создай сущность вручную (create {…,"parent":"${e.name}"}) и перезапусти раннер`);
  for (const i of open) {
    // An earlier child may have resolved this component (several instances share one main): skip it then.
    if (!unresolved().some((x) => x.key === i.key)) continue;
    const url = `https://www.figma.com/design/${spec.figma.fileKey}/?node-id=${i.mainId!.replace(/:/g, '-')}`;
    const child = childName(entityName(i.name), new Set(listEntities().map((x) => x.name)));
    say(`  вложенный ${i.name} → ${child}`);
    await importEntity('component', child, url, e.name, args);
    // The fresh child matches by its component key: one more deps pass over the parent.
    say(await api.entityDeps({ entity: e.name }));
    if (!unresolved().length) return;
  }
  const rest = unresolved();
  throw new Error(`остались неразрешённые вложенные (${rest.map((i) => `${i.name} ×${i.nodeIds.length}`).join(', ')}) — twin-наборы и переиспользование реши вручную: craftui spec {"action":"deps"}`);
}

/** The whole pipeline for one root entity. Returns the final report; throws with a human-readable stop reason. */
export async function auto(argv: string[]): Promise<string> {
  if (Number(process.versions.node.split('.')[0]) < 24) fail(`нужен Node.js 24 или новее, сейчас ${process.version}`);
  if (!fs.existsSync('craftui.config.json')) fail('в текущей папке нет craftui.config.json — это не проект craftui (node <skill>/scripts/init-project.ts)');
  const args = parseArgs(argv);
  const { url, name, kind } = args;
  if (!url || !name) fail('нужны --url <ссылка Figma> и --name <Имя>');

  try {
    await api.receiverStart({});
    const e = await importEntity(kind, name, url, undefined, args);

    const open = e.state.steps.filter((s) => s.status === 'pending' || s.status === 'in-progress' || s.status === 'failed').map((s) => s.id);
    let verifyNote = 'verify не запускался: нет node_modules — сначала npm install';
    if (fs.existsSync('node_modules')) {
      try {
        verifyNote = await api.verifyEntity({ entity: e.name });
      } catch (err) {
        verifyNote = `verify упал: ${String((err as Error)?.message ?? err)}`;
      }
    }
    say(verifyNote);

    return `\n✓ headless-импорт ${e.kind}/${e.name}: черновики, эталоны и spec готовы. Открытые шаги: ${open.join(', ') || '—'}.\nДальше — агент с скиллом craftui: \`next\` → шаг code (доводка по сводке verify выше), tests, report.`;
  } finally {
    await api.receiverStop();
  }
}

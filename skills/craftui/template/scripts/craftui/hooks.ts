// Auto-continue: a Stop hook (Claude Code, Codex), a SessionStart hook after compaction (Claude Code)
// and an autopilot loop that restarts the agent after API failures.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, listEntities, openBlockers, readJson, writeJson } from './lib.ts';

type HookGroup = { matcher: string; hooks: { type: string; command: string; timeout?: number }[] };
type HookSettings = { hooks?: Record<string, HookGroup[]>; [key: string]: unknown };

const HOOK_STATE = '.craftui/hook-state.json';
const MAX_NO_PROGRESS = 3;

function pending() {
  const open = listEntities().filter((e) => e.state.status !== 'done');
  const doneSteps = listEntities().reduce((n, e) => n + e.state.steps.filter((s) => s.status === 'done').length, 0);
  const waiting = open.find((e) => e.state.awaitingUser);
  const stuck = open.length > 0 && open.every((e) => e.state.steps.some((s) => s.status === 'failed' && (s.attempts ?? 0) >= 3));
  const next = open.find((e) => !openBlockers(e.state).length) ?? open[0];
  return { open, doneSteps, waiting, stuck, next };
}

export function install(args: string[]) {
  const all = !args.includes('--claude') && !args.includes('--codex');
  const command = 'node scripts/craftui/cli.ts hook-stop';
  const targets: string[] = [];
  if (all || args.includes('--claude')) targets.push('.claude/settings.json');
  if (all || args.includes('--codex')) targets.push('.codex/hooks.json');
  for (const file of targets) {
    const settings = readJson<HookSettings>(file, {});
    const hooks = (settings.hooks ??= {});
    hooks.Stop ??= [];
    const present = hooks.Stop.some((g) => g.hooks?.some((h) => h.command === command));
    if (!present) hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command, timeout: 10 }] });
    console.log(`${present ? '= уже есть' : '✓ добавлен'} Stop-хук в ${file}`);
    // After compaction a small-context model forgets the step it was on: give it the card again.
    if (file.startsWith('.claude')) {
      const session = 'node scripts/craftui/cli.ts hook-session';
      hooks.SessionStart ??= [];
      const has = hooks.SessionStart.some((g) => g.hooks?.some((h) => h.command === session));
      if (!has) hooks.SessionStart.push({ matcher: 'compact', hooks: [{ type: 'command', command: session, timeout: 10 }] });
      console.log(`${has ? '= уже есть' : '✓ добавлен'} SessionStart-хук (после сжатия контекста) в ${file}`);
    }
    writeJson(file, settings);
  }
  console.log('Codex может попросить доверить хук при первом запуске (trusted_hash в ~/.codex/config.toml).');
}

// Prints {"decision":"block"} while there is unfinished work the agent can do without the user.
export async function hookStop() {
  try {
    let input: { cwd?: string } = {};
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) input = JSON.parse(raw);
    const cwd = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
    if (cwd && fs.existsSync(path.join(cwd, 'craftui.config.json'))) process.chdir(cwd);
    if (!fs.existsSync('craftui.config.json')) return;

    const p = pending();
    if (!p.open.length || p.waiting || p.stuck) return;
    const hs = readJson<{ doneSteps?: number; noProgress?: number }>(HOOK_STATE, {});
    const noProgress = hs.doneSteps === p.doneSteps ? (hs.noProgress ?? 0) + 1 : 0;
    writeJson(HOOK_STATE, { doneSteps: p.doneSteps, noProgress, at: new Date().toISOString() });
    if (noProgress >= MAX_NO_PROGRESS) return;

    const step = p.next.state.steps.find((s) => s.status !== 'done' && s.status !== 'skipped');
    const reason =
      `craftui: работа не закончена (${p.next.name}, шаг ${step?.id}). Выполни \`npm run craftui -- next\` и продолжай. ` +
      `Если нужен ответ пользователя — сначала \`npm run craftui -- wait ${p.next.name} "<вопрос>"\`, потом задай вопрос и заверши ход.`;
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } catch {
    // never block the agent because of a hook error
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export async function autopilot({ agent, max }: { agent?: string; max: number }) {
  const cfg = config().autopilot ?? {};
  const name = agent ?? cfg.agent ?? 'claude';
  const template = cfg.commands?.[name];
  if (!template) {
    console.error(`нет команды для агента "${name}" в craftui.config.json → autopilot.commands`);
    process.exit(1);
  }
  const prompt =
    'Продолжи работу craftui в этом проекте: выполни `npm run craftui -- next` и следуй инструкции до конца шага, затем следующий. ' +
    'Если нужен ответ пользователя — `npm run craftui -- wait <Name> "<вопрос>"` и остановись.';
  let failures = 0;
  let noProgress = 0;
  for (let run = 1; run <= max; run++) {
    const before = pending();
    if (!before.open.length) return console.log('autopilot: всё импортировано.');
    if (before.waiting) return console.log(`autopilot: ждём пользователя — ${before.waiting.name}: ${before.waiting.state.awaitingUser}`);
    if (before.stuck) return console.log('autopilot: шаги падают повторно, нужен человек (npm run craftui -- status).');

    console.log(`\nautopilot: запуск ${run}/${max} (${name})`);
    const r = spawnSync(template.replace('{prompt}', quote(prompt)), { shell: true, stdio: 'inherit' });
    const after = pending();
    if (r.status !== 0) {
      failures++;
      const delay = Math.min(600, 30 * 2 ** (failures - 1));
      console.log(`autopilot: агент завершился с кодом ${r.status}, повтор через ${delay} с`);
      await sleep(delay * 1000);
      continue;
    }
    failures = 0;
    noProgress = after.doneSteps > before.doneSteps ? 0 : noProgress + 1;
    if (noProgress >= MAX_NO_PROGRESS) return console.log('autopilot: нет прогресса 3 запуска подряд — остановка (npm run craftui -- status).');
  }
  console.log('autopilot: достигнут лимит запусков.');
}

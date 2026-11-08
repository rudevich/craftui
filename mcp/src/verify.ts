// typecheck + rstest + screenshot tests for one entity → short summary; full logs in craftlog/visual/output/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appendHistory, config, findEntity, readJson, replaceSection } from './lib.ts';
import { checkEntity, describe as describeUnits } from './units.ts';
import type { Entity, Spec } from './types.ts';

/** craftlog/visual/output/<id>.json, written by tests/visual.ts. */
type VisualResult = { id: string; pass?: boolean; diffRatio?: number; missing?: boolean; report?: string[]; styleIssues?: string[] };
type TargetConfig = { maxDiffRatio?: number; threshold?: number; skip?: boolean; reason?: string };
type VisualConfig = { default?: TargetConfig; targets?: Record<string, TargetConfig> };

const tail = (text: string, n: number) => text.trim().split('\n').slice(-n);

function exec(cmd: string, args: string[], logFile: string, env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', CI: '1', ...env }, maxBuffer: 64 * 1024 * 1024 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  fs.writeFileSync(logFile, output);
  return { ok: r.status === 0, output };
}

export function run(ref: string | undefined, { grep, unit, visual }: { grep?: string; unit: boolean; visual: boolean }) {
  const e = findEntity(ref);
  const out = path.join(e.craftlog, 'visual', 'output');
  fs.mkdirSync(out, { recursive: true });
  const lines: string[] = [];
  let ok = true;

  const units = checkEntity(e);
  if (units.errors.length) {
    ok = false;
    lines.push(`units ✗ ${units.errors.length} — только px и %, viewport-единицы только для оверлеев`);
    lines.push(...describeUnits(units).slice(0, 6));
  } else lines.push(`units ✓${units.justified.length ? ` (viewport с обоснованием: ${units.justified.length})` : ''}`);

  // gen first: demo metadata (and README) must exist and follow the current code.
  exec('node', ['scripts/gen.ts'], path.join(out, 'gen.log'));
  const tsc = exec('npx', ['tsc', '--noEmit'], path.join(out, 'typecheck.log'));
  if (tsc.ok) lines.push('typecheck ✓');
  else {
    ok = false;
    const errors = tsc.output.split('\n').filter((l) => /error TS/.test(l));
    const own = errors.filter((l) => l.includes(e.dir));
    lines.push(`typecheck ✗ ${errors.length} ошибок${own.length !== errors.length ? ` (в ${e.name}: ${own.length})` : ''}`);
    lines.push(...(own.length ? own : errors).slice(0, 6).map((l) => `  ${l}`));
  }

  if (unit) {
    const testsDir = path.join(e.craftlog, 'tests');
    if (!fs.existsSync(testsDir) || !fs.readdirSync(testsDir).length) lines.push('rstest — нет тестов');
    else {
      // AI_AGENT switches rstest to its stable markdown+JSON report, which is parsed below.
      const r = exec('npx', ['rstest', 'run', testsDir], path.join(out, 'unit.log'), { AI_AGENT: process.env.AI_AGENT || 'craftui' });
      const count = (k: string) => Number(r.output.match(new RegExp(`"${k}":\\s*(\\d+)`))?.[1] ?? 0);
      const summary = `${count('passedTests')} passed, ${count('failedTests')} failed`;
      if (r.ok) lines.push(`rstest ✓ ${summary}`);
      else {
        ok = false;
        lines.push(`rstest ✗ ${summary}`);
        const failures = [...r.output.matchAll(/"fullName":\s*"([^"]*)"[\s\S]*?"message":\s*"([^"]*)"/g)].map((m) => `${m[1] || 'file'}: ${m[2].slice(0, 160)}`);
        lines.push(...(failures.length ? failures.slice(0, 8) : tail(r.output, 8)).map((l) => `  ${l.trim()}`));
      }
    }
  }

  if (visual) {
    const shots = path.join(e.craftlog, 'figma', 'screenshots');
    const ids = fs.existsSync(shots) ? fs.readdirSync(shots).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)) : [];
    const selected = grep ? ids.filter((id) => id.includes(grep)) : ids;
    for (const id of selected) fs.rmSync(path.join(out, `${id}.json`), { force: true });
    if (!ids.length) {
      ok = false;
      lines.push('visual ✗ нет эталонов в craftlog/figma/screenshots/ (шаг screenshots)');
    } else {
      const args = ['playwright', 'test', path.join(e.craftlog, 'visual')];
      if (grep) args.push('--grep', grep);
      const r = exec('npx', args, path.join(out, 'visual.log'));
      // Skipped in visual.config.json with a reason (a design error the user decides on): listed, not failed.
      const visualConfig = readJson<VisualConfig>(path.join(e.craftlog, 'visual', 'visual.config.json'));
      const skipped = selected.filter((id) => visualConfig?.targets?.[id]?.skip);
      const results = selected.filter((id) => !skipped.includes(id)).map((id): VisualResult => readJson<VisualResult>(path.join(out, `${id}.json`)) ?? { id, pass: false, missing: true });
      const passed = results.filter((x) => x.pass);
      if (!passed.length && results.every((x) => x.missing)) {
        ok = false;
        lines.push('visual ✗ тесты не запустились:');
        lines.push(...tail(r.output, 8).map((l) => `  ${l}`));
      } else {
        if (passed.length !== results.length) ok = false;
        const threshold = visualConfig?.default?.maxDiffRatio ?? (e.kind === 'page' ? config().pages.maxDiffRatio : config().maxDiffRatio);
        lines.push(`visual ${passed.length === results.length ? '✓' : '✗'} ${passed.length}/${results.length} (порог ${(threshold * 100).toFixed(1)}%)${skipped.length ? `, пропущено ${skipped.length}` : ''}`);
        for (const id of skipped) lines.push(`  ${id}: пропущен — ${visualConfig?.targets?.[id]?.reason ?? 'без причины: допиши reason'}`);
        // Worst first: fixing the biggest difference often fixes several smaller ones too.
        for (const x of results.filter((x) => !x.pass).sort((a, b) => (b.diffRatio ?? 1) - (a.diffRatio ?? 1)).slice(0, 6)) {
          if (x.missing) {
            lines.push(`  ${x.id}: не снят — см. ${path.join(out, 'visual.log')}`);
            continue;
          }
          lines.push(`  ${x.id}:`);
          lines.push(...(x.report ?? []).slice(0, 8).map((l) => `    ${l}`));
        }
        const failing = results.filter((x) => !x.pass).length;
        if (failing > 6) lines.push(`  … ещё ${failing - 6} — подробно в ${out}/<id>.json`);
        const styleOnly = results.filter((x) => x.pass && x.styleIssues?.length).length;
        if (styleOnly) lines.push(`  style-check: замечания в ${styleOnly} прошедших targets (в <id>.json)`);
      }
      // The results were already parsed above: skipped targets (no json) get the bare { id } row.
      const byId = new Map(results.map((x) => [x.id, x]));
      renderTargets(e, selected.map((id) => byId.get(id) ?? { id }));
    }
  }

  lines.push(ok ? `\n✓ ${e.name}: всё зелёное — craftui step {"action":"done","entity":"${e.name}","step":"verify"}` : `\nДиффы: ${out}/<id>.diff.png, полные логи: ${out}/*.log`);
  console.log(lines.join('\n'));
  appendHistory(e, `verify: ${lines.filter((l) => /^(units|typecheck|rstest|visual)/.test(l)).join('; ')}`);
  if (!ok) process.exitCode = 1;
}

function renderTargets(e: Entity, results: VisualResult[]) {
  const spec = readJson<Spec>(e.specFile);
  const rows = results.map((r) => {
    const t = spec?.targets?.find((x) => x.id === r.id);
    const status = r.pass === undefined ? '⏳' : r.pass ? '✅' : '❌';
    const diff = typeof r.diffRatio === 'number' ? `${(r.diffRatio * 100).toFixed(2)}%` : '—';
    return `| \`${r.id}\` | ${t?.title ?? ''} | ${t?.figmaNodeId ?? ''} | ${status} | ${diff} |`;
  });
  replaceSection(e.logFile, 'targets', ['| id | вариант | node | статус | diff |', '|---|---|---|---|---|', ...rows].join('\n'));
}

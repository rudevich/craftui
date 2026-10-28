// Code that the agent runs inside the Figma page (Chrome mode), and `put` for the no-receiver fallback.
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakpointsForSnippet, config, fail, findEntity, parseFigmaUrl, readJson, safeCraftlogPath } from './lib.ts';
import { sourcesOf } from './sources.ts';
import type { Entity, SnippetParams, SourceFile, Spec } from './types.ts';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snippets');
const STEPS = ['probe', 'extract', 'export'];
// Pages have snippets of their own (breakpoint frames, pictures); the layer serializer is shared (snippets/lib/core.ts).
const fileOf = (kind: string, step: string) => path.join(DIR, kind === 'page' && step !== 'probe' ? `${step}-page.ts` : `${step}.ts`);

/** TypeScript → JavaScript for the page. Node prints a warning that the API is experimental: not the user's business. */
function stripTypes(code: string): string {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return stripTypeScriptTypes(code);
  } finally {
    process.emitWarning = emit;
  }
}

/**
 * A snippet and the snippets/lib modules it imports as one expression for the page: types stripped, imports and
 * exports dropped (each lib once, before what uses it), its default `run` called with the parameters.
 */
export function bundle(file: string, p: SnippetParams): string {
  const order: string[] = [];
  const visit = (f: string) => {
    if (order.includes(f)) return;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import \{[^}]*\} from '(\.[^']+)';$/gm)) visit(path.resolve(path.dirname(f), m[1]));
    order.push(f);
  };
  visit(file);
  const body = order.map((f) =>
    stripTypes(fs.readFileSync(f, 'utf8'))
      .replace(/^import\b[^;]*;$/gm, '')
      .replace(/^export default async function run\b/m, 'async function run')
      .replace(/^export (async function|function|const) /gm, '$1 '),
  );
  return `(async (CU) => {\n${body.join('\n')}\nreturn await run(CU);\n})(${JSON.stringify(p)})`;
}

function params(e: Entity, step: string): SnippetParams {
  const cfg = config();
  const source = readJson<SourceFile>(path.join(e.craftlog, 'figma', 'source.json')) ?? fail(`нет source.json у ${e.name}`);
  const p: SnippetParams = {
    kind: e.kind,
    name: e.name,
    nodeId: source.nodeId,
    fileKey: source.fileKey,
    craftlog: e.craftlog.split(path.sep).join('/'),
    receiver: `http://127.0.0.1:${cfg.receiverPort ?? 4601}`,
    scale: e.kind === 'page' ? cfg.pages.scale : cfg.scale,
    breakpoints: breakpointsForSnippet(cfg.pages.breakpoints),
  };
  if (e.kind === 'page') p.maxNodes = 15000; // a screen holds far more layers than a component
  if (step === 'extract') p.sources = sourcesOf(e).sources.map(({ nodeId, variant, filter }) => ({ nodeId, variant, filter }));
  if (step === 'export') {
    const spec = readJson<Spec>(e.specFile);
    if (!spec) fail(`нет ${e.specFile} — сначала npm run craftui -- normalize ${e.name}`);
    p.targets = spec.targets.map((t) => ({ id: t.id, nodeId: t.figmaNodeId }));
    p.assets = (spec.assets ?? []).map((a) => ({ nodeId: a.nodeId, file: a.file, format: a.format }));
  }
  return p;
}

export function renderSnippet(e: Entity, step: string): string {
  if (!STEPS.includes(step)) throw new Error(`snippet: ${STEPS.join('|')}`);
  const code = bundle(fileOf(e.kind, step), params(e, step));
  // Long runs may outlive the browser tool's timeout: the result is also kept in window.__craftui.
  return `((p) => { window.__craftui = { step: '${step}', status: 'running' }; p.then((result) => { window.__craftui = { step: '${step}', status: 'done', result }; }, (err) => { window.__craftui = { step: '${step}', status: 'error', error: String(err) }; }); return p; })(${code.trim()})`;
}

export function run([ref, step]: (string | undefined)[]) {
  // Reconnaissance happens before the entity exists: `snippet <figma-url> probe`.
  const figma = parseFigmaUrl(ref ?? '');
  if (figma) {
    if (step !== 'probe') fail('по ссылке доступен только probe; для extract/export сначала npm run craftui -- new …');
    const cfg = config();
    const p: SnippetParams = { nodeId: figma.nodeId, fileKey: figma.fileKey, receiver: `http://127.0.0.1:${cfg.receiverPort ?? 4601}`, breakpoints: breakpointsForSnippet(cfg.pages.breakpoints) };
    console.log('// Выполни в странице Figma (javascript_tool / evaluate_script), результат — JSON:');
    console.log(bundle(fileOf('component', 'probe'), p));
    return;
  }
  const e = findEntity(ref);
  if (!step || !STEPS.includes(step)) return fail(`snippet <Name> <${STEPS.join('|')}>`);
  const inline = process.argv.includes('--inline');
  if (step === 'probe' || inline) {
    console.log('// Выполни в странице Figma (javascript_tool / evaluate_script), результат — JSON:');
    console.log(renderSnippet(e, step));
    return;
  }
  const { receiver } = params(e, 'probe');
  const body = `const r = await fetch('${receiver}/snippet/${e.kind}/${e.name}/${step}.js'); if (!r.ok) throw new Error(await r.text()); return await (0, eval)(await r.text());`;
  console.log('// Выполни в странице Figma. Код загрузится с receiver, данные уйдут на диск, в ответ — короткая сводка.');
  console.log(`// javascript_tool (выражение):\n(async () => { ${body} })()`);
  console.log(`// evaluate_script (функция):\nasync () => { ${body} }`);
  console.log('// Таймаут вызова? Подожди и прочитай window.__craftui. fetch к 127.0.0.1 заблокирован — «Без receiver» в figma-chrome.md.');
}

export function put([ref, rel]: (string | undefined)[], base64: boolean) {
  const e = findEntity(ref);
  const target = safeCraftlogPath(path.posix.join(e.craftlog.split(path.sep).join('/'), rel ?? ''));
  if (!target) fail('путь должен быть внутри craftlog, например figma/raw/plugin.json');
  const chunks: Buffer[] = [];
  process.stdin.on('data', (c: Buffer) => chunks.push(c));
  process.stdin.on('end', () => {
    let body = Buffer.concat(chunks);
    if (base64) body = Buffer.from(body.toString('utf8').replace(/\s+/g, ''), 'base64');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    console.log(`✓ ${target} (${body.length} B)`);
  });
}

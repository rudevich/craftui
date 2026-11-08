// Code that the agent runs inside the Figma page (Chrome mode), and `put` for the no-receiver fallback.
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakpointsForSnippet, config, fail, findEntity, parseFigmaUrl, readJson, safeCraftlogPath } from './lib.ts';
import { sourcesOf } from './sources.ts';
import type { Entity, SnippetParams, SourceFile, Spec } from './types.ts';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snippets');
const STEPS = ['probe', 'probe-extract', 'extract', 'export'];
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
  // Named imports share one scope; a default import (`import probeRun from './probe.ts'`) renames the
  // imported file's `run` to the local name, so probe-extract can call probe and extract in one bundle.
  const order: { file: string; defaultAs?: string }[] = [];
  const visit = (f: string, defaultAs?: string) => {
    if (order.some((o) => o.file === f)) return;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^import \{[^}]*\} from '(\.[^']+)';$/gm)) visit(path.resolve(path.dirname(f), m[1]));
    for (const m of src.matchAll(/^import (\w+) from '(\.[^']+)';$/gm)) visit(path.resolve(path.dirname(f), m[2]), m[1]);
    order.push({ file: f, defaultAs });
  };
  visit(file);
  const body = order.map(({ file: f, defaultAs }) =>
    stripTypes(fs.readFileSync(f, 'utf8'))
      .replace(/^import\b[^;]*;$/gm, '')
      .replace(/^export default async function run\b/m, `async function ${defaultAs ?? 'run'}`)
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
  p.maxVariants = cfg.maxExtractVariants;
  if (step === 'extract' || step === 'probe-extract') p.sources = sourcesOf(e).sources.map(({ nodeId, variant, filter }) => ({ nodeId, variant, filter }));
  if (step === 'export') {
    const spec = readJson<Spec>(e.specFile);
    if (!spec) fail(`нет ${e.specFile} — сначала craftui spec {"action":"normalize","entity":"${e.name}"}`);
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

export function run([ref, step]: (string | undefined)[], { inline = false }: { inline?: boolean } = {}) {
  // Reconnaissance happens before the entity exists: `snippet <figma-url> probe`.
  const figma = parseFigmaUrl(ref ?? '');
  if (figma) {
    if (step !== 'probe') fail('по ссылке доступен только probe; для extract/export сначала создай сущность (инструмент create)');
    const cfg = config();
    const p: SnippetParams = { nodeId: figma.nodeId, fileKey: figma.fileKey, receiver: `http://127.0.0.1:${cfg.receiverPort ?? 4601}`, breakpoints: breakpointsForSnippet(cfg.pages.breakpoints) };
    console.log('// Выполни в странице Figma (javascript_tool / evaluate_script), результат — JSON:');
    console.log(bundle(fileOf('component', 'probe'), p));
    return;
  }
  const e = findEntity(ref);
  if (!step || !STEPS.includes(step)) return fail(`snippet: поле step — ${STEPS.join('|')}`);
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

/** The no-receiver fallback: the agent passes the file content as a tool argument. */
export function putFile(entity: string, rel: string | undefined, content: string, base64 = false): string {
  const e = findEntity(entity);
  const target = safeCraftlogPath(path.posix.join(e.craftlog.split(path.sep).join('/'), rel ?? ''));
  if (!target) fail('путь должен быть внутри craftlog, например figma/raw/plugin.json');
  let body = Buffer.from(content, 'utf8');
  if (base64) body = Buffer.from(body.toString('utf8').replace(/\s+/g, ''), 'base64');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  return `✓ ${target} (${body.length} B)`;
}

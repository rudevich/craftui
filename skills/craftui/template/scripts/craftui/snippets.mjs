// Code that the agent runs inside the Figma page (Chrome mode), and `put` for the no-receiver fallback.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, fail, findEntity, parseFigmaUrl, readJson, safeCraftlogPath } from './lib.mjs';
import { sourcesOf } from './sources.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snippets');
const STEPS = ['probe', 'extract', 'export'];

function params(e, step) {
  const cfg = config();
  const source = readJson(path.join(e.craftlog, 'figma', 'source.json'));
  const p = {
    kind: e.kind,
    name: e.name,
    nodeId: source.nodeId,
    fileKey: source.fileKey,
    craftlog: e.craftlog.split(path.sep).join('/'),
    receiver: `http://127.0.0.1:${cfg.receiverPort ?? 4601}`,
    scale: cfg.scale ?? 2,
  };
  if (step === 'extract') p.sources = sourcesOf(e).sources.map(({ nodeId, variant, filter }) => ({ nodeId, variant, filter }));
  if (step === 'export') {
    const spec = readJson(e.specFile);
    if (!spec) fail(`нет ${e.specFile} — сначала npm run craftui -- normalize ${e.name}`);
    p.targets = spec.targets.map((t) => ({ id: t.id, nodeId: t.figmaNodeId }));
    p.assets = (spec.assets ?? []).map((a) => ({ nodeId: a.nodeId, file: a.file }));
  }
  return p;
}

export function renderSnippet(e, step) {
  if (!STEPS.includes(step)) throw new Error(`snippet: ${STEPS.join('|')}`);
  const code = fs.readFileSync(path.join(DIR, `${step}.js`), 'utf8').replace('__CU__', JSON.stringify(params(e, step)));
  // Long runs may outlive the browser tool's timeout: the result is also kept in window.__craftui.
  return `((p) => { window.__craftui = { step: '${step}', status: 'running' }; p.then((result) => { window.__craftui = { step: '${step}', status: 'done', result }; }, (err) => { window.__craftui = { step: '${step}', status: 'error', error: String(err) }; }); return p; })(${code.trim()})`;
}

export function run([ref, step]) {
  // Reconnaissance happens before the entity exists: `snippet <figma-url> probe`.
  const figma = parseFigmaUrl(ref ?? '');
  if (figma) {
    if (step !== 'probe') fail('по ссылке доступен только probe; для extract/export сначала npm run craftui -- new …');
    const cfg = config();
    const p = { nodeId: figma.nodeId, fileKey: figma.fileKey, receiver: `http://127.0.0.1:${cfg.receiverPort ?? 4601}` };
    console.log('// Выполни в странице Figma (javascript_tool / evaluate_script), результат — JSON:');
    console.log(fs.readFileSync(path.join(DIR, 'probe.js'), 'utf8').replace('__CU__', JSON.stringify(p)));
    return;
  }
  const e = findEntity(ref);
  if (!STEPS.includes(step)) fail(`snippet <Name> <${STEPS.join('|')}>`);
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

export function put([ref, rel], base64) {
  const e = findEntity(ref);
  const target = safeCraftlogPath(path.posix.join(e.craftlog.split(path.sep).join('/'), rel ?? ''));
  if (!target) fail('путь должен быть внутри craftlog, например figma/raw/plugin.json');
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    let body = Buffer.concat(chunks);
    if (base64) body = Buffer.from(body.toString('utf8').replace(/\s+/g, ''), 'base64');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    console.log(`✓ ${target} (${body.length} B)`);
  });
}

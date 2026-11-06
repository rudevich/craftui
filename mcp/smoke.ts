// Stdio smoke of the MCP server on a fixture project: initialize → tools/list → tools/call → error paths.
// `node mcp/smoke.ts` (part of `npm run check`), exits 0 when everything answers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mcp = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'craftui-smoke-'));
fs.writeFileSync(path.join(fixture, 'craftui.config.json'), '{}\n');

const server = spawn(process.execPath, [path.join(mcp, 'server.ts')], { cwd: fixture, stdio: ['pipe', 'pipe', 'inherit'] });
const responses = new Map<number, any>();
let buf = '';
server.stdout.on('data', (d: Buffer) => {
  buf += d.toString();
  let i: number;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    } catch {}
  }
});
const send = (o: unknown) => server.stdin.write(`${JSON.stringify(o)}\n`);

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'status', arguments: {} } });
send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'figma-url', arguments: { url: 'https://example.com/not-figma' } } });
send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'no-such-tool', arguments: {} } });

const problems: string[] = [];
setTimeout(() => {
  const init = responses.get(1);
  if (init?.result?.serverInfo?.name !== 'craftui') problems.push(`initialize: ${JSON.stringify(init?.result ?? init?.error)}`);
  const tools: { name: string }[] = responses.get(2)?.result?.tools ?? [];
  const expected = ['status', 'next', 'step', 'log', 'config', 'figma-url', 'create', 'sources', 'extract', 'spec', 'digest', 'build', 'verify', 'hooks'];
  for (const name of expected) if (!tools.some((t) => t.name === name)) problems.push(`tools/list: нет инструмента ${name}`);
  if (tools.length !== expected.length) problems.push(`tools/list: ${tools.length} вместо ${expected.length}`);
  const status = responses.get(3);
  const text = status?.result?.content?.[0]?.text ?? '';
  if (!text.includes('Пока нет сущностей') && !text.includes('Всё импортировано')) problems.push(`status: ${JSON.stringify(text.slice(0, 200))}`);
  const bad = responses.get(4);
  if (!bad?.result?.isError) problems.push(`figma-url с чужой ссылкой должен быть ошибкой: ${JSON.stringify(bad?.result ?? bad?.error)}`);
  const unknown = responses.get(5);
  if (unknown?.error?.code !== -32602) problems.push(`неизвестный инструмент должен давать -32602: ${JSON.stringify(unknown?.error)}`);

  server.kill();
  fs.rmSync(fixture, { recursive: true, force: true });
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`✓ smoke: initialize, ${tools.length} инструментов, status, ошибки — в порядке`);
}, 3000);

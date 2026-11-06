#!/usr/bin/env node
// craftui MCP server: newline-delimited JSON-RPC 2.0 over stdio (Node 24, zero dependencies).
// Works on the project in cwd — that is where MCP clients launch it. `node mcp/server.ts`
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { TOOLS } from './tools.ts';

const VERSION = (JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error(`✗ craftui mcp: нужен Node.js 24 или новее, сейчас ${process.version}.`);
  process.exit(1);
}

const respond = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const respondError = (id: unknown, code: number, message: string) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);

function requireProject() {
  if (!fs.existsSync('craftui.config.json')) {
    throw new Error('в текущей папке нет craftui.config.json — это не проект craftui. Предложи пользователю создать его: node <skill>/scripts/init-project.ts, затем npm install.');
  }
}

type Message = { id?: unknown; method?: string; params?: { name?: string; arguments?: object; protocolVersion?: string } & Record<string, unknown> };

async function handle({ id, method, params }: Message) {
  if (!method || method.startsWith('notifications/')) return; // notifications get no response
  switch (method) {
    case 'initialize':
      return respond(id, {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'craftui', version: VERSION },
      });
    case 'ping':
      return respond(id, {});
    case 'tools/list':
      return respond(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return respondError(id, -32602, `неизвестный инструмент "${params?.name}"`);
      try {
        if (tool.project !== false) requireProject();
        const text = await tool.run(params?.arguments ?? {});
        respond(id, { content: [{ type: 'text', text }] });
      } catch (err) {
        respond(id, { content: [{ type: 'text', text: `✗ ${(err as Error).message ?? err}` }], isError: true });
      } finally {
        process.exitCode = undefined; // modules set it to signal CLI failures; the server must not inherit it
      }
      return;
    }
    default:
      return respondError(id, -32601, `метод "${method}" не поддерживается`);
  }
}

// Serial tool calls: the commands share project state (state.json, spec.json), like the CLI ran them one by one.
let queue: Promise<unknown> = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg: Message;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  queue = queue
    .then(() => handle(msg))
    .catch((err) => {
      console.error('craftui mcp:', err);
      if (msg.id !== undefined) respondError(msg.id, -32603, String((err as Error).message ?? err));
    });
});
console.error(`craftui mcp ${VERSION}: проект — ${process.cwd()}`);

// Local receiver for Chrome mode: the Figma page posts extracted JSON/PNG/SVG here,
// so heavy data goes straight to disk instead of through the model's context.
// It lives inside the MCP server process: the extract tool starts and stops it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { applyStep, appendHistory, config, findEntity, kindDirs, safeCraftlogPath, saveState } from './lib.ts';
import type { Kind } from './types.ts';
import { renderSnippet } from './snippets.ts';

const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*figma\.com$/;
const IDLE_MS = 30 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;

let server: http.Server | null = null;
let idle: NodeJS.Timeout | undefined;
let port = 0;

export function running() {
  return server !== null;
}

export async function start({ port: given }: { port?: number } = {}): Promise<string> {
  if (server) return `receiver уже работает: http://127.0.0.1:${port} — сначала stop`;
  port = given || config().receiverPort || 4601;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      console.error('receiver: 30 min idle, stopping');
      void stop();
    }, IDLE_MS);
  };
  touch();

  const created = http.createServer((req, res) => {
    touch();
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGIN.test(origin)) return send(res, 403, { error: `origin ${origin} not allowed` });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return send(res, 204);

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/ping') return send(res, 200, { ok: true, root: process.cwd() });

    const snippet = url.pathname.match(/^\/snippet\/([a-z]+)\/([A-Za-z0-9]+)\/(\w+)\.js$/);
    if (req.method === 'GET' && snippet) {
      try {
        const code = renderSnippet(findEntity(`${snippet[1]}/${snippet[2]}`), snippet[3]);
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        return res.end(code);
      } catch (err) {
        return send(res, 404, { error: String((err as Error).message ?? err) });
      }
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      const rel = safeCraftlogPath(url.searchParams.get('path'));
      if (!rel) return send(res, 400, { error: 'path must be inside src/<kind>/<Name>/craftlog/' });
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        let body = Buffer.concat(chunks);
        if (url.searchParams.get('base64')) body = Buffer.from(body.toString('utf8'), 'base64');
        fs.mkdirSync(path.dirname(rel), { recursive: true });
        fs.writeFileSync(rel, body);
        const done = url.searchParams.get('done');
        if (done) closeStep(rel, done);
        console.error(`saved ${rel} (${body.length} B)`); // stderr: stdout carries the MCP protocol
        send(res, 200, { ok: true, path: rel, bytes: body.length });
      });
      return;
    }
    send(res, 404, { error: 'not found' });
  });

  await new Promise<void>((resolve, reject) => {
    created.once('error', (err: NodeJS.ErrnoException) => {
      server = null;
      clearTimeout(idle);
      reject(err.code === 'EADDRINUSE' ? new Error(`receiver: порт ${port} занят — вероятно, уже работает (проверь http://127.0.0.1:${port}/ping)`) : err);
    });
    created.listen(port, '127.0.0.1', () => resolve());
  });
  server = created;
  return `receiver: http://127.0.0.1:${port} (остановится после 30 мин бездействия; сниппеты из страницы Figma пишут файлы сюда)`;
}

/** The snippet's last save carries done=<step>: the receiver closes it itself (extract/screenshots), so the agent skips step done.
 *  Unknown entity or step only logs — the agent closes it manually as before. */
function closeStep(rel: string, stepId: string) {
  try {
    const dirs = kindDirs();
    const kind = (Object.keys(dirs) as Kind[]).find((k) => rel.startsWith(`${dirs[k]}/`));
    if (!kind) return;
    const name = rel.slice(dirs[kind].length + 1).split('/')[0];
    const e = findEntity(`${kind}/${name}`);
    const s = e.state;
    const step = s.steps.find((x) => x.id === stepId);
    if (!step || step.status === 'done' || step.status === 'skipped') return;
    applyStep(s, stepId, 'done');
    saveState(e, s);
    appendHistory(e, `шаг ${stepId} выполнен (receiver)`);
    console.error(`receiver: шаг ${stepId} закрыт (${e.name})`);
  } catch (err) {
    console.error(`receiver: не закрыл шаг ${stepId} — ${String((err as Error)?.message ?? err)}`);
  }
}

export async function stop(): Promise<string> {
  const created = server;
  server = null;
  clearTimeout(idle);
  if (!created) return 'receiver не запущен.';
  await new Promise<void>((resolve) => created.close(() => resolve()));
  return `receiver остановлен (порт ${port}).`;
}

function send(res: http.ServerResponse, status: number, json?: unknown) {
  if (json === undefined) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(json));
}

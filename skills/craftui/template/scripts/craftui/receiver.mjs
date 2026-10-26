// Local receiver for Chrome mode: the Figma page posts extracted JSON/PNG/SVG here,
// so heavy data goes straight to disk instead of through the model's context.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { config, findEntity, safeCraftlogPath } from './lib.mjs';
import { renderSnippet } from './snippets.mjs';

const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*figma\.com$/;
const IDLE_MS = 30 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;

export function run(args) {
  const i = args.indexOf('--port');
  const port = Number(i !== -1 ? args[i + 1] : config().receiverPort) || 4601;
  let idle;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      console.log('receiver: 30 min idle, stopping');
      process.exit(0);
    }, IDLE_MS);
  };
  touch();

  const server = http.createServer((req, res) => {
    touch();
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGIN.test(origin)) return send(res, 403, { error: `origin ${origin} not allowed` });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return send(res, 204);

    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/ping') return send(res, 200, { ok: true, root: process.cwd() });

    const snippet = url.pathname.match(/^\/snippet\/([a-z]+)\/([A-Za-z0-9]+)\/(\w+)\.js$/);
    if (req.method === 'GET' && snippet) {
      try {
        const code = renderSnippet(findEntity(`${snippet[1]}/${snippet[2]}`), snippet[3]);
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        return res.end(code);
      } catch (err) {
        return send(res, 404, { error: String(err.message ?? err) });
      }
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      const rel = safeCraftlogPath(url.searchParams.get('path'));
      if (!rel) return send(res, 400, { error: 'path must be inside src/<kind>/<Name>/craftlog/' });
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        let body = Buffer.concat(chunks);
        if (url.searchParams.get('base64')) body = Buffer.from(body.toString('utf8'), 'base64');
        fs.mkdirSync(path.dirname(rel), { recursive: true });
        fs.writeFileSync(rel, body);
        console.log(`saved ${rel} (${body.length} B)`);
        send(res, 200, { ok: true, path: rel, bytes: body.length });
      });
      return;
    }
    send(res, 404, { error: 'not found' });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.log(`receiver: port ${port} is busy — probably already running (check http://127.0.0.1:${port}/ping)`);
    else console.error(err);
    process.exit(err.code === 'EADDRINUSE' ? 0 : 1);
  });
  server.listen(port, '127.0.0.1', () => console.log(`receiver: http://127.0.0.1:${port} (stops after 30 min idle)`));
}

function send(res, status, json) {
  if (json === undefined) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(json));
}

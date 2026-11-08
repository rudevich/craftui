// Talks to a running Chrome over the DevTools protocol (CDP) and executes craftui snippets
// in the Figma tab — the deterministic replacement of the agent's evaluate_script call.
// Node 24, zero dependencies (global WebSocket). The user starts Chrome with
// --remote-debugging-port=9222 and opens the Figma file: the login stays with the user.

const POLL_MS = 500;
const DEFAULT_TIMEOUT = 5 * 60_000;

const CDP_HINT = 'нет Chrome с debugging-портом — запусти его так и открой вкладку с файлом Figma:\n  open -a "Google Chrome" --args --remote-debugging-port=9222';

type CdpTarget = { id: string; type: string; url: string; title: string; webSocketDebuggerUrl?: string };

/** Lists the open tabs of the Chrome debugging port. */
export async function listTargets(cdp: string): Promise<CdpTarget[]> {
  const res = await fetch(`http://127.0.0.1:${cdp}/json/list`).catch(() => null);
  if (!res?.ok) throw new Error(`CDP http://127.0.0.1:${cdp} не отвечает: ${CDP_HINT}`);
  return (await res.json()) as CdpTarget[];
}

/** The Figma tab to run snippets in: an editor tab of the file, or any figma.com tab. */
export function findFigmaTarget(targets: CdpTarget[], fileKey?: string): CdpTarget {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url.includes('figma.com'));
  if (!pages.length) {
    const open = targets.filter((t) => t.type === 'page').map((t) => `  ${t.title} — ${t.url.slice(0, 60)}`).join('\n');
    throw new Error(`среди вкладок Chrome нет figma.com:\n${open || '  (вкладок нет)'}\n${CDP_HINT}`);
  }
  if (fileKey) {
    const hit = pages.find((t) => t.url.includes(fileKey));
    if (hit) return hit;
  }
  const editor = pages.find((t) => /figma\.com\/(design|file)\//.test(t.url));
  return editor ?? pages[0];
}

type Msg = { id?: number; result?: { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }; error?: { message: string } };

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`CDP websocket не открылся: ${url} — ${CDP_HINT}`));
  });
}

function evaluate(ws: WebSocket, expression: string, requestId = 1): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as Msg;
      if (msg.id !== requestId) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) return reject(new Error(`CDP: ${msg.error.message}`));
      const details = msg.result?.exceptionDetails;
      if (details) return reject(new Error(`сниппет упал: ${details.exception?.description ?? details.text}`));
      resolve(msg.result?.result?.value);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
}

/** Runs a bundled snippet (renderSnippet output) in the Figma tab: starts it, polls window.__craftui
 *  until done/error — long runs outlive the evaluate call, the wrapper keeps the result on the page. */
export async function runSnippet(cdp: string, code: string, { fileKey, timeoutMs = DEFAULT_TIMEOUT }: { fileKey?: string; timeoutMs?: number } = {}): Promise<unknown> {
  const targets = await listTargets(cdp);
  const target = findFigmaTarget(targets, fileKey);
  const ws = await connect(target.webSocketDebuggerUrl!);
  try {
    await evaluate(ws, `(() => { try { void (${code}); return 'ok'; } catch (err) { return 'sync error: ' + err; } })()`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const raw = (await evaluate(ws, 'JSON.stringify(window.__craftui ?? null)', 2)) as string;
      const state = raw ? (JSON.parse(raw) as { status?: string; result?: unknown; error?: string }) : null;
      if (state?.status === 'done') return state.result;
      if (state?.status === 'error') throw new Error(String(state.error));
    }
    throw new Error(`сниппет не закончил за ${Math.round(timeoutMs / 60000)} мин — проверь вкладку Figma (window.__craftui)`);
  } finally {
    ws.close();
  }
}

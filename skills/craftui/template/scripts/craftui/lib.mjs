// Shared helpers for the craftui CLI: entities, state.json, craftui.log.md.
import fs from 'node:fs';
import path from 'node:path';

// Kind → folder. v2 adds `page: 'src/pages'`.
export const KIND_DIRS = { component: 'src/components' };
export const KIND_ALIASES = { components: 'component', page: 'page', pages: 'page' };

export const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
export const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};
export const config = () => readJson('craftui.config.json', {});
export const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

/**
 * Where the Figma data comes from: chrome (Chrome MCP: Claude in Chrome, chrome-devtools-mcp) or figma (Figma MCP).
 * The first value given wins, chrome by default; "mcp" is the old name of figma. Unknown → undefined.
 */
export function resolveSource(...values) {
  const value = values.find((v) => typeof v === 'string' && v.trim()) ?? 'chrome';
  const source = value.trim().toLowerCase() === 'mcp' ? 'figma' : value.trim().toLowerCase();
  return ['chrome', 'figma'].includes(source) ? source : undefined;
}

export function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

export function parseFigmaUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const i = parts.findIndex((p) => ['design', 'file', 'proto', 'board', 'make'].includes(p));
  if (i === -1 || !parts[i + 1]) return null;
  let fileKey = parts[i + 1];
  // Branch links: /design/<fileKey>/branch/<branchKey>/<name> — the API works with the branch key.
  if (parts[i + 2] === 'branch' && parts[i + 3]) fileKey = parts[i + 3];
  const rawNode = u.searchParams.get('node-id');
  const nodeId = rawNode ? decodeURIComponent(rawNode).replace(/-/g, ':') : null;
  return { fileKey, nodeId, url };
}

export const slug = (s) =>
  translit(String(s))
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** TS/JS literal with single quotes and bare keys: { tone: 'neutral', children: 'Badge' }. */
export function tsLiteral(v) {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (Array.isArray(v)) return `[${v.map(tsLiteral).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : tsLiteral(k)}: ${tsLiteral(x)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

export const camel = (s) => slug(s).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
export const pascal = (s) => camel(s).replace(/^./, (c) => c.toUpperCase());

const RU = 'а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:h ц:ts ч:ch ш:sh щ:sch ъ: ы:y ь: э:e ю:yu я:ya';
const RU_MAP = Object.fromEntries(RU.split(' ').map((p) => p.split(':')));
function translit(s) {
  return s.replace(/[а-яё]/gi, (ch) => {
    const lower = ch.toLowerCase();
    const t = RU_MAP[lower] ?? '';
    return ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1);
  });
}

const SAVE_PATH = /^src\/[a-z]+\/[A-Za-z0-9]+\/craftlog\/[\w./-]+$/;

/** Normalized relative path if it points inside some src/<kind>/<Name>/craftlog/, else null. */
export function safeCraftlogPath(p) {
  const rel = path.posix.normalize(String(p ?? '').replace(/\\/g, '/'));
  if (rel.startsWith('/') || rel.split('/').includes('..') || !SAVE_PATH.test(rel)) return null;
  return rel;
}

// ── entities ──────────────────────────────────────────────────────────────────

export function entityDir(kind, name) {
  const dir = KIND_DIRS[kind];
  if (!dir) fail(`unknown kind "${kind}" (known: ${Object.keys(KIND_DIRS).join(', ')})`);
  return path.join(dir, name);
}

export function listEntities() {
  const out = [];
  for (const [kind, dir] of Object.entries(KIND_DIRS)) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const stateFile = path.join(dir, name, 'craftlog', 'state.json');
      if (fs.existsSync(stateFile)) out.push(entity(kind, name));
    }
  }
  return out;
}

function entity(kind, name) {
  const dir = entityDir(kind, name);
  const craftlog = path.join(dir, 'craftlog');
  return {
    kind,
    name,
    dir,
    craftlog,
    stateFile: path.join(craftlog, 'state.json'),
    logFile: path.join(craftlog, 'craftui.log.md'),
    specFile: path.join(craftlog, 'figma', 'spec.json'),
    get state() {
      return readJson(this.stateFile);
    },
  };
}

/** Finds an entity by "Name" or "kind/Name". */
export function findEntity(ref) {
  if (!ref) fail('entity name is required');
  const [a, b] = ref.split('/');
  const kind = b ? (KIND_ALIASES[a] ?? a) : null;
  const name = b ?? a;
  const found = listEntities().filter((e) => e.name === name && (!kind || e.kind === kind));
  if (!found.length) fail(`entity "${ref}" not found — create it with: npm run craftui -- new component ${name} <figma-url>`);
  if (found.length > 1) fail(`"${name}" is ambiguous, use kind/Name: ${found.map((e) => `${e.kind}/${e.name}`).join(', ')}`);
  return found[0];
}

export function newEntity(kind, name) {
  return entity(kind, name);
}

// ── state ─────────────────────────────────────────────────────────────────────

export function saveState(e, state) {
  state.updatedAt = new Date().toISOString();
  const steps = state.steps;
  if (steps.every((s) => s.status === 'done' || s.status === 'skipped')) state.status = 'done';
  else if (steps.some((s) => s.status === 'failed')) state.status = 'failed';
  else if (openBlockers(state).length) state.status = 'blocked'; // nested entities not done yet
  else state.status = 'in-progress';
  writeJson(e.stateFile, state);
  renderLogSections(e, state);
}

export function getStep(state, id) {
  const step = state.steps.find((s) => s.id === id);
  if (!step) fail(`unknown step "${id}" (steps: ${state.steps.map((s) => s.id).join(', ')})`);
  return step;
}

/** Entities this one waits for that are not done yet. */
export function openBlockers(state) {
  const done = new Set(listEntities().filter((x) => x.state.status === 'done').map((x) => x.name));
  return (state.blockedBy ?? []).filter((n) => !done.has(n));
}

// ── log ───────────────────────────────────────────────────────────────────────

const ICON = { pending: '⏳', 'in-progress': '🔄', done: '✅', failed: '❌', skipped: '➖' };

export function appendHistory(e, line) {
  fs.appendFileSync(e.logFile, `- ${now()} — ${line}\n`);
}

export function replaceSection(file, marker, body) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const start = `<!-- craftui:${marker} -->`;
  const end = `<!-- /craftui:${marker} -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1) return;
  fs.writeFileSync(file, `${text.slice(0, i + start.length)}\n${body}\n${text.slice(j)}`);
}

export function renderLogSections(e, state) {
  const steps = state.steps
    .map((s) => {
      const extra = [s.attempts > 1 ? `попыток: ${s.attempts}` : '', s.lastError ? `ошибка: ${s.lastError}` : '']
        .filter(Boolean)
        .join(', ');
      return `- ${ICON[s.status] ?? '?'} \`${s.id}\` ${s.title}${extra ? ` (${extra})` : ''}`;
    })
    .join('\n');
  const head = [`Статус: **${state.status}**`];
  const waiting = openBlockers(state);
  if (waiting.length) head.push(`ждёт: ${waiting.join(', ')}`);
  if (state.awaitingUser) head.push(`ждёт ответа пользователя: ${state.awaitingUser}`);
  replaceSection(e.logFile, 'steps', `${head.join(' · ')}\n\n${steps}`);
}

// Units rule for component code: sizes only in px or %. Viewport units (vw, vh, dvh, svh, lvh…) only for
// screen-bound overlays (modal, popup, drawer) and with a reason comment in the same rule: /* units: модальное окно … */
import fs from 'node:fs';
import path from 'node:path';
import { findEntity, listEntities } from './lib.mjs';

const NUMBER_UNIT = /(?<![\w#.-])(-?(?:\d+\.?\d*|\.\d+))([a-z]+)\b/gi;
const FORBIDDEN = new Set(['em', 'rem', 'ch', 'ex', 'cap', 'ic', 'lh', 'rlh', 'pt', 'pc', 'cm', 'mm', 'in', 'q']);
const VIEWPORT = new Set(['vw', 'vh', 'vmin', 'vmax', 'vi', 'vb', 'dvh', 'dvw', 'svh', 'svw', 'lvh', 'lvw', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax']);
const REASON = /units\s*:/i;

const lineAt = (text, i) => text.slice(0, i).split('\n').length;

/** Problems in one stylesheet or inline-style source: [{ line, unit, value, kind: 'forbidden' | 'viewport', justified }] */
export function scanCss(text) {
  const found = [];
  const clean = text.replace(/url\([^)]*\)/g, (m) => ' '.repeat(m.length)); // keep offsets for line numbers
  // Each innermost { … } block is one rule; a reason comment anywhere in it justifies viewport units there.
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    const body = block[1];
    const justified = REASON.test(body);
    const declarations = body.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
    for (const m of declarations.matchAll(NUMBER_UNIT)) {
      const unit = m[2].toLowerCase();
      const kind = FORBIDDEN.has(unit) ? 'forbidden' : VIEWPORT.has(unit) ? 'viewport' : null;
      if (kind) found.push({ line: lineAt(text, block.index + 1 + m.index), unit, value: m[0], kind, justified });
    }
  }
  // Media and container query conditions are outside blocks.
  for (const q of clean.matchAll(/@(media|container)[^{]*/g)) {
    for (const m of q[0].matchAll(NUMBER_UNIT)) {
      const unit = m[2].toLowerCase();
      if (FORBIDDEN.has(unit)) found.push({ line: lineAt(text, q.index + m.index), unit, value: m[0], kind: 'forbidden', justified: false });
    }
  }
  return found;
}

/** Inline styles in TSX: style={{ … }} objects with string values like '1rem'. */
export function scanTsx(text) {
  const found = [];
  for (const s of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    for (const v of s[1].matchAll(/['"`]([^'"`]*)['"`]/g)) {
      for (const m of v[1].matchAll(NUMBER_UNIT)) {
        const unit = m[2].toLowerCase();
        const kind = FORBIDDEN.has(unit) ? 'forbidden' : VIEWPORT.has(unit) ? 'viewport' : null;
        if (kind) found.push({ line: lineAt(text, s.index + 9 + v.index), unit, value: m[0], kind, justified: false });
      }
    }
  }
  return found;
}

/** Component sources of an entity: everything but craftlog/ and demo files. */
export function checkEntity(e) {
  const issues = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name !== 'craftlog') walk(file);
        continue;
      }
      if (/\.demo\.tsx$/.test(d.name)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const found = d.name.endsWith('.css') ? scanCss(text) : /\.tsx?$/.test(d.name) ? scanTsx(text) : [];
      for (const f of found) issues.push({ ...f, file: path.relative(process.cwd(), file) });
    }
  };
  walk(e.dir);
  return {
    errors: issues.filter((i) => i.kind === 'forbidden' || !i.justified),
    justified: issues.filter((i) => i.kind === 'viewport' && i.justified),
  };
}

export function describe({ errors, justified }) {
  const lines = errors.map(
    (i) => `  ${i.file}:${i.line} ${i.value} — ${i.kind === 'forbidden' ? `${i.unit} запрещён, только px или %` : `${i.unit} только для оверлеев, нужен комментарий /* units: … */ в правиле`}`,
  );
  for (const i of justified) lines.push(`  ${i.file}:${i.line} ${i.value} — разрешено комментарием units:`);
  return lines;
}

export function run(ref) {
  let failed = false;
  for (const e of ref ? [findEntity(ref)] : listEntities()) {
    const result = checkEntity(e);
    failed ||= result.errors.length > 0;
    console.log(`${result.errors.length ? '✗' : '✓'} ${e.name}: единицы ${result.errors.length ? `— нарушений ${result.errors.length}` : 'px/%'}`);
    for (const l of describe(result)) console.log(l);
  }
  if (failed) process.exitCode = 1;
}

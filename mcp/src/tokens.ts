// Merges tokens from spec.json into src/tokens.css: adds missing ones, never overwrites existing values.
import fs from 'node:fs';
import { appendHistory, fail, findEntity, readJson, slug } from './lib.ts';
import type { Spec } from './types.ts';

const FILE = 'src/tokens.css';

/** Merges the spec tokens into src/tokens.css. Returns the number of real value conflicts — they are decided with the user, not silently. */
export function run(ref: string | undefined): number {
  const e = findEntity(ref);
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — craftui spec {"action":"normalize","entity":"${e.name}"}`);
  let css = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : ':root {\n}\n';
  const added = [];
  const conflicts = [];
  let existing = 0;
  const near = []; // a copy of the library with a slightly different value: the one in tokens.css stays

  for (const t of spec.tokens) {
    for (const [mode, value] of Object.entries(t.values)) {
      // Modes: "theme=dark" → [data-theme="dark"]; a bare mode name (older specs, MCP) → [data-theme="<mode>"].
      const [axis, modeValue] = mode.includes('=') ? mode.split('=') : ['theme', slug(mode)];
      const selector = mode === t.defaultMode ? ':root' : `[data-${axis}="${modeValue}"]`;
      const block = findBlock(css, selector);
      const current = block && new RegExp(`(^|[\\s;{])${escape(t.name)}\\s*:\\s*([^;]+);`).exec(block.body);
      if (current) {
        const was = current[2].trim();
        if (was === value) existing++;
        else if (sameColor(was, value)) near.push(`${t.name} (${selector}): ${was} ≈ ${value}`);
        else conflicts.push(`${t.name} (${selector}): в tokens.css ${was}, в Figma ${value}`);
        continue;
      }
      const line = `  ${t.name}: ${value};${t.figma ? ` /* ${t.figma} */` : ''}\n`;
      if (block) css = css.slice(0, block.end) + line + css.slice(block.end);
      else css += `\n${selector} {\n${line}}\n`;
      added.push(`${t.name}${selector === ':root' ? '' : ` ${selector}`}`);
    }
  }
  fs.writeFileSync(FILE, css);
  appendHistory(e, `tokens.css: +${added.length}, уже были ${existing}${near.length ? `, почти равных ${near.length} (${near.join('; ')})` : ''}, конфликтов ${conflicts.length}`);
  console.log(`tokens.css: добавлено ${added.length}, уже были ${existing}, конфликтов ${conflicts.length}`);
  for (const a of added.slice(0, 30)) console.log(`  + ${a}`);
  if (added.length > 30) console.log(`  … ещё ${added.length - 30}`);
  for (const n of near) console.log(`  ≈ ${n} — разница не видна глазу (копия библиотеки), оставлено значение tokens.css`);
  for (const c of conflicts) console.log(`  ! ${c} — реши с пользователем, какое значение верное`);
  return conflicts.length;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Position right before the closing brace of `selector { … }` (top-level blocks only).
function findBlock(css: string, selector: string): { body: string; end: number } | null {
  const re = new RegExp(`(^|\\n)\\s*${escape(selector)}\\s*\\{`, 'g');
  const m = re.exec(css);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = css.indexOf('}', start);
  return { body: css.slice(start, end), end };
}

// #rrggbb / rgba(r, g, b, a) → [r, g, b, a·255]
function rgba(v: string): number[] | null {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(v);
  if (hex) return [...hex.slice(1).map((x) => parseInt(x, 16)), 255];
  const fn = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(v);
  return fn ? [+fn[1], +fn[2], +fn[3], (fn[4] === undefined ? 1 : +fn[4]) * 255] : null;
}

// Within 4 of 255 per channel: below what a screenshot comparison or an eye can tell.
export function sameColor(a: string, b: string): boolean {
  const [x, y] = [rgba(a), rgba(b)];
  return Boolean(x && y) && x!.every((c, i) => Math.abs(c - y![i]) <= 4);
}

#!/usr/bin/env node
// Creates (or updates) a craftui project from ../template:
//   node init-project.ts [dir] [--name <package>] [--merge] [--update]
// --merge  add craftui to a folder that already has a foreign package.json
// --update refresh tool files (scripts/, tests/, demo/, configs, skill docs) of an existing craftui project
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The tool scripts are TypeScript that Node runs as it is: Node 24 (type stripping without flags).
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error(`✗ Нужен Node.js 24 или новее, сейчас ${process.version}.`);
  process.exit(1);
}

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateDir = path.join(skillDir, 'template');
const args = process.argv.slice(2);
const opt = (name: string): string | true | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const target = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--name') ?? '.');
const update = Boolean(opt('update'));
const merge = Boolean(opt('merge')) || update;

if (fs.existsSync(path.join(target, '.claude-plugin', 'plugin.json')) && fs.existsSync(path.join(target, 'skills', 'craftui'))) {
  console.error('✗ Это репозиторий самого скилла craftui. Запусти импорт в папке проекта (например, отдельной папке библиотеки).');
  process.exit(1);
}

const pkgFile = path.join(target, 'package.json');
const existingPkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : null;
const isCraftuiProject = fs.existsSync(path.join(target, 'craftui.config.json'));
if (existingPkg && !isCraftuiProject && !merge) {
  console.error(`✗ В ${target} уже есть package.json другого проекта.`);
  console.error('  Спроси пользователя: создать библиотеку в подпапке (node init-project.ts <подпапка>) или добавить в этот проект (--merge).');
  process.exit(3);
}

const TOOL_FILES = [
  'rspack.lib.config.mjs', 'rspack.demo.config.mjs', 'rstest.config.ts', 'rstest.setup.ts', 'playwright.config.ts',
  'tsconfig.json', 'tsconfig.build.json', 'tsconfig.scripts.json', 'src/global.d.ts', 'src/lib/cx.ts',
];
// The tool scripts moved to the global MCP server: --update removes them from projects that still have them.
const REMOVED = ['scripts/craftui', 'tsconfig.snippets.json'];
const USER_FILES = new Set(['demo/fonts.ts']);
const toolOwned = (rel: string) => !USER_FILES.has(rel) && (TOOL_FILES.includes(rel) || /^(scripts|tests|demo)\//.test(rel));

const created: string[] = [];
const notes: string[] = [];
const updated: string[] = [];
const kept: string[] = [];

function* walk(dir: string, base = ''): Generator<string> {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === '~' || d.name === '.DS_Store') continue; // a literal "~" is a stray $HOME copy made by a sandboxed shell
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) yield* walk(path.join(dir, d.name), rel);
    else yield rel;
  }
}

function write(rel: string, content: string) {
  const file = path.join(target, rel);
  const exists = fs.existsSync(file);
  if (exists && fs.readFileSync(file, 'utf8') === content) return kept.push(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  (exists ? updated : created).push(rel);
}

fs.mkdirSync(target, { recursive: true });
const name = (typeof opt('name') === 'string' && opt('name')) || existingPkg?.name || path.basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, '-');

for (const rel of walk(templateDir)) {
  const src = path.join(templateDir, rel);
  const dest = rel === 'gitignore' ? '.gitignore' : rel;
  const destFile = path.join(target, dest);
  const exists = fs.existsSync(destFile);
  const content = fs.readFileSync(src, 'utf8');

  if (dest === 'package.json') {
    const tpl = JSON.parse(content.replace('__PACKAGE_NAME__', name));
    if (!existingPkg) write(dest, `${JSON.stringify(tpl, null, 2)}\n`);
    else {
      const pkg = { ...existingPkg };
      pkg.type ??= tpl.type;
      pkg.sideEffects ??= tpl.sideEffects;
      pkg.files ??= tpl.files;
      pkg.exports ??= tpl.exports;
      pkg.scripts = { ...pkg.scripts, ...tpl.scripts };
      delete pkg.scripts.craftui; // the tool moved to the global MCP server
      pkg.peerDependencies = { ...pkg.peerDependencies, ...tpl.peerDependencies };
      pkg.devDependencies = { ...pkg.devDependencies, ...tpl.devDependencies };
      write(dest, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  } else if (dest === 'craftui.config.json') {
    const tpl = JSON.parse(content);
    const cur = exists ? JSON.parse(fs.readFileSync(destFile, 'utf8')) : {};
    // Nested blocks merge key by key: a new setting reaches old projects, the user's values stay.
    const mergedCfg = {
      ...tpl,
      ...cur,
      dirs: { ...tpl.dirs, ...cur.dirs },
      pages: { ...tpl.pages, ...cur.pages },
      autopilot: { ...tpl.autopilot, ...cur.autopilot, commands: { ...tpl.autopilot.commands, ...cur.autopilot?.commands } },
    };
    if (!exists || JSON.stringify(mergedCfg) !== JSON.stringify(cur)) write(dest, `${JSON.stringify(mergedCfg, null, 2)}\n`);
    else kept.push(dest);
  } else if (dest === '.claude/settings.json') {
    // The tool owns only its deny rules (spec.json and raw Figma data are too big for a model to read); the rest is the user's.
    const tpl = JSON.parse(content);
    const cur = exists ? JSON.parse(fs.readFileSync(destFile, 'utf8')) : {};
    const deny = [...new Set([...(cur.permissions?.deny ?? []), ...tpl.permissions.deny])];
    const mergedSettings = { ...cur, permissions: { ...cur.permissions, deny } };
    if (!exists || JSON.stringify(mergedSettings) !== JSON.stringify(cur)) write(dest, `${JSON.stringify(mergedSettings, null, 2)}\n`);
    else kept.push(dest);
  } else if (dest === 'demo/fonts.ts' && exists) {
    // Fonts now come from "demoFonts" of the settings. An untouched old stub is replaced, a file edited by hand is kept.
    const cur = fs.readFileSync(destFile, 'utf8');
    if (cur === content) kept.push(dest);
    else if (/^\/\/ Fonts used by the Figma designs[^\n]*\n\/\/ e\.g\.[^\n]*\nexport \{\};\s*$/.test(cur)) write(dest, content);
    else {
      kept.push(dest);
      notes.push('demo/fonts.ts изменён вручную и оставлен как есть. Шрифты теперь задаются в craftui.config.json → demoFonts: перенеси туда ссылки и верни файл из шаблона.');
    }
  } else if (dest === 'AGENTS.md' && exists) {
    const cur = fs.readFileSync(destFile, 'utf8');
    if (cur.includes('<!-- craftui:start -->')) {
      const next = cur.replace(/<!-- craftui:start -->[\s\S]*<!-- craftui:end -->\n?/, content);
      if (next !== cur) write(dest, next);
      else kept.push(dest);
    } else write(dest, `${cur.trimEnd()}\n\n${content}`);
  } else if (dest === 'README.md') {
    // Commands section between markers is the tool's (refreshed on --update), the rest of the README is the user's.
    const tpl = content.replaceAll('__PACKAGE_NAME__', name);
    const block = tpl.slice(tpl.indexOf('<!-- craftui:start -->'));
    const cur = exists ? fs.readFileSync(destFile, 'utf8') : null;
    const next = cur === null
      ? tpl
      : cur.includes('<!-- craftui:start -->')
        ? cur.replace(/<!-- craftui:start -->[\s\S]*<!-- craftui:end -->\n?/, block)
        : `${cur.trimEnd()}\n\n${block}`;
    if (next !== cur) write(dest, next);
    else kept.push(dest);
  } else if (dest === 'CLAUDE.md' && exists) {
    const cur = fs.readFileSync(destFile, 'utf8');
    if (cur.includes('@AGENTS.md')) kept.push(dest);
    else write(dest, `${cur.trimEnd()}\n\n@AGENTS.md\n`);
  } else if (!exists || (update && toolOwned(dest))) {
    if (exists && fs.readFileSync(destFile, 'utf8') === content) kept.push(dest);
    else write(dest, content);
  } else kept.push(dest);
}

// The tool scripts moved to the global MCP server: an updated project should not keep the stale copies.
for (const rel of REMOVED) {
  const file = path.join(target, rel);
  if (fs.existsSync(file)) {
    fs.rmSync(file, { recursive: true, force: true });
    notes.push(`${rel} удалён: скрипты craftui теперь в глобальном MCP-сервере (обнови его: плагин или node install.ts --mcp).`);
  }
}
// Hooks written by the old CLI point at the deleted scripts/craftui/cli.ts: drop them, the server's hooks tool adds fresh ones.
for (const rel of ['.claude/settings.json', '.codex/hooks.json']) {
  const file = path.join(target, rel);
  if (!fs.existsSync(file)) continue;
  const settings = JSON.parse(fs.readFileSync(file, 'utf8')) as { hooks?: Record<string, { hooks?: { command?: string }[] }[]> };
  let changed = false;
  for (const groups of Object.values(settings.hooks ?? {})) {
    for (const g of groups) {
      const keep = (g.hooks ?? []).filter((h) => !String(h.command ?? '').includes('scripts/craftui/cli.ts'));
      if (keep.length !== (g.hooks?.length ?? 0)) {
        g.hooks = keep;
        changed = true;
      }
    }
  }
  if (changed) {
    write(rel, `${JSON.stringify(settings, null, 2)}\n`);
    notes.push(`${rel}: убраны хуки старого CLI — поставь новые, когда подключён сервер (инструмент hooks, action install).`);
  }
}

// The workflow travels with the project, so any agent can resume without the skill installed.
const docsDir = path.join(target, '.craftui', 'skill');
fs.rmSync(docsDir, { recursive: true, force: true });
fs.mkdirSync(docsDir, { recursive: true });
fs.copyFileSync(path.join(skillDir, 'SKILL.md'), path.join(docsDir, 'SKILL.md'));
fs.cpSync(path.join(skillDir, 'references'), path.join(docsDir, 'references'), { recursive: true, filter: (src) => !['~', '.DS_Store'].includes(path.basename(src)) });

console.log(`craftui ${update ? 'обновлён' : 'готов'} в ${target}`);
console.log(`  создано: ${created.length}, обновлено: ${updated.length}, без изменений: ${kept.length}`);
if (updated.length) console.log(`  обновлены: ${updated.join(', ')}`);
for (const note of notes) console.log(`  ⚠ ${note}`);
console.log('Дальше: npm install --no-audit --no-fund > .craftui/install.log 2>&1 && npx playwright install chromium');

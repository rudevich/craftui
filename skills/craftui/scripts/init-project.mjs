#!/usr/bin/env node
// Creates (or updates) a craftui project from ../template:
//   node init-project.mjs [dir] [--name <package>] [--merge] [--update]
// --merge  add craftui to a folder that already has a foreign package.json
// --update refresh tool files (scripts/, tests/, demo/, configs, skill docs) of an existing craftui project
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateDir = path.join(skillDir, 'template');
const args = process.argv.slice(2);
const opt = (name) => {
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
  console.error('  Спроси пользователя: создать библиотеку в подпапке (node init-project.mjs <подпапка>) или добавить в этот проект (--merge).');
  process.exit(3);
}

const TOOL_FILES = [
  'rspack.lib.config.mjs', 'rspack.demo.config.mjs', 'rstest.config.ts', 'rstest.setup.ts', 'playwright.config.ts',
  'tsconfig.json', 'tsconfig.build.json', 'src/global.d.ts', 'src/lib/cx.ts',
];
const USER_FILES = new Set(['demo/fonts.ts']);
const toolOwned = (rel) => !USER_FILES.has(rel) && (TOOL_FILES.includes(rel) || /^(scripts|tests|demo)\//.test(rel));

const created = [];
const updated = [];
const kept = [];

function* walk(dir, base = '') {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === '~' || d.name === '.DS_Store') continue; // a literal "~" is a stray $HOME copy made by a sandboxed shell
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) yield* walk(path.join(dir, d.name), rel);
    else yield rel;
  }
}

function write(rel, content) {
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
      pkg.peerDependencies = { ...pkg.peerDependencies, ...tpl.peerDependencies };
      pkg.devDependencies = { ...pkg.devDependencies, ...tpl.devDependencies };
      write(dest, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  } else if (dest === 'craftui.config.json') {
    const tpl = JSON.parse(content);
    const cur = exists ? JSON.parse(fs.readFileSync(destFile, 'utf8')) : {};
    const mergedCfg = { ...tpl, ...cur, autopilot: { ...tpl.autopilot, ...cur.autopilot, commands: { ...tpl.autopilot.commands, ...cur.autopilot?.commands } } };
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

// The workflow travels with the project, so any agent can resume without the skill installed.
const docsDir = path.join(target, '.craftui', 'skill');
fs.rmSync(docsDir, { recursive: true, force: true });
fs.mkdirSync(docsDir, { recursive: true });
fs.copyFileSync(path.join(skillDir, 'SKILL.md'), path.join(docsDir, 'SKILL.md'));
fs.cpSync(path.join(skillDir, 'references'), path.join(docsDir, 'references'), { recursive: true, filter: (src) => !['~', '.DS_Store'].includes(path.basename(src)) });

console.log(`craftui ${update ? 'обновлён' : 'готов'} в ${target}`);
console.log(`  создано: ${created.length}, обновлено: ${updated.length}, без изменений: ${kept.length}`);
if (updated.length) console.log(`  обновлены: ${updated.join(', ')}`);
console.log('Дальше: npm install --no-audit --no-fund > .craftui/install.log 2>&1 && npx playwright install chromium');

#!/usr/bin/env node
// Checks the skill's own code (run it after every change to the scripts): `npm run check` in the repository, Node 24.
// Deploys the template into .craftui-check/ (git ignores it), installs its dependencies once, then tsc for the tool
// scripts, the snippets and these skill scripts, and the script tests.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(skillDir, '..', '..');
const work = path.join(repo, '.craftui-check');

const run = (cmd: string, args: string[], cwd = work) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

run('node', [path.join(skillDir, 'scripts', 'init-project.ts'), work, ...(fs.existsSync(work) ? ['--update'] : [])], repo);
if (!fs.existsSync(path.join(work, 'node_modules'))) run('npm', ['install', '--no-audit', '--no-fund']);
const skillScripts = { extends: './tsconfig.scripts.json', include: [path.join(skillDir, 'scripts', '*.ts'), path.join(repo, 'install.ts')], exclude: [] };
fs.writeFileSync(path.join(work, 'tsconfig.skill.json'), `${JSON.stringify(skillScripts, null, 2)}\n`);
for (const config of ['tsconfig.scripts.json', 'tsconfig.snippets.json', 'tsconfig.skill.json']) run('npx', ['tsc', '-p', config]);
run('npx', ['rstest', 'run', 'scripts']);
console.log('✓ craftui: типы и тесты скриптов в порядке');

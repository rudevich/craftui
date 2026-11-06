#!/usr/bin/env node
// Checks the repository (run after every change): `npm run check` in the root, Node 24.
// Types of the MCP server (mcp/) and the skill scripts, the template sandbox, module tests and a stdio smoke run of the server.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mcp = path.join(repo, 'mcp');
const skillDir = path.join(repo, 'skills', 'craftui');
const work = path.join(repo, '.craftui-check');

const run = (cmd: string, args: string[], cwd: string) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

// 1. MCP server: dev deps only for types and tests, the runtime itself has no dependencies.
if (!fs.existsSync(path.join(mcp, 'node_modules'))) run('npm', ['install', '--no-audit', '--no-fund'], mcp);
run('npx', ['tsc', '-p', 'tsconfig.json'], mcp);
run('npx', ['tsc', '-p', 'tsconfig.snippets.json'], mcp);

// 2. Skill scripts and install.ts: tsc of the template sandbox (its node_modules has typescript and @types/node).
run('node', [path.join(skillDir, 'scripts', 'init-project.ts'), work, ...(fs.existsSync(work) ? ['--update'] : [])], repo);
if (!fs.existsSync(path.join(work, 'node_modules'))) run('npm', ['install', '--no-audit', '--no-fund'], work);
const skillScripts = { extends: './tsconfig.scripts.json', include: [path.join(skillDir, 'scripts', '*.ts'), path.join(repo, 'install.ts')], exclude: [] };
fs.writeFileSync(path.join(work, 'tsconfig.skill.json'), `${JSON.stringify(skillScripts, null, 2)}\n`);
run('npx', ['tsc', '-p', 'tsconfig.scripts.json'], work); // template scripts (gen.ts)
run('npx', ['tsc', '-p', 'tsconfig.skill.json'], work);

// 3. Tests of the mcp modules and the stdio smoke of the server on a fixture project.
run('npx', ['rstest', 'run', 'src'], mcp);
run(process.execPath, [path.join(mcp, 'smoke.ts')], repo);
console.log('✓ craftui: типы, тесты и smoke MCP-сервера в порядке');

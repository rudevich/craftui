#!/usr/bin/env node
// Checks the repository (run after every change): `npm run check` in the root, Node 24.
// Types of the MCP server (mcp/) and the skill scripts, the template sandbox, module tests and a stdio smoke run of the server.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
// Skipped when nothing they see changed: sandbox resync and the two tsc runs are the slowest idle steps of check.
const inputHash = (() => {
  const h = createHash('sha256');
  const walk = (p: string) => {
    if (fs.statSync(p).isDirectory()) for (const d of fs.readdirSync(p).sort()) walk(path.join(p, d));
    else h.update(`${path.relative(repo, p)}\u0000`).update(fs.readFileSync(p));
  };
  walk(path.join(skillDir, 'template'));
  walk(path.join(skillDir, 'scripts'));
  walk(path.join(repo, 'install.ts'));
  return h.digest('hex');
})();
const hashFile = path.join(work, '.template-hash');
const sandboxReady = fs.existsSync(hashFile) && fs.readFileSync(hashFile, 'utf8') === inputHash && fs.existsSync(path.join(work, 'node_modules'));
if (sandboxReady) console.log('sandbox: шаблон и скилл-скрипты не менялись — resync и tsc песочницы пропущены');
else {
  run('node', [path.join(skillDir, 'scripts', 'init-project.ts'), work, ...(fs.existsSync(work) ? ['--update'] : [])], repo);
  if (!fs.existsSync(path.join(work, 'node_modules'))) run('npm', ['install', '--no-audit', '--no-fund'], work);
  const skillScripts = { extends: './tsconfig.scripts.json', include: [path.join(skillDir, 'scripts', '*.ts'), path.join(repo, 'install.ts')], exclude: [] };
  const skillCfg = `${JSON.stringify(skillScripts, null, 2)}\n`;
  const cfgFile = path.join(work, 'tsconfig.skill.json');
  if (!fs.existsSync(cfgFile) || fs.readFileSync(cfgFile, 'utf8') !== skillCfg) fs.writeFileSync(cfgFile, skillCfg);
  run('npx', ['tsc', '-p', 'tsconfig.scripts.json'], work); // template scripts (gen.ts)
  run('npx', ['tsc', '-p', 'tsconfig.skill.json'], work);
  fs.writeFileSync(hashFile, inputHash);
}

// 3. Tests of the mcp modules and the stdio smoke of the server on a fixture project.
run('npx', ['rstest', 'run', 'src'], mcp);
run(process.execPath, [path.join(mcp, 'smoke.ts')], repo);
console.log('✓ craftui: типы, тесты и smoke MCP-сервера в порядке');

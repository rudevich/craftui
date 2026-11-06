#!/usr/bin/env node
// Installs the craftui skill for local agents: node install.ts [--copy] [--claude] [--codex] [--target <skills-dir>] [--mcp] (Node 24+)
// --mcp also registers the craftui MCP server for the chosen agents (the scripts are global now, not deployed into projects).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(repo, 'skills', 'craftui');
const args = process.argv.slice(2);
const copy = args.includes('--copy');
const withMcp = args.includes('--mcp');
const targets: string[] = [];
if (args.includes('--claude')) targets.push(path.join(os.homedir(), '.claude', 'skills'));
if (args.includes('--codex')) targets.push(path.join(os.homedir(), '.codex', 'skills'));
const t = args.indexOf('--target');
if (t !== -1 && args[t + 1]) targets.push(path.resolve(args[t + 1]));
if (!targets.length) {
  for (const agent of ['.claude', '.codex']) {
    if (fs.existsSync(path.join(os.homedir(), agent))) targets.push(path.join(os.homedir(), agent, 'skills'));
  }
}
if (!targets.length) {
  console.error('No agent folders found. Use --claude, --codex or --target <skills-dir>.');
  process.exit(1);
}

for (const dir of targets) {
  const dest = path.join(dir, 'craftui');
  fs.mkdirSync(dir, { recursive: true });
  const stat = fs.lstatSync(dest, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) fs.unlinkSync(dest);
  else if (stat) {
    console.error(`skip ${dest}: already exists and is not a symlink (remove it to reinstall)`);
    continue;
  }
  if (copy) fs.cpSync(skillDir, dest, { recursive: true, filter: (src) => !['~', '.DS_Store'].includes(path.basename(src)) });
  else fs.symlinkSync(skillDir, dest, 'dir');
  console.log(`${copy ? 'copied' : 'linked'} ${dest} -> ${skillDir}`);
}

if (!withMcp) {
  console.log('MCP-сервер craftui не зарегистрирован: добавь флаг --mcp (или используй плагин — он подключает сервер сам).');
} else {
  const server = path.join(repo, 'mcp', 'server.ts');
  const wantsClaude = args.includes('--claude') || targets.includes(path.join(os.homedir(), '.claude', 'skills'));
  const wantsCodex = args.includes('--codex') || targets.includes(path.join(os.homedir(), '.codex', 'skills'));
  if (wantsClaude) {
    const r = spawnSync('claude', ['mcp', 'add', '-s', 'user', 'craftui', '--', 'node', server], { stdio: 'inherit' });
    if (r.error || r.status !== 0) console.error(`✗ claude mcp add не сработал: добавь вручную — claude mcp add -s user craftui -- node ${server}`);
  }
  if (wantsCodex) {
    registerCodex(server);
  }
}

/** Codex: a marked block in ~/.codex/config.toml, idempotent on re-install. */
function registerCodex(server: string) {
  const file = path.join(os.homedir(), '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const START = '# <!-- craftui:mcp -->';
  const END = '# <!-- /craftui:mcp -->';
  const block = `${START}\n[mcp_servers.craftui]\ncommand = "node"\nargs = ["${server}"]\n${END}`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const replaced = current.includes(START)
    ? current.replace(new RegExp(`${START.replace(/[/*]/g, '\\$&')}[\\s\\S]*?${END.replace(/[/*]/g, '\\$&')}`), block)
    : `${current.trimEnd()}${current.trimEnd() ? '\n\n' : ''}${block}\n`;
  fs.writeFileSync(file, replaced);
  console.log(`✓ MCP-сервер craftui в ${file}`);
}

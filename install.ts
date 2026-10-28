#!/usr/bin/env node
// Installs the craftui skill for local agents: node install.ts [--copy] [--claude] [--codex] [--target <skills-dir>] (Node 24+)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills', 'craftui');
const args = process.argv.slice(2);
const copy = args.includes('--copy');
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

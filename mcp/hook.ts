#!/usr/bin/env node
// Entry for the client's project hooks (Node 24): `node <mcp>/hook.ts stop|session`.
// stop — the Stop hook: {"decision":"block"} while there is unfinished work; session — SessionStart
// after compaction: the current step's card goes back into the fresh context.
import { projectCard } from './api.ts';
import { hookStop } from './src/hooks.ts';

const [cmd] = process.argv.slice(2);
if (cmd === 'stop') await hookStop();
else if (cmd === 'session') {
  const card = await projectCard();
  if (card) console.log(card);
}

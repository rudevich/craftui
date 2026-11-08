#!/usr/bin/env node
// Headless import (Node 24): `node <repo>/mcp/auto.ts --url <figma> --name <Name>` in the consumer project.
// No LLM: snippets run in the user's Chrome tab over CDP, the code step is left to the agent or the human.
import { auto } from './src/auto.ts';

try {
  console.log(await auto(process.argv.slice(2)));
} catch (err) {
  console.error(`✗ ${(err as Error)?.message ?? err}`);
  process.exit(1);
}

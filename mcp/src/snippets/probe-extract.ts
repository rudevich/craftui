// Runs in the Figma page (Chrome mode): probe (reconnaissance) + extract in one go — saves an agent round-trip.
import type { SnippetParams } from '../types.ts';
import { errorText } from './lib/plugin.ts';
import probeRun from './probe.ts';
import extractRun from './extract.ts';

export default async function run(CU: SnippetParams) {
  const probe = await probeRun(CU);
  const out: any = { probe };
  if (probe.pluginApi && probe.receiver === true && probe.node) {
    try {
      out.extract = await extractRun(CU);
    } catch (err) {
      out.extractError = errorText(err);
    }
  } else {
    out.hint = !probe.pluginApi ? 'Plugin API (figma) недоступен — см. figma-chrome.md' : 'receiver недоступен — craftui extract {"action":"receiver"}';
  }
  return out;
}
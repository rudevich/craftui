// Shared by every snippet that runs in the Figma page; snippets.ts puts it in place of the import.
import type { SnippetParams } from '../../types.ts';

/** The Plugin API: Figma creates it lazily on first access to window.figma, so poll for it. */
export async function figmaApi(): Promise<PluginAPI | undefined> {
  for (let i = 0; i < 50; i++) {
    const f = (window as unknown as { figma?: PluginAPI }).figma;
    if (f && typeof f.getNodeByIdAsync === 'function') return f;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

export async function requireFigma(): Promise<PluginAPI> {
  const figma = await figmaApi();
  if (!figma) throw new Error('Plugin API (figma) недоступен на этой странице — см. figma-chrome.md');
  return figma;
}

/** Saves a file under craftlog/figma/ through the receiver: heavy data goes to disk, not through the model.
 *  `done` on the last save is the step id: the receiver closes it, so the agent skips step done. */
export const saver = (CU: SnippetParams) => async (file: string, body: string | Uint8Array, done?: string) => {
  const res = await fetch(`${CU.receiver}/save?path=${encodeURIComponent(`${CU.craftlog}/figma/${file}`)}${done ? `&done=${done}` : ''}`, { method: 'POST', body: body as BodyInit });
  if (!res.ok) throw new Error(`receiver: ${res.status} ${await res.text()}`);
};

export const errorText = (err: unknown) => String((err as Error)?.message ?? err);

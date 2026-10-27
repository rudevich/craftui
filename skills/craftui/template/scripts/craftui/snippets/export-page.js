(async () => {
  const CU = __CU__;
  // Figma creates the Plugin API lazily on first access to window.figma, so poll for it.
  const figma = await (async () => {
    for (let i = 0; i < 50; i++) {
      const f = window.figma;
      if (f && typeof f.getNodeByIdAsync === 'function') return f;
      await new Promise((r) => setTimeout(r, 200));
    }
    return undefined;
  })();
  if (typeof figma === 'undefined') throw new Error('Plugin API (figma) недоступен на этой странице — см. figma-chrome.md');
  const save = async (file, bytes) => {
    const res = await fetch(`${CU.receiver}/save?path=${encodeURIComponent(`${CU.craftlog}/figma/${file}`)}`, { method: 'POST', body: bytes });
    if (!res.ok) throw new Error(`receiver: ${res.status} ${await res.text()}`);
  };
  const done = [];
  const failed = [];
  // One reference per breakpoint frame, at the page scale (pages.scale): a full screen at 2x would be huge.
  for (const t of CU.targets) {
    try {
      const node = await figma.getNodeByIdAsync(t.nodeId);
      if (!node) throw new Error('not found');
      await save(`screenshots/${t.id}.png`, await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: CU.scale }, useAbsoluteBounds: true }));
      done.push(t.id);
    } catch (err) {
      failed.push(`${t.id}: ${err.message ?? err}`);
    }
  }
  await save('screenshots/bounds.json', '{}');
  // Pictures as PNG at 2x (sharp on dense screens), vector graphics as SVG.
  for (const a of CU.assets) {
    try {
      const node = await figma.getNodeByIdAsync(a.nodeId);
      if (!node) throw new Error('not found');
      const bytes = a.format === 'png'
        ? await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })
        : await node.exportAsync({ format: 'SVG_STRING', svgOutlineText: true, svgIdAttribute: false });
      await save(a.file, bytes);
      done.push(a.file);
    } catch (err) {
      failed.push(`${a.file}: ${err.message ?? err}`);
    }
  }
  return { saved: done.length, failed };
})()

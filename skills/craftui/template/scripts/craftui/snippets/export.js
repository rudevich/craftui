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
  const bounds = {};
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const t of CU.targets) {
    try {
      const node = await figma.getNodeByIdAsync(t.nodeId);
      if (!node) throw new Error('not found');
      // Usually the node box, same as the element box Playwright captures. A layer drawn outside it (a dropdown under
      // the field, a shadow) is part of the state: then the render area, and its offset from the node goes to bounds.json.
      const box = node.absoluteBoundingBox;
      const drawn = node.absoluteRenderBounds;
      const outside = box && drawn && (drawn.x < box.x - 0.5 || drawn.y < box.y - 0.5 || drawn.x + drawn.width > box.x + box.width + 0.5 || drawn.y + drawn.height > box.y + box.height + 0.5);
      const png = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: CU.scale }, useAbsoluteBounds: !outside });
      if (outside) bounds[t.id] = { x: r2(drawn.x - box.x), y: r2(drawn.y - box.y), w: r2(drawn.width), h: r2(drawn.height) };
      await save(`screenshots/${t.id}.png`, png);
      done.push(t.id);
    } catch (err) {
      failed.push(`${t.id}: ${err.message ?? err}`);
    }
  }
  await save('screenshots/bounds.json', JSON.stringify(bounds, null, 2));
  for (const a of CU.assets) {
    try {
      const node = await figma.getNodeByIdAsync(a.nodeId);
      if (!node) throw new Error('not found');
      const svg = await node.exportAsync({ format: 'SVG_STRING', svgOutlineText: true, svgIdAttribute: false });
      await save(a.file, svg);
      done.push(a.file);
    } catch (err) {
      failed.push(`${a.file}: ${err.message ?? err}`);
    }
  }
  return { saved: done.length, failed, ...(Object.keys(bounds).length ? { outsideNode: Object.keys(bounds) } : {}) };
})()

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
  const out = { url: location.href, title: document.title };
  out.needsLogin =
    /\/(login|signup|sign_in)/.test(location.pathname) || Boolean(document.querySelector('input[type="password"]'));
  out.requestAccess = /request access|запросить доступ/i.test(document.body?.innerText?.slice(0, 5000) ?? '');
  out.pluginApi = Boolean(figma);
  if (out.pluginApi && CU.nodeId) {
    out.editorType = figma.editorType;
    out.fileKey = figma.fileKey;
    try {
      const node = await figma.getNodeByIdAsync(CU.nodeId);
      if (node?.type === 'PAGE') await node.loadAsync(); // pages load lazily in big files
      if (node) {
        // Enough for the import plan: what the node is, its variants and nested components.
        out.node = { id: node.id, name: node.name, type: node.type, width: node.width, height: node.height };
        if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') {
          try {
            out.node.properties = Object.fromEntries(
              Object.entries(node.componentPropertyDefinitions).map(([k, d]) => [k.replace(/#[\d:]+$/, ''), d.type === 'VARIANT' ? d.variantOptions : d.type]),
            );
          } catch {}
        }
        if (node.type === 'COMPONENT_SET') out.node.variants = node.children.length;
        if (node.type === 'PAGE') out.node.hint = 'ссылка на страницу: выбери компонент из components и запусти probe по его id';
        if (node.type === 'INSTANCE') out.node.main = (await node.getMainComponentAsync())?.name;
        if ('findAll' in node) {
          if (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE') {
            out.node.components = node
              .findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })
              .filter((n) => n.type === 'COMPONENT_SET' || n.parent?.type !== 'COMPONENT_SET')
              .slice(0, 100)
              .map((n) => ({ id: n.id, name: n.name, type: n.type, variants: n.type === 'COMPONENT_SET' ? n.children.length : undefined }));
          }
          const nested = new Map();
          for (const i of node.findAll((n) => n.type === 'INSTANCE').slice(0, 300)) {
            if (i.parent && i.parent.type === 'INSTANCE') continue;
            const main = await i.getMainComponentAsync();
            const set = main?.parent?.type === 'COMPONENT_SET' ? main.parent : null;
            const name = set?.name ?? main?.name;
            if (name) nested.set(name, { name, remote: Boolean(main.remote), count: (nested.get(name)?.count ?? 0) + 1 });
          }
          out.node.nested = [...nested.values()];
        }
      } else out.node = null;
    } catch (err) {
      out.nodeError = String(err);
    }
  }
  try {
    out.receiver = (await fetch(`${CU.receiver}/ping`)).ok;
  } catch (err) {
    out.receiver = `blocked: ${err.message}`;
  }
  return out;
})()

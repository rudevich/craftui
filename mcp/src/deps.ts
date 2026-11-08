// Nested components: which instances are already imported entities, which must be imported first, which stay inline.
import path from 'node:path';
import { appendHistory, fail, findEntity, listEntities, readJson, writeJson } from './lib.ts';
import type { Entity, Instance, SourceFile, Spec } from './types.ts';

type Other = { entity: Entity; spec: Spec | undefined; source: SourceFile | undefined };

const readSpec = (e: Entity) => readJson<Spec>(e.specFile) ?? fail(`нет spec.json — craftui spec {"action":"normalize","entity":"${e.name}"}`);

function entityOf(i: Instance, others: Other[], spec: Spec): Other | undefined {
  return others.find(
    (o) =>
      (o.spec?.figma?.key && o.spec.figma.key === i.key) ||
      o.spec?.figma?.keys?.includes(i.key) ||
      (o.source?.nodeId && o.source.nodeId === i.mainId && o.source.fileKey === spec.figma.fileKey) ||
      // MCP gives no component keys, only names
      (i.key?.startsWith('mcp:') && o.spec?.figma?.nodeName === i.name),
  );
}

/** Lists nested instances and applies --inline/--same decisions. Returns the number of unresolved instances: 0 means the deps step can close. */
export async function run(ref: string | undefined, inline: string | true | undefined, { all = false, same = null as [string | true, string | undefined] | null } = {}): Promise<number> {
  const e = findEntity(ref);
  const others = listEntities()
    .filter((x) => x.name !== e.name)
    .map((x): Other => ({ entity: x, spec: readJson<Spec>(x.specFile), source: readJson<SourceFile>(path.join(x.craftlog, 'figma', 'source.json')) }));

  // --inline-all: library parts of this component (cells, checkboxes) are its internals. Inlining a part reveals the parts
  // inside it, so repeat with normalize until nothing new turns up. Imported entities stay entities.
  if (all) {
    for (let round = 0; round < 6; round++) {
      const spec = readSpec(e);
      const open = spec.instances.filter((i) => !i.resolution && !i.as && !entityOf(i, others, spec));
      if (!open.length) break;
      for (const i of open) i.resolution = 'inline';
      writeJson(e.specFile, spec);
      appendHistory(e, `вложенные inline: ${open.map((i) => i.name.trim()).join(', ')}`);
      const quiet = console.log;
      console.log = () => {};
      try {
        await (await import('./normalize.ts')).run(e.name, { keep: true });
      } finally {
        console.log = quiet;
      }
    }
  }

  const spec = readSpec(e);
  // --same "<instance>" <Entity>: a twin set in the kit (.Item/Select/M next to .Item/Select/Default/M) is that entity too.
  if (same) {
    const [given, target] = same;
    const name = String(given);
    const to = others.find((o) => o.entity.name === target) ?? fail(`нет сущности ${target} (есть: ${others.map((o) => o.entity.name).join(', ')})`);
    // Remembered by name: the instance may appear only after its parents are inlined (an item inside the dropdown).
    spec.twins = { ...spec.twins, [name.trim()]: to.entity.name };
    for (const i of spec.instances.filter((x) => x.name.trim() === name.trim())) i.as = to.entity.name;
    appendHistory(e, `вложенный ${name.trim()}: та же сущность, что ${to.entity.name}`);
  }
  if (typeof inline === 'string') {
    const hit = spec.instances.filter((i) => i.name === inline || i.name.trim() === inline.trim() || i.key === inline);
    if (!hit.length) fail(`нет вложенного "${inline}" (есть: ${spec.instances.map((i) => i.name).join(', ')})`);
    for (const i of hit) i.resolution = 'inline';
    appendHistory(e, `вложенный ${inline}: inline`);
  }

  const unresolved: Instance[] = [];
  for (const i of spec.instances) {
    if (i.resolution === 'inline' || i.resolution === 'content' || i.resolution === 'graphic') continue;
    const match = i.as ? others.find((o) => o.entity.name === i.as) : entityOf(i, others, spec);
    i.resolution = match ? `entity:${match.entity.kind}/${match.entity.name}` : null;
    if (!match) unresolved.push(i);
  }
  writeJson(e.specFile, spec);

  for (const i of spec.instances) {
    const where = i.resolution === 'inline'
      ? 'inline (иконка/декор внутри компонента)'
      : i.resolution === 'content'
        ? 'пример содержимого слота (передаёт потребитель)'
        : i.resolution === 'graphic'
        ? 'графика (логотип, иконка) — картинка в assets/'
        : i.resolution
        ? `импортирован → ${i.resolution.slice(7)}`
        : `НЕ импортирован${i.graphic ? ' (только векторы — похоже на иконку, можно --inline)' : ''}`;
    console.log(`- ${i.name} ×${i.nodeIds.length}: ${where}`);
  }
  if (!spec.instances.length) console.log('Вложенных компонентов нет.');

  if (!unresolved.length) {
    console.log('\n✓ все вложенные разрешены');
    return 0;
  }

  console.log(`\nИмпортируй их до продолжения, или пометь частью этого компонента: --inline "<имя>", все сразу — --inline-all:`);
  for (const i of unresolved) {
    // A library component is in this file too once it is used: its node opens by id like a local one.
    const url = i.mainId && spec.figma.fileKey ? `https://www.figma.com/design/${spec.figma.fileKey}/?node-id=${i.mainId.replace(/:/g, '-')}` : null;
    console.log(url
      ? `  craftui create {"kind":"component","name":"<Имя>","url":"${url}","parent":"${e.name}"}   # ${i.name}${i.remote ? ' (библиотека)' : ''}`
      : `  ${i.name}: нет id главного компонента — попроси у пользователя ссылку (ПКМ → Go to main component → Copy link)`);
  }
  process.exitCode = 2;
  return unresolved.length;
}

import { appendHistory, fail, findEntity, readJson, writeJson } from './lib.ts';
import type { Prop, SlotContent, Spec, SpecNode, SuggestedSlot, Target } from './types.ts';

// Which layers of a variant are slot content (an icon, a value the consumer passes in) and not part of the component.
// Their size and look belong to the content, so the component must not hard-code them.
const EMPTY = /^(none|false|no|off|empty|нет)$/i;

const index = (tree: SpecNode) => {
  const out = new Map<string, SpecNode>();
  const walk = (n: SpecNode) => {
    out.set(n.key, n);
    n.children?.forEach(walk);
  };
  walk(tree);
  return out;
};

// An asset, or a wrapper of the same size around exactly one slot root (a "Content" frame around the icon).
const sameSize = (a: SpecNode, b: SpecNode) => a.box && b.box && Math.abs(a.box.w - b.box.w) <= 0.5 && Math.abs(a.box.h - b.box.h) <= 0.5;
const isSlotRoot = (n: SpecNode): boolean => Boolean(n.asset) || (n.children?.length === 1 && Boolean(sameSize(n, n.children[0])) && isSlotRoot(n.children[0]));

const isText = (n: SpecNode): boolean => n.type === 'TEXT' || (Boolean(n.children?.length) && n.children!.every(isText));
// The icon's own name, not its "Content" frame: the innermost instance down a single-child chain.
const nameOf = (n: SpecNode): string | null => n.instance?.name ?? (n.children?.length === 1 ? nameOf(n.children[0]) : null);
const contentOf = (n: SpecNode): SlotContent => ({
  key: n.key,
  name: nameOf(n) ?? n.name,
  kind: n.asset ? 'graphic' : isText(n) ? 'text' : 'mixed',
  size: n.box ? { width: n.box.w, height: n.box.h } : undefined,
  asset: n.asset,
});

function mark(node: SpecNode, react: string) {
  node.slot = react;
  const strip = (n: SpecNode) => {
    delete n.expect; // not an element of the component: style-check must not compare it
    n.children?.forEach(strip);
  };
  strip(node);
}

/**
 * Marks slot content in spec.targets[].tree (`node.slot = '<prop>'`) and lists it in `target.slots`.
 * A variant with a slot axis set (ContentLeft=True, ContentRight=Icon; manual props named "Axis=Value")
 * is compared with the same variant where that axis is empty: layers only it has are the content.
 * Instance-swap props mark the instance that references them. Returns warnings for unresolved cases.
 */
export function markSlotContent(spec: Spec): string[] {
  const warnings: string[] = [];
  const axes = new Map(spec.props.filter((p) => p.type === 'VARIANT').map((p) => [p.figma, p]));
  const slotValues: { axis: string; value: string; react: string }[] = [];
  for (const p of spec.props) {
    if (p.type === 'VARIANT' && p.role === 'slot' && p.react) {
      for (const [value, mapped] of Object.entries(p.map ?? {})) if (mapped) slotValues.push({ axis: p.figma, value, react: p.react });
    }
    const manual = !p.key && p.react && p.figma?.match(/^(.+?)=(.+)$/);
    if (manual && axes.has(manual[1])) slotValues.push({ axis: manual[1], value: manual[2], react: p.react! });
  }

  const known = new Map<string, Set<string>>(); // react prop → keys found as its content anywhere
  const pending: { t: Target; sv: (typeof slotValues)[number]; empty?: string }[] = [];
  for (const t of spec.targets) {
    const nodes = index(t.tree);
    for (const sv of slotValues) {
      if (t.variant?.[sv.axis] !== sv.value) continue;
      const empty = axes.get(sv.axis)?.options?.find((o) => EMPTY.test(o));
      const sibling = empty && spec.targets.find((o) => o !== t && o.variant && Object.entries(t.variant!).every(([k, v]) => (k === sv.axis ? o.variant![k] === empty : o.variant![k] === v)));
      if (!sibling) {
        pending.push({ t, sv, empty });
        continue;
      }
      const theirs = index(sibling.tree);
      const only = [...nodes.keys()].filter((k) => !theirs.has(k));
      const top = only.filter((k) => !only.some((o) => o !== k && k.startsWith(`${o}/`)));
      for (const k of top) mark(nodes.get(k)!, sv.react);
      if (top.length) {
        (t.slots ??= {})[sv.react] = contentOf(nodes.get(top[0])!);
        known.set(sv.react, new Set([...(known.get(sv.react) ?? []), ...top]));
      }
    }
    // Content bound by hand (`craftui slot <Name> @key prop`): the layer is in every variant, no axis toggles it.
    for (const p of spec.props.filter((x): x is Prop & { content: string[]; react: string } => Boolean(x.content && x.react))) {
      const keys = ([] as string[]).concat(p.content).filter((k) => nodes.has(k));
      const key = keys.find((k) => isSlotRoot(nodes.get(k)!)) ?? keys[0];
      const n = key && nodes.get(key);
      if (!n) continue;
      mark(n, p.react);
      if (n.hidden) continue; // switched off in this variant (ContentLeft=false)
      (t.slots ??= {})[p.react] = contentOf(n);
      t.props ??= {};
      if (t.props[p.react] === undefined) t.props[p.react] = `$slot:${p.react}`;
    }
    for (const p of spec.props.filter((x): x is Prop & { react: string } => x.type === 'INSTANCE_SWAP' && Boolean(x.react))) {
      for (const n of nodes.values()) {
        if ((p.keys ?? [p.key]).includes(n.propRefs?.mainComponent)) {
          mark(n, p.react);
          (t.slots ??= {})[p.react] = contentOf(n);
        }
      }
    }
  }

  // No sibling variant extracted (filtered out): reuse the keys found for the same slot in other variants.
  for (const { t, sv, empty } of pending) {
    const nodes = index(t.tree);
    const keys = [...(known.get(sv.react) ?? [])].filter((k) => nodes.has(k));
    for (const k of keys) mark(nodes.get(k)!, sv.react);
    if (keys.length) (t.slots ??= {})[sv.react] = contentOf(nodes.get(keys[0])!);
    else warnings.push(`${t.id}: нет варианта ${sv.axis}=${empty ?? 'None'} для сравнения — содержимое слота ${sv.react} не найдено, добавь его в фильтр`);
  }
  return warnings;
}

/**
 * Icons present in every variant under the same key and not marked as slot content: probably what the consumer
 * passes in (an IconButton icon). Climbs to the outermost same-size wrapper (a "Content" frame around the icon).
 */
export function suggestSlots(spec: Spec): SuggestedSlot[] {
  if (!spec.targets.length) return [];
  const roots = spec.targets.map((t) => {
    const parents = new Map<string, string>();
    const nodes = index(t.tree);
    const walk = (n: SpecNode): void => n.children?.forEach((c) => (parents.set(c.key, n.key), walk(c)));
    walk(t.tree);
    const found = new Map<string, SpecNode>();
    for (const [key, n] of nodes) {
      if (!n.asset || n.slot || n.hidden) continue;
      let top = key;
      for (let p = parents.get(top); p && p !== 'root'; p = parents.get(p)) {
        const pn = nodes.get(p)!;
        if (pn.children?.length !== 1 || !sameSize(pn, nodes.get(top)!)) break;
        top = p;
      }
      found.set(top, nodes.get(top)!);
    }
    return found;
  });
  // An icon that changes with the state inside one set (chevron down when closed, up when opened) belongs to the component.
  const bySource = new Map<string, Set<string | undefined>>();
  roots.forEach((found, i) => found.forEach((n, key) => {
    const id = `${spec.targets[i].source ?? 0}|${key}`;
    bySource.set(id, new Set([...(bySource.get(id) ?? []), n.asset]));
  }));
  const stateful = new Set([...bySource].filter(([, assets]) => assets.size > 1).map(([id]) => id.split('|')[1]));
  roots.forEach((found) => stateful.forEach((key) => found.delete(key)));
  // Greedy: keys covering the most targets until every target is covered (a spinner only in loading targets is left out).
  const coverage = new Map<string, number[]>();
  roots.forEach((found, i) => found.forEach((n, key) => coverage.set(key, [...(coverage.get(key) ?? []), i])));
  const uncovered = new Set(roots.map((_, i) => i));
  const keys: string[] = [];
  for (const [key, ids] of [...coverage].sort((a, b) => b[1].length - a[1].length)) {
    if (!ids.some((i) => uncovered.has(i))) continue;
    keys.push(key);
    ids.forEach((i) => uncovered.delete(i));
    if (!uncovered.size) break;
  }
  if (uncovered.size || !keys.length) return [];
  const sample = roots[0].get(keys.find((k) => roots[0].has(k))!) ?? [...roots[0].values()][0];
  const names = [...new Set(roots.flatMap((found) => keys.filter((k) => found.has(k)).map((k) => found.get(k)!.instance?.name ?? found.get(k)!.name)))];
  return [{ keys, name: names.join(' / '), size: sample?.box ? { width: sample.box.w, height: sample.box.h } : undefined }];
}

/** "contentLeft — icon-24×24 24×24, icon-16×16 12×12 (xxs)" per slot prop, for the normalize summary. */
export function describeSlots(spec: Spec): string[] {
  const byProp = new Map<string, Map<string, string[]>>();
  for (const t of spec.targets) {
    for (const [prop, c] of Object.entries(t.slots ?? {})) {
      const label = `${c.name} ${c.size ? `${c.size.width}×${c.size.height}` : ''}`.trim();
      const set = byProp.get(prop) ?? new Map();
      set.set(label, [...(set.get(label) ?? []), t.id]);
      byProp.set(prop, set);
    }
  }
  const list = (ids: string[]) => (ids.length > 4 ? `${ids.slice(0, 3).join(', ')} и ещё ${ids.length - 3}` : ids.join(', '));
  return [...byProp].map(([prop, labels]) => `${prop} — ${[...labels].map(([l, ids]) => (labels.size > 1 ? `${l} (${list(ids)})` : l)).join('; ')}`);
}

/**
 * `craftui slot <Name> <@layer-key | Axis=Value> <prop>`: records that a layer (present in every variant) or an axis value
 * is the content of a React prop, then re-normalizes so markSlotContent applies it.
 */
export async function bindSlot(args: string[]) {
  const [ref, ...rest] = args;
  const react = rest.pop();
  const target = rest.join(' ');
  const e = findEntity(ref);
  if (!rest.length || !react) fail('slot <Name> <@ключ-слоя…|Ось=Значение> <prop>, например: slot IconButton @root/content @root/content/icon children');
  const spec = readJson<Spec>(e.specFile) ?? fail(`нет spec.json — npm run craftui -- normalize ${e.name}`);
  const upsert = (prop: Prop) => {
    const i = spec.props.findIndex((p) => !p.key && (p.figma === prop.figma || p.react === prop.react));
    if (i === -1) spec.props.push(prop);
    else spec.props[i] = prop;
  };
  if (target.startsWith('@')) {
    const keys = rest.map((k) => k.replace(/^@/, ''));
    for (const key of keys) if (!spec.targets.some((t) => index(t.tree).has(key))) fail(`слоя ${key} нет ни в одном target (ключи: npm run craftui -- normalize ${e.name} --summary)`);
    upsert({ figma: `@${react}`, key: null, type: 'SLOT', role: 'slot', react, reactType: 'ReactNode', content: keys, manual: true });
  } else {
    const [axis, value] = target.split('=');
    const axisProp = spec.props.find((p) => p.type === 'VARIANT' && p.figma === axis);
    if (!axisProp?.options?.includes(value)) return fail(`нет оси ${axis} со значением ${value}`);
    upsert({ figma: target, key: null, type: 'VARIANT', role: 'slot', react, reactType: 'ReactNode', manual: true });
    // This value now feeds another prop: the axis prop no longer maps it.
    if (axisProp.react !== react && axisProp.map?.[value] !== undefined) axisProp.map[value] = null;
  }
  writeJson(e.specFile, spec);
  appendHistory(e, `слот: ${target} → ${react}`);
  await (await import('./normalize.ts')).run(e.name, { keep: true });
}

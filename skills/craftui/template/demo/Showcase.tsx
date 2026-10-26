import type { ReactNode } from 'react';
import { controlsFor, defaultsOf } from './controls';
import type { Entity } from './registry';
import { Room } from './Room';

type Item = { label: string; props: Record<string, unknown>; pseudo?: string };

// Every property with all its values: each item is the defaults with exactly one prop changed.
function rowsOf(entity: Entity): { name: string; items: Item[] }[] {
  const rows: { name: string; items: Item[] }[] = [];
  for (const c of controlsFor(entity.props, entity.demo)) {
    if (c.kind === 'select') rows.push({ name: c.name, items: c.options.map((v) => ({ label: v, props: { [c.name]: v } })) });
    else if (c.kind === 'boolean') rows.push({ name: c.name, items: [false, true].map((v) => ({ label: String(v), props: { [c.name]: v } })) });
    else if (c.kind === 'slot' && Object.keys(c.presets).length) {
      const presets = Object.entries(c.presets).map(([label, node]: [string, ReactNode]) => ({ label, props: { [c.name]: node } }));
      rows.push({ name: c.name, items: [{ label: 'нет', props: { [c.name]: undefined } }, ...presets] });
    }
  }
  if (entity.pseudo.length) {
    rows.push({ name: 'состояния', items: [{ label: 'default', props: {} }, ...entity.pseudo.map((p) => ({ label: `:${p}`, props: {}, pseudo: p }))] });
  }
  return rows;
}

export function Showcase({ entity }: { entity: Entity }) {
  const { component: Component, background } = entity.demo;
  const base = defaultsOf(entity.demo);
  const rows = rowsOf(entity);
  if (!rows.length) return <p className="cu-muted">У компонента нет свойств с конечным набором значений.</p>;
  return (
    <div className="cu-showcase">
      {rows.map((row) => (
        <section key={row.name} className="cu-row">
          <code className="cu-row-name">{row.name}</code>
          <div className="cu-row-items" style={{ background }}>
            {row.items.map((item) => (
              <figure key={item.label} className="cu-item">
                <Room data-cu-pseudo={item.pseudo}>
                  <Component {...base} {...item.props} />
                </Room>
                <figcaption>{item.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

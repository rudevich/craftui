import { useEffect, useRef, useState } from 'react';
import config from '../craftui.config.json';
import type { DemoTarget } from './defineDemo';
import { Playground } from './Playground';
import { type Entity, craftlogUrl } from './registry';
import { Showcase } from './Showcase';

type Result = { pass: boolean; diffRatio: number; sizeMismatch?: string };

// `focus`: only on a page with one target (the screenshot test); on the showcase every card would take the focus away.
export function TargetFrame({ entity, target, focus = false }: { entity: Entity; target: DemoTarget<any>; focus?: boolean }) {
  const { component: Component } = entity.demo;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus && target.focus) ref.current?.querySelector<HTMLElement>(target.focus)?.focus();
  }, [focus, target.focus]);
  return (
    <div
      ref={ref}
      data-cu-target={target.id}
      data-cu-pseudo={target.pseudo?.join(' ') || undefined}
      style={{ display: 'inline-flex', verticalAlign: 'top', width: target.frame?.width, height: target.frame?.height }}
    >
      <Component {...target.props} />
    </div>
  );
}

function Reference({ entity, target }: { entity: Entity; target: DemoTarget<any> }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [missing, setMissing] = useState(false);
  if (missing) return <span className="cu-muted">нет эталона</span>;
  return (
    <img
      alt={`Figma: ${target.id}`}
      src={craftlogUrl(entity, `figma/screenshots/${target.id}.png`)}
      style={size ? { width: size.w / config.scale, height: size.h / config.scale } : { visibility: 'hidden' }}
      onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      onError={() => setMissing(true)}
    />
  );
}

function useResult(entity: Entity, id: string) {
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    fetch(craftlogUrl(entity, `visual/output/${id}.json`))
      .then((r) => (r.ok ? r.json() : null))
      .then(setResult, () => setResult(null));
  }, [entity, id]);
  return result;
}

// Area a reference covers outside the node (craftlog/figma/screenshots/bounds.json): room for an open dropdown or a shadow.
type Area = { x: number; y: number; w: number; h: number };

function useOutside(entity: Entity, id: string) {
  const [area, setArea] = useState<Area | null>(null);
  useEffect(() => {
    fetch(craftlogUrl(entity, 'figma/screenshots/bounds.json'))
      .then((r) => (r.ok ? r.json() : {}))
      .then((all: Record<string, Area>) => setArea(all[id] ?? null), () => setArea(null));
  }, [entity, id]);
  return area;
}

function TargetCard({ entity, target, showReference }: { entity: Entity; target: DemoTarget<any>; showReference: boolean }) {
  const result = useResult(entity, target.id);
  const outside = useOutside(entity, target.id);
  return (
    <figure className="cu-card">
      <figcaption>
        <strong>{target.title ?? target.id}</strong>
        <code>{target.id}</code>
        {result && (
          <span className={result.pass ? 'cu-pass' : 'cu-fail'}>
            {(result.diffRatio * 100).toFixed(2)}%{result.sizeMismatch ? ` · ${result.sizeMismatch}` : ''}
          </span>
        )}
      </figcaption>
      <div className="cu-compare" style={{ background: entity.demo.background }}>
        <div>
          <span className="cu-label">React</span>
          <div style={outside ? { minWidth: outside.w, minHeight: outside.h, paddingLeft: Math.max(0, -outside.x), paddingTop: Math.max(0, -outside.y) } : undefined}>
            <TargetFrame entity={entity} target={target} />
          </div>
        </div>
        {showReference && (
          <div>
            <span className="cu-label">Figma</span>
            <Reference entity={entity} target={target} />
          </div>
        )}
      </div>
      <details>
        <summary>props</summary>
        <pre>{JSON.stringify(target.props, (k, v) => (k === '$$typeof' || typeof v === 'function' ? undefined : v), 2)}</pre>
      </details>
    </figure>
  );
}

export function EntityPage({ entity, tab }: { entity: Entity; tab?: string }) {
  const base = `#/${entity.kind}/${entity.name}`;
  const playground = tab === 'playground';
  return (
    <article>
      <header className="cu-header">
        <h1>{entity.name}</h1>
        <nav className="cu-tabs" aria-label="Страницы компонента">
          <a href={base} aria-current={playground ? undefined : 'page'}>
            Свойства
          </a>
          <a href={`${base}/playground`} aria-current={playground ? 'page' : undefined}>
            Песочница
          </a>
        </nav>
        {entity.demo.figma && (
          <a href={entity.demo.figma.url} target="_blank" rel="noreferrer">
            Открыть в Figma
          </a>
        )}
      </header>
      {playground ? <Playground entity={entity} /> : <Overview entity={entity} />}
    </article>
  );
}

function Overview({ entity }: { entity: Entity }) {
  const [showReference, setShowReference] = useState(true);
  const { demo, props } = entity;
  return (
    <>
      <h2>Свойства</h2>
      <Showcase entity={entity} />

      <div className="cu-section-head">
        <h2>Состояния из Figma ({demo.targets.length})</h2>
        <label>
          <input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)} /> эталоны Figma
        </label>
      </div>
      <div className="cu-grid">
        {demo.targets.map((t) => (
          <TargetCard key={t.id} entity={entity} target={t} showReference={showReference} />
        ))}
      </div>

      <h2>API</h2>
      {props.length ? (
        <table className="cu-props">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Тип</th>
              <th>По умолчанию</th>
              <th>Описание</th>
            </tr>
          </thead>
          <tbody>
            {props.map((p) => (
              <tr key={p.name}>
                <td>
                  <code>{p.name}</code>
                  {p.required && <span className="cu-fail"> *</span>}
                </td>
                <td>
                  <code>{p.options ? p.options.map((o) => `'${o}'`).join(' | ') : p.type}</code>
                </td>
                <td>{p.defaultValue !== undefined && <code>{p.defaultValue}</code>}</td>
                <td>{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="cu-muted">Нет данных о свойствах — запустите `npm run gen`.</p>
      )}
    </>
  );
}

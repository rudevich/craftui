import { useEffect, useState } from 'react';
import { EntityPage, TargetFrame } from './EntityPage';
import { entities, KIND_TITLES } from './registry';

function parseHash() {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [kind, name, tab] = path.split('/');
  const params = new URLSearchParams(query);
  return { kind, name, tab, target: params.get('target'), isolated: params.has('isolated') };
}

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const entity = entities.find((e) => e.kind === route.kind && e.name === route.name);
  // A new page starts at the top; hash navigation would otherwise keep the previous scroll position.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.kind, route.name, route.tab]);

  // Screenshot tests open a single target on a transparent page.
  if (route.isolated) {
    const target = entity?.demo.targets.find((t) => t.id === route.target);
    document.documentElement.dataset.cuIsolated = '';
    if (!entity || !target) return <p data-cu-missing="">Target not found: {location.hash}</p>;
    return <TargetFrame entity={entity} target={target} focus />;
  }

  const kinds = [...new Set(entities.map((e) => e.kind))];
  return (
    <div className="cu-layout">
      <nav className="cu-sidebar">
        <a className="cu-logo" href="#/">craftui</a>
        {kinds.map((kind) => (
          <section key={kind}>
            <h2>{KIND_TITLES[kind] ?? kind}</h2>
            {entities
              .filter((e) => e.kind === kind)
              .map((e) => (
                <a key={e.name} href={`#/${e.kind}/${e.name}`} aria-current={e === entity ? 'page' : undefined}>
                  {e.name}
                </a>
              ))}
          </section>
        ))}
        {!entities.length && <p className="cu-muted">Пока ничего не импортировано.</p>}
      </nav>
      <main className="cu-main">
        {entity ? (
          <EntityPage key={`${entity.kind}/${entity.name}`} entity={entity} tab={route.tab} />
        ) : (
          <div className="cu-empty">
            <h1>Библиотека компонентов</h1>
            <p className="cu-muted">Выберите сущность слева. Импорт: попросите агента «craftui &lt;ссылка на Figma&gt;».</p>
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Fragment, isValidElement } from 'react';
import { type Control, controlsFor, defaultsOf, toJsx } from './controls';
import type { Entity } from './registry';

const NONE = '__none';
const TEXT = '__text';

// Which choice of a slot select matches the current value: none, a preset or custom text.
function slotChoice(control: Extract<Control, { kind: 'slot' }>, value: unknown): string {
  if (value === undefined || value === null) return NONE;
  const preset = Object.entries(control.presets).find(([, node]) => node === value);
  if (preset) return preset[0];
  // Элемент-по-умолчанию пересоздаётся при каждом рендере, identity-совпадения с пресетом нет:
  // показываем первый пресет как ближайший, а не текстовое поле с [object Object].
  if (isValidElement(value) && Object.keys(control.presets).length) return Object.keys(control.presets)[0];
  return TEXT;
}

function Field({ control, value, onChange }: { control: Control; value: unknown; onChange: (v: unknown) => void }) {
  const id = `cu-control-${control.name}`;
  const label = (
    <label htmlFor={id} title={control.prop.description}>
      <code>{control.name}</code>
    </label>
  );
  switch (control.kind) {
    case 'select':
      return (
        <div className="cu-field">
          {label}
          <select id={id} value={String(value ?? control.prop.defaultValue ?? '')} onChange={(e) => onChange(e.target.value)}>
            {control.prop.defaultValue === undefined && <option value="">—</option>}
            {control.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      );
    case 'boolean':
      return (
        <div className="cu-field">
          {label}
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        </div>
      );
    case 'number':
      return (
        <div className="cu-field">
          {label}
          <input id={id} type="number" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
        </div>
      );
    case 'text':
      return (
        <div className="cu-field">
          {label}
          <input id={id} type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case 'slot': {
      const choice = slotChoice(control, value);
      return (
        <div className="cu-field">
          {label}
          <div className="cu-slot">
            <select
              id={id}
              value={choice}
              onChange={(e) => {
                const v = e.target.value;
                onChange(v === NONE ? undefined : v === TEXT ? (typeof value === 'string' ? value : control.name) : control.presets[v]);
              }}
            >
              <option value={NONE}>нет</option>
              {Object.keys(control.presets).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value={TEXT}>текст…</option>
            </select>
            {choice === TEXT && <input aria-label={`${control.name}: текст`} type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />}
          </div>
        </div>
      );
    }
  }
}

export function Playground({ entity }: { entity: Entity }) {
  const { component: Component, background } = entity.demo;
  const controls = useMemo(() => controlsFor(entity.props, entity.demo), [entity]);
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultsOf(entity.demo));
  const [copied, setCopied] = useState(false);
  const code = toJsx(entity.name, values, entity.props);
  const set = (name: string) => (v: unknown) => setValues((cur) => ({ ...cur, [name]: v }));

  // Function props (onChange, onClick…): the sandbox wires demo handlers itself and shows the calls,
  // so callbacks stay visible even though they have no control.
  const fnProps = useMemo(() => entity.props.filter((p) => p.kind === 'func' || p.kind === 'function' || /^\(/.test(p.type)), [entity]);
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => setEvents([]), [entity]);
  const handlers = useMemo(() => {
    const out: Record<string, (...args: unknown[]) => void> = {};
    for (const p of fnProps) {
      out[p.name] = (...args: unknown[]) => {
        const shown = args.map((a) => (typeof a === 'object' && a !== null ? '…' : String(a))).join(', ');
        setEvents((cur) => [`${p.name}(${shown})`, ...cur].slice(0, 6));
      };
    }
    return out;
  }, [fnProps]);

  return (
    <div className="cu-playground">
      <div className="cu-playground-main">
        <div className="cu-preview" style={{ background }}>
          <Component {...values} {...handlers} />
        </div>
        <div className="cu-code">
          <pre>
            <code>{code}</code>
          </pre>
          <div className="cu-code-actions">
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(code).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
            <button type="button" onClick={() => setValues(defaultsOf(entity.demo))}>
              Сбросить
            </button>
          </div>
        </div>
      </div>
      <form className="cu-controls" onSubmit={(e) => e.preventDefault()} aria-label="Свойства">
        {controls.map((c) => (
          <Field key={c.name} control={c} value={values[c.name]} onChange={set(c.name)} />
        ))}
        {fnProps.length > 0 && (
          <div className="cu-events" data-empty={events.length === 0 || undefined}>
            <div className="cu-events-head">
              <span>События</span>
              {events.length > 0 && (
                <button type="button" onClick={() => setEvents([])}>
                  Очистить
                </button>
              )}
            </div>
            {events.length === 0 ? (
              <p>
                повзаимодействуйте с компонентом — вызовы <code>{fnProps.map((p) => p.name).join(', ')}</code> появятся здесь
              </p>
            ) : (
              <ol>
                {events.map((e, i) => (
                  <li key={`${i}-${e}`}>
                    <code>{e}</code>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

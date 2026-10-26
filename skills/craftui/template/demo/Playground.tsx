import { useMemo, useState } from 'react';
import { type Control, controlsFor, defaultsOf, toJsx } from './controls';
import type { Entity } from './registry';

const NONE = '__none';
const TEXT = '__text';

// Which choice of a slot select matches the current value: none, a preset or custom text.
function slotChoice(control: Extract<Control, { kind: 'slot' }>, value: unknown): string {
  if (value === undefined || value === null) return NONE;
  const preset = Object.entries(control.presets).find(([, node]) => node === value);
  return preset ? preset[0] : TEXT;
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
            {choice === TEXT && <input aria-label={`${control.name}: текст`} type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} />}
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

  return (
    <div className="cu-playground">
      <div className="cu-playground-main">
        <div className="cu-preview" style={{ background }}>
          <Component {...values} />
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
      </form>
    </div>
  );
}

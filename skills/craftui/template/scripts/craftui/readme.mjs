// README.md in an entity folder: props, import version and date, check results, history.
// Generated from state.json, spec.json, the component types (demo/.generated/props.json) and the log — not edited by hand.
import fs from 'node:fs';
import path from 'node:path';
import { config, findEntity, listEntities, readJson, writeJson } from './lib.mjs';

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Completed import cycles: 1 = first import, +1 for every completion after `craftui reopen`. Older entities get it from the log once. */
export function importsOf(e, state) {
  if (state.imports) return state.imports;
  const imports = [];
  let reason = null;
  const log = fs.existsSync(e.logFile) ? fs.readFileSync(e.logFile, 'utf8') : '';
  for (const m of log.matchAll(/^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) — (.*)$/gm)) {
    const reopened = m[2].match(/^шаги с \S+ открыты заново: (.*)$/);
    if (reopened) reason = reopened[1];
    if (m[2] === 'шаг report выполнен') {
      imports.push({ version: imports.length + 1, at: m[1], reason: imports.length ? reason ?? 'обновление' : 'первый импорт' });
      reason = null;
    }
  }
  state.imports = imports;
  writeJson(e.stateFile, state);
  return imports;
}

function section(log, title) {
  const start = log.indexOf(`## ${title}\n`);
  if (start === -1) return '';
  const rest = log.slice(start + title.length + 4);
  const end = rest.search(/^## /m);
  return (end === -1 ? rest : rest.slice(0, end)).replace(/<!--[^>]*-->/g, '').trim();
}

function checks(e) {
  const out = path.join(e.craftlog, 'visual', 'output');
  if (!fs.existsSync(out)) return null;
  const results = fs.readdirSync(out).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(out, f)));
  const visualConfig = readJson(path.join(e.craftlog, 'visual', 'visual.config.json'));
  const threshold = visualConfig?.default?.maxDiffRatio ?? config().maxDiffRatio;
  const own = Object.entries(visualConfig?.targets ?? {}).filter(([, t]) => t.maxDiffRatio !== undefined || t.skip || t.mask);
  const unit = fs.existsSync(path.join(out, 'unit.log')) ? fs.readFileSync(path.join(out, 'unit.log'), 'utf8') : '';
  const count = (k) => unit.match(new RegExp(`"${k}":\\s*(\\d+)`))?.[1];
  const parts = [];
  // Targets with their own threshold, mask or skip are named: "83/83 at 1%" alone would hide them.
  const exceptions = own.length ? `, свои условия у ${own.map(([id]) => `\`${id}\``).join(', ')} — см. «Отклонения от макета»` : '';
  if (results.length) parts.push(`скриншоты: ${results.filter((r) => r.pass).length}/${results.length} совпадают с Figma (порог ${(threshold * 100).toFixed(1)}%${exceptions})`);
  if (count('passedTests')) parts.push(`rstest: ${count('passedTests')} пройдено, ${count('failedTests') ?? 0} упало`);
  return parts.join('; ') || null;
}

export function writeReadme(e) {
  const state = e.state;
  const spec = readJson(e.specFile) ?? {};
  const source = readJson(path.join(e.craftlog, 'figma', 'source.json')) ?? {};
  const pkg = readJson('package.json', {});
  const kindDir = path.basename(path.dirname(e.dir));
  const meta = readJson('demo/.generated/props.json', {})[`${kindDir}/${e.name}`];
  const props = meta?.props ?? [];
  const imports = importsOf(e, state);
  const last = imports.at(-1);
  const log = fs.existsSync(e.logFile) ? fs.readFileSync(e.logFile, 'utf8') : '';
  const sources = source.sources ?? [{ url: source.url, nodeId: source.nodeId, variant: {} }];

  const lines = [`# ${e.name}`, ''];
  // With several sets (sizes, outline) the description belongs to the first one only.
  if (spec.figma?.description) lines.push(sources.length > 1 ? `> Описание в Figma (набор «${spec.figma.nodeName}»): ${spec.figma.description}` : spec.figma.description, '');
  lines.push(
    '| | |',
    '|---|---|',
    `| Версия импорта | ${last ? `**${last.version}** — ${last.at.slice(0, 10)}` : 'первый импорт ещё не завершён'} |`,
    `| Первый импорт | ${imports[0]?.at.slice(0, 10) ?? (state.createdAt ?? '').slice(0, 10)} |`,
    `| Макет Figma | ${sources.map((s) => `[${s.nodeId}](${s.url})${Object.keys(s.variant ?? {}).length ? ` (${Object.entries(s.variant).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`).join('<br>')} |`,
    `| Источник данных | ${state.source === 'chrome' ? 'Chrome MCP (Plugin API)' : 'Figma MCP'} |`,
  );
  const checked = checks(e);
  if (checked) lines.push(`| Проверка | ${cell(checked)} |`);
  if (state.status !== 'done') lines.push(`| Статус | импорт в процессе (\`npm run craftui -- next ${e.name}\`) |`);

  // Usage: import paths and an example: required props, the first text from the design (label="Title"),
  // a non-default value of view or size (else of the first union prop).
  const variantProp = props.find((p) => p.name === 'view' && p.options?.length > 1) ?? props.find((p) => p.name === 'size' && p.options?.length > 1) ?? props.find((p) => p.options?.length > 1);
  const example = variantProp ? variantProp.options.find((o) => o !== variantProp.defaultValue) : null;
  // Slot content in the design ($slot:children — an icon) is the consumer's: shown as <Icon />. Required strings get a sample.
  const raw = spec.targets?.[0]?.props?.children;
  const children = typeof raw === 'string' && raw.startsWith('$slot:') ? '<Icon />' : raw;
  const required = props.filter((p) => p.required && p.name !== 'children').map((p) => (p.type === 'string' ? ` ${p.name}="…"` : ` ${p.name}={…}`)).join('');
  const text = spec.props?.find((p) => p.role === 'text' && p.react && p.react !== 'children' && typeof p.default === 'string' && props.some((x) => x.name === p.react && !x.required));
  const attrs = `${required}${text ? ` ${text.react}="${text.default}"` : ''}${example ? ` ${variantProp.name}="${example}"` : ''}`;
  lines.push(
    '',
    '## Использование',
    '',
    '```tsx',
    `import '${pkg.name}/tokens.css'; // один раз в приложении`,
    `import { ${e.name} } from '${pkg.name}/${e.name}';`,
    '',
    typeof children === 'string' ? `<${e.name}${attrs}>${children}</${e.name}>` : `<${e.name}${attrs} />`,
    '```',
  );

  lines.push('', '## Свойства', '');
  if (props.length) {
    lines.push('| Свойство | Тип | По умолчанию | Описание |', '|---|---|---|---|');
    for (const p of props) {
      const type = p.options ? p.options.map((o) => `'${o}'`).join(' \\| ') : cell(p.type);
      // No JSDoc (lost in a union type, say): at least name the Figma property it comes from.
      const figma = spec.props?.find((x) => x.react === p.name)?.figma;
      const description = p.description || (figma ? `Figma: ${figma}` : '');
      lines.push(`| \`${p.name}\`${p.required ? ' *' : ''} | \`${type}\` | ${p.defaultValue !== undefined ? `\`${cell(p.defaultValue)}\`` : ''} | ${cell(description)} |`);
    }
    lines.push('', meta.note ?? 'Остальные атрибуты передаются корневому элементу, `ref` указывает на него.');
  } else lines.push('_Нет данных — запустите `npm run gen`._');
  if (meta?.pseudo?.length) lines.push('', `Состояния ${meta.pseudo.map((p) => `\`:${p}\``).join(', ')} — средствами CSS, отдельных пропсов нет.`);

  const deps = (spec.instances ?? []).filter((i) => i.resolution);
  if (deps.length) {
    lines.push('', '## Вложенные части макета', '');
    const what = (r) => (r === 'inline' ? 'Встроены в компонент' : r === 'content' ? 'Пример содержимого слота в макете' : r === 'graphic' ? 'Графика (картинка)' : `Компонент ${r.replace(/^entity:[^/]+\//, '')}`);
    // Sizes repeat the same nested parts under other layer names: one line per outcome.
    const groups = new Map();
    for (const i of deps) groups.set(what(i.resolution), new Set([...(groups.get(what(i.resolution)) ?? []), i.name.trim()]));
    for (const [outcome, names] of groups) lines.push(`- ${outcome}: ${[...names].join(', ')}`);
  }
  for (const title of ['Отклонения от макета', 'Компромиссы']) {
    const body = section(log, title);
    if (body && body !== '_нет_') lines.push('', `## ${title}`, '', body);
  }

  lines.push('', '## История импортов', '');
  if (imports.length) {
    lines.push('| Версия | Дата (UTC) | Что изменилось |', '|---|---|---|');
    for (const i of [...imports].reverse()) lines.push(`| ${i.version} | ${i.at} | ${cell(i.reason)} |`);
  } else lines.push('_Импорт ещё не завершён._');

  lines.push(
    '',
    '---',
    `Файл создаётся командой \`npm run craftui -- readme ${e.name}\` (и при \`npm run gen\`) — правки вручную будут перезаписаны. ` +
      `Подробный журнал: [craftlog/craftui.log.md](craftlog/craftui.log.md). Демо: \`npm run dev\` → http://localhost:${config().port ?? 4600}/#/${kindDir}/${e.name}`,
    '',
  );
  const file = path.join(e.dir, 'README.md');
  const content = lines.join('\n');
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content);
  return file;
}

export function run(ref) {
  for (const e of ref ? [findEntity(ref)] : listEntities()) console.log(`✓ ${writeReadme(e)}`);
}

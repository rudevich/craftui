#!/usr/bin/env node
// craftui — state, checkpoints and deterministic steps of the craftui skill. `npm run craftui -- help`
import fs from 'node:fs';
import path from 'node:path';
import {
  appendHistory, config, fail, findEntity, getStep, KIND_ALIASES, KIND_DIRS, listEntities, newEntity,
  now, openBlockers, parseFigmaUrl, readJson, replaceSection, saveState, writeJson,
} from './lib.mjs';
import { importsOf, writeReadme } from './readme.mjs';
import { readFilter, sourceEntry } from './sources.mjs';
import { instructions, STEPS } from './steps.mjs';

const HELP = `craftui — команды (npm run craftui -- <команда>)

Состояние и продолжение
  status                       сущности проекта, их статус и текущий шаг
  next [Name]                  следующий шаг с точной инструкцией (без Name — по всему проекту с учётом зависимостей)
  new <kind> <Name> <url> [--source chrome|mcp] [--parent Name] [--variant "Size=M"] [--filter <json|file>]
                               создать сущность (kind: component): папку, craftlog, state.json, лог
  source <Name> list | add <url> [--variant …] [--filter …] | filter <i|all> <json|file>
                               наборы Figma, из которых собирается сущность (размеры, outline…), и фильтр вариантов
  begin|done|fail|skip <Name> <step> [текст]   отметить шаг (fail — с текстом ошибки)
  reopen <Name> <step> [причина]   открыть шаг и все следующие заново (ресинк, новые источники)
  wait <Name> <вопрос>         пометить, что ждём ответа пользователя (автопродолжение не сработает)
  resume <Name>                снять ожидание
  log <Name> <текст>           строка в «Историю» лога

Figma
  url <figma-url>              разобрать ссылку → fileKey, nodeId
  receiver                     локальный приёмник файлов для Chrome-режима (держать в фоне)
  snippet <Name> <probe|extract|export>   код для выполнения в странице Figma (Chrome)
  put <Name> <путь-в-craftlog> [--base64]  записать stdin в craftlog (запасной путь без receiver)
  rest-images <Name>           PNG-эталоны через Figma REST API (нужен FIGMA_TOKEN)
  normalize <Name> [--summary] [--keep]   raw → spec.json; --summary только печать; --keep сохранить ручные правки
  deps <Name> [--inline <имя> | --inline-all]   вложенные компоненты: импортированы / нужно импортировать / inline
                               (--inline-all — все неразрешённые, с повторным normalize по уровням вложенности;
                               --same "<имя>" <Entity> — набор-двойник в ките считается той же сущностью)
  slot <Name> <@ключ… | Ось=Значение> <prop>  слой или значение оси — содержимое пропа (иконка IconButton → children)

Код и проверка
  tokens <Name>                добавить токены из spec.json в src/tokens.css
  scaffold <Name> [--force]    заготовки: index.ts, <Name>.tsx, styles.module.css, types.ts, demo, тесты, node-map
  scaffold <Name> --add-targets   дописать в <Name>.demo.tsx targets, которых там ещё нет (новые варианты, размеры)
  prop <Name> <свойство Figma> <имя React | -> [тип TS] [--role text|bool|slot|prop --default <v>]
                               правка свойства на шаге confirm (targets переименуются тоже); с --role — новое свойство
  brief <Name>                 выжимка spec.json для шага code (~4k токенов): data-атрибуты, пропсы, разметка, стили
  spec <Name> [<target>] [<слой>] [--depth N]   точечный просмотр spec.json: без target — список targets,
                               иначе слои с классами и CSS (spec.json целиком не открывать — он огромный)
  svg <Name> <asset.svg> <IconName>   TSX-иконка из ассета Figma (одноцветная → currentColor), вывод в stdout
  verify <Name> [--grep <id>] [--no-unit] [--no-visual]   единицы + typecheck + rstest + скриншоты + style-check, краткая сводка
  units [Name]                 правило единиц: только px и %; vw/vh/dvh… — только оверлеи с комментарием /* units: … */
  readme [Name]                README.md в папке сущности: свойства, версия и дата импорта, проверка, история
  shortcuts [Name]             собрать комментарии \`shortcut:\` в раздел «Компромиссы» лога

Автопродолжение
  hooks install [--claude] [--codex]   проектные хуки: Stop не даёт остановиться, пока есть шаги;
                               SessionStart (Claude Code) после сжатия контекста возвращает карточку текущего шага
  hook-stop                    обработчик хука (вызывается агентом)
  autopilot [--agent claude|codex] [--max N]   перезапускать агента после сбоев API, пока работа не закончена
`;

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const positional = () => {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (args[i + 1] && !args[i + 1].startsWith('--') && !['--summary', '--keep', '--force', '--base64', '--inline', '--add-targets', '--no-unit', '--no-visual'].includes(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
};

const commands = {
  help: () => console.log(HELP),

  url: () => {
    const parsed = parseFigmaUrl(args[0] ?? '');
    if (!parsed) fail('не похоже на ссылку Figma');
    console.log(JSON.stringify(parsed, null, 2));
    if (!parsed.nodeId) console.log('Нет node-id: попроси пользователя ссылку на слой (ПКМ → Copy link to selection).');
  },

  status: () => {
    const entities = listEntities();
    if (!entities.length) return console.log('Пока нет сущностей. Новый импорт: npm run craftui -- new component <Name> <figma-url> --source chrome|mcp');
    for (const e of entities) {
      const s = e.state;
      const current = s.steps.find((x) => x.status !== 'done' && x.status !== 'skipped');
      const blockers = openBlockers(s);
      // The saved status may predate a nested entity finishing: blocked is only what is still open.
      const status = s.status === 'blocked' && !blockers.length ? 'in-progress' : s.status;
      const parts = [`${e.kind}/${e.name}: ${status}`];
      if (current) parts.push(`шаг ${current.id} (${current.status})`);
      if (blockers.length) parts.push(`ждёт ${blockers.join(', ')}`);
      if (s.awaitingUser) parts.push(`ждёт ответа: ${s.awaitingUser}`);
      console.log(`- ${parts.join(' · ')}`);
    }
    const pending = entities.filter((e) => e.state.status !== 'done');
    console.log(pending.length ? '\nДальше: npm run craftui -- next' : '\nВсё импортировано.');
  },

  next: () => {
    const ref = positional()[0];
    let e = ref ? findEntity(ref) : pickNext();
    if (!e) return console.log('Незавершённой работы нет.');
    let s = e.state;
    const blockers = openBlockers(s);
    if (blockers.length) {
      console.log(`${e.name} ждёт вложенные: ${blockers.join(', ')} — сначала они.`);
      e = findEntity(blockers[0]);
      s = e.state;
    }
    if (s.awaitingUser) {
      console.log(`${e.name}: ждём ответа пользователя — ${s.awaitingUser}`);
      console.log(`Когда ответ получен: npm run craftui -- resume ${e.name}`);
      return;
    }
    const step = s.steps.find((x) => x.status !== 'done' && x.status !== 'skipped');
    if (!step) return console.log(`${e.name}: все шаги выполнены.`);
    console.log(`${e.kind}/${e.name} · шаг ${step.id}: ${step.title}${step.status === 'failed' ? ` (ошибка: ${step.lastError})` : ''}`);
    if (step.attempts >= 3) console.log('Шаг уже падал 3 раза: опиши проблему пользователю и спроси, как быть (или skip).');
    console.log(`Начало: npm run craftui -- begin ${e.name} ${step.id}`);
    for (const line of instructions(e, s, step.id)) console.log(`  ${line}`);
    console.log(`Готово: npm run craftui -- done ${e.name} ${step.id}   Ошибка: npm run craftui -- fail ${e.name} ${step.id} "<текст>"`);
  },

  new: () => {
    const [kindArg, name, url] = positional();
    const kind = KIND_ALIASES[kindArg] ?? kindArg;
    if (!KIND_DIRS[kind]) fail(`kind должен быть: ${Object.keys(KIND_DIRS).join(', ')}`);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name ?? '')) fail('имя — PascalCase латиницей, например BasicButton');
    const figma = parseFigmaUrl(url ?? '');
    if (!figma?.nodeId) fail('нужна ссылка Figma с node-id');
    const parent = flag('parent');
    const source = flag('source') ?? (typeof parent === 'string' ? findEntity(parent).state.source : undefined) ?? config().source;
    if (!['chrome', 'mcp'].includes(source)) fail('укажи --source chrome|mcp (или "source" в craftui.config.json)');
    const e = newEntity(kind, name);
    if (fs.existsSync(e.stateFile)) fail(`${name} уже есть — продолжай: npm run craftui -- next ${name}`);

    for (const d of ['figma/raw', 'figma/screenshots', 'figma/assets', 'visual', 'tests']) fs.mkdirSync(path.join(e.craftlog, d), { recursive: true });
    const first = sourceEntry(url, { variant: flag('variant'), filter: readFilter(flag('filter')) });
    writeJson(path.join(e.craftlog, 'figma', 'source.json'), { kind, name, source, ...figma, sources: [first], createdAt: new Date().toISOString() });
    fs.writeFileSync(e.logFile, logTemplate(kind, name, figma, source));
    const state = {
      version: 1, kind, name, source, figma, status: 'in-progress', awaitingUser: null, blockedBy: [],
      usedBy: typeof parent === 'string' ? [parent] : [],
      steps: STEPS[kind].map(([id, title]) => ({ id, title, status: 'pending', attempts: 0, lastError: null })),
      createdAt: new Date().toISOString(),
    };
    saveState(e, state);
    appendHistory(e, `создано (${source})${parent ? `, вложенный в ${parent}` : ''}`);

    if (typeof parent === 'string') {
      const p = findEntity(parent);
      const ps = p.state;
      ps.blockedBy = [...new Set([...(ps.blockedBy ?? []), name])];
      saveState(p, ps);
      appendHistory(p, `ждёт вложенный ${name}`);
    }
    console.log(`✓ ${e.dir}/craftlog создан. Дальше: npm run craftui -- next ${name}`);
  },

  begin: () => mark('in-progress'),
  done: () => mark('done'),
  fail: () => mark('failed'),
  skip: () => mark('skipped'),

  // Resync or extension (new sources, sizes): the step and everything after it run again.
  reopen: () => {
    const [ref, stepId, ...text] = positional();
    const e = findEntity(ref);
    const s = e.state;
    const from = s.steps.indexOf(getStep(s, stepId));
    for (const step of s.steps.slice(from)) {
      step.status = 'pending';
      step.lastError = null;
    }
    importsOf(e, s); // fix the history before a new cycle starts
    if (text.length) s.pendingReason = [s.pendingReason, text.join(' ')].filter(Boolean).join('; ');
    saveState(e, s);
    appendHistory(e, `шаги с ${stepId} открыты заново${text.length ? `: ${text.join(' ')}` : ''}`);
    console.log(`✓ ${e.name}: шаги ${s.steps.slice(from).map((x) => x.id).join(', ')} снова pending. Дальше: npm run craftui -- next ${e.name}`);
  },

  wait: () => {
    const [ref, ...text] = positional();
    const e = findEntity(ref);
    const s = e.state;
    s.awaitingUser = text.join(' ') || 'ответ пользователя';
    saveState(e, s);
    appendHistory(e, `ждём пользователя: ${s.awaitingUser}`);
    console.log(`✓ ${e.name}: ожидание ответа отмечено. Заверши ход вопросом пользователю.`);
  },

  resume: () => {
    const e = findEntity(positional()[0]);
    const s = e.state;
    s.awaitingUser = null;
    saveState(e, s);
    appendHistory(e, 'ответ получен, продолжаем');
    console.log(`✓ ${e.name}: продолжаем. npm run craftui -- next ${e.name}`);
  },

  log: () => {
    const [ref, ...text] = positional();
    const e = findEntity(ref);
    appendHistory(e, text.join(' '));
    console.log('✓ записано');
  },

  shortcuts: () => {
    const ref = positional()[0];
    const entities = ref ? [findEntity(ref)] : listEntities();
    for (const e of entities) {
      const found = [];
      for (const file of walk(e.dir)) {
        if (file.includes(`${path.sep}craftlog${path.sep}`)) continue;
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/shortcut:/g)) {
          // Block comment (/* … */) runs to */, a line comment (//) to the end of the line.
          const lineStart = text.lastIndexOf('\n', m.index) + 1;
          const block = text.slice(lineStart, m.index).includes('/*');
          const from = m.index + m[0].length;
          const to = block ? text.indexOf('*/', from) : text.indexOf('\n', from);
          const note = text.slice(from, to === -1 ? undefined : to).replace(/\s*\*\s*/g, ' ').replace(/\s+/g, ' ').trim();
          found.push(`- \`${path.relative(e.dir, file)}:${text.slice(0, m.index).split('\n').length}\` ${note}`);
        }
      }
      replaceSection(e.logFile, 'shortcuts', found.join('\n') || '_нет_');
      console.log(`${e.name}: ${found.length ? `\n${found.join('\n')}` : 'компромиссов нет'}`);
    }
  },

  source: async () => (await import('./sources.mjs')).run(positional(), flag),
  receiver: async () => (await import('./receiver.mjs')).run(args),
  snippet: async () => (await import('./snippets.mjs')).run(positional()),
  put: async () => (await import('./snippets.mjs')).put(positional(), Boolean(flag('base64'))),
  'rest-images': async () => (await import('./rest.mjs')).run(positional()[0]),
  normalize: async () => (await import('./normalize.mjs')).run(positional()[0], { summary: Boolean(flag('summary')), keep: Boolean(flag('keep')) }),
  deps: async () => (await import('./deps.mjs')).run(positional()[0], flag('inline'), { all: Boolean(flag('inline-all')), same: flag('same') ? [flag('same'), positional()[1]] : null }),
  tokens: async () => (await import('./tokens.mjs')).run(positional()[0]),
  scaffold: async () => (await import('./scaffold.mjs')).run(positional()[0], Boolean(flag('force')), Boolean(flag('add-targets'))),
  brief: async () => console.log((await import('./digest.mjs')).brief(positional()[0])),
  spec: async () => console.log((await import('./digest.mjs')).query(positional()[0], positional()[1], positional()[2], Number(flag('depth')) || 3)),
  svg: async () => (await import('./svg.mjs')).run(positional()),
  readme: async () => (await import('./readme.mjs')).run(positional()[0]),
  units: async () => (await import('./units.mjs')).run(positional()[0]),
  slot: async () => (await import('./slots.mjs')).bindSlot(positional()),
  verify: async () => (await import('./verify.mjs')).run(positional()[0], { grep: flag('grep'), unit: !flag('no-unit'), visual: !flag('no-visual') }),
  hooks: async () => (args[0] === 'install' ? (await import('./hooks.mjs')).install(args.slice(1)) : fail('usage: hooks install [--claude] [--codex]')),
  'hook-stop': async () => (await import('./hooks.mjs')).hookStop(),
  // SessionStart after compaction: the card of the current step goes back into the fresh context.
  'hook-session': () => {
    if (!fs.existsSync('craftui.config.json') || !listEntities().some((e) => e.state.status !== 'done')) return;
    console.log('craftui: контекст сжат, продолжай с текущего шага. spec.json и figma/raw не открывай — данные: npm run craftui -- brief <Name>.');
    commands.next();
  },
  // Confirm step: a Figma property becomes a React prop (or "-": not a prop). Targets follow the new name.
  prop: () => {
    const [ref, figmaName, react, reactType] = positional();
    const e = findEntity(ref);
    const spec = readJson(e.specFile) ?? fail(`нет spec.json — npm run craftui -- normalize ${e.name}`);
    if (!react) fail('usage: prop <Name> <свойство Figma> <имя React | -> [тип TS] [--role text|bool|slot|prop --default <значение>]');
    let p = spec.props.find((x) => x.figma === figmaName);
    // An MCP export does not show TEXT, BOOLEAN and INSTANCE_SWAP properties: they are added by hand with a role.
    if (!p && typeof flag('role') === 'string') spec.props.push((p = { figma: figmaName, role: flag('role'), react: null, ...(flag('default') !== undefined ? { default: flag('default') } : {}) }));
    if (!p) fail(`нет свойства "${figmaName}" (новое — с --role). Есть: ${spec.props.map((x) => x.figma).join(', ')}`);
    const was = p.react;
    p.react = react === '-' ? null : react;
    if (reactType) p.reactType = reactType;
    for (const t of spec.targets) {
      if (!was || !(was in (t.props ?? {}))) continue;
      if (p.react) t.props[p.react] = t.props[was];
      delete t.props[was];
    }
    writeJson(e.specFile, spec);
    appendHistory(e, `confirm: ${figmaName} → ${p.react ?? '(не проп)'}${reactType ? `: ${reactType}` : ''}`);
    console.log(`✓ ${figmaName} → ${p.react ?? '(не проп)'}${reactType ? `: ${reactType}` : ''}. Затем: npm run craftui -- normalize ${e.name} --keep`);
  },
  autopilot: async () => (await import('./hooks.mjs')).autopilot({ agent: flag('agent'), max: Number(flag('max')) || 10 }),
};

function mark(status) {
  const [ref, stepId, ...text] = positional();
  const e = findEntity(ref);
  const s = e.state;
  const step = getStep(s, stepId);
  if (status === 'in-progress') step.attempts += 1;
  step.status = status;
  step.lastError = status === 'failed' ? text.join(' ') || 'без описания' : null;
  step.updatedAt = new Date().toISOString();
  // A finished report closes an import cycle: version 1 is the first import, every reopen + report adds one.
  const finished = stepId === 'report' && status === 'done';
  if (finished) {
    const imports = importsOf(e, s);
    imports.push({ version: imports.length + 1, at: now(), reason: imports.length ? (s.pendingReason ?? 'обновление') : 'первый импорт' });
    s.pendingReason = null;
  }
  saveState(e, s);
  const label = { 'in-progress': 'начат', done: 'выполнен', failed: 'ошибка', skipped: 'пропущен' }[status];
  appendHistory(e, `шаг ${stepId} ${label}${text.length ? `: ${text.join(' ')}` : ''}`);
  if (finished) {
    appendHistory(e, `версия импорта ${s.imports.at(-1).version}`);
    console.log(`README: ${writeReadme(e)} (версия импорта ${s.imports.at(-1).version})`);
  }
  if (status === 'done' && s.status === 'done') {
    for (const parentName of s.usedBy ?? []) {
      const p = listEntities().find((x) => x.name === parentName);
      if (p) appendHistory(p, `вложенный ${e.name} готов`);
    }
  }
  console.log(`✓ ${e.name} · ${stepId}: ${status}${status === 'done' ? '\nДальше: npm run craftui -- next' : ''}`);
}

// Unfinished entity to work on now: blockers first, then the oldest one.
function pickNext() {
  const open = listEntities().filter((e) => e.state.status !== 'done');
  if (!open.length) return null;
  const waiting = open.find((e) => e.state.awaitingUser);
  if (waiting) return waiting;
  return open.find((e) => !openBlockers(e.state).length) ?? open[0];
}

function* walk(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(d.name)) yield p;
  }
}

function logTemplate(kind, name, figma, source) {
  return `# ${name} — craftui

| | |
|---|---|
| Вид | ${kind} |
| Макет | ${figma.url} |
| fileKey / nodeId | \`${figma.fileKey}\` / \`${figma.nodeId}\` |
| Источник данных | ${source} |
| Создан | ${now()} |

## Шаги
<!-- craftui:steps -->
<!-- /craftui:steps -->

## Свойства (Figma → React)
_заполняется на шаге confirm_

## Targets
<!-- craftui:targets -->
_заполняется командой verify_
<!-- /craftui:targets -->

## Зависимости
_использует / используется в_

## Токены и ассеты

## Отклонения от макета

## Компромиссы
<!-- craftui:shortcuts -->
_нет_
<!-- /craftui:shortcuts -->

## История
`;
}

const run = commands[cmd ?? 'help'];
if (!run) fail(`неизвестная команда "${cmd}". npm run craftui -- help`);
await run();

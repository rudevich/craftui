// The MCP tool surface: 14 typed tools over api.ts, grouped as flow / figma / spec / code.
// Schemas are plain JSON Schema: the server has zero dependencies, the details live in the descriptions.
import * as api from './api.ts';

export type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  /** false for tools that work outside a craftui project. */
  project?: boolean;
  run: (args: any) => Promise<string>;
};

const str = (description: string) => ({ type: 'string', description });
const bool = (description: string) => ({ type: 'boolean', description });
const num = (description: string) => ({ type: 'number', description });
const enum_ = (values: string[], description: string) => ({ type: 'string', enum: values, description });
const obj = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS: Tool[] = [
  // ── flow ───────────────────────────────────────────────────────────────────
  {
    name: 'status',
    description: 'Обзор проекта: сущности, их статус, текущий шаг, блокировки и ожидания пользователя.',
    inputSchema: obj({}),
    run: () => api.status(),
  },
  {
    name: 'next',
    description: 'Карточка следующего шага: что делать, точные вызовы инструментов и файлы. Без аргументов — по всему проекту с учётом зависимостей между сущностями. Потерял нить — вызови next.',
    inputSchema: obj({ entity: str('имя сущности ("Name" или "kind/Name"); без неё — самая важная незавершённая') }),
    run: ({ entity }: { entity?: string }) => api.next(entity),
  },
  {
    name: 'step',
    description: 'Отметить шаг сущности. Цикл: begin → работа по карточке → done (или fail с text). reopen — открыть шаг и все следующие заново (ресинк, новые наборы). wait — пометить, что ждём ответа пользователя (заверши ход вопросом), resume — снять ожидание.',
    inputSchema: obj({
      action: enum_(['begin', 'done', 'fail', 'skip', 'reopen', 'wait', 'resume'], ''),
      entity: str(''),
      step: str('id шага, например extract; не нужен для wait/resume'),
      text: str('fail — текст ошибки; reopen — причина; wait — вопрос пользователю'),
    }, ['action', 'entity']),
    run: ({ action, entity, step, text }: { action: api.StepAction; entity: string; step?: string; text?: string }) => api.step({ entity, action, step, text }),
  },
  {
    name: 'log',
    description: 'action note — строка в «Историю» лога сущности (принятый план, итог итерации verify); action shortcuts — собрать комментарии `shortcut:` из кода в «Компромиссы» лога (без entity — по всем).',
    inputSchema: obj({
      action: enum_(['note', 'shortcuts'], 'по умолчанию note'),
      entity: str('для note — обязательна; для shortcuts — без неё по всем сущностям'),
      text: str('текст записи (note)'),
    }),
    run: ({ entity, action, text }: { entity?: string; action?: 'note' | 'shortcuts'; text?: string }) => api.log({ entity, action, text }),
  },
  {
    name: 'config',
    description: 'Брейкпоинты страниц (craftui.config.json → pages.breakpoints). С аргументами — задать заново целиком: верхняя граница каждого диапазона включительно, null — диапазона нет; передан desktop — появится largeDesktop. Без аргументов — показать текущие.',
    inputSchema: obj({
      mobile: num('до скольки px включительно мобильный диапазон'),
      tablet: { anyOf: [num(''), { type: 'null' }], description: 'верхняя граница или null — планшетного нет' },
      desktop: { anyOf: [num(''), { type: 'null' }], description: 'верхняя граница или null — без верхней границы (largeDesktop не выделяется)' },
    }),
    run: ({ mobile, tablet, desktop }: { mobile?: number; tablet?: number | null; desktop?: number | null }) => api.setBreakpoints({ mobile, tablet, desktop }),
  },

  // ── figma ──────────────────────────────────────────────────────────────────
  {
    name: 'figma-url',
    description: 'Разобрать ссылку Figma → fileKey и nodeId. Для разведки до создания сущности.',
    inputSchema: obj({ url: str('') }, ['url']),
    project: false,
    run: ({ url }: { url: string }) => api.figmaUrl(url),
  },
  {
    name: 'create',
    description: 'Новая сущность из ссылки Figma (папка, craftlog, state.json, лог). kind по умолчанию — component; page — адаптивная страница (нужны брейкпоинты config, только chrome). source: chrome — Chrome MCP (по умолчанию), figma — Figma MCP. parent — вложенный компонент (родитель ждёт его завершения). variant — "Ось=Значение", filter — JSON-массив условий или файл.',
    inputSchema: obj({
      kind: enum_(['component', 'page'], ''),
      name: str('PascalCase латиницей, например BasicButton'),
      url: str('ссылка Figma с node-id'),
      source: enum_(['chrome', 'figma'], ''),
      parent: str('имя родительской сущности'),
      variant: str('"Size=M, View=Accent" — оси, добавляемые этим набором'),
      filter: str('[{"View":"Accent"}] — какие варианты оставить, JSON или путь к файлу'),
    }, ['name', 'url']),
    run: ({ kind, name, url, source, parent, variant, filter }: { kind?: string; name: string; url: string; source?: string; parent?: string; variant?: string; filter?: string }) =>
      api.create({ kind, name, url, source, parent, variant, filter }),
  },
  {
    name: 'sources',
    description: 'Наборы Figma, из которых собирается сущность (UI-кит часто разбивает компонент на несколько component set: размеры, outline), и фильтры вариантов. action add — добавить набор (url, variant, filter); filter — условия для набора index или всех; variant — оси набора index.',
    inputSchema: obj({
      entity: str(''),
      action: enum_(['list', 'add', 'filter', 'variant'], 'по умолчанию list'),
      url: str('ссылка Figma с node-id (add)'),
      variant: str('"Size=M" (add, variant)'),
      filter: str('[{"View":"Accent"}] — JSON или файл (add, filter)'),
      index: { anyOf: [num(''), enum_(['all'], '')], description: 'номер набора (filter, variant)' },
    }, ['entity']),
    run: ({ entity, action, url, variant, filter, index }: { entity: string; action?: 'list' | 'add' | 'filter' | 'variant'; url?: string; variant?: string; filter?: string; index?: number | 'all' }) =>
      api.sources({ entity, action, url, variant, filter, index }),
  },
  {
    name: 'extract',
    description: 'Тяжёлые данные Figma — мимо контекста. action receiver: mode start — запустить локальный приёмник файлов (запусти перед extract/export в chrome-режиме), mode stop — остановить. action snippet: код для выполнения в странице Figma браузерным инструментом (chrome-devtools evaluate_script / javascript_tool); step probe|extract|export, до создания сущности — probe по url. action put: записать content в craftlog (путь вида figma/raw/plugin.json; base64 для PNG) — запасной путь без receiver. action rest-images: PNG-эталоны через Figma REST API (нужен FIGMA_TOKEN).',
    inputSchema: obj({
      action: enum_(['receiver', 'snippet', 'put', 'rest-images'], ''),
      mode: enum_(['start', 'stop'], 'для receiver, по умолчанию start'),
      entity: str('для snippet/put/rest-images'),
      step: enum_(['probe', 'extract', 'export'], 'для snippet'),
      url: str('ссылка Figma — probe до создания сущности'),
      inline: bool('для snippet: код целиком в ответе, без загрузки с receiver'),
      path: str('для put: путь внутри craftlog, например figma/raw/plugin.json'),
      content: str('для put: содержимое файла'),
      base64: bool('для put: content в base64 (PNG)'),
    }, ['action']),
    run: ({ action, mode, entity, step, url, inline, path, content, base64 }: any) => {
      if (action === 'receiver') return mode === 'stop' ? api.receiverStop() : api.receiverStart();
      if (action === 'snippet') return api.snippet({ entity, url, step: step ?? 'probe', inline: Boolean(inline) });
      if (action === 'put') return api.putFile({ entity, path, content, base64: Boolean(base64) });
      return api.restImages(entity);
    },
  },

  // ── spec ───────────────────────────────────────────────────────────────────
  {
    name: 'spec',
    description: 'spec.json сущности. action normalize — raw → spec (keep — сохранить ручные правки после prop/slot, summary — только сводка на печать); deps — вложенные компоненты: какие импортированы, inline "<имя>" — пометить встроенным, inlineAll — все, same {instance, entity} — набор-двойник считается той же сущностью; prop — свойство Figma → React-проп (react: имя или "-", type — тип TS; новое свойство — с role prop|text|bool|slot; state disabled|loading|hover|active — значение оси становится состоянием, не пропом); slot — слой (target: ключи "@root/…" или ось "Ось=Значение") становится содержимым пропа prop; mockup — слой страницы макет устройства, не верстать; part — слой страницы её часть name (shared — общая для страниц).',
    inputSchema: obj({
      action: enum_(['normalize', 'deps', 'prop', 'slot', 'mockup', 'part'], ''),
      entity: str('сущность (mockup/part — имя страницы)'),
      keep: bool('normalize: сохранить ручные правки свойств'),
      summary: bool('normalize: только сводка, без записи spec.json'),
      inline: str('deps: имя вложенного, которое встроить'),
      inlineAll: bool('deps: встроить все неразрешённые'),
      sameInstance: str('deps: имя вложенного-двойника'),
      sameEntity: str('deps: сущность, двойником которой он считается'),
      figma: str('prop: имя свойства Figma'),
      react: str('prop: имя React-пропа или "-"'),
      type: str('prop: тип TS'),
      role: enum_(['prop', 'text', 'bool', 'slot'], 'prop: для нового свойства'),
      default: str('prop: значение по умолчанию нового свойства'),
      state: str('prop: disabled|loading|hover|active|focus — значение становится состоянием'),
      target: { type: 'array', items: str('@ключ-слоя или "Ось=Значение"'), description: 'slot: слои-кандидаты' },
      prop: str('slot: имя пропа-содержимого'),
      layer: str('mockup/part: имя слоя страницы'),
      name: str('part: имя части'),
      shared: bool('part: общая для всех страниц'),
      remove: bool('mockup/part: отменить'),
    }, ['action', 'entity']),
    run: ({ action, entity, keep, summary, inline, inlineAll, sameInstance, sameEntity, figma, react, type, role, default: defaultValue, state, target, prop: prop_, layer, name, shared, remove }: any) => {
      if (action === 'normalize') return api.normalize({ entity, keep: Boolean(keep), summary: Boolean(summary) });
      if (action === 'deps') return api.entityDeps({ entity, inline, inlineAll: Boolean(inlineAll), same: sameInstance && sameEntity ? { instance: sameInstance, entity: sameEntity } : undefined });
      if (action === 'prop') return api.prop({ entity, figma, react, type, role, default: defaultValue, state });
      if (action === 'slot') return api.slot({ entity, target: target ?? [], prop: prop_ });
      if (action === 'mockup') return api.mockup({ page: entity, layer: layer ?? '', remove: Boolean(remove) });
      return api.part({ page: entity, layer: layer ?? '', name, shared: Boolean(shared), remove: Boolean(remove) });
    },
  },
  {
    name: 'digest',
    description: 'Данные для кода вместо spec.json (его открывать нельзя — сотни килобайт). action brief — выжимка сущности: свойства, data-атрибуты, разметка, стили (~4k токенов); action spec — точечный просмотр: target (брейкпоинт страницы) и layer (слой), depth — глубина.',
    inputSchema: obj({
      action: enum_(['brief', 'spec'], 'по умолчанию brief'),
      entity: str(''),
      target: str('spec: id target или брейкпоинт страницы'),
      layer: str('spec: ключ слоя'),
      depth: num('spec: глубина вложенности (по умолчанию 3)'),
    }, ['entity']),
    run: ({ action, entity, target, layer, depth }: { action?: 'brief' | 'spec'; entity: string; target?: string; layer?: string; depth?: number }) =>
      action === 'spec' ? api.specQuery({ entity, target, layer, depth }) : api.brief(entity),
  },

  // ── code ───────────────────────────────────────────────────────────────────
  {
    name: 'build',
    description: 'Генерация. action tokens — токены spec.json в src/tokens.css (не перезаписывает существующие); scaffold — заготовки файлов с черновиками кода (force — перезаписать, addTargets — дописать в демо targets, которых там нет); svg — TSX-иконка из ассета craftlog/figma/assets/ (asset, name); units — проверить правило единиц (только px и %); readme — пересобрать README.md сущности (без entity — всех).',
    inputSchema: obj({
      action: enum_(['tokens', 'scaffold', 'svg', 'units', 'readme'], ''),
      entity: str(''),
      force: bool('scaffold: перезаписать существующие файлы'),
      addTargets: bool('scaffold: только дописать новые targets в демо'),
      asset: str('svg: имя файла ассета, например icon.svg'),
      name: str('svg: имя компонента (по умолчанию из файла)'),
    }, ['action', 'entity']),
    run: ({ action, entity, force, addTargets, asset, name }: any) => {
      if (action === 'tokens') return api.mergeTokens(entity);
      if (action === 'scaffold') return api.scaffoldFiles({ entity, force: Boolean(force), addTargets: Boolean(addTargets) });
      if (action === 'svg') return api.svgIcon({ entity, asset, name });
      if (action === 'units') return api.unitsCheck(entity);
      return api.writeReadmes(entity);
    },
  },
  {
    name: 'verify',
    description: 'Проверка сущности: единицы + typecheck + rstest + скриншоты (Playwright) + style-check → краткая сводка; полные логи и diff — в craftlog/visual/output/. grep — подмножество targets.',
    inputSchema: obj({
      entity: str(''),
      grep: str('фильтр id targets'),
      unit: bool('по умолчанию true'),
      visual: bool('по умолчанию true'),
    }, ['entity']),
    run: ({ entity, grep, unit, visual }: { entity: string; grep?: string; unit?: boolean; visual?: boolean }) => api.verifyEntity({ entity, grep, unit: unit !== false, visual: visual !== false }),
  },
  {
    name: 'hooks',
    description: 'Автопродолжение. action install — Stop-хук (не даёт остановиться, пока есть шаги) и SessionStart-хук (после сжатия контекста возвращает карточку шага) в настройки проекта: claude (.claude/settings.json) и/или codex (.codex/hooks.json), без флагов — оба. action autopilot — перезапускать агента (agent: имя из craftui.config.json → autopilot.commands, max — число запусков), пока работа не закончится.',
    inputSchema: obj({
      action: enum_(['install', 'autopilot'], 'по умолчанию install'),
      claude: bool('install: только .claude/settings.json'),
      codex: bool('install: только .codex/hooks.json'),
      agent: str('autopilot: claude | codex | имя из конфига'),
      max: num('autopilot: лимит запусков (по умолчанию 10)'),
    }),
    run: ({ action, claude, codex, agent, max }: { action?: 'install' | 'autopilot'; claude?: boolean; codex?: boolean; agent?: string; max?: number }) =>
      action === 'autopilot' ? api.autopilot({ agent, max }) : api.installHooks({ claude: Boolean(claude), codex: Boolean(codex) }),
  },
];

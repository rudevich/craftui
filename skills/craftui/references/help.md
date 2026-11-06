# craftui — справка

Импортирует компоненты из Figma (по одному или целым UI-китом) в React 19 + CSS Modules. Результат собирается в библиотеку на rspack, к ней прилагаются демо-страницы, общие токены, скриншот-тесты против Figma и unit-тесты.

## Как вызывать

| Что сказать агенту | Что произойдёт |
|---|---|
| `craftui <ссылка на компонент Figma>` | новый импорт через Chrome MCP (источник по умолчанию; другой — в `source` конфига) |
| `craftui <ссылка> через figma` / `через chrome` | новый импорт через Figma MCP / Chrome MCP |
| `craftui <ссылка на страницу UI-кита>` | список компонентов кита → выбор → пакетный импорт |
| `craftui <ссылка на экран> page` | адаптивная страница в `src/pages/<Page>/`: фрейм на брейкпоинт, части, компоненты из `src/components` (`kind-page.md`) |
| `craftui continue` / «продолжи импорт» | продолжение с места остановки |
| `craftui fix Button: hover темнее, иконка 16px` | правки импортированного компонента |
| `craftui resync Button` | пересинхронизация с изменившимся макетом |
| `craftui status` | что импортировано и что в процессе |
| `craftui help` | эта справка |
| `craftui <что угодно словами>` | агент разберёт задачу (импорт, правка, проверка) и покажет план |

В Claude Code: `/craftui …` (или `/craftui:craftui …`, если скилл установлен как плагин). В Codex: `$craftui …` или просто попросить словами.

Перед любыми изменениями агент показывает пронумерованный план. Его можно принять, отклонить или поправить.

## Источники данных

- **chrome** (по умолчанию) — Chrome MCP: ваш Chrome, где выполнен вход в Figma: Claude in Chrome или chrome-devtools-mcp. Данные берутся через Plugin API страницы (иногда нужно один раз открыть Plugins → Development → Open console), запасной путь — сетевые запросы и Dev Mode. Если потребуется войти в Figma, агент попросит об этом явно.
- **figma** — Figma MCP: официальный сервер (удалённый `mcp.figma.com` или локальный из Figma Desktop). Нужна авторизация сервера в агенте. Старое имя `mcp` тоже принимается.

## Инструменты MCP-сервера

Детерминированную работу делают инструменты MCP-сервера `craftui` (в сессии это `mcp__craftui__<имя>`). Агент вызывает их сам; пользователю достаточно слов.

| Инструмент | Что делает |
|---|---|
| `status`, `next` | где мы и что делать дальше (карточка с точными вызовами) |
| `step` | отметки шагов сущности: begin → done (fail/skip), reopen — заново с шага (ресинк, новые наборы), wait/resume — ожидание ответа пользователя |
| `log` | строка в «Историю» лога (note), сбор компромиссов `shortcut:` (shortcuts) |
| `config` | брейкпоинты страниц в конфиге (верхние границы включительно, null — не нужен) |
| `figma-url` | разобрать ссылку Figma: fileKey, nodeId |
| `create` | новая сущность: kind component\|page, имя, ссылка, source chrome\|figma, parent (вложенный), variant, filter |
| `sources` | наборы Figma, из которых собран компонент (размеры, outline), фильтр вариантов |
| `extract` | данные Figma мимо контекста: receiver (локальный приёмник файлов), snippet (код для страницы Figma: probe/extract/export), put (файл в craftlog без receiver), rest-images (PNG через Figma REST API) |
| `spec` | spec.json: normalize (собрать из raw; keep — сохранить ручные правки, summary — сводка), deps (вложенные компоненты: inline, inlineAll, same), prop/slot/mockup/part — правки confirm |
| `digest` | данные для кода: brief — выжимка spec.json (~4k токенов), spec — точечный просмотр слоёв; сам spec.json не открывать |
| `build` | tokens (токены в src/tokens.css), scaffold (заготовки и черновики кода; addTargets — новые targets в демо), svg (TSX-иконки из ассетов), units (правило единиц: только px и %), readme |
| `verify` | проверка сущности: единицы, typecheck, rstest, скриншоты, style-check |
| `hooks` | автопродолжение: install — Stop/SessionStart-хуки в настройки проекта, autopilot — перезапуск после сбоев API |

## Команды проекта

| Команда | Что делает |
|---|---|
| `npm run dev` | демо: `http://localhost:4600`. У каждого компонента две страницы. «Свойства» — все значения каждого свойства, состояния из Figma с эталонами и diff%, таблица API. «Песочница» — контролы свойств, превью и код JSX |
| `npm run build` | библиотека в `dist/`: отдельный ESM-вход на компонент (`<pkg>/Button`), CSS подключается автоматически, `.d.ts`, `dist/tokens.css` |
| `npm run gen` | пересобрать `src/index.ts`, `exports` в package.json и таблицы свойств для демо |
| `npm run typecheck` | TypeScript |
| `npm test` | rstest (unit-тесты из `craftlog/tests/`) |
| `npm run test:visual` | Playwright: скриншоты против эталонов Figma |

## Структура проекта

```
README.md                 о библиотеке и её npm-командах (блок между <!-- craftui:start/end --> обновляет init --update)
craftui.config.json       настройки проекта (раздел «Конфиг проекта» ниже)
src/tokens.css            общие токены (переменные и стили Figma), темы через [data-theme]
src/components/<Name>/    index.ts, <Name>.tsx, styles.module.css, types.ts, …, <Name>.demo.tsx
src/pages/<Page>/         то же для страницы + parts/<Page><Part>/ и assets/ (kind-page.md)
  README.md               свойства, версия и дата импорта, проверка, история версий (генерируется)
  craftlog/
    craftui.log.md     журнал импорта: источник, шаги, свойства, targets, отклонения, история
    state.json            машинное состояние (для продолжения)
    figma/                всё выкачанное: raw/, spec.json, node-map.json, screenshots/, assets/
    visual/               скриншот-тест, visual.config.json, output/ (actual, diff)
    tests/                rstest
scripts/gen.ts            сборка barrel, exports и метаданных демо из папок сущностей
src/pages/parts/<Имя>/    общие части страниц (part.json — откуда сделана)
demo/                     демо-приложение (шрифты макета — demoFonts в конфиге)
.craftui/              служебное: копия инструкций скилла, состояние хуков, логи установки
```

Скрипты craftui в проект не устанавливаются: вся работа — в глобальном MCP-сервере; формы данных (`spec.json`, state.json, node-map, конфиг) описаны в его `mcp/src/types.ts`.

## Конфиг проекта

`craftui.config.json` в корне проекта. Новые ключи `init --update` дописывает сам, ваши значения не трогает.

| Ключ | По умолчанию | Что задаёт |
|---|---|---|
| `source` | `chrome` | откуда данные: chrome (Chrome MCP) или figma (Figma MCP) |
| `defaultKind` | `component` | вид, если в запросе не сказано `component` / `page` |
| `dirs` | `src/components`, `src/pages` | папки сущностей, только `src/<имя>` на один уровень |
| `context` | `small` | окно модели: small (~64k) — короткие выводы brief / spec, large — подробнее |
| `verifyIterations` | `5` | сколько итераций verify до вопроса пользователю |
| `demoFonts` | `[]` | ссылки на CSS шрифтов макета для демо и скриншот-тестов |
| `scale`, `maxDiffRatio` | `2`, `0.01` | масштаб PNG-эталонов и порог сравнения компонентов |
| `pages` | — | `breakpoints` (инструмент `config`), `scale` (1), `maxDiffRatio` (0.02), `export` (страницы в сборке как `<pkg>/pages/<Page>`) |
| `tokenPrefix`, `port`, `receiverPort`, `autopilot` | | префикс токенов, порт демо, порт receiver, команды автопилота |

Инструмент `status` показывает ошибки конфига.

## Использование библиотеки

```ts
import '<pkg>/tokens.css';            // один раз в приложении
import { Button } from '<pkg>/Button'; // CSS компонента подтянется сам
import { Landing } from '<pkg>/pages/Landing'; // страница (pages.export)
```

Шрифты из макета подключает приложение.

## Частые проблемы

| Проблема | Решение |
|---|---|
| Нет инструментов craftui в сессии | сервер не подключён: плагин craftui или `node install.ts --mcp` из репозитория, затем перезапусти сессию |
| Figma MCP не авторизован | авторизуйте сервер в агенте (Claude Code: `/mcp`) или выберите chrome |
| В Chrome просит вход в Figma | войдите сами во вкладке, которую открыл агент, и ответьте «готово» |
| Chrome спрашивает доступ к локальной сети для figma.com | разрешите: так данные идут на диск напрямую (receiver на 127.0.0.1:4601) |
| `pluginApi: false` | откройте в файле Plugins → Development → Open console; read-only файл — сделайте копию |
| Тесты rstest или сервер не стартуют | Node.js 24 или новее (`node --version`) |
| Скриншот-тест: «target is missing» | id в `<Name>.demo.tsx` должен совпадать с именем эталона |
| Агент упал на ошибке API | `craftui continue` или инструмент `hooks` с action autopilot |
| Модель долго читает данные Figma и не начинает писать код, контекст постоянно сжимается | маленькое окно модели — см. раздел ниже |
| Нужно принять отличие от макета | попросите агента: он запишет отклонение и ослабит проверку только для этого состояния |

## Маленькое окно модели (LiteLLM, vLLM, локальные модели)

Скилл рассчитан и на модели с окном ~64k. Только системный промпт и инструменты Claude Code занимают из них 15–20k. Поэтому:
- `spec.json` и `figma/raw/*` модель не открывает: в проекте их чтение запрещено (`.claude/settings.json`). Данные для кода дают `digest` (brief и spec), свойства правятся через `spec` (action prop);
- карточка `next` самодостаточна, справочники нужны только в трудных местах;
- scaffold пишет черновик разметки и стилей из макета: модели остаётся довести его по замечаниям `verify`;
- `hooks` (action install) добавляет хук, который после сжатия контекста возвращает модели текущий шаг.

Claude Code должен знать настоящее окно модели. Иначе он сжимает контекст слишком поздно, и шлюз отвечает `400 ContextWindowExceededError`. Пример для qwen с окном 64000 токенов, в `env` файла `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_MODEL": "qwen3.8",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "qwen3.8",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3.8",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "qwen3.8",
    "CLAUDE_CODE_SUBAGENT_MODEL": "qwen3.8",
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "64000",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "8192",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "75",
    "CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS": "10000",
    "BASH_MAX_OUTPUT_LENGTH": "20000",
    "MAX_MCP_OUTPUT_TOKENS": "8000"
  }
}
```

- Имя модели — как в шлюзе. Оно не должно начинаться с `claude-`, иначе `CLAUDE_CODE_MAX_CONTEXT_TOKENS` не действует.
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS`: vLLM считает промпт и ответ вместе, а без этой настройки Claude Code просит 32000 токенов ответа, то есть половину окна.
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` не подходит: у него минимум 100000.
- Если ошибка всё же случилась — `/compact` в той же сессии, перезапуск не нужен.

## Ограничения

- Страницы импортируются только через Chrome MCP; Figma MCP для них пока не поддержан.

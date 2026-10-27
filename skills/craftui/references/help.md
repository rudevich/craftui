# craftui — справка

Импортирует компоненты из Figma (по одному или целым UI-китом) в React 19 + CSS Modules. Результат собирается в библиотеку на rspack, к ней прилагаются демо-страницы, общие токены, скриншот-тесты против Figma и unit-тесты.

## Как вызывать

| Что сказать агенту | Что произойдёт |
|---|---|
| `craftui <ссылка на компонент Figma>` | новый импорт через Chrome MCP (источник по умолчанию; другой — в `source` конфига) |
| `craftui <ссылка> через figma` / `через chrome` | новый импорт через Figma MCP / Chrome MCP |
| `craftui <ссылка на страницу UI-кита>` | список компонентов кита → выбор → пакетный импорт |
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

## Команды проекта

| Команда | Что делает |
|---|---|
| `npm run dev` | демо: `http://localhost:4600`. У каждого компонента две страницы. «Свойства» — все значения каждого свойства, состояния из Figma с эталонами и diff%, таблица API. «Песочница» — контролы свойств, превью и код JSX |
| `npm run build` | библиотека в `dist/`: отдельный ESM-вход на компонент (`<pkg>/Button`), CSS подключается автоматически, `.d.ts`, `dist/tokens.css` |
| `npm run gen` | пересобрать `src/index.ts`, `exports` в package.json и таблицы свойств для демо |
| `npm run typecheck` | TypeScript |
| `npm test` | rstest (unit-тесты из `craftlog/tests/`) |
| `npm run test:visual` | Playwright: скриншоты против эталонов Figma |
| `npm run craftui -- help` | все подкоманды craftui |

Главные подкоманды `craftui`:

| Команда | Что делает |
|---|---|
| `status`, `next [Name]` | где мы и что делать дальше (с точной командой) |
| `new component <Name> <url> [--source chrome\|figma] [--variant "Size=M"] [--filter f.json]` | создать сущность (источник по умолчанию — chrome) |
| `source <Name> list \| add <url> --variant … --filter …` | наборы Figma, из которых собран компонент (размеры, outline), фильтр вариантов |
| `begin/done/fail/skip <Name> <step>`, `reopen <Name> <step>` | отметки шагов; `reopen` — заново с шага (ресинк, новые наборы) |
| `wait/resume <Name>`, `log <Name> <текст>` | ожидание ответа пользователя, история |
| `url`, `receiver`, `snippet`, `put`, `rest-images` | работа с Figma |
| `normalize [--keep] [--summary]`, `deps [--inline <имя> \| --inline-all \| --same <имя> <Entity>]`, `tokens` | spec.json, вложенные компоненты (встроить, встроить всё, двойник сущности), токены |
| `slot <Name> <@ключ… \| Ось=Значение> <prop>` | слой (иконка во всех вариантах) или значение оси — содержимое пропа: `slot IconButton @root/content children` |
| `prop <Name> "<свойство Figma>" <имя React \| -> [тип] [--role …]` | правка или добавление свойства на шаге confirm без открытия spec.json |
| `scaffold [--force] [--add-targets]`, `svg <Name> <asset> <Icon>` | заготовки и черновики кода (разметка по слоям, стили по вариантам), новые targets в демо, TSX-иконки из ассетов (без пустых clipPath во весь размер) |
| `brief <Name>`, `spec <Name> [<target>] [<слой>]` | выжимка spec.json для кода (~4k токенов) и точечный просмотр слоёв; сам spec.json не открывать |
| `verify <Name> [--grep id]`, `shortcuts` | проверка (единицы, typecheck, rstest, скриншоты, style-check), сбор компромиссов |
| `units [Name]` | правило единиц: только `px` и `%`; `vw`/`vh`/`dvh`… — только оверлеи с `/* units: … */` |
| `readme [Name]` | README.md в папке компонента (обновляется и сам: при report и `npm run gen`) |
| `hooks install`, `autopilot` | автопродолжение: не останавливаться на середине, после сжатия контекста вернуть карточку шага, перезапуск после сбоев API |

Полный список: `npm run craftui -- help`.

## Структура проекта

```
README.md                 о библиотеке и её npm-командах (блок между <!-- craftui:start/end --> обновляет init --update)
craftui.config.json    source, scale (2), maxDiffRatio (0.01), tokenPrefix, port (4600), receiverPort (4601), autopilot
src/tokens.css            общие токены (переменные и стили Figma), темы через [data-theme]
src/components/<Name>/    index.ts, <Name>.tsx, styles.module.css, types.ts, …, <Name>.demo.tsx
  README.md               свойства, версия и дата импорта, проверка, история версий (генерируется)
  craftlog/
    craftui.log.md     журнал импорта: источник, шаги, свойства, targets, отклонения, история
    state.json            машинное состояние (для продолжения)
    figma/                всё выкачанное: raw/, spec.json, node-map.json, screenshots/, assets/
    visual/               скриншот-тест, visual.config.json, output/ (actual, diff)
    tests/                rstest
demo/                     демо-приложение; demo/fonts.ts — шрифты макета
.craftui/              служебное: копия инструкций скилла, логи установки
```

## Использование библиотеки

```ts
import '<pkg>/tokens.css';            // один раз в приложении
import { Button } from '<pkg>/Button'; // CSS компонента подтянется сам
```

Шрифты из макета подключает приложение.

## Частые проблемы

| Проблема | Решение |
|---|---|
| Figma MCP не авторизован | авторизуйте сервер в агенте (Claude Code: `/mcp`) или выберите chrome |
| В Chrome просит вход в Figma | войдите сами во вкладке, которую открыл агент, и ответьте «готово» |
| Chrome спрашивает доступ к локальной сети для figma.com | разрешите: так данные идут на диск напрямую (receiver на 127.0.0.1:4601) |
| `pluginApi: false` | откройте в файле Plugins → Development → Open console; read-only файл — сделайте копию |
| Тесты rstest не стартуют | Node.js `^20.19 || >=22.12` |
| Скриншот-тест: «target is missing» | id в `<Name>.demo.tsx` должен совпадать с именем эталона |
| Агент упал на ошибке API | `craftui continue` или `npm run craftui -- autopilot` |
| Модель долго читает данные Figma и не начинает писать код, контекст постоянно сжимается | маленькое окно модели — см. раздел ниже |
| Нужно принять отличие от макета | попросите агента: он запишет отклонение и ослабит проверку только для этого состояния |

## Маленькое окно модели (LiteLLM, vLLM, локальные модели)

Скилл рассчитан и на модели с окном ~64k. Только системный промпт и инструменты Claude Code занимают из них 15–20k. Поэтому:
- `spec.json` и `figma/raw/*` модель не открывает: в проекте их чтение запрещено (`.claude/settings.json`). Данные для кода дают `craftui brief` и `craftui spec`, свойства правятся через `craftui prop`;
- карточка `craftui next` самодостаточна, справочники нужны только в трудных местах;
- scaffold пишет черновик разметки и стилей из макета: модели остаётся довести его по замечаниям `craftui verify`;
- `npm run craftui -- hooks install` добавляет хук, который после сжатия контекста возвращает модели текущий шаг.

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

## Скоро

Вид **page** — экраны целиком (брейкпоинты, композиция из импортированных компонентов). Структура `src/pages/<Name>/craftlog/` и все команды craftui уже рассчитаны на него.

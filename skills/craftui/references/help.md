# craftui — справка

Импортирует компоненты из Figma (по одному или целым UI-китом) в React 19 + CSS Modules. Результат собирается в библиотеку на rspack, к ней прилагаются демо-страницы, общие токены, скриншот-тесты против Figma и unit-тесты.

## Как вызывать

| Что сказать агенту | Что произойдёт |
|---|---|
| `craftui <ссылка на компонент Figma>` | новый импорт (источник спросит или возьмёт из конфига) |
| `craftui <ссылка> через chrome` / `через mcp` | новый импорт с указанным источником |
| `craftui <ссылка на страницу UI-кита>` | список компонентов кита → выбор → пакетный импорт |
| `craftui continue` / «продолжи импорт» | продолжение с места остановки |
| `craftui fix Button: hover темнее, иконка 16px` | правки импортированного компонента |
| `craftui resync Button` | пересинхронизация с изменившимся макетом |
| `craftui status` | что импортировано и что в процессе |
| `craftui help` | эта справка |

В Claude Code: `/craftui …` (или `/craftui:craftui …`, если скилл установлен как плагин). В Codex: `$craftui …` или просто попросить словами.

Перед любыми изменениями агент показывает пронумерованный план. Его можно принять, отклонить или поправить.

## Источники данных

- **mcp** — официальный Figma MCP (удалённый `mcp.figma.com` или локальный из Figma Desktop). Нужна авторизация сервера в агенте.
- **chrome** — ваш Chrome, где выполнен вход в Figma: Claude in Chrome или chrome-devtools-mcp. Данные берутся через Plugin API страницы (иногда нужно один раз открыть Plugins → Development → Open console), запасной путь — сетевые запросы и Dev Mode. Если потребуется войти в Figma, агент попросит об этом явно.

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
| `new component <Name> <url> --source chrome\|mcp [--variant "Size=M"] [--filter f.json]` | создать сущность |
| `source <Name> list \| add <url> --variant … --filter …` | наборы Figma, из которых собран компонент (размеры, outline), фильтр вариантов |
| `begin/done/fail/skip <Name> <step>`, `reopen <Name> <step>` | отметки шагов; `reopen` — заново с шага (ресинк, новые наборы) |
| `wait/resume <Name>`, `log <Name> <текст>` | ожидание ответа пользователя, история |
| `url`, `receiver`, `snippet`, `put`, `rest-images` | работа с Figma |
| `normalize [--keep] [--summary]`, `deps [--inline <имя> \| --inline-all \| --same <имя> <Entity>]`, `tokens` | spec.json, вложенные компоненты (встроить, встроить всё, двойник сущности), токены |
| `slot <Name> <@ключ… \| Ось=Значение> <prop>` | слой (иконка во всех вариантах) или значение оси — содержимое пропа: `slot IconButton @root/content children` |
| `scaffold [--force] [--add-targets]`, `svg <Name> <asset> <Icon>` | заготовки, новые targets в демо, TSX-иконки из ассетов (без пустых clipPath во весь размер) |
| `verify <Name> [--grep id]`, `shortcuts` | проверка (единицы, typecheck, rstest, скриншоты, style-check), сбор компромиссов |
| `units [Name]` | правило единиц: только `px` и `%`; `vw`/`vh`/`dvh`… — только оверлеи с `/* units: … */` |
| `readme [Name]` | README.md в папке компонента (обновляется и сам: при report и `npm run gen`) |
| `hooks install`, `autopilot` | автопродолжение |

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
| Нужно принять отличие от макета | попросите агента: он запишет отклонение и ослабит проверку только для этого состояния |

## Скоро

Вид **page** — экраны целиком (брейкпоинты, композиция из импортированных компонентов). Структура `src/pages/<Name>/craftlog/` и все команды craftui уже рассчитаны на него.

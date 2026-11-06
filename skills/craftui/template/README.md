# __PACKAGE_NAME__

Библиотека React-компонентов (React 19, CSS Modules), импортированных из Figma скиллом craftui. У каждого компонента есть свой `README.md` в `src/components/<Name>/`: свойства, версия и дата импорта, результат проверки.

<!-- craftui:start -->
## Команды

Перед первым запуском: `npm install`, для скриншот-тестов ещё `npx playwright install chromium`.

| Команда | Что делает |
|---|---|
| `npm run dev` | демо компонентов на http://localhost:4600 |
| `npm run build` | сборка библиотеки в `dist/` |
| `npm run gen` | пересобирает сгенерированные файлы: экспорты и описание пропсов для демо |
| `npm run typecheck` | проверка типов во всём проекте |
| `npm test` | rstest: поведение компонентов и демо |
| `npm run test:visual` | скриншот-тесты: компоненты против эталонов из Figma |
| MCP-инструменты craftui | импорт из Figma и проверка (справка: `.craftui/skill/references/help.md`) |

### `npm run dev`

Сначала выполняет `gen`, затем запускает демо (rspack dev server) на порту `port` из `craftui.config.json`, по умолчанию 4600. Слева список компонентов, у каждого две страницы:
- **Свойства** (`#/components/<Name>`): компонент со всеми значениями каждого свойства, состояния из Figma рядом с эталоном и процентом расхождения, таблица API;
- **Песочница** (`#/components/<Name>/playground`): свойства задаются контролами, код JSX можно скопировать.

Страница перезагружается при правке `src/` и `demo/`; файлы в `craftlog/` (эталоны, результаты тестов) перезагрузку не вызывают. После правки `rspack.*.config.mjs` перезапусти сервер: скриншот-тесты используют уже запущенный.

### `npm run build`

`gen` → rspack (`rspack.lib.config.mjs`) → tsc (`tsconfig.build.json`, только `.d.ts`). В `dist/`:
- `components/<Name>/index.js` и `index.css` — отдельная точка входа каждого компонента, JS сам подключает свой CSS;
- `index.js` — все компоненты одним импортом;
- `tokens.css` — токены дизайна (цвета, радиусы, типографика), подключаются в приложении один раз;
- `<номер>.js` и `.css` — общий код нескольких компонентов (`src/lib/`), его подключают сами компоненты;
- `.d.ts` рядом с JS.

Демо, `craftlog/` и тесты в сборку не попадают. React — `peerDependency`, в `dist/` его нет. Шрифты библиотека не подключает: это делает приложение.

### `npm run gen`

Генерирует из `src/components/*`:
- `src/index.ts` — экспорт всех компонентов;
- `exports` в `package.json` — путь `./<Name>` для каждого компонента;
- `demo/.generated/props.json` — пропсы из `types.ts` (тип, значение по умолчанию, JSDoc) для витрины, песочницы и README.

Сам запускается из `dev`, `build` и `typecheck`. Вручную нужен после добавления или переименования компонента и правки `types.ts`, если демо не запущено. Сгенерированные файлы руками не правят: перезапишутся.

### `npm run typecheck`

`gen`, затем `tsc --noEmit` по компонентам, демо и тестам. Проверяет и запреты в типах: строка теста с `@ts-expect-error` (например, кнопка без обязательного `aria-label`) даёт ошибку, если запрещённое вдруг стало разрешено.

### `npm test`

rstest в happy-dom (без браузера):
- `src/**/craftlog/tests/*.test.tsx` — поведение компонентов: пропсы, состояния, клавиатура, доступность;
- `demo/**/*.test.tsx` — контролы и JSX песочницы.

Один компонент: `npx rstest run src/components/<Name>`.

### `npm run test:visual`

Playwright снимает каждый вариант каждого компонента и сравнивает с PNG-эталоном из Figma (`src/components/<Name>/craftlog/figma/screenshots/`). Демо поднимает сам или берёт уже запущенное. Порог и исключения с причинами — `craftlog/visual/visual.config.json`, результаты — `craftlog/visual/output/`: `<id>.actual.png`, `<id>.diff.png` (красное — отличия), `<id>.json`.

Для одного компонента удобнее `craftui verify {"entity":"<Name>"}`: единицы, типы, rstest, скриншоты и сверка стилей с Figma (style-check) одной короткой сводкой.

### Инструменты craftui (MCP)

Импорт из Figma ведут инструменты MCP-сервера craftui (агент вызывает их сам). Импорт и правки обычно ведёт агент со скиллом craftui, без скилла — по `.craftui/skill/SKILL.md`. Чаще всего нужны:

| Инструмент | Что делает |
|---|---|
| `status`, `next` | компоненты проекта и следующий шаг с точными вызовами |
| `verify {"entity":"<Name>"}` | полная проверка компонента |
| `build {"action":"units","entity":"<Name>"}` | правило единиц: размеры только в `px` и `%` |
| `build {"action":"readme"}` | пересобрать README компонента |
| `hooks {"action":"install"}` / `{"action":"autopilot"}` | автопродолжение работы агента после сбоев |

Справка по всем инструментам: `.craftui/skill/references/help.md`.

## Использование

```tsx
import '__PACKAGE_NAME__/tokens.css'; // один раз в приложении
import { Name } from '__PACKAGE_NAME__/Name'; // или все сразу: from '__PACKAGE_NAME__'
```

## Структура

- `src/components/<Name>/` — компонент: `<Name>.tsx`, `types.ts`, `styles.module.css`, `index.ts`, демо `<Name>.demo.tsx`, `README.md` и `craftlog/` (данные из Figma, журнал импорта, тесты);
- `src/pages/<Page>/` — адаптивная страница из Figma (фрейм на брейкпоинт): то же устройство, плюс `parts/` (внутренние части) и `assets/` (картинки); подключение — `<pkg>/pages/<Page>`;
- `src/lib/` — общий код компонентов (`cx`, общие стили и части);
- `src/tokens.css` — токены дизайна;
- `demo/` — приложение демо, `tests/` — общий код скриншот-тестов, `scripts/` — `gen` и `craftui`;
- `craftui.config.json` — настройки: источник данных, папки, брейкпоинты страниц, шрифты демо, пороги проверки;
- `.craftui/` — инструкции скилла и служебные файлы.
<!-- craftui:end -->

# Сценарии: новый проект, импорт, продолжение, правки, ресинк

Подробности к разделу «Сценарии» в `SKILL.md`. Читай нужный раздел, когда карточки `craftui next` не хватает.

## Вход

- В папке есть `craftui.config.json` → выполни `craftui status`. Если есть незавершённая работа и пользователь не просил другого, переходи к **B**.
- Проекта нет → в плане (правило 1) предложи развернуть его:
  1. `node <skill>/scripts/init-project.ts`;
  2. `npm install --no-audit --no-fund > .craftui/install.log 2>&1`;
  3. `npx playwright install chromium`.

  Нужна Node.js 24 или новее. Если скрипт сообщает о чужом `package.json`, спроси: библиотека в подпапке или `--merge`.
- Обновить инструменты в существующем проекте: `node <skill>/scripts/init-project.ts --update`.
- Для Claude Code и Codex предложи в плане автопродолжение: `craftui hooks {"action":"install"}`. Это постоянная настройка проекта, поэтому только с согласия пользователя. Хук не даёт остановиться на середине. После сжатия контекста он подсказывает текущий шаг.

## A. Новый импорт

1. `craftui figma-url {"url":"<ссылка>"}`. Если проекта ещё нет — тот же инструмент `figma-url` (работает и без проекта). Если в ссылке нет node-id, попроси ссылку на слой (ПКМ → Copy link to selection).
2. **Источник:** из сообщения пользователя («через chrome» / «через figma») → `source` в `craftui.config.json` → иначе **chrome** (Chrome MCP: Claude in Chrome или chrome-devtools-mcp). Проверь, что инструменты источника доступны. Нет браузерного MCP — скажи об этом и предложи figma (Figma MCP). Если Figma MCP требует авторизации, скажи пользователю, как её пройти (в Claude Code: `/mcp`).
3. **Разведка без записи:** узнай тип узла и имя (metadata через MCP или проба в Chrome: `craftui extract {"action":"snippet","url":"<ссылка>","step":"probe"}`, см. справочник источника).
   - COMPONENT_SET / COMPONENT → один компонент.
   - INSTANCE → предложи импортировать его главный компонент.
   - PAGE или секция UI-кита → список наборов. Компонент может состоять из нескольких наборов (по размерам, outline): тогда это одна сущность с несколькими источниками. Несколько разных компонентов → выбор и очередь (`kind-component.md`, «UI-кит»).
   - Сотни вариантов в наборе → вместе с пользователем выбери приоритетные targets и задай фильтр (`figma-chrome.md`, «Разведка»).
   - Экран (страница приложения) → вид `page` (`kind-page.md`). probe по секции или странице Figma перечисляет фреймы с шириной и диапазоном; предложи по фрейму на брейкпоинт.
   - Вид задаёт пользователь: «страница» / `page` → page, иначе `defaultKind` из `craftui.config.json` (component). Не угадывай по картинке: экран, который пользователь назвал компонентом, импортируется как компонент.
4. **Для страницы — брейкпоинты.** `craftui config` показывает диапазоны. Не заданы — их можно передать прямо в create: `"breakpoints":"767,1279"` (верхние границы mobile/tablet/desktop, пустой сегмент — диапазона нет; запишутся в config). Ширины фреймов подскажет probe. Если и там неизвестно — спроси пользователя AskUserQuestion: mobile до скольки px; tablet до скольки (пусто — нет); desktop до скольки (пусто — без верхней границы, large desktop не нужен). Затем `craftui config {"mobile":…,"tablet":…,"desktop":null}`.
5. **План → подтверждение** (правило 1). Отдельно — **имя компонента**: PascalCase из имени в Figma как первый вариант (`Button / Primary` → `Button`, кириллицу транслитерируй или переведи), с проверкой, что такой папки ещё нет.
6. `craftui create {"kind":"component|page","name":"<Name>","url":"<ссылка>","source":"chrome|figma","variant":"Size=M","filter":"<файл>","breakpoints":"767,1279"}`, затем остальные наборы (у страницы — фреймы брейкпоинтов): `craftui sources {"entity":"<Name>","action":"add",…}`.
7. Дальше цикл `next` (см. `SKILL.md`). Шаги страницы — в `kind-page.md`. Шаги компонента:
   - extract → normalize;
   - confirm: свойства и targets подтверждает пользователь, и строки `?` сводки (предложенные слоты) тоже;
   - screenshots;
   - deps: вложенные компоненты импортируются раньше родителя (`craftui create {…,"parent":"<Name>}`);
   - tokens → scaffold (черновики TSX и CSS из макета) → code (доводка черновиков по `craftui brief`) → tests → verify (до 5 итераций) → report.
   Шаги normalize, tokens, scaffold и deps закрываются сами при успешном вызове инструмента (конфликты токенов и неразрешённые вложенные оставляют шаг открытым); extract и screenshots в chrome-режиме закрывает receiver последней выгрузкой сниппета. Ручные `step begin/done` — запасной путь.
8. Итоговый отчёт — по `log-format.md`. `craftui step {"action":"done","entity":"<Name>","step":"report"}` закрывает версию импорта и пишет `README.md` в папке компонента. Затем пригласи пользователя дать правки.

## B. Продолжение

`craftui next` (без имени — по всему проекту: сначала вложенные, потом родители). Покажи план оставшихся шагов → подтверждение → цикл `next`.

## C. Правки от пользователя

Прочитай лог (`src/<kind>/<Name>/craftlog/craftui.log.md`) и файлы компонента. Покажи план правки и получи подтверждение. Внеси правку и прогони `craftui verify {"entity":"<Name>"}` (для затронутых состояний поле "grep":"<id>"). Запиши задачу и результат: `craftui log {"entity":"<Name>","text":"…"}`.
- Пользователь сознательно отходит от макета → раздел «Отклонения от макета» в логе плюс порог или маска в `craftlog/visual/visual.config.json` (`verify.md`). Эталон Figma не переписывай.
- Новое поведение → добавь rstest-тест.

## D. Ресинк с Figma

1. План.
2. `craftui step {"action":"reopen","entity":"<Name>","step":"extract","text":"<причина>"}`. Причина попадёт в историю версий README.
3. Заново шаги extract, normalize и screenshots. normalize с "keep":true сохраняет ручные правки props и targets и добавляет новые значения.
4. Новые targets добавь в демо: `craftui build {"action":"scaffold","entity":"<Name>","addTargets":true}`.
5. `verify` покажет, какие состояния разошлись с обновлённым макетом. Обнови код и тесты и запиши итог в лог.

Так же добавляются новые наборы (размеры, outline): `craftui sources {"entity":"<Name>","action":"add",…}` → `reopen`.

## E. Headless-импорт (без агента)

Раннер `node <репозиторий>/mcp/auto.ts --url <ссылка> --name <Name>` проходит create → extract → normalize → screenshots → deps → tokens → scaffold → verify без LLM (Chrome с debugging-портом, см. `figma-chrome.md`, раздел «Headless-режим»). Confirm при этом пропускается, поэтому после headless-импорта агент на шаге code обязан:

1. Проверить имена сущностей: раннер называет их PascalCase-именем набора с запечёнными осями (`SegmentItemHorizontalMRounded`). Переименуй по семантике (`Item`, `SegmentGroup`, …) — папка, файлы, `state.json`, ссылки `entity:component/…` в spec родителей.
2. Раскрыть контейнеры: списки однотипных инстансов в spec — это `children`/слоты (см. `code-conventions.md`); не оставляй `children?: never` у очевидного контейнера.
3. Сверить composition с эталонами PNG (`craftlog/figma/screenshots/*.png`): какие айтемы selected (и какой `selectView`), где скролл/обрезка — они различаются по targets.
4. Однофамильные наборы (один компонент в разных размерах/ориентациях) раннер импортирует как отдельные сущности — при необходимости объедини в одну с осью Size/Orientation через `sources {"action":"add",…}` и `reopen`.

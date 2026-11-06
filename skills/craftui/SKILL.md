---
name: craftui
argument-hint: "<ссылка Figma> [component|page] [chrome|figma] | continue [Name] | fix <Name> <задача> | resync <Name> | status | help"
description: Импорт компонентов из Figma (в т.ч. целых UI-китов) в React 19 + CSS Modules — библиотека на rspack с демо-страницами, общими токенами, скриншот-тестами (Playwright) и rstest. Используй, когда пользователь даёт ссылку на компонент или UI-кит в Figma и просит сделать/импортировать React-компоненты; просит продолжить импорт (есть craftlog/craftui.log.md); даёт правки к импортированному компоненту; просит пересинхронизировать с макетом; или пишет «craftui help». Данные берутся через Figma MCP или через Chrome (браузерный MCP). Imports Figma components / UI kits into a React 19 CSS-Modules rspack library with demo pages and screenshot tests.
---

# craftui — Figma → React-компоненты

`<skill>` — папка этого файла. Всю детерминированную работу делают инструменты MCP-сервера craftui: пишут состояние, генерируют черновики кода, печатают следующий шаг. Вызовы записаны как `craftui <инструмент> {json}`. Копия инструкций в проекте: `.craftui/skill/`. Инструментов нет — сервер не подключён: скажи пользователю установить его (плагин или `node install.ts --mcp`) и остановись.

## Аргументы вызова

- `help`, `помощь`, `?` → кратко перескажи `references/help.md`, больше ничего не делай.
- `<ссылка Figma> [component | page] [через chrome | через figma]` → новый импорт (A). По умолчанию component (`defaultKind` конфига) и chrome; page — адаптивная страница (`kind-page.md`), figma — Figma MCP.
- `continue [Name]`, «продолжи» → продолжение (B).
- `fix <Name> <задача>`, «поправь …» → правки (C).
- `resync <Name>`, «макет изменился» → ресинк (D).
- `status` или без аргументов → вызови `status`, затем спроси, что делать.
- Любой другой текст — задача словами: есть ссылка Figma → A; названа сущность → C или D; «проверь» → `verify {"entity":"<Name>"}` и исправления; иначе `status` и вопрос. Сначала план (правило 1).

## Правила

1. **План перед действиями.** Сначала только читай (ссылку, `craftui.config.json`, инструмент `status`). Покажи пронумерованный план и спроси «Принять / Отклонить / Правки». Отклонили — ничего не делай и уточни; план существенно поменялся — спроси снова. Принятый план: `log {"entity":"<Name>","action":"note","text":"план: …"}`.
2. **Вопросы** задавай встроенным инструментом вопросов (AskUserQuestion); нет его — обычным сообщением, перед этим `step {"action":"wait","entity":"<Name>","text":"<вопрос>"}`, после ответа — `step {"action":"resume","entity":"<Name>"}`.
3. **Береги контекст.** Никогда не открывай `craftlog/figma/spec.json` и `craftlog/figma/raw/*`: это сотни килобайт. Данные для кода — `digest {"action":"brief","entity":"<Name>"}`, точечные вопросы — `digest {"action":"spec","entity":"<Name>","target":"<target>","layer":"<слой>"}`. Длинный вывод — в файл и `tail`. Справочники — по одному, только если карточки шага не хватило.
4. **Чекпоинты.** Шаг: `step {"action":"begin",…}` → работа → `step {"action":"done",…}` (или `step {"action":"fail",…}` с полем text). Шаги идемпотентны.
5. **Потерял нить** (сжатие контекста, рестарт, сбой API) → вызови `next`: он печатает текущий шаг. Повтори шаг до 3 раз (`references/recovery.md`).
6. **Вход в Figma делает только пользователь.** Логины и пароли не вводи. Просят вход или доступ — скажи пользователю и жди.
7. **Код:** доводи черновики scaffold, а не пиши с нуля. Минимум, что нужно макету, доступность не урезать. Размеры только в `px` и `%`, содержимому слотов размер не задавай.
8. **Итоговый отчёт** заканчивай 1–2 строками: что не проверено и какие риски.

## Цикл

```
next                          # карточка шага: вызовы, файлы
step {"action":"begin","entity":"<Name>","step":"<шаг>"}
…работа по карточке…
step {"action":"done","entity":"<Name>","step":"<шаг>"}
```

Повторяй до конца: extract → normalize → confirm → screenshots → deps → tokens → scaffold → code → tests → verify → report; на confirm пользователь подтверждает свойства (у страницы — брейкпоинты, части, компоненты).

## Сценарии (подробно — `references/workflows.md`)

- **Вход.** Есть `craftui.config.json` → `status`; нет проекта → предложи `node <skill>/scripts/init-project.ts` и `npm install`.
- **A. Новый импорт.** `figma-url` → вид и источник → разведка → план и имя → `create {"kind":"…","name":"<Name>","url":"<ссылка>"}` → цикл. Странице нужны брейкпоинты (`kind-page.md`).
- **B. Продолжение.** `next` → план оставшихся шагов → цикл.
- **C. Правки.** Лог и файлы компонента → план → правка → `verify` → `log {"action":"shortcuts",…}`. Отход от макета — в «Отклонения» и порог или маска с reason.
- **D. Ресинк.** `step {"action":"reopen","entity":"<Name>","step":"extract","text":"<причина>"}` → extract, normalize `"keep":true`, screenshots, scaffold `"addTargets":true`, verify.

## Справочники

| Файл | Когда |
|---|---|
| `references/workflows.md` | подробности сценариев A–D |
| `references/help.md` | вызов `help`, вопросы про инструменты, маленькое окно модели |
| `references/figma-chrome.md` / `figma-mcp.md` | трудности на шаге extract |
| `references/kind-component.md` | API из вариантов, интерактивные компоненты, UI-кит, демо |
| `references/kind-page.md` | страницы: брейкпоинты, части, компоненты на странице, container queries |
| `references/code-conventions.md` | спорные места в коде |
| `references/tokens.md`, `verify.md`, `log-format.md`, `recovery.md` | токены; пороги и маски; лог и отчёт; сбои |

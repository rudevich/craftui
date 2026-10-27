---
name: craftui
description: Импорт компонентов из Figma (в т.ч. целых UI-китов) в React 19 + CSS Modules — библиотека на rspack с демо-страницами, общими токенами, скриншот-тестами (Playwright) и rstest. Используй, когда пользователь даёт ссылку на компонент или UI-кит в Figma и просит сделать/импортировать React-компоненты; просит продолжить импорт (есть craftlog/craftui.log.md); даёт правки к импортированному компоненту; просит пересинхронизировать с макетом; или пишет «craftui help». Данные берутся через Figma MCP или через Chrome (браузерный MCP). Imports Figma components / UI kits into a React 19 CSS-Modules rspack library with demo pages and screenshot tests.
---

# craftui — Figma → React-компоненты

`<skill>` — папка этого файла. Всю детерминированную работу делают команды `npm run craftui -- …` в проекте: они пишут состояние, генерируют черновики кода и печатают следующий шаг. Копия инструкций в проекте: `.craftui/skill/`.

## Аргументы вызова

- `help`, `помощь`, `?` → кратко перескажи `<skill>/references/help.md` и больше ничего не делай.
- `<ссылка Figma> [через chrome | через mcp]` → новый импорт (A).
- `continue [Name]`, «продолжи» → продолжение (B).
- `fix <Name> <задача>`, «поправь …» → правки (C).
- `resync <Name>`, «макет изменился» → ресинк (D).
- `status` или без аргументов → `npm run craftui -- status`, затем спроси, что делать.

## Правила

1. **План перед действиями.** Сначала только читай (ссылку, `craftui.config.json`, `npm run craftui -- status`). Затем покажи пронумерованный план и спроси «Принять / Отклонить / Правки». Отклонили — ничего не делай и уточни. План существенно поменялся — спроси снова. Принятый план: `npm run craftui -- log <Name> "план: …"`.
2. **Вопросы** задавай встроенным инструментом вопросов (AskUserQuestion). Если его нет — обычным сообщением, перед этим `npm run craftui -- wait <Name> "<вопрос>"`, после ответа — `craftui resume <Name>`.
3. **Береги контекст.** Никогда не открывай `craftlog/figma/spec.json` и `craftlog/figma/raw/*`: это сотни килобайт. Данные для кода — `npm run craftui -- brief <Name>`, точечные вопросы — `npm run craftui -- spec <Name> <target> <слой>`. Длинный вывод команд направляй в файл и смотри `tail`. Справочники из `references/` читай, только если карточки шага не хватило, и только нужный раздел.
4. **Чекпоинты.** Шаг: `craftui begin <Name> <step>` → работа → `craftui done <Name> <step>` (или `craftui fail <Name> <step> "<ошибка>"`). Шаги идемпотентны.
5. **Потерял нить** (сжатие контекста, рестарт, сбой API) → `npm run craftui -- next`: он печатает текущий шаг. Повтори шаг до 3 раз (`references/recovery.md`).
6. **Вход в Figma делает только пользователь.** Логины и пароли не вводи. Просят вход или доступ — скажи пользователю и жди.
7. **Код:** доводи черновики scaffold, а не пиши с нуля. Минимум, что нужно макету, доступность не урезать. Размеры только в `px` и `%`, содержимому слотов размер не задавай.
8. **Итоговый отчёт** заканчивай 1–2 строками: что не проверено и какие риски.

## Цикл

```
npm run craftui -- next        # шаг, команды, файлы — всё в карточке
npm run craftui -- begin <Name> <step>
…работа по карточке…
npm run craftui -- done <Name> <step>
```

Повторяй до конца: extract → normalize → confirm → screenshots → deps → tokens → scaffold → code → tests → verify → report. На шаге confirm свойства подтверждает пользователь.

## Сценарии (подробно — `references/workflows.md`)

- **Вход.** Есть `craftui.config.json` → `status`; нет проекта → предложи `node <skill>/scripts/init-project.mjs` и `npm install`.
- **A. Новый импорт.** `craftui url` → источник (chrome / mcp) → разведка → план и имя → `craftui new component <Name> "<ссылка>" --source …` → цикл.
- **B. Продолжение.** `next` → план оставшихся шагов → цикл.
- **C. Правки.** Лог и файлы компонента → план → правка → `craftui verify <Name>` → `craftui log`. Отход от макета — в «Отклонения» лога и порог или маска с reason.
- **D. Ресинк.** `craftui reopen <Name> extract "<причина>"` → extract, normalize `--keep`, screenshots → `scaffold --add-targets` → verify.

## Справочники

| Файл | Когда |
|---|---|
| `references/workflows.md` | подробности сценариев A–D |
| `references/help.md` | вызов `help`, вопросы про команды, маленькое окно модели |
| `references/figma-chrome.md` / `figma-mcp.md` | трудности на шаге extract |
| `references/kind-component.md` | API из вариантов, интерактивные компоненты, UI-кит, демо |
| `references/code-conventions.md` | спорные места в коде |
| `references/tokens.md`, `verify.md`, `log-format.md`, `recovery.md` | токены; пороги и маски; лог и отчёт; сбои |

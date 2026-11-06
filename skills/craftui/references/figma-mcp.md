# Источник mcp: Figma MCP

Официальный Figma MCP бывает двух видов: удалённый (`https://mcp.figma.com/mcp`, вход через OAuth) и локальный из десктопного приложения Figma (Dev Mode). Имена инструментов зависят от клиента, нужны эти:

| Инструмент | Зачем |
|---|---|
| `get_metadata` | XML-структура узла: id, имена, типы, размеры, варианты |
| `get_design_context` | код узла (React + Tailwind): источник значений стилей и ссылок на ассеты |
| `get_variable_defs` | переменные, которые использует узел (токены) |
| `get_screenshot` | картинка узла для сверки «на глаз» |

Параметры — `fileKey` и `nodeId` из `craftui figma-url {"url":"<ссылка>"}` (nodeId через двоеточие: `2601:7740`). Если сервер не авторизован, скажи пользователю, как подключить его в своём агенте (в Claude Code — `/mcp`), и жди.

## Шаг extract: что и куда сохранять

Делай по одному вызову за раз и сразу пиши результат в файл:
1. `get_metadata(root)` → `craftlog/figma/raw/metadata.xml` (XML как есть).
2. `get_variable_defs(root)` → `craftlog/figma/raw/variables.json` (объект `{ "Colors/Primary": "#1A73E8", … }`).
3. Для каждого варианта (дочерний узел набора с именем вида `Size=M, State=Hover`) вызови `get_design_context(variantId)` → `craftlog/figma/raw/design-context/<id с ":"→"-">.tsx`. Если вариантов больше 12 — начни с вариантов по умолчанию для каждой оси, остальные добавляй по мере надобности.

Код из `get_design_context` используй только как источник чисел, цветов и структуры. Его Tailwind-классы в проект не переносятся: переводи их в CSS Modules (`code-conventions.md`).

## normalize

`craftui spec {"action":"normalize","entity":"<Name>"}` строит targets из вариантов в metadata, а `css` и `expect` узлов — из Tailwind-классов design context (по `data-node-id`, best effort). Свойства TEXT, BOOLEAN и INSTANCE_SWAP в metadata не видны: на шаге confirm добавь их по коду design context командой `craftui spec {"action":"prop","entity":"<Name>","figma":"<свойство Figma>","react":"<имя React>","type":"<тип TS>","role":"text|bool|slot","default":"<значение>"}` и согласуй с пользователем. `spec.json` руками не открывай: он большой.

## Эталоны (шаг screenshots), по порядку

1. В ответах MCP есть ссылки на изображения узлов (локальный сервер отдаёт `http://localhost:3845/assets/…`) → скачай `curl -o craftlog/figma/screenshots/<id>.png`.
2. В окружении есть `FIGMA_TOKEN` → `craftui extract {"action":"rest-images","entity":"<Name>"}` (один пакетный запрос, масштаб из конфига).
3. Есть Chrome → гибрид: эталоны через `snippet export` (`figma-chrome.md`).
4. Иначе попроси пользователя: выделить варианты → Export → PNG 2x → сохранить как `<id>.png` в `craftlog/figma/screenshots/`. Список id: `craftui spec {"action":"normalize","entity":"<Name>","summary":true}`. До этого сверяй «на глаз»: `get_screenshot` против `craftlog/visual/output/<id>.actual.png`.

## Вложенные компоненты

В metadata инстансы видны как `<instance>`. `craftui spec {"action":"deps",…}` сопоставляет их по имени (ключей компонентов MCP не даёт). Ссылку на главный компонент спроси у пользователя или найди через `get_metadata` на странице библиотеки.

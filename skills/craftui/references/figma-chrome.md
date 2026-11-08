# Источник chrome: Figma в настоящем Chrome пользователя

Работаем во вкладке Chrome, где пользователь уже вошёл в Figma. Тяжёлые данные (дерево узлов, PNG, SVG) страница отправляет прямо на диск через локальный receiver и не проходит через контекст модели.

## Инструменты

| Действие | Claude Code (Claude in Chrome) | Codex и другие (chrome-devtools-mcp) |
|---|---|---|
| вкладки | `tabs_context_mcp`, `tabs_create_mcp` | `list_pages`, `new_page` |
| открыть URL | `navigate` | `navigate_page` |
| выполнить JS в странице | `javascript_tool` — **выражение** | `evaluate_script` — **функция** `async () => …` (код можно взять из файла: `sourcePath`) |
| сетевые запросы | `read_network_requests` | `list_network_requests`, `get_network_request` |
| текст страницы | `get_page_text`, `read_page` | `take_snapshot` |
| скриншот | `computer` → screenshot | `take_screenshot` |

`craftui extract` (action snippet) печатает обе формы: выражение для `javascript_tool` и функцию для `evaluate_script`. Если один инструмент не подключён, используй другой: chrome-devtools-mcp поднимает свой Chrome, в котором пользователь входит в Figma сам. Работай в новой вкладке и не трогай вкладки пользователя.

## 0. Вход и доступ — обязательная проверка

1. Открой ссылку в новой вкладке. Подожди, пока загрузится холст (5–10 с; при таймауте навигации проверь список вкладок — страница обычно уже открыта).
2. Проба: `craftui extract {"action":"snippet","url":"<ссылка>","step":"probe"}` (до `craftui new`) или `snippet <Name> probe`. Выполни код в странице.
   - `needsLogin: true` → **остановись** и явно напиши пользователю: «В Chrome нужно войти в Figma — вкладка <url>. Войдите и ответьте „готово“». Перед вопросом — `craftui step {"action":"wait","entity":"<Name>","text":"вход в Figma"}` (если сущность уже создана).
   - `requestAccess: true` → попроси запросить доступ к файлу или открыть его под нужным аккаунтом.
   - Логин, пароль и коды не вводи никогда.

## 1. Plugin API

Figma создаёт `window.figma` **лениво, при первом обращении**: сниппеты сами ждут его до 10 с. Если `pluginApi: false`:
- повтори probe ещё раз (первое обращение могло только запустить создание);
- иначе попроси пользователя открыть в этом файле **Plugins → Development → Open console** (или запустить любой плагин) и повтори;
- файл только для просмотра → предложи сделать копию (Duplicate) или перейди к п. 5.

`receiver: true` значит, что страница достучалась до `http://127.0.0.1:4601`. Если там `blocked: …`: запусти `craftui extract {"action":"receiver"}` в фоне. Если Chrome спрашивает про доступ к локальной сети — пусть пользователь разрешит. Если и это не помогло — «Без receiver».

## 2. Разведка: что за узел

Результат probe содержит `node`:
- `PAGE` (ссылка на страницу кита) → в `components` список наборов: id, имя, число вариантов. Выбери нужный набор (или несколько: размеры, outline) и повтори probe по его id;
- `COMPONENT_SET` → `properties` (оси вариантов) и `variants`, `nested` (вложенные компоненты, `remote` — из библиотеки);
- `INSTANCE` → `main`: предложи импортировать главный компонент.

**Большие наборы.** В UI-ките в наборе бывают сотни вариантов (кнопка: 830). За раз извлекается не больше 80 вариантов на источник. Выбери приоритетные targets вместе с пользователем и задай фильтр: JSON-массив частичных наборов осей, вариант подходит, если совпадает с любым объектом.

```json
[{"Stretching":"Auto","ContentLeft":"False","Loading":"False","Disabled":"False","Hovered":"False","Actived":"False"},
 {"View":"Accent","Hovered":"True"}]
```

**Несколько наборов на один компонент** (по набору на размер, отдельный outline-набор):

```
craftui create {"kind":"component","name":"BasicButton","url":"<ссылка на набор M>","source":"chrome","variant":"Size=M","filter":"filters/m.json"}
craftui sources {"entity":"BasicButton","action":"add","url":"<ссылка на набор XL>","variant":"Size=XL","filter":"filters/sizes.json"}
craftui sources {"entity":"BasicButton","action":"add","url":"<ссылка на outline M>","variant":"Size=M, View=Secondary Outline"}
```

Поле `variant` добавляет ось (Size) или переопределяет значение (View=Secondary → Secondary Outline). `craftui sources {"entity":"<Name>"}` показывает источники.

## 3. Извлечение (шаг extract)

1. Receiver в фоне: `craftui extract {"action":"receiver"}` (после обновления скриптов перезапусти его).
2. `craftui extract {"action":"snippet","entity":"<Name>","step":"probe-extract"}` → выполни выведенный однострочник. Один прогон: разведка (probe) и сразу выгрузка всех источников с фильтрами в `craftlog/figma/raw/plugin.json`; в ответе `probe` и сводка `extract`.
3. Сниппет сам попросит настроить источники, если их несколько или вариантов больше капа: ответ содержит готовый вызов `craftui sources {…}` (или смотри «Разведку» выше). После `craftui sources {"action":"add"|"filter",…}` повтори тот же сниппет. Значения осей сравниваются без учёта регистра (в одном ките бывает `Disclosure=false` и `Disclosure=False`). Если фильтр источника не нашёл ни одного варианта, в сводке будет `warnings` с осями этого набора — поправь фильтр (`craftui sources {"entity":"<Name>","action":"filter","index":<i>}`).
4. По отдельности: `step:"probe"` — только разведка, `step:"extract"` — только выгрузка (после настройки источников).
5. Наборы из подключённой библиотеки (`remote`) открываются по id так же, как локальные: id набора даёт `getMainComponentAsync()` у его инстанса, ссылку собери как `…?node-id=<id>`. Но **Figma подгружает в файл не всё содержимое библиотечных компонентов**: у части вариантов вложенная ячейка или иконка приходит пустой. normalize пишет об этом `⚠ Figma не подгрузила содержимое…`. Эталоны PNG при этом верные: недостающие стили бери из вариантов, где слой есть, или из инстансов в родительском компоненте.
6. **Таймаут вызова инструмента** не означает, что работа остановилась: подожди и прочитай в странице `window.__craftui` (`{ step, status, result | error }`).
7. Чистый прогон по всем источникам закрывает шаг extract сам (`stepClosed: 'extract'` в сводке); `warnings` (кап, пустой фильтр) оставляют его открытым — разбери и повтори.

## 4. Эталоны и ассеты (шаг screenshots)

После normalize: `craftui extract {"action":"snippet","entity":"<Name>","step":"export"}`. Каждый target экспортируется в PNG с `scale` из конфига, векторные ассеты — в SVG: `craftlog/figma/screenshots/<id>.png` и `craftlog/figma/assets/`. Обычно эталон — рамка узла (`useAbsoluteBounds`). Если вариант рисует что-то за рамкой (открытый список под полем, тень, точка обязательности слева), экспорт берёт область отрисовки, а смещение и размер этой области пишет в `screenshots/bounds.json`; сводка перечисляет такие targets в `outsideNode`. Скриншот-тест снимает ту же область. Когда все targets выгрузились без ошибок, сниппет закрывает шаг screenshots сам (`stepClosed: 'screenshots'` в сводке); при `failed` шаг остаётся открытым — разбери список и повтори.

## Без receiver (fetch к 127.0.0.1 заблокирован)

- `craftui extract {"action":"snippet","entity":"<Name>","step":"extract","inline":true}` печатает код целиком. Замени в нём отправку на receiver возвратом JSON и при большом объёме режь его на куски по 50–100 КБ.
- `craftui extract {"action":"put","entity":"<Name>","path":"figma/raw/plugin.json","content":"<файл>"}`; PNG — base64 (`figma.base64Encode(bytes)`) и поле `"base64":true`.
- Это дорого по контексту. Если можно запускать отдельных агентов, отдай эту работу им.

## 5. Без Plugin API: сетевые запросы и Dev Mode

1. Перезагрузи вкладку и прочитай запросы с фильтром `/api/`. Полезные JSON-ответы забери по id и сохрани в `craftlog/figma/raw/network-<что>.json`: `file_metadata`, `design_systems/library/<file>/published_and_moved_components` (список компонентов с ключами), переменные. Сам холст приходит по websocket в бинарном виде, стилей узлов в запросах нет.
2. **Dev Mode:** `<ссылка>&m=dev`, выдели слой и прочитай текст страницы — панель Inspect показывает CSS слоя.
3. Собери `craftlog/figma/spec.json` скриптом (`node`) по схеме из `kind-component.md`: открывать его инструментом чтения нельзя. Эталоны PNG попроси у пользователя (Export → PNG 2x, файлы `<id>.png`) или получи гибридом: Figma MCP или `craftui rest-images`.

## Запомни, что сработало

После первого импорта запиши в `.craftui/chrome-recon.md` 3–5 строк: инструмент, был ли нужен Open console, работает ли receiver, особенности файла (большие наборы, слоистые переменные). При следующих импортах начинай с этого файла.

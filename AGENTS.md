# AGENTS.md

## Структура репозитория

Проект на TypeScript: MCP-сервер импорта Figma → React 19 + CSS Modules.

- `mcp/` — сам MCP-сервер: `api.ts`, `tools.ts`, `src/*.ts` (нормализация Figma, юниты, слоты, страницы);
- `playground/` — демо-приложение (rspack) со скриншот-тестами Playwright и rstest; там своя документация — `playground/AGENTS.md`;
- `skills/craftui/` — документация скилла для агента (`references/kind-component.md`, `kind-page.md`, `code-conventions.md`, …);
- `docs/` — документация для людей (`designer-guide.md` — инструкция для дизайнера, диаграмма архитектуры).

## MCP Server Configuration

**Вы обязаны использовать исключительно MCP-сервер Serena для этого проекта.**
* **Название сервера:** `serena-craftui`
* **URL/Порт:** `http://localhost:9122` (или `http://127.0.0.1:9122`)

## Serena MCP — обязателен перед редактированием кода

1. **Активация проекта.** В начале каждой сессии работы с кодом вызывай Serena-инструмент (serena-craftui)
   `activate_project` для текущей директории (где лежит этот файл).
2. **Карта символов перед правками.** Прежде чем редактировать код, построй карту символов
   и функций Serena-инструментами:
   - `get_symbols_overview` — структура модуля/пакета (`mcp/src/`, `playground/src/`, `playground/tests/`);
   - `find_symbol` — точное тело функции/класса перед изменением (без чтения файла целиком);
   - `find_referencing_symbols` — все использования перед переименованием/сменой сигнатуры.
3. **Точечные правки.** Правь через символы (`replace_symbol_body`, `insert_after_symbol`,
   …), а не переписыванием файлов целиком. Крупные файлы (`mcp/src/normalize.ts`,
   `mcp/api.ts`, `mcp/src/digest.ts`, `mcp/src/normalize-page.ts`) не читай целиком без необходимости.
4. **Если Serena недоступна** (инструментов `mcp__serena-craftui__*` нет в сессии) — скажи об этом
   прямо, не имитируй вызовы, и работай встроенным поиском (Read/Grep), отметив, что карта
   символов Serena не строилась.

Подключение Serena (если сервер ещё не добавлен в MCP-конфиг хоста):

```json
// .mcp.json в корне проекта
{ "mcpServers": { "serena-craftui": {
    "command": "uvx",
    "args": ["--from", "git+https://github.com/oraios/serena",
             "serena", "start-mcp-server", "--context", "ide-assistant"]
} } }
```
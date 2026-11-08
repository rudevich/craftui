# craftui

```bash
npx skills add rudevich/craftui
```

Утилита [skills](https://github.com/vercel-labs/skills) (нужна Node.js 22.20+) спросит, в каких агентов поставить скилл (Claude Code, Codex, Cursor и др.). По умолчанию скилл ставится в текущий проект, с `-g` — для всех проектов. Без вопросов, глобально для Claude Code:

```bash
npx skills add rudevich/craftui --skill craftui -g -a claude-code
```

Обновление: `npx skills update craftui`. Другие способы установки — ниже.

A skill for coding agents that imports Figma components and UI kits into a React 19 + CSS Modules library with demo pages and screenshot tests.

Скилл для кодинговых агентов (Claude Code, Codex и другие, поддерживающие Agent Skills), который импортирует компоненты из Figma в React 19 + CSS Modules. Результат собирается в библиотеку на rspack. К ней прилагаются демо-страницы, общие `tokens.css`, скриншот-тесты против Figma (Playwright) и unit-тесты (rstest). Данные берутся через Figma MCP или из вашего Chrome.

Справка по использованию: [skills/craftui/references/help.md](skills/craftui/references/help.md).

## Установка

Скилл и MCP-сервер — две части одного репозитория: инструкции для агента (`skills/craftui`) и его рабочий инструмент (`mcp/`). MCP-сервер ставится один раз глобально и работает с проектом в текущей папке; в сами проекты скрипты больше не устанавливаются.

**Claude Code — как плагин из этого репозитория:**

```
/plugin marketplace add rudevich/craftui
/plugin install craftui@craftui
```

Плагин подключает и скилл, и MCP-сервер. Обновление: `/plugin marketplace update craftui`.

**Claude Code / Codex — из клона репозитория:**

```bash
git clone https://github.com/rudevich/craftui.git && node craftui/install.ts --mcp
```

`install.ts` ставит симлинк на `skills/craftui` в `~/.claude/skills` и `~/.codex/skills` (если эти папки есть), а флаг `--mcp` регистрирует MCP-сервер: для Claude Code — `claude mcp add -s user craftui …`, для Codex — блок в `~/.codex/config.toml`. Флаги: `--claude`, `--codex`, `--target <папка skills>`, `--copy` (копия вместо симлинка), `--mcp`. Обновление скилла и сервера — `git pull` (при симлинке).

**Другие агенты:** скопируйте `skills/craftui` в папку скиллов агента и зарегистрируйте MCP-сервер вручную: `node <репозиторий>/mcp/server.ts` (stdio).

Если репозиторий приватный, оба способа работают там, где у git есть доступ к аккаунту GitHub (SSH-ключ или `gh auth login`).

## Требования

- Node.js 24 или новее: скилл-скрипты и MCP-сервер на TypeScript, Node запускает их сам, без сборки (нужен и агенту, и клиенту, который поднимает сервер)
- Figma MCP (удалённый или из Figma Desktop) или браузерный MCP с вашим Chrome (Claude in Chrome / chrome-devtools-mcp)

## Устройство

```
skills/craftui/         пакет 1 — скилл: только инструкции и шаблон проекта
  SKILL.md              сценарий для агента
  references/           справочники по шагам (читаются по необходимости)
  scripts/init-project.ts    разворачивает/обновляет проект библиотеки в рабочей папке
  scripts/check.ts           проверка репозитория: npm run check (типы, тесты, smoke)
  template/             шаблон проекта: rspack (библиотека + демо), rstest, Playwright
mcp/                    пакет 2 — MCP-сервер: вся детерминированная работа
  server.ts             stdio-сервер (JSON-RPC, без зависимостей)
  tools.ts              14 инструментов: status/next/step/log/config, figma-url/create/sources/extract,
                        spec/digest, build/verify/hooks
  api.ts                ядро команд над src/
  src/                  модули: состояние, normalize, токены, заготовки, проверка, автопродолжение
  hook.ts               вход проектных хуков (Stop, SessionStart)
.claude-plugin/         манифест плагина и маркетплейса Claude Code (скилл + mcpServers)
install.ts              установка: скилл в ~/.claude/skills и ~/.codex/skills, --mcp — регистрация сервера
```

Детерминированная логика (состояние, извлечение, normalize, токены, заготовки, проверка, автопродолжение) живёт в глобальном MCP-сервере: он пишет состояние, генерирует черновики кода и печатает следующий шаг. Формы данных (`spec.json`, конфиг, state, сырые данные Figma) описаны в `mcp/src/types.ts`. Код, который выполняется в странице Figma, лежит в `mcp/src/snippets/`: перед отправкой в браузер с него снимаются типы. Тяжёлые данные идут в файлы через локальный receiver (он встроен в процесс сервера), контекст агента читает только короткие сводки.

Инструкции копируются в проект (`.craftui/skill/`), так что начатый импорт может продолжить любой агент. После правок кода сервера: `npm run check` в корне репозитория (типы, тесты, smoke-запуск сервера по stdio).

## Headless-импорт без агента

Почти весь конвейер детерминирован, поэтому компонент можно прогнать вообще без LLM: `mcp/auto.ts` сам выполняет сниппеты во вкладке Chrome через CDP и доходит до черновиков кода, эталонов и сводки verify.

```bash
# с Chrome 136 флаг работает только с выделенным профилем (второй экземпляр, вход в Figma — за пользователем)
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.craftui/chrome-profile"
cd <проект-потребитель>
node <репозиторий>/mcp/auto.ts --url <ссылка> --name <Name>
```

Вложенные компоненты импортируются рекурсивно; неоднозначные случаи (twin-наборы, конфликты токенов) останавливают прогон со списком решений. Шаг code — доводка черновиков по verify — остаётся за агентом с скиллом или человеком: `craftui next` покажет, где остановились. Подробности — `skills/craftui/references/figma-chrome.md`, раздел «Headless-режим».

## Лицензия

[MIT](LICENSE)

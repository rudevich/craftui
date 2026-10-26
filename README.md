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

**Claude Code — как плагин из этого репозитория:**

```
/plugin marketplace add rudevich/craftui
/plugin install craftui@craftui
```

Обновление: `/plugin marketplace update craftui`.

**Claude Code / Codex — из клона репозитория:**

```bash
git clone https://github.com/rudevich/craftui.git && node craftui/install.mjs
```

`install.mjs` ставит симлинк на `skills/craftui` в `~/.claude/skills` и `~/.codex/skills` (если эти папки есть). Флаги: `--claude`, `--codex`, `--target <папка skills>`, `--copy` (копия вместо симлинка). Обновление скилла — `git pull` (при симлинке).

**Другие агенты:** скопируйте `skills/craftui` в папку скиллов агента или подключите `SKILL.md` как инструкцию.

Если репозиторий приватный, оба способа работают там, где у git есть доступ к аккаунту GitHub (SSH-ключ или `gh auth login`).

## Требования

- Node.js `^20.19 || >=22.12`
- Figma MCP (удалённый или из Figma Desktop) или браузерный MCP с вашим Chrome (Claude in Chrome / chrome-devtools-mcp)

## Устройство

```
skills/craftui/
  SKILL.md              сценарий для агента
  references/           справочники по шагам (читаются по необходимости)
  scripts/init-project.mjs   разворачивает/обновляет проект библиотеки в рабочей папке
  template/             шаблон проекта: rspack (библиотека + демо), rstest, Playwright, CLI craftui
.claude-plugin/         манифест плагина и маркетплейса Claude Code
install.mjs             установка в ~/.claude/skills и ~/.codex/skills
```

Вся детерминированная логика (состояние, извлечение, normalize, токены, заготовки, проверка, автопродолжение) живёт в проекте как `scripts/craftui`. Инструкции копируются в `.craftui/skill/`, так что начатый импорт может продолжить любой агент.

## Лицензия

[MIT](LICENSE)

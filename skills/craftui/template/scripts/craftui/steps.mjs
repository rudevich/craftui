// Step lists per kind and the instruction `craftui next` prints for each step.
// Instructions are short and exact so any model can resume after losing context.

// init-project copies the skill's SKILL.md and references into the project, so any agent can resume.
const R = '.craftui/skill/references';

export const STEPS = {
  component: [
    ['extract', 'Выгрузить данные узла из Figma в craftlog/figma/raw/'],
    ['normalize', 'Собрать craftlog/figma/spec.json'],
    ['confirm', 'Подтвердить у пользователя свойства и список targets'],
    ['screenshots', 'PNG-эталоны targets в craftlog/figma/screenshots/'],
    ['deps', 'Разрешить вложенные компоненты'],
    ['tokens', 'Добавить токены в src/tokens.css'],
    ['scaffold', 'Создать заготовки файлов компонента'],
    ['code', 'Написать компонент (tsx, css, types)'],
    ['tests', 'Дописать rstest-тесты и пройти их'],
    ['verify', 'Пройти craftui verify (скриншоты + style-check)'],
    ['report', 'Итоговый отчёт пользователю'],
  ],
};

export function instructions(e, state, stepId) {
  const n = e.name;
  const chrome = state.source === 'chrome';
  const src = chrome ? `${R}/figma-chrome.md` : `${R}/figma-mcp.md`;
  const map = {
    extract: chrome
      ? [
          `Прочитай ${src} (разделы «Вход», «Проба», «Извлечение»).`,
          `1) В фоне: npm run craftui -- receiver`,
          `2) Открой ${state.figma.url} в Chrome; если просит вход — попроси пользователя войти (craftui wait ${n} "вход в Figma").`,
          `3) В странице Figma выполни вывод: npm run craftui -- snippet ${n} probe (Plugin API появляется не сразу — повтори при false)`,
          `4) Наборы и фильтры: npm run craftui -- source ${n} list (сотни вариантов → фильтр, см. «Разведка»)`,
          `5) Затем вывод: npm run craftui -- snippet ${n} extract → craftlog/figma/raw/plugin.json (таймаут → window.__craftui)`,
        ]
      : [
          `Прочитай ${src}.`,
          `Сохрани ответы Figma MCP в ${e.craftlog}/figma/raw/: metadata.xml (get_metadata), variables.json (get_variable_defs),`,
          `design-context/<nodeId>.tsx (get_design_context по каждому варианту, nodeId с ":" → "-"). По одному вызову за раз.`,
        ],
    normalize: [`npm run craftui -- normalize ${n}`, 'Проверь сводку: число targets, свойства, токены, вложенные компоненты.'],
    confirm: [
      `Покажи пользователю таблицу свойств и targets (npm run craftui -- normalize ${n} --summary) и спроси подтверждение.`,
      `Правки вноси в ${e.specFile} (props[].react / reactType, targets[].id / props) и снова npm run craftui -- normalize ${n} --keep.`,
      `Пока ждёшь ответа в агенте без встроенного вопроса — npm run craftui -- wait ${n} "подтверждение свойств".`,
    ],
    screenshots: chrome
      ? [`receiver должен работать (npm run craftui -- receiver в фоне).`, `В странице Figma выполни вывод: npm run craftui -- snippet ${n} export`]
      : [
          `Если ответы MCP дают ссылки на изображения — скачай их curl в ${e.craftlog}/figma/screenshots/<id>.png.`,
          `Иначе при наличии FIGMA_TOKEN: npm run craftui -- rest-images ${n}. Иначе попроси пользователя экспортировать PNG@2x (список: npm run craftui -- normalize ${n} --summary).`,
        ],
    deps: [
      `npm run craftui -- deps ${n}`,
      `Для каждого неимпортированного: импортируй его сначала (npm run craftui -- new component <Dep> <url> --parent ${n})`,
      `или, если это простая иконка/декор, пометь inline: npm run craftui -- deps ${n} --inline "<имя>".`,
    ],
    tokens: [`npm run craftui -- tokens ${n}`, `Правила: ${R}/tokens.md.`],
    scaffold: [`npm run craftui -- scaffold ${n}`, `Если файлы уже есть (ресинк, новые наборы): npm run craftui -- scaffold ${n} --add-targets`],
    code: [
      `Прочитай ${R}/kind-component.md и ${R}/code-conventions.md.`,
      `Данные: ${e.specFile} (targets[].tree: css, expect, text, instance). Пиши ${e.dir}/${n}.tsx и styles.module.css.`,
      `Классы элементов — из ${e.craftlog}/figma/node-map.json. Затем: npm run gen && npm run typecheck`,
    ],
    tests: [`Дополни ${e.craftlog}/tests/${n}.test.tsx (${R}/kind-component.md, «rstest»).`, `npm test -- ${n}`],
    verify: [
      `npm run craftui -- verify ${n}`,
      'Исправляй по текстовой сводке (области diff, style-check), повторяй. До 5 итераций; итог каждой — npm run craftui -- log.',
      `Правила: ${R}/verify.md.`,
    ],
    report: [`Отчёт пользователю по ${R}/log-format.md («Итоговый отчёт»), затем npm run craftui -- done ${n} report — закроет версию импорта и обновит ${e.dir}/README.md.`],
  };
  return map[stepId] ?? [];
}

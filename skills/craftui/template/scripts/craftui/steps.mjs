// Step lists per kind and the instruction `craftui next` prints for each step.
// Instructions are short and exact so any model can resume after losing context.

import { config, describeBreakpoints } from './lib.mjs';

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
  page: [
    ['extract', 'Выгрузить фреймы-брейкпоинты страницы в craftlog/figma/raw/'],
    ['normalize', 'Собрать spec.json: брейкпоинты, части, компоненты'],
    ['confirm', 'Подтвердить брейкпоинты, части и компоненты страницы'],
    ['screenshots', 'PNG-эталоны брейкпоинтов и картинки страницы'],
    ['deps', 'Компоненты страницы: импортированы или встроены'],
    ['tokens', 'Добавить токены в src/tokens.css'],
    ['scaffold', 'Заготовки страницы, частей и демо'],
    ['code', 'Довести страницу и части (tsx, css)'],
    ['tests', 'Дописать rstest-тесты страницы и пройти их'],
    ['verify', 'Пройти craftui verify на всех брейкпоинтах'],
    ['report', 'Итоговый отчёт пользователю'],
  ],
};

// Cards of a page: the same steps, the page's own pipeline (frames per breakpoint, parts, components on the page).
function pageInstructions(e, state, stepId) {
  const n = e.name;
  const bp = describeBreakpoints(config().pages.breakpoints);
  const map = {
    extract: [
      `1) В фоне: npm run craftui -- receiver. Открой ${state.figma.url} в Chrome (вход — только пользователь).`,
      `2) npm run craftui -- snippet ${n} probe — выполни вывод во вкладке Figma. В frames — фреймы с шириной и диапазоном (${bp}).`,
      `3) Один фрейм на брейкпоинт: первый уже источник, остальные — npm run craftui -- source ${n} add "<ссылка на фрейм>".`,
      `4) Так же выполни snippet ${n} extract: сохранит craftlog/figma/raw/plugin.json, в ответе только сводка. Файл не открывай.`,
      `Трудности — ${R}/figma-chrome.md; страницы — ${R}/kind-page.md.`,
    ],
    normalize: [`npm run craftui -- normalize ${n}`, 'Проверь сводку: какой фрейм в каком брейкпоинте, предупреждения, части, компоненты. spec.json не открывай.'],
    confirm: [
      `Покажи пользователю сводку (npm run craftui -- normalize ${n} --summary) и согласуй: брейкпоинты, части, компоненты.`,
      `Части — внутренние компоненты страницы: npm run craftui -- part ${n} <слой> <Имя> (убрать: --remove). Предложения — в сводке.`,
      `Пока ждёшь ответа в агенте без встроенного вопроса — npm run craftui -- wait ${n} "подтверждение страницы".`,
    ],
    screenshots: [`receiver в фоне; выполни во вкладке Figma вывод npm run craftui -- snippet ${n} export: PNG брейкпоинтов и картинки.`],
    deps: [
      `npm run craftui -- deps ${n}: компоненты из ${config().dirs.component} страница берёт как есть.`,
      `Не импортирован — импортируй сначала (npm run craftui -- new component <Имя> <url> --parent ${n}) или встрой: deps ${n} --inline "<имя>".`,
    ],
    tokens: [`npm run craftui -- tokens ${n}`, `Конфликты имён — ${R}/tokens.md.`],
    scaffold: [`npm run craftui -- scaffold ${n} — страница, части (parts/), демо по брейкпоинтам, черновики разметки и стилей, картинки в assets/.`],
    code: [
      `1) npm run craftui -- brief ${n} — брейкпоинты, части, компоненты, разметка. spec.json и figma/raw не открывай.`,
      `2) Черновики уже в ${e.dir}: ${n}.tsx, parts/, styles.module.css. Доводи их, а не пиши заново.`,
      `3) Mobile-first: правила шире — @container (min-width: …) по границам ${bp}; границы не меняй.`,
      '   Ширина страницы не фиксирована; компоненты не перестилизовывай (положение — className); header/main/section/footer; alt у картинок; размеры px и %.',
      `4) npm run gen && npm run typecheck. Уточнить слой: npm run craftui -- spec ${n} <брейкпоинт> <слой>. Подробно — ${R}/kind-page.md.`,
    ],
    tests: [`Дополни ${e.craftlog}/tests/${n}.test.tsx: тексты и ссылки, части на месте, компоненты получают нужные пропсы.`, `npm test -- ${n}`],
    verify: [
      `npm run craftui -- verify ${n}: скриншот каждого брейкпоинта в рамке ширины его фрейма и style-check.`,
      `Сначала самое большое расхождение; до ${config().verifyIterations} итераций, дальше спроси пользователя. Итог итерации — npm run craftui -- log.`,
      `Осознанный отход от макета — порог или маска с reason в craftlog/visual/visual.config.json (${R}/verify.md).`,
    ],
    report: [`Отчёт пользователю по ${R}/log-format.md («Итоговый отчёт»), затем npm run craftui -- done ${n} report.`],
  };
  return map[stepId] ?? [];
}

export function instructions(e, state, stepId) {
  if (e.kind === 'page') return pageInstructions(e, state, stepId);
  const n = e.name;
  const chrome = state.source === 'chrome';
  const src = chrome ? `${R}/figma-chrome.md` : `${R}/figma-mcp.md`;
  // Cards are self-sufficient: a model with a small context window should not need the references to do the step.
  const map = {
    extract: chrome
      ? [
          `1) В фоне: npm run craftui -- receiver (принимает файлы из страницы Figma).`,
          `2) Открой ${state.figma.url} в Chrome. Просит вход — попроси пользователя войти (craftui wait ${n} "вход в Figma") и жди.`,
          `3) npm run craftui -- snippet ${n} probe печатает JS: выполни его в вкладке Figma инструментом браузера`,
          `   (chrome-devtools evaluate_script или javascript_tool). Ответ — короткий JSON. Plugin API появляется не сразу: false → повтори.`,
          `4) Наборы и фильтры: npm run craftui -- source ${n} list (сотни вариантов → фильтр).`,
          `5) Так же выполни snippet ${n} extract. Он сам сохранит craftlog/figma/raw/plugin.json; в ответе только сводка. Файл не открывай.`,
          `Трудности (вход, таймаут, receiver недоступен) — ${src}, нужный раздел.`,
        ]
      : [
          `Сохрани ответы Figma MCP в ${e.craftlog}/figma/raw/: metadata.xml (get_metadata), variables.json (get_variable_defs),`,
          `design-context/<nodeId>.tsx (get_design_context по каждому варианту, nodeId с ":" → "-"). По одному вызову за раз, ответы не перечитывай.`,
          `Подробности — ${src}.`,
        ],
    normalize: [`npm run craftui -- normalize ${n}`, 'Проверь сводку: число targets, свойства, токены, вложенные компоненты. spec.json не открывай.'],
    confirm: [
      `Покажи пользователю таблицу свойств и targets (npm run craftui -- normalize ${n} --summary) и спроси подтверждение.`,
      `Правки свойств: npm run craftui -- prop ${n} "<свойство Figma>" <имя React | -> [тип TS], затем npm run craftui -- normalize ${n} --keep.`,
      `Пока ждёшь ответа в агенте без встроенного вопроса — npm run craftui -- wait ${n} "подтверждение свойств".`,
    ],
    screenshots: chrome
      ? [`receiver должен работать (npm run craftui -- receiver в фоне).`, `Выполни в вкладке Figma вывод npm run craftui -- snippet ${n} export (как probe на шаге extract).`]
      : [
          `Если ответы MCP дают ссылки на изображения — скачай их curl в ${e.craftlog}/figma/screenshots/<id>.png.`,
          `Иначе при наличии FIGMA_TOKEN: npm run craftui -- rest-images ${n}. Иначе попроси пользователя экспортировать PNG@2x (список: npm run craftui -- normalize ${n} --summary).`,
        ],
    deps: [
      `npm run craftui -- deps ${n}`,
      `Для каждого неимпортированного: импортируй его сначала (npm run craftui -- new component <Dep> <url> --parent ${n})`,
      `или, если это простая иконка/декор, пометь inline: npm run craftui -- deps ${n} --inline "<имя>".`,
    ],
    tokens: [`npm run craftui -- tokens ${n}`, `Конфликты имён — ${R}/tokens.md.`],
    scaffold: [
      `npm run craftui -- scaffold ${n} — заготовки и черновики: разметка в ${n}.tsx и стили в styles.module.css по слоям Figma.`,
      `Если файлы уже есть (ресинк, новые наборы): npm run craftui -- scaffold ${n} --add-targets`,
    ],
    code: [
      `1) npm run craftui -- brief ${n} — всё для кода: data-атрибуты, пропсы, разметка, стили. spec.json и figma/raw не открывай.`,
      `2) Черновики уже лежат в ${e.dir}: ${n}.tsx (разметка по слоям), styles.module.css (стили из макета), types.ts. Доводи их, а не пиши заново.`,
      '3) Правила: размеры только px и %; цвета, шрифты, радиусы — var(--токен) как в черновике; содержимому слотов размер не задавай;',
      '   пропсы — в types.ts с JSDoc; умолчания — в деструктуризации; <button type="button">; aria-*, клавиатура и :focus-visible обязательны.',
      `4) npm run gen && npm run typecheck. Уточнить слой: npm run craftui -- spec ${n} <target> <слой>.`,
      `Спорные места — ${R}/code-conventions.md; интерактивные компоненты — ${R}/kind-component.md, раздел «Интерактивные компоненты».`,
    ],
    tests: [
      `Дополни ${e.craftlog}/tests/${n}.test.tsx: заготовка уже проверяет рендер, ref, className и data-атрибуты.`,
      'Добавь по тесту на каждое поведение: клик, клавиатура, disabled/loading, управляемое значение. Проверяй атрибуты и вызовы, не стили.',
      `npm test -- ${n}`,
    ],
    verify: [
      `npm run craftui -- verify ${n} (полный отчёт — в craftlog/visual/output/<id>.json; в консоли — сводка).`,
      `Исправляй сначала самое большое расхождение и строки style-check (они называют свойство и класс), повторяй до ${config().verifyIterations} раз, дальше спроси пользователя; итог каждой итерации — npm run craftui -- log.`,
      `Осознанный отход от макета — порог или маска с reason в craftlog/visual/visual.config.json и запись в «Отклонения» лога (${R}/verify.md).`,
    ],
    report: [`Отчёт пользователю по ${R}/log-format.md («Итоговый отчёт»), затем npm run craftui -- done ${n} report — закроет версию импорта и обновит ${e.dir}/README.md.`],
  };
  return map[stepId] ?? [];
}

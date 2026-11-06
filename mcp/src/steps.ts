// Step lists per kind and the instruction `next` prints for each step.
// Instructions are short and exact so any model can resume after losing context.
// Tool calls are written as `craftui <инструмент> {json}` — the MCP server's tools (see references/help.md).

import { config, describeBreakpoints } from './lib.ts';
import type { Entity, State } from './types.ts';

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
    ['verify', 'Пройти verify (скриншоты + style-check)'],
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
    ['verify', 'Пройти verify на всех брейкпоинтах'],
    ['report', 'Итоговый отчёт пользователю'],
  ],
};

// Cards of a page: the same steps, the page's own pipeline (frames per breakpoint, parts, components on the page).
function pageInstructions(e: Entity, state: State, stepId: string): string[] {
  const n = e.name;
  const bp = describeBreakpoints(config().pages.breakpoints);
  const map: Record<string, string[]> = {
    extract: [
      `1) В фоне: craftui extract {"action":"receiver"}. Открой ${state.figma.url} в Chrome (вход — только пользователь).`,
      `2) craftui extract {"action":"snippet","entity":"${n}","step":"probe"} — выполни вывод во вкладке Figma. В frames — фреймы с шириной и диапазоном (${bp}).`,
      `3) Один фрейм на брейкпоинт: первый уже источник, остальные — craftui sources {"entity":"${n}","action":"add","url":"<ссылка на фрейм>"}.`,
      `4) Так же выполни snippet с step "extract": сохранит craftlog/figma/raw/plugin.json, в ответе только сводка. Файл не открывай.`,
      `Трудности — ${R}/figma-chrome.md; страницы — ${R}/kind-page.md.`,
    ],
    normalize: [`craftui spec {"action":"normalize","entity":"${n}"}`, 'Проверь сводку: какой фрейм в каком брейкпоинте, предупреждения, части, компоненты. spec.json не открывай.'],
    confirm: [
      `Покажи пользователю сводку (craftui spec {"action":"normalize","entity":"${n}","summary":true}) и согласуй: брейкпоинты, части, компоненты.`,
      `Части — внутренние компоненты страницы: craftui spec {"action":"part","entity":"${n}","layer":"<слой>","name":"<Имя>"}. Предложения — в сводке.`,
      `Пока ждёшь ответа в агенте без встроенного вопроса — craftui step {"action":"wait","entity":"${n}","text":"подтверждение страницы"}.`,
    ],
    screenshots: [`receiver работает; выполни во вкладке Figma вывод craftui extract {"action":"snippet","entity":"${n}","step":"export"}: PNG брейкпоинтов и картинки.`],
    deps: [
      `craftui spec {"action":"deps","entity":"${n}"}: компоненты из ${config().dirs.component} страница берёт как есть.`,
      `Не импортирован — импортируй сначала (craftui create {"kind":"component","name":"<Имя>","url":"<url>","parent":"${n}"}) или встрой: craftui spec {"action":"deps","entity":"${n}","inline":"<имя>"}.`,
    ],
    tokens: [`craftui build {"action":"tokens","entity":"${n}"}`, `Конфликты имён — ${R}/tokens.md.`],
    scaffold: [`craftui build {"action":"scaffold","entity":"${n}"} — страница, части (parts/), демо по брейкпоинтам, черновики разметки и стилей, картинки в assets/.`],
    code: [
      `1) craftui digest {"action":"brief","entity":"${n}"} — брейкпоинты, части, компоненты, разметка. spec.json и figma/raw не открывай.`,
      `2) Черновики уже в ${e.dir}: ${n}.tsx, parts/, styles.module.css. Доводи их, а не пиши заново.`,
      `3) Mobile-first: правила шире — @container (min-width: …) по границам ${bp}; границы не меняй.`,
      '   Ширина страницы не фиксирована; компоненты не перестилизовывай (положение — className); header/main/section/footer; alt у картинок; размеры px и %.',
      `4) npm run gen && npm run typecheck. Уточнить слой: craftui digest {"action":"spec","entity":"${n}","target":"<брейкпоинт>","layer":"<слой>"}. Подробно — ${R}/kind-page.md.`,
    ],
    tests: [`Дополни ${e.craftlog}/tests/${n}.test.tsx: тексты и ссылки, части на месте, компоненты получают нужные пропсы.`, `npm test -- ${n}`],
    verify: [
      `craftui verify {"entity":"${n}"}: скриншот каждого брейкпоинта в рамке ширины его фрейма и style-check.`,
      `Сначала самое большое расхождение; до ${config().verifyIterations} итераций, дальше спроси пользователя. Итог итерации — craftui log {"entity":"${n}","text":"…"}.`,
      `Осознанный отход от макета — порог или маска с reason в craftlog/visual/visual.config.json (${R}/verify.md).`,
    ],
    report: [`Отчёт пользователю по ${R}/log-format.md («Итоговый отчёт»), затем craftui step {"action":"done","entity":"${n}","step":"report"}.`],
  };
  return map[stepId] ?? [];
}

export function instructions(e: Entity, state: State, stepId: string): string[] {
  if (e.kind === 'page') return pageInstructions(e, state, stepId);
  const n = e.name;
  const chrome = state.source === 'chrome';
  const src = chrome ? `${R}/figma-chrome.md` : `${R}/figma-mcp.md`;
  // Cards are self-sufficient: a model with a small context window should not need the references to do the step.
  const map: Record<string, string[]> = {
    extract: chrome
      ? [
          `1) В фоне: craftui extract {"action":"receiver"} (принимает файлы из страницы Figma).`,
          `2) Открой ${state.figma.url} в Chrome. Просит вход — попроси пользователя войти (craftui step {"action":"wait","entity":"${n}","text":"вход в Figma"}) и жди.`,
          `3) craftui extract {"action":"snippet","entity":"${n}","step":"probe"} печатает JS: выполни его во вкладке Figma инструментом браузера`,
          `   (chrome-devtools evaluate_script или javascript_tool). Ответ — короткий JSON. Plugin API появляется не сразу: false → повтори.`,
          `4) Наборы и фильтры: craftui sources {"entity":"${n}"} (сотни вариантов — добавь filter).`,
          `5) Так же выполни snippet с step "extract". Он сам сохранит craftlog/figma/raw/plugin.json; в ответе только сводка. Файл не открывай.`,
          `Трудности (вход, таймаут, receiver недоступен) — ${src}, нужный раздел.`,
        ]
      : [
          `Сохрани ответы Figma MCP в ${e.craftlog}/figma/raw/: metadata.xml (get_metadata), variables.json (get_variable_defs),`,
          `design-context/<nodeId>.tsx (get_design_context по каждому варианту, nodeId с ":" → "-"). По одному вызову за раз, ответы не перечитывай.`,
          `Подробности — ${src}.`,
        ],
    normalize: [`craftui spec {"action":"normalize","entity":"${n}"}`, 'Проверь сводку: число targets, свойства, токены, вложенные компоненты. spec.json не открывай.'],
    confirm: [
      `Покажи пользователю таблицу свойств и targets (craftui spec {"action":"normalize","entity":"${n}","summary":true}) и спроси подтверждение.`,
      `Правки свойств: craftui spec {"action":"prop","entity":"${n}","figma":"<свойство Figma>","react":"<имя React | ->","type":"<тип TS>"}, затем normalize с "keep":true.`,
      `Пока ждёшь ответа в агенте без встроенного вопроса — craftui step {"action":"wait","entity":"${n}","text":"подтверждение свойств"}.`,
    ],
    screenshots: chrome
      ? [`receiver должен работать (craftui extract {"action":"receiver"}).`, `Выполни во вкладке Figma вывод craftui extract {"action":"snippet","entity":"${n}","step":"export"} (как probe на шаге extract).`]
      : [
          `Если ответы MCP дают ссылки на изображения — скачай их curl в ${e.craftlog}/figma/screenshots/<id>.png.`,
          `Иначе при наличии FIGMA_TOKEN: craftui extract {"action":"rest-images","entity":"${n}"}. Иначе попроси пользователя экспортировать PNG@2x (список: normalize с "summary":true).`,
        ],
    deps: [
      `craftui spec {"action":"deps","entity":"${n}"}`,
      `Для каждого неимпортированного: импортируй его сначала (craftui create {"kind":"component","name":"<Dep>","url":"<url>","parent":"${n}"})`,
      `или, если это простая иконка/декор, пометь inline: craftui spec {"action":"deps","entity":"${n}","inline":"<имя>"}.`,
    ],
    tokens: [`craftui build {"action":"tokens","entity":"${n}"}`, `Конфликты имён — ${R}/tokens.md.`],
    scaffold: [
      `craftui build {"action":"scaffold","entity":"${n}"} — заготовки и черновики: разметка в ${n}.tsx и стили в styles.module.css по слоям Figma.`,
      `Если файлы уже есть (ресинк, новые наборы): тот же вызов с "addTargets":true.`,
    ],
    code: [
      `1) craftui digest {"action":"brief","entity":"${n}"} — всё для кода: data-атрибуты, пропсы, разметка, стили. spec.json и figma/raw не открывай.`,
      `2) Черновики уже лежат в ${e.dir}: ${n}.tsx (разметка по слоям), styles.module.css (стили из макета), types.ts. Доводи их, а не пиши заново.`,
      '3) Правила: размеры только px и %; цвета, шрифты, радиусы — var(--токен) как в черновике; содержимому слотов размер не задавай;',
      '   пропсы — в types.ts с JSDoc; умолчания — в деструктуризации; <button type="button">; aria-*, клавиатура и :focus-visible обязательны.',
      `4) npm run gen && npm run typecheck. Уточнить слой: craftui digest {"action":"spec","entity":"${n}","target":"<target>","layer":"<слой>"}.`,
      `Спорные места — ${R}/code-conventions.md; интерактивные компоненты — ${R}/kind-component.md, раздел «Интерактивные компоненты».`,
    ],
    tests: [
      `Дополни ${e.craftlog}/tests/${n}.test.tsx: заготовка уже проверяет рендер, ref, className и data-атрибуты.`,
      'Добавь по тесту на каждое поведение: клик, клавиатура, disabled/loading, управляемое значение. Проверяй атрибуты и вызовы, не стили.',
      `npm test -- ${n}`,
    ],
    verify: [
      `craftui verify {"entity":"${n}"} (полный отчёт — в craftlog/visual/output/<id>.json; в ответе — сводка).`,
      `Исправляй сначала самое большое расхождение и строки style-check (они называют свойство и класс), повторяй до ${config().verifyIterations} раз, дальше спроси пользователя; итог каждой итерации — craftui log {"entity":"${n}","text":"…"}.`,
      `Осознанный отход от макета — порог или маска с reason в craftlog/visual/visual.config.json и запись в «Отклонения» лога (${R}/verify.md).`,
    ],
    report: [`Отчёт пользователю по ${R}/log-format.md («Итоговый отчёт»), затем craftui step {"action":"done","entity":"${n}","step":"report"} — закроет версию импорта и обновит ${e.dir}/README.md.`],
  };
  return map[stepId] ?? [];
}

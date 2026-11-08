// Screenshot tests: every craftlog/figma/screenshots/<id>.png is compared with the demo target <id>.
// Results go to craftlog/visual/output/<id>.{json,actual.png,diff.png}; the craftui MCP server's verify tool summarizes them.
// A render with unchanged inputs replays the last result from craftlog/visual/cache/<id>.json instead of rendering.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, test } from '@playwright/test';
import { type Box, compare, describeResult } from './compare';

type TargetConfig = { maxDiffRatio?: number; threshold?: number; mask?: Box[]; skip?: boolean; reason?: string };
type SpecNode = { key: string; slot?: string; css?: Record<string, string>; expect?: Record<string, string>; children?: SpecNode[] };

const config = JSON.parse(fs.readFileSync('craftui.config.json', 'utf8'));
// Pages have references of their own scale and threshold (craftui.config.json → pages).
const pagesFolder = (config.dirs?.page ?? 'src/pages').split('/').pop();
const readJson = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined);

const CACHE_VERSION = 1;
const digest = (parts: (string | Buffer)[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex').slice(0, 16);
};
const walkFiles = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const p = path.join(dir, d.name);
        return d.isDirectory() ? walkFiles(p) : /\.(tsx?|css)$/.test(d.name) ? [p] : [];
      })
    : [];

export function describeVisual(name: string, kind = 'components') {
  const isPage = kind === pagesFolder;
  const scale = isPage ? (config.pages?.scale ?? 1) : config.scale;
  const defaultMaxDiff = isPage ? (config.pages?.maxDiffRatio ?? 0.02) : config.maxDiffRatio;
  const root = path.join('src', kind, name, 'craftlog');
  const shots = path.join(root, 'figma', 'screenshots');
  const out = path.join(root, 'visual', 'output');
  const visualConfig = readJson(path.join(root, 'visual', 'visual.config.json')) ?? {};
  const spec = readJson(path.join(root, 'figma', 'spec.json'));
  const nodeMap: Record<string, string> = readJson(path.join(root, 'figma', 'node-map.json')) ?? {};
  // Targets whose reference reaches outside the node (an open dropdown, a shadow): offset and size of that area.
  const bounds: Record<string, Box> = readJson(path.join(shots, 'bounds.json')) ?? {};
  const ids = fs.existsSync(shots)
    ? fs.readdirSync(shots).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort()
    : [];

  // Everything the render and the comparison depend on: the entity's code, shared demo/lib/tokens, spec,
  // node-map, bounds, thresholds and the reference PNG itself.
  const entityDir = path.join('src', kind, name);
  const cacheDir = path.join(root, 'visual', 'cache');
  const keyOf = (id: string): string => {
    const files = [
      ...walkFiles(entityDir).filter((f) => !f.split(path.sep).includes('craftlog')),
      ...walkFiles('src/lib'),
      ...walkFiles('demo').filter((f) => !f.includes('.generated')),
      ...['src/tokens.css', 'tests/compare.ts'].filter((f) => fs.existsSync(f)),
    ].sort();
    const parts: (string | Buffer)[] = [String(CACHE_VERSION), String(scale)];
    for (const f of files) parts.push(f, fs.readFileSync(f));
    parts.push(JSON.stringify(spec ?? null), JSON.stringify(nodeMap), JSON.stringify(bounds), JSON.stringify(visualConfig), fs.readFileSync(path.join(shots, `${id}.png`)));
    return digest(parts);
  };

  test.describe(`${kind}/${name}`, () => {
    // The browser renders at the reference scale (pages differ from components), compare() checks the same scale.
    test.use({ deviceScaleFactor: scale });
    if (!ids.length) test('Figma references exist', () => expect(ids, `no PNG in ${shots}`).not.toHaveLength(0));

    for (const id of ids) {
      const t: TargetConfig = { ...visualConfig.default, ...visualConfig.targets?.[id] };
      test(id, async ({ page }) => {
        test.skip(Boolean(t.skip), t.reason);
        fs.mkdirSync(out, { recursive: true });
        // The cache replays the last result for unchanged inputs: no render, no compare, same output json for verify.
        const key = keyOf(id);
        const cacheFile = path.join(cacheDir, `${id}.json`);
        const cached = readJson(cacheFile) as { key: string; result: { pass?: boolean; report?: string[] } } | undefined;
        if (cached?.key === key && cached.result) {
          fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(cached.result, null, 2));
          expect(cached.result.pass, ['[кэш]', ...(cached.result.report ?? [])].join('\n')).toBe(true);
          return;
        }
        await page.goto(`/#/${kind}/${name}?target=${encodeURIComponent(id)}&isolated`);
        const target = page.locator(`[data-cu-target="${id}"]`);
        await expect(target, `target "${id}" is missing in ${name}.demo.tsx`).toBeVisible({ timeout: 15_000 });
        // Font stylesheets may be added at runtime (demo/fonts.ts): wait for them, then for the fonts themselves.
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.fonts.ready);

        const area = bounds[id];
        const box = area && (await target.boundingBox());
        const actual = box
          ? await page.screenshot({ clip: { x: box.x + area.x, y: box.y + area.y, width: area.w, height: area.h }, fullPage: true, omitBackground: true, animations: 'disabled', caret: 'hide' })
          : await target.screenshot({ omitBackground: true, animations: 'disabled', caret: 'hide' });
        fs.writeFileSync(path.join(out, `${id}.actual.png`), actual);
        const specTarget = spec?.targets?.find((x: { id: string }) => x.id === id);
        const result = compare(fs.readFileSync(path.join(shots, `${id}.png`)), actual, {
          scale,
          threshold: t.threshold,
          masks: t.mask,
          cropTop: specTarget?.mockTop,
        });
        fs.writeFileSync(path.join(out, `${id}.diff.png`), result.diffPng);

        const tree = specTarget?.tree;
        const styleIssues = tree ? await styleCheck(target, name, tree, nodeMap) : [];
        const maxDiffRatio = t.maxDiffRatio ?? defaultMaxDiff;
        const pass = result.diffRatio <= maxDiffRatio && !result.sizeMismatch;
        // Style issues name the exact property to fix, so they go right after the headline.
        const [headline, ...details] = describeResult(result);
        const report = [headline, ...styleIssues, ...details];
        const { diffPng, ...json } = result;
        const reportJson = { id, pass, maxDiffRatio, ...json, styleIssues, report };
        fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(reportJson, null, 2));
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ key, result: reportJson }, null, 2));
        expect(pass, report.join('\n')).toBe(true);
      });
    }
  });
}

// Compares computed styles of mapped elements with values Figma gave for the same layers.
async function styleCheck(target: Locator, folder: string, tree: SpecNode, nodeMap: Record<string, string>) {
  // `opacity` is compared as painted: the product along the layer path in Figma and along the element's ancestors in React,
  // so a dimmed wrapper in code equals dimmed layers inside it in Figma.
  const checks: { key: string; className: string; expect: Record<string, string>; opacity: number }[] = [];
  // A layer turned by ±90° in Figma (a vertical divider drawn as a horizontal one) has width and height swapped.
  const quarterTurn = (node: SpecNode) => /rotate\(-?(90|270)deg\)/.test(node.css?.transform ?? '');
  const walk = (node: SpecNode, inherited = 1, turned = false) => {
    if (node.slot) return; // slot content belongs to what the consumer passes in, not to the component
    const opacity = inherited * Number(node.expect?.opacity ?? 1);
    const swap = turned !== quarterTurn(node);
    const expect = swap && node.expect ? { ...node.expect, width: node.expect.height, height: node.expect.width } : node.expect;
    // A page part keeps its classes in its own folder: "LandingHero/title" → LandingHero__title.
    const cls = nodeMap[node.key];
    if (expect && cls) checks.push({ key: node.key, className: cls.includes('/') ? cls.replace('/', '__') : `${folder}__${cls}`, expect: Object.fromEntries(Object.entries(expect).filter(([, v]) => v !== undefined)) as Record<string, string>, opacity });
    node.children?.forEach((child) => walk(child, opacity, swap));
  };
  walk(tree);
  if (!checks.length) return [];

  return target.evaluate((root, checks) => {
    const issues: string[] = [];
    const num = (v: string) => (v.endsWith('px') ? Number.parseFloat(v) : Number.NaN);
    const rgba = (v: string) => {
      const probe = document.createElement('i');
      probe.style.color = v;
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      const c = computed.match(/[\d.]+/g)?.map(Number) ?? [];
      // color-mix() computes to color(srgb r g b / a) with channels 0…1.
      if (computed.startsWith('color(')) return [c[0] * 255, c[1] * 255, c[2] * 255, c[3] ?? 1];
      return [c[0], c[1], c[2], c[3] ?? 1];
    };
    // Figma puts text transparency into opacity, CSS may put it into the colour (color-mix): compare what is painted.
    const painted = (color: string, opacity: number) => {
      const c = rgba(color);
      return [c[0], c[1], c[2], c[3] * opacity];
    };
    const ancestorsOpacity = (el: Element) => {
      let o = 1;
      for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      return o;
    };
    const sameColor = (a: number[], b: number[]) => (a[3] <= 0.02 && b[3] <= 0.02) || a.every((v, i) => Math.abs(v - b[i]) <= (i === 3 ? 0.02 : 3));
    for (const check of checks) {
      const el = root.matches(`.${CSS.escape(check.className)}`) ? root : root.querySelector(`.${CSS.escape(check.className)}`);
      if (!el) {
        issues.push(`${check.key}: элемент .${check.className} не найден`);
        continue;
      }
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      for (const [prop, expected] of Object.entries(check.expect)) {
        // Figma sizes include padding and borders, like the element's border box.
        const actual = prop === 'width' || prop === 'height' ? `${Math.round(rect[prop] * 100) / 100}px` : cs.getPropertyValue(prop);
        let same: boolean;
        if (prop === 'color') {
          same = sameColor(painted(expected, check.opacity), painted(actual, ancestorsOpacity(el)));
        } else if (prop.includes('color')) {
          // Any fully transparent colour is the same nothing: rgba(255, 255, 255, 0) = transparent.
          same = sameColor(rgba(expected), rgba(actual));
        } else if (prop === 'opacity') {
          const [want, got] = check.expect.color ? [painted(check.expect.color, check.opacity)[3], painted(cs.color, ancestorsOpacity(el))[3]] : [check.opacity, ancestorsOpacity(el)];
          same = Math.abs(want - got) <= 0.02;
        } else if (prop === 'font-family') {
          same = actual.toLowerCase().includes(expected.toLowerCase().replace(/["']/g, '').split(',')[0].trim());
        } else if (!Number.isNaN(num(expected))) {
          // Figma rounds text boxes to whole pixels, the browser does not: sizes get 1.5px. Letter spacing adds up
          // over every letter of a line (0.3px is 6px on a title), so it gets almost none.
          const tolerance = prop === 'width' || prop === 'height' ? 1.5 : prop === 'letter-spacing' ? 0.05 : 0.5;
          same = Math.abs(num(expected) - num(actual)) <= tolerance;
        } else {
          same = expected === actual;
        }
        if (!same) issues.push(`${check.key}: ${prop} ожидалось ${expected}, получено ${actual}`);
      }
    }
    return issues;
  }, checks);
}

// Pixel comparison of a Figma reference with a rendered screenshot, plus a text report
// (sizes, regions that differ, average colors) so models without vision can act on it.
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export type Box = { x: number; y: number; w: number; h: number };
export type Region = Box & { pixels: number; figma: string; react: string };
export type CompareResult = {
  diffRatio: number;
  diffPixels: number;
  figmaSize: string;
  reactSize: string;
  sizeMismatch?: string;
  figmaContent?: Box;
  reactContent?: Box;
  regions: Region[];
  diffPng: Buffer;
};

const hex = (r: number, g: number, b: number, a: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}${a < 250 ? Math.round(a).toString(16).padStart(2, '0') : ''}`;

function pad(png: PNG, width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < png.height; y++) png.data.copy(out, y * width * 4, y * png.width * 4, (y + 1) * png.width * 4);
  return out;
}

function contentBox(data: Buffer, width: number, height: number, scale: number): Box | undefined {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return undefined;
  const r = (v: number) => Math.round((v / scale) * 10) / 10;
  return { x: r(minX), y: r(minY), w: r(maxX - minX + 1), h: r(maxY - minY + 1) };
}

export function compare(
  figmaBuf: Buffer,
  reactBuf: Buffer,
  opts: { scale: number; threshold?: number; masks?: Box[] },
): CompareResult {
  const figma = PNG.sync.read(figmaBuf);
  const react = PNG.sync.read(reactBuf);
  const { scale } = opts;
  const width = Math.max(figma.width, react.width);
  const height = Math.max(figma.height, react.height);
  const a = pad(figma, width, height);
  const b = pad(react, width, height);

  for (const m of opts.masks ?? []) {
    for (let y = Math.round(m.y * scale); y < Math.min(height, Math.round((m.y + m.h) * scale)); y++) {
      const start = (y * width + Math.round(m.x * scale)) * 4;
      const end = (y * width + Math.min(width, Math.round((m.x + m.w) * scale))) * 4;
      a.copy(b, start, start, end);
    }
  }

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a, b, diff.data, width, height, {
    threshold: opts.threshold ?? 0.1,
    includeAA: false,
    diffMask: true,
    diffColor: [255, 0, 0],
    aaColor: [255, 255, 0],
  });

  const css = (w: number, h: number) => `${Math.round((w / scale) * 10) / 10}×${Math.round((h / scale) * 10) / 10}`;
  const figmaSize = css(figma.width, figma.height);
  const reactSize = css(react.width, react.height);
  const sizeMismatch =
    Math.abs(figma.width - react.width) > scale || Math.abs(figma.height - react.height) > scale
      ? `размер Figma ${figmaSize}, React ${reactSize}`
      : undefined;

  return {
    diffRatio: diffPixels / (width * height),
    diffPixels,
    figmaSize,
    reactSize,
    sizeMismatch,
    figmaContent: contentBox(a, width, height, scale),
    reactContent: contentBox(b, width, height, scale),
    regions: regions(diff.data, a, b, width, height, scale),
    diffPng: PNG.sync.write(diff),
  };
}

// Groups diff pixels into rectangles on a 4 CSS px grid and reports the largest ones.
function regions(mask: Buffer, a: Buffer, b: Buffer, width: number, height: number, scale: number): Region[] {
  const cell = Math.max(1, Math.round(4 * scale));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hot = new Uint8Array(cols * rows);
  const isDiff = (i: number) => mask[i] === 255 && mask[i + 1] === 0 && mask[i + 2] === 0 && mask[i + 3] > 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (isDiff((y * width + x) * 4)) hot[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;

  const seen = new Uint8Array(cols * rows);
  const found: Region[] = [];
  for (let start = 0; start < hot.length; start++) {
    if (!hot[start] || seen[start]) continue;
    let minC = cols, minR = rows, maxC = 0, maxR = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const c = i % cols, r = Math.floor(i / cols);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        const n = nr * cols + nc;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && hot[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    const x0 = minC * cell, y0 = minR * cell, x1 = Math.min(width, (maxC + 1) * cell), y1 = Math.min(height, (maxR + 1) * cell);
    const sumA = [0, 0, 0, 0], sumB = [0, 0, 0, 0];
    let pixels = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        if (!isDiff(i)) continue;
        pixels++;
        for (let k = 0; k < 4; k++) {
          sumA[k] += a[i + k];
          sumB[k] += b[i + k];
        }
      }
    const avg = (s: number[]) => hex(s[0] / pixels, s[1] / pixels, s[2] / pixels, s[3] / pixels);
    const r = (v: number) => Math.round((v / scale) * 10) / 10;
    found.push({ x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0), pixels, figma: avg(sumA), react: avg(sumB) });
  }
  return found.sort((p, q) => q.pixels - p.pixels).slice(0, 5);
}

export function describeResult(r: CompareResult): string[] {
  const lines = [`diff ${(r.diffRatio * 100).toFixed(2)}% (${r.diffPixels} px), Figma ${r.figmaSize}, React ${r.reactSize}`];
  if (r.sizeMismatch) lines.push(r.sizeMismatch);
  const box = (b?: Box) => (b ? `x${b.x} y${b.y} ${b.w}×${b.h}` : 'пусто');
  if (JSON.stringify(r.figmaContent) !== JSON.stringify(r.reactContent))
    lines.push(`контент: Figma ${box(r.figmaContent)}, React ${box(r.reactContent)}`);
  for (const g of r.regions)
    lines.push(`область x${g.x} y${g.y} ${g.w}×${g.h}: Figma ${g.figma}, React ${g.react} (${g.pixels} px)`);
  return lines;
}

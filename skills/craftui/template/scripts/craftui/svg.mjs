// SVG exported from Figma (craftlog/figma/assets/*.svg) → a small TSX icon component printed to stdout.
// Single-colour icons get fill/stroke="currentColor" so they follow the text colour.
import fs from 'node:fs';
import path from 'node:path';
import { fail, findEntity, pascal } from './lib.mjs';

const camelAttr = (name) => name.replace(/[-:]([a-z])/g, (_, c) => c.toUpperCase());

export function run([ref, asset, name]) {
  const e = findEntity(ref);
  const file = path.join(e.craftlog, 'figma', asset?.startsWith('assets/') ? asset : `assets/${asset ?? ''}`);
  if (!fs.existsSync(file)) fail(`нет ${file}; ассеты: ${fs.readdirSync(path.join(e.craftlog, 'figma', 'assets')).join(', ')}`);
  const component = pascal(name || path.basename(file, '.svg'));
  const svg = fs.readFileSync(file, 'utf8').trim();
  if (/foreignObject|<mask|<image/.test(svg)) console.error('// ⚠ в SVG есть foreignObject/mask/image — проверь результат глазами');
  console.log(toTsx(svg, component));
}

/** Figma clips a frame export to its own box: a clipPath of one rect as big as the SVG clips nothing.
 *  Dropped, because its fixed id repeats in the DOM when the icon is on the page twice. */
export function dropFrameClips(source) {
  const width = source.match(/<svg[^>]*\swidth="([\d.]+)"/)?.[1];
  const height = source.match(/<svg[^>]*\sheight="([\d.]+)"/)?.[1];
  let svg = source;
  for (const [whole, id, rect] of source.matchAll(/<clipPath id="([^"]+)">\s*(<rect\b[^>]*\/>)\s*<\/clipPath>/g)) {
    const attr = (name) => rect.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    const full = attr('width') === width && attr('height') === height && !Number(attr('x') ?? 0) && !Number(attr('y') ?? 0) && !attr('transform');
    if (!full) continue;
    svg = svg.replace(whole, '').replace(new RegExp(`\\sclip-path="url\\(#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)"`, 'g'), '');
  }
  return svg.replace(/<defs>\s*<\/defs>/g, '').replace(/\n\s*\n/g, '\n');
}

/** Figma SVG → `export function <component>({ size })` with currentColor for single-colour icons. */
export function toTsx(source, component) {
  let svg = dropFrameClips(source);
  // Paint inside <defs>/<clipPath>/<mask> is a shape for clipping (white rect), not a colour of the icon.
  const paint = /(fill|stroke)="(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|white|black)"/g;
  const parts = svg.split(/(<(?:defs|clipPath|mask)\b[\s\S]*?<\/(?:defs|clipPath|mask)>)/);
  const colors = new Set(parts.filter((_, i) => i % 2 === 0).flatMap((part) => [...part.matchAll(paint)].map((m) => m[2].toLowerCase())));
  if (colors.size === 1) {
    svg = parts.map((part, i) => (i % 2 ? part : part.replace(paint, '$1="currentColor"').replace(/\s(fill|stroke)-opacity="[^"]*"/g, ''))).join('');
  }
  // The icon owns its size (px from the Figma export); a component's slot never stretches it.
  const width = Number(svg.match(/<svg[^>]*\swidth="([\d.]+)"/)?.[1] ?? 24);
  const height = Number(svg.match(/<svg[^>]*\sheight="([\d.]+)"/)?.[1] ?? width);
  svg = svg
    .replace(/\s(width|height)="[^"]*"/, '') // the first width/height pair belongs to <svg>
    .replace(/\s(width|height)="[^"]*"/, '')
    .replace(/<svg\b/, `<svg width={size} height={${height === width ? 'size' : `(size * ${height}) / ${width}`}} aria-hidden="true" focusable="false"`)
    .replace(/\s([a-z]+[-:][a-z-]+)=/g, (_, attr) => ` ${/^(aria|data)-/.test(attr) ? attr : camelAttr(attr)}=`)
    .replace(/\sxmlns(:\w+)?="[^"]*"/g, '');
  return `export function ${component}({ size = ${width} }: { size?: number }) {\n  return (\n    ${svg.split('\n').join('\n    ')}\n  );\n}`;
}

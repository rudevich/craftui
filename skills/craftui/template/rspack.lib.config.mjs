// Library build: one ESM entry per component (dist/components/<Name>/index.js + index.css), per page
// (dist/pages/<Page>/index.js, when pages.export is on) plus dist/tokens.css. Folders come from craftui.config.json → dirs.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './scripts/craftui/lib.ts';

const cfg = config();
const entitiesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, 'index.ts'))) : []);
const componentsDir = path.resolve(cfg.dirs.component);
const pagesDir = path.resolve(cfg.dirs.page);
const components = entitiesIn(componentsDir);
const pages = cfg.pages.export ? entitiesIn(pagesDir) : [];

const entry = { tokens: './src/tokens.css' };
if (components.length) entry.index = './src/index.ts';
for (const name of components) entry[`${path.basename(componentsDir)}/${name}/index`] = `./${cfg.dirs.component}/${name}/index.ts`;
for (const name of pages) entry[`${path.basename(pagesDir)}/${name}/index`] = `./${cfg.dirs.page}/${name}/index.ts`;

// Imports of a component's folder stay imports of its built entry, so shared components are not duplicated:
// from another component, from a page (and its parts) and from src/index.ts.
function siblingComponents({ context, request }, callback) {
  if (!request?.startsWith('.')) return callback();
  const target = path.relative(componentsDir, path.resolve(context, request)).split(path.sep);
  if (target.length !== 1 || target[0].startsWith('..') || !components.includes(target[0])) return callback();
  const ownIn = (dir) => (context.startsWith(dir + path.sep) ? path.relative(dir, context).split(path.sep)[0] : null);
  if (ownIn(componentsDir) === target[0]) return callback();
  // dist mirrors the folders: the importing entry is dist/<components>/<Name>, dist/<pages>/<Page> or dist/ (index).
  const out = ownIn(componentsDir) ? `${path.basename(componentsDir)}/${ownIn(componentsDir)}` : ownIn(pagesDir) ? `${path.basename(pagesDir)}/${ownIn(pagesDir)}` : '.';
  let rel = path.posix.relative(out, `${path.basename(componentsDir)}/${target[0]}/index.js`);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  callback(null, rel);
}

// Each JS entry imports its own CSS, so `import { Button } from 'lib/Button'` brings the styles along. Code that several
// components share (src/lib: button views, Spinner) lands in a common chunk with its own CSS, imported the same way.
class ImportOwnCssPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap('ImportOwnCssPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'ImportOwnCssPlugin', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS },
        (assets) => {
          for (const file of Object.keys(assets)) {
            if (!file.endsWith('.js')) continue;
            const css = file.replace(/\.js$/, '.css');
            if (!assets[css]) continue;
            const banner = `import "./${path.posix.basename(css)}";\n`;
            compilation.updateAsset(file, (old) => new sources.ConcatSource(banner, old));
          }
        },
      );
    });
  }
}

export default {
  mode: 'production',
  entry,
  output: {
    path: path.resolve('dist'),
    filename: '[name].js',
    cssFilename: '[name].css',
    module: true,
    library: { type: 'modern-module' },
    clean: true,
  },
  externalsType: 'module',
  externals: [/^react($|\/)/, /^react-dom($|\/)/, siblingComponents],
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  optimization: { minimize: false, splitChunks: false, runtimeChunk: false },
  module: {
    // Custom properties stay global: tokens and --cu-* variables are shared by component and src/lib/ modules.
    parser: { 'css/auto': { namedExports: false, dashedIdents: false } },
    generator: { 'css/auto': { localIdentName: '[folder]-[local]-[hash:base64:5]' } },
    rules: [
      { test: /\.css$/, type: 'css/auto' },
      { test: /\.svg$/, type: 'asset/inline' },
      { test: /\.(png|jpe?g|webp|gif)$/, type: 'asset/resource' },
      {
        test: /\.tsx?$/,
        loader: 'builtin:swc-loader',
        options: { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } } },
      },
    ],
  },
  plugins: [new ImportOwnCssPlugin()],
};

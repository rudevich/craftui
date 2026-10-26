// Library build: one ESM entry per component (dist/components/<Name>/index.js + index.css) plus dist/tokens.css.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('src');
const componentsDir = path.join(src, 'components');
const components = fs.existsSync(componentsDir)
  ? fs.readdirSync(componentsDir).filter((name) => fs.existsSync(path.join(componentsDir, name, 'index.ts')))
  : [];

const entry = { tokens: './src/tokens.css' };
if (components.length) entry.index = './src/index.ts';
for (const name of components) entry[`components/${name}/index`] = `./src/components/${name}/index.ts`;

// Imports of another component's folder stay imports of its built entry, so shared components are not duplicated.
function siblingComponents({ context, request }, callback) {
  if (!request?.startsWith('.')) return callback();
  const target = path.relative(componentsDir, path.resolve(context, request)).split(path.sep);
  if (target.length !== 1 || target[0].startsWith('..') || !components.includes(target[0])) return callback();
  const own = path.relative(componentsDir, context).split(path.sep)[0];
  if (own === target[0]) return callback();
  const from = context.startsWith(componentsDir) ? path.join(componentsDir, own) : src;
  let rel = path.relative(from, path.join(componentsDir, target[0], 'index.js')).split(path.sep).join('/');
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

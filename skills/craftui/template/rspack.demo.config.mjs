// Demo app (`npm run dev`): one page per entity, all targets, props table, Figma references.
import fs from 'node:fs';
import path from 'node:path';
import { rspack } from '@rspack/core';

const config = JSON.parse(fs.readFileSync('craftui.config.json', 'utf8'));

export default {
  mode: 'development',
  entry: './demo/main.tsx',
  devtool: 'cheap-module-source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    alias: { '@demo': path.resolve('demo/defineDemo.ts') },
  },
  module: {
    // Custom properties stay global: tokens and --cu-* variables are shared by component and src/lib/ modules.
    parser: { 'css/auto': { namedExports: false, dashedIdents: false } },
    // [folder]__[local] keeps class names readable and lets tests find elements by CSS-module class.
    generator: { 'css/auto': { localIdentName: '[folder]__[local]' } },
    rules: [
      { test: /\.css$/, type: 'css/auto', use: [{ loader: path.resolve('scripts/pseudo-states-loader.cjs') }] },
      { test: /\.svg$/, type: 'asset/inline' },
      { test: /\.(png|jpe?g|webp|gif)$/, type: 'asset/resource' },
      {
        test: /\.tsx?$/,
        loader: 'builtin:swc-loader',
        options: { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } } },
      },
    ],
  },
  plugins: [new rspack.HtmlRspackPlugin({ template: './demo/index.html' })],
  // package.json "sideEffects" describes the library for consumers; here it would drop side-effect imports like ./fonts.
  optimization: { sideEffects: false },
  // Tests write PNG/JSON into craftlog/ — that must not trigger rebuilds and page reloads.
  watchOptions: { ignored: ['**/node_modules/**', '**/craftlog/**'] },
  devServer: {
    port: config.port,
    hot: false,
    liveReload: true,
    open: false,
    client: { overlay: { warnings: false } },
    // craftlog files (Figma references, diff results) are shown next to live renders.
    static: [{ directory: path.resolve('src'), publicPath: '/src', watch: false }],
  },
};

// Demo-only loader: duplicates `:hover`/`:active`/`:focus`/`:focus-visible` rules under
// `[data-cu-pseudo~="hover"] …` so the demo and screenshot tests can show these states statically.
const postcss = require('postcss');

const PSEUDO = /:(hover|active|focus-visible|focus)(?![\w-])/g;

const plugin = {
  postcssPlugin: 'craftui-pseudo-states',
  Rule(rule) {
    if (rule.__cuPseudo || !PSEUDO.test(rule.selector)) return;
    PSEUDO.lastIndex = 0;
    const extra = [];
    for (const selector of rule.selectors) {
      // shortcut: pseudo-classes inside :not()/:is() are left as is, handle them if a design needs it.
      if (/:(not|is|where|has)\([^)]*:(hover|active|focus)/.test(selector)) continue;
      const states = new Set();
      const stripped = selector.replace(PSEUDO, (_, state) => {
        states.add(state);
        return '';
      });
      if (!states.size) continue;
      const prefix = [...states].map((s) => `[data-cu-pseudo~="${s}"]`).join('');
      extra.push(`${prefix} ${stripped.trim() || '*'}`);
    }
    if (!extra.length) return;
    const clone = rule.clone({ selectors: extra });
    clone.__cuPseudo = true;
    rule.after(clone);
  },
};

module.exports = function pseudoStatesLoader(source) {
  const callback = this.async();
  postcss([plugin])
    .process(source, { from: this.resourcePath })
    .then((result) => callback(null, result.css))
    .catch(callback);
};

// Fonts of the Figma designs, for the demo and screenshot tests only: stylesheet URLs in craftui.config.json → demoFonts.
// The library itself sets font-family; the app that uses it loads the fonts.
import config from '../craftui.config.json';

for (const href of (config as { demoFonts?: string[] }).demoFonts ?? []) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

export {};

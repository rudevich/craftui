import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['src/**/craftlog/tests/**/*.test.{ts,tsx}', 'demo/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  testEnvironment: 'happy-dom',
  setupFiles: ['./rstest.setup.ts'],
  tools: {
    swc: { jsc: { transform: { react: { runtime: 'automatic' } } } },
  },
});

import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const config = JSON.parse(fs.readFileSync('craftui.config.json', 'utf8'));

export default defineConfig({
  testDir: 'src',
  testMatch: '**/craftlog/visual/*.spec.ts',
  outputDir: '.craftui/playwright',
  reporter: [['line']],
  fullyParallel: true,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${config.port}`,
    // Figma references are exported at this scale, so screenshots match pixel for pixel.
    deviceScaleFactor: config.scale,
    viewport: { width: 1600, height: 1200 },
  },
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${config.port}`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
  },
});

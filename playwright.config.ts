import { defineConfig } from '@playwright/test'

export default defineConfig({
  /**
   * Test root — covers smoke.spec.ts and any future test/e2e/*.e2e.ts files.
   * Playwright's default testMatch pattern picks up *.{spec,test}.{js,ts}
   * so vitest files (*.test.ts) in renderer/ and preload/ are never loaded
   * because they live outside this testDir.
   */
  testDir: './test',
  /** Per-test timeout: generous for full pi-roundtrip including LLM latency. */
  timeout: 120_000,
  retries: 0,
  use: {
    /** Default assertion timeout — most locators carry explicit timeouts anyway. */
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'electron',
    },
  ],
})

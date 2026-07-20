/**
 * End-to-end smoke test for gsd-tau.
 *
 * Verifies the full happy-path cycle:
 *   launch → open project (via Recents) → Idle → send prompt →
 *   receive assistant response → close → no gsd process leaks.
 *
 * Prerequisites (must be satisfied before running `pnpm test:e2e`):
 *   1. `pnpm build` — built app at out/main/index.js
 *   2. `gsd` binary on PATH with a working provider configured
 *   3. `node node_modules/electron/install.js` — Electron binary present
 *
 * The 10-consecutive-run verification in S06 is confirmed by running
 * `pnpm test:e2e` 10 times and observing all passes.
 *
 * Design note: the native folder-picker dialog cannot be driven by Playwright.
 * We work around this by injecting the fixture directory into localStorage as a
 * recent project before the app loads (via addInitScript), so it appears in the
 * Recents list and can be clicked directly without any OS dialog.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const APP_ENTRY = resolve(__dirname, '../out/main/index.js')

/** Must match RECENTS_KEY in renderer/App.tsx. */
const RECENTS_KEY = 'gsd-tau:recent-projects'

// ─────────────────────────────────────────────────────────────────────────────
// Fixture: minimal git-initialised project
// ─────────────────────────────────────────────────────────────────────────────

let fixtureDir: string

test.beforeAll(() => {
  if (!existsSync(APP_ENTRY)) {
    throw new Error(
      `Built app not found: ${APP_ENTRY}\n` +
        `Run 'pnpm build' before 'pnpm test:e2e'.`,
    )
  }

  fixtureDir = mkdtempSync(join(tmpdir(), 'gsd-tau-smoke-'))

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify({ name: 'smoke-fixture', version: '1.0.0' }, null, 2),
  )

  const git = (args: string): void => {
    execSync(`git ${args}`, {
      cwd: fixtureDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })
  }
  git('init')
  git('config user.email "smoke-test@example.com"')
  git('config user.name "Smoke Test"')
  git('add .')
  git('commit -m "init fixture"')
})

// ─────────────────────────────────────────────────────────────────────────────
// Process-leak helpers
// ─────────────────────────────────────────────────────────────────────────────

function gsdProcessCount(): number {
  try {
    const raw = execSync(
      'pwsh -NoProfile -Command "(Get-Process -Name gsd -ErrorAction SilentlyContinue | Measure-Object).Count"',
      { encoding: 'utf8', timeout: 5_000 },
    ).trim()
    return parseInt(raw, 10) || 0
  } catch {
    return 0
  }
}

async function waitForNoGsdProcesses(deadlineMs = 8_000): Promise<number> {
  const end = Date.now() + deadlineMs
  let count = gsdProcessCount()
  while (count > 0 && Date.now() < end) {
    await new Promise<void>((r) => setTimeout(r, 500))
    count = gsdProcessCount()
  }
  return count
}

// ─────────────────────────────────────────────────────────────────────────────
// Smoke test
// ─────────────────────────────────────────────────────────────────────────────

test(
  'launch → open project → send prompt → receive response → shutdown clean',
  async () => {
    const consoleErrors: string[] = []

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronBin: string = require('electron') as string

    const app = await electron.launch({
      executablePath: electronBin,
      args: [APP_ENTRY],
      timeout: 30_000,
    })

    const page = await app.firstWindow()

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.waitForLoadState('domcontentloaded')

    try {
      // ── 1. Landing screen visible ───────────────────────────────────────
      await expect(page.locator('button:has-text("Browse")')).toBeVisible({
        timeout: 30_000,
      })

      // ── 2. Inject fixture into Recents and reload ───────────────────────
      //    Native folder-picker dialogs cannot be automated by Playwright.
      //    We seed localStorage so the fixture appears as a Recent project,
      //    then reload so the React app picks it up from storage.
      const dir = fixtureDir
      await page.evaluate(
        ({ key, cwd }: { key: string; cwd: string }) => {
          localStorage.setItem(
            key,
            JSON.stringify([{ cwd, lastOpened: new Date().toISOString() }]),
          )
        },
        { key: RECENTS_KEY, cwd: dir },
      )
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // ── 3. Click the Recent project button ──────────────────────────────
      //    projectName() returns the last path segment (e.g. gsd-tau-smoke-abc123).
      const name = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? dir
      await page.locator(`button:has-text("${name}")`).click()

      // ── 4. Wait for chat view (header with project path) ────────────────
      await expect(page.locator('header')).toBeVisible({ timeout: 30_000 })

      // ── 5. Composer is enabled (Idle state) ─────────────────────────────
      const composer = page.locator('textarea')
      await expect(composer).not.toBeDisabled({ timeout: 60_000 })

      // ── 6. Send prompt ──────────────────────────────────────────────────
      await composer.fill('say hello in exactly three words')
      await composer.press('Enter')

      // ── 7. Wait for assistant response ──────────────────────────────────
      //    TurnList renders assistant text as <p> inside [aria-label="Conversation"].
      //    Poll until at least 2 words have appeared.
      await page.waitForFunction(
        () => {
          const paras = document.querySelectorAll(
            '[aria-label="Conversation"] p',
          )
          const text = Array.from(paras)
            .map((p) => (p.textContent ?? '').trim())
            .join(' ')
          return text.split(/\s+/).filter(Boolean).length >= 2
        },
        undefined,
        { timeout: 120_000 },
      )

      // ── 8. Wait for Idle after response ─────────────────────────────────
      await expect(composer).not.toBeDisabled({ timeout: 30_000 })

      // ── 9. Assert zero renderer console errors ──────────────────────────
      expect(
        consoleErrors,
        `Unexpected renderer console errors:\n${consoleErrors.join('\n')}`,
      ).toHaveLength(0)
    } finally {
      await app.close()
    }

    // ── 10. Verify no gsd child-process leaks ────────────────────────────
    const leaked = await waitForNoGsdProcesses(8_000)
    expect(
      leaked,
      `${leaked} gsd process(es) still running after app close`,
    ).toBe(0)
  },
)

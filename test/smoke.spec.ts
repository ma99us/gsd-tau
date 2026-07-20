/**
 * End-to-end smoke test for gsd-tau.
 *
 * Verifies the full happy-path cycle:
 *   launch → folder picker → open project → Idle → send prompt →
 *   receive assistant response → close → no gsd process leaks.
 *
 * Prerequisites (must be satisfied before running `pnpm test:e2e`):
 *   1. `pnpm build` — built app at out/main/index.js
 *   2. `gsd` binary on PATH with a working provider configured
 *   3. `node node_modules/electron/install.js` — Electron binary present
 *
 * The 10-consecutive-run verification in S06 is confirmed by running
 * `pnpm test:e2e` 10 times and observing all passes.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Absolute path to the built Electron main-process entry.
 * Constructed relative to this test file (test/smoke.spec.ts → out/main/).
 */
const APP_ENTRY = resolve(__dirname, '../out/main/index.js')

// ─────────────────────────────────────────────────────────────────────────────
// Fixture: minimal git-initialised project
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Absolute path to the temporary fixture directory created in beforeAll.
 * Using os.tmpdir() avoids embedding a nested .git repo inside this
 * repository's working tree, which git would treat as a submodule placeholder.
 */
let fixtureDir: string

test.beforeAll(() => {
  // Fail fast with a human-readable message when the app has not been built.
  if (!existsSync(APP_ENTRY)) {
    throw new Error(
      `Built app not found: ${APP_ENTRY}\n` +
        `Run 'pnpm build' before 'pnpm test:e2e'.`,
    )
  }

  // Create a fresh temp directory for this test run.
  fixtureDir = mkdtempSync(join(tmpdir(), 'gsd-tau-smoke-'))

  // Write the minimal project descriptor.  The committed file at
  // test/fixtures/sample-project/package.json is the canonical template;
  // here we copy its shape into the throw-away temp directory.
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify({ name: 'smoke-fixture', version: '1.0.0' }, null, 2),
  )

  // Initialise as a git repository (pi/gsd requires a git context).
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

/**
 * Returns the number of processes named "gsd" currently running.
 * Uses PowerShell so this works on Windows without WSL.
 */
function gsdProcessCount(): number {
  try {
    const raw = execSync(
      'pwsh -NoProfile -Command "(Get-Process -Name gsd -ErrorAction SilentlyContinue | Measure-Object).Count"',
      { encoding: 'utf8', timeout: 5_000 },
    ).trim()
    return parseInt(raw, 10) || 0
  } catch {
    // Get-Process exits non-zero when no match; treat as 0.
    return 0
  }
}

/**
 * Polls until no gsd processes remain or the deadline elapses.
 * The graceful-shutdown handler (T11) has a 5 s hard deadline, so we wait
 * up to 8 s to account for that plus some buffer.
 */
async function waitForNoGsdProcesses(
  deadlineMs = 8_000,
): Promise<number> {
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

    // Resolve the Electron executable from the installed npm package.
    // `require('electron')` is the canonical way to get the binary path;
    // it works with pnpm's virtual store because node_modules/electron/index.js
    // resolves to the real package directory.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronBin: string = require('electron') as string

    const app = await electron.launch({
      executablePath: electronBin,
      args: [APP_ENTRY],
      timeout: 30_000,
    })

    const page = await app.firstWindow()

    // Collect renderer console errors throughout the test.
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Wait for the renderer bundle to finish loading before interacting.
    // `firstWindow()` returns as soon as the window is created; the React
    // app hydration happens asynchronously a moment later.
    await page.waitForLoadState('domcontentloaded')

    try {
      // ── 1. Folder picker visible ────────────────────────────────────────
      //    The App renders an <input> with this placeholder when no session
      //    is open (renderer/App.tsx — the "No session: folder picker" branch).
      const pathInput = page.locator('input[placeholder="D:/Projects/my-app"]')
      await expect(pathInput).toBeVisible({ timeout: 30_000 })

      // ── 2. Open the fixture project ─────────────────────────────────────
      await pathInput.fill(fixtureDir)
      await page.locator('button:has-text("Open")').click()

      // ── 3. Wait for Idle state ──────────────────────────────────────────
      //    Once the session opens, the chat view is shown.  The <header>
      //    element appears with the project cwd, and the composer <textarea>
      //    becomes enabled (disabled={isWorking || isStopped}).
      //    StateIndicator returns null for the Idle state so there is no
      //    visible "Idle" label — we infer it from the textarea being enabled.
      await expect(page.locator('header')).toBeVisible({ timeout: 30_000 })

      const composer = page.locator('textarea')
      await expect(composer).not.toBeDisabled({ timeout: 60_000 })

      // Confirm the enabled-state placeholder text as an extra guard.
      await expect(composer).toHaveAttribute(
        'placeholder',
        'Message pi\u2026 (Enter to send, Shift+Enter for newline)',
      )

      // ── 4. Send prompt ──────────────────────────────────────────────────
      await composer.fill('say hello in exactly three words')
      await composer.press('Enter')

      // ── 5. Wait for assistant response ──────────────────────────────────
      //    TurnList renders assistant text as <p> elements inside the
      //    [aria-label="Conversation"] container.  Poll until the combined
      //    text of all <p> elements contains at least 2 words.
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

      // ── 6. Wait for Idle after response ─────────────────────────────────
      //    After the agent_end event fires, the session state returns to Idle
      //    and the composer becomes enabled again.
      await expect(composer).not.toBeDisabled({ timeout: 30_000 })

      // ── 7. Assert zero renderer console errors ──────────────────────────
      expect(
        consoleErrors,
        `Unexpected renderer console errors:\n${consoleErrors.join('\n')}`,
      ).toHaveLength(0)
    } finally {
      // Always close the Electron app — even when assertions fail — so we do
      // not leave orphaned windows that block subsequent runs.
      await app.close()
    }

    // ── 8. Verify no gsd child-process leaks ─────────────────────────────
    //    The before-quit handler (T11) has a 5 s hard deadline; allow 8 s
    //    for the graceful-shutdown + process-exit cascade to complete.
    const leaked = await waitForNoGsdProcesses(8_000)
    expect(
      leaked,
      `${leaked} gsd process(es) still running after app close`,
    ).toBe(0)
  },
)

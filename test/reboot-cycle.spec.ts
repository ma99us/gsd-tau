/**
 * Reboot-cycle end-to-end test for gsd-tau.
 *
 * Verifies that 3 open tabs survive CYCLE_COUNT quit-relaunch cycles:
 *   1. Launch app with an isolated APPDATA directory.
 *   2. Open 3 fixture projects (project-a, project-b, project-c).
 *   3. Quit the app (triggers the before-quit registry flush).
 *   4. Relaunch with the same APPDATA directory.
 *   5. Assert all 3 tabs restored by displayName.
 *   6. Assert the active tab is exactly project-c (last active before quit).
 *   7. Assert registry.json is valid JSON with 3 session entries.
 *   8. Repeat steps 3-7 for CYCLE_COUNT total cycles.
 *
 * Prerequisites (same as smoke.spec.ts):
 *   1. `pnpm build` — built app at out/main/index.js.
 *   2. `gsd` binary on PATH with a working provider configured.
 *   3. `node node_modules/electron/install.js` — Electron binary present.
 *
 * Design notes
 * ────────────
 * • Isolated APPDATA: each run uses a mkdtemp dir so the test never touches
 *   real user data and concurrent test runs do not collide.
 * • Tab-open strategy: the native folder-picker dialog cannot be driven by
 *   Playwright. We open project-a by injecting it into localStorage recents
 *   and clicking from the landing screen; project-b and project-c are opened
 *   via the [+] flyout recents list (all 3 are pre-seeded in localStorage).
 * • Graceful quit: `page.evaluate(() => window.close())` triggers the
 *   Electron window-close handler which calls `app.quit()`, which in turn
 *   fires the `before-quit` handler that flushes the registry to disk before
 *   closing sessions. `app.close()` then waits for the OS process to exit.
 * • Active-tab assertion: after T02 wired the activeTabCwd persistence and
 *   restore pipeline, the registry persists the CWD of the last-active tab
 *   (project-c, the last one opened before quit) and the renderer restores
 *   focus to that exact tab. The assertion now checks for exactly "project-c".
 *
 * Failure modes tested (Q7)
 * ─────────────────────────
 * • Registry missing on relaunch  → RegistryStore falls back to .bak then
 *   empty default; the test asserts the file exists before JSON.parse.
 * • Registry corrupt              → JSON.parse throws; Playwright surfaces
 *   the error as a test failure.
 * • Session cwd missing on relaunch → MissingSessionBanner (covered by T10).
 * • Duplicate tabs after restore  → toHaveCount(3) catches extras.
 * • No active tab                 → `aria-selected="true"` assertion fails.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const APP_ENTRY = resolve(__dirname, '../out/main/index.js')

/** Must match RECENTS_KEY in renderer/App.tsx and renderer/components/OpenProjectFlyout.tsx. */
const RECENTS_KEY = 'gsd-tau:recent-projects'

/** Number of quit-relaunch cycles to run. */
const CYCLE_COUNT = 5

/**
 * Fixture project directory names — committed to git under test/fixtures/.
 * The fixtures only need a package.json; no git init is required because
 * gsd-tau does not check for a git repository before opening a session.
 */
const FIXTURE_NAMES = ['project-a', 'project-b', 'project-c'] as const
type FixtureName = (typeof FIXTURE_NAMES)[number]

/** Absolute paths to the 3 fixture project directories. */
const FIXTURE_PATHS: Record<FixtureName, string> = {
  'project-a': resolve(__dirname, 'fixtures', 'project-a'),
  'project-b': resolve(__dirname, 'fixtures', 'project-b'),
  'project-c': resolve(__dirname, 'fixtures', 'project-c'),
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight check
// ─────────────────────────────────────────────────────────────────────────────

test.beforeAll(() => {
  if (!existsSync(APP_ENTRY)) {
    throw new Error(
      `Built app not found: ${APP_ENTRY}\n` +
        `Run 'pnpm build' before 'pnpm test:e2e'.`,
    )
  }

  for (const [name, dir] of Object.entries(FIXTURE_PATHS) as [FixtureName, string][]) {
    if (!existsSync(dir)) {
      throw new Error(
        `Fixture project directory not found: ${dir}\n` +
          `Expected ${name}/package.json to be committed under test/fixtures/.`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read and parse registry.json from the isolated app-data directory.
 * Throws if the file is missing or contains invalid JSON.
 */
function readRegistry(
  tempAppData: string,
): { version: number; sessions: Array<{ id: string; cwd: string; displayName: string }> } {
  const registryPath = join(tempAppData, 'gsd-tau', 'registry.json')
  if (!existsSync(registryPath)) {
    throw new Error(`registry.json not found at: ${registryPath}`)
  }
  return JSON.parse(readFileSync(registryPath, 'utf8')) as {
    version: number
    sessions: Array<{ id: string; cwd: string; displayName: string }>
  }
}

/**
 * Seed localStorage with all 3 fixture paths as recent projects,
 * ordered so that project-a is at the top of the recents list.
 *
 * Each entry gets a slightly different timestamp so the order is stable
 * and deduplicated correctly by App.saveRecent().
 */
async function seedRecents(
  page: import('@playwright/test').Page,
): Promise<void> {
  const now = Date.now()
  await page.evaluate(
    ({
      key,
      entries,
    }: {
      key: string
      entries: Array<{ cwd: string; lastOpened: string }>
    }) => {
      localStorage.setItem(key, JSON.stringify(entries))
    },
    {
      key: RECENTS_KEY,
      entries: FIXTURE_NAMES.map((name, i) => ({
        cwd: FIXTURE_PATHS[name],
        // project-a gets the most recent timestamp so it appears at the top.
        lastOpened: new Date(now - i * 1_000).toISOString(),
      })),
    },
  )
}

/**
 * Wait for a tab with the given display name to appear in the tab bar.
 * Uses a scoped locator to avoid matching close-button text.
 */
async function waitForTab(
  page: import('@playwright/test').Page,
  name: string,
  timeoutMs = 90_000,
): Promise<void> {
  // The tab <div role="tab"> contains a <span> with the display name.
  // :has-text() matches elements whose subtree contains the text.
  await expect(
    page.locator(`[role="tab"]:has-text("${name}")`),
  ).toBeVisible({ timeout: timeoutMs })
}

// ─────────────────────────────────────────────────────────────────────────────
// Reboot-cycle test
// ─────────────────────────────────────────────────────────────────────────────

test(
  `reboot-cycle: 3 tabs survive ${CYCLE_COUNT} quit-relaunch cycles`,
  async () => {
    // Override per-test timeout: 5 minutes covers first launch + 5 cycles.
    test.setTimeout(300_000)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronBin: string = require('electron') as string

    /**
     * Isolated app-data directory.  The RegistryStore reads APPDATA from the
     * environment, so overriding it here scopes all registry I/O to a temp
     * path that is cleaned up in the finally block.
     */
    const tempAppData = mkdtempSync(join(tmpdir(), 'gsd-tau-reboot-'))

    try {
      // ── Phase 1: Initial launch — open 3 fixture projects ───────────────

      {
        const app = await electron.launch({
          executablePath: electronBin,
          args: [APP_ENTRY],
          env: { ...process.env, APPDATA: tempAppData },
          timeout: 30_000,
        })

        try {
          const page = await app.firstWindow()
          await page.waitForLoadState('domcontentloaded')

          // Wait for the landing screen (no tabs open yet).
          await expect(
            page.locator('button:has-text("Browse")'),
          ).toBeVisible({ timeout: 30_000 })

          // Pre-seed all 3 fixture paths as recents so the flyout can open them.
          await seedRecents(page)

          // Reload so the React app picks up the freshly written localStorage.
          await page.reload()
          await page.waitForLoadState('domcontentloaded')

          // ── Open project-a from the landing screen recents list ──────────
          // project-a has the most recent timestamp → it appears at the top.
          await page.locator(`button:has-text("project-a")`).first().click()
          await waitForTab(page, 'project-a')

          // ── Open project-b via the [+] flyout ────────────────────────────
          await page.locator('[aria-label="New tab (Ctrl+T)"]').click()
          const flyout1 = page.locator('[role="dialog"][aria-label="Open project"]')
          await expect(flyout1).toBeVisible({ timeout: 5_000 })
          await flyout1.locator('button:has-text("project-b")').first().click()
          await waitForTab(page, 'project-b')

          // ── Open project-c via the [+] flyout ────────────────────────────
          // project-c is the last tab opened — it becomes the active tab.
          await page.locator('[aria-label="New tab (Ctrl+T)"]').click()
          const flyout2 = page.locator('[role="dialog"][aria-label="Open project"]')
          await expect(flyout2).toBeVisible({ timeout: 5_000 })
          await flyout2.locator('button:has-text("project-c")').first().click()
          await waitForTab(page, 'project-c')

          // Confirm exactly 3 tabs in the tab bar.
          await expect(page.locator('[role="tab"]')).toHaveCount(3, {
            timeout: 10_000,
          })
        } finally {
          // Graceful close: triggers win.on('close') → app.quit() →
          // before-quit (registryStore.flush + session cleanup) → process exit.
          // app.close() waits for the OS process to fully exit.
          await app.close()
        }
      }

      // Allow the OS to release the single-instance lock before the next launch.
      await new Promise<void>((r) => setTimeout(r, 1_500))

      // ── Phase 2: 5 reboot cycles ─────────────────────────────────────────

      for (let cycle = 1; cycle <= CYCLE_COUNT; cycle++) {
        const app = await electron.launch({
          executablePath: electronBin,
          args: [APP_ENTRY],
          env: { ...process.env, APPDATA: tempAppData },
          timeout: 30_000,
        })

        try {
          const page = await app.firstWindow()
          await page.waitForLoadState('domcontentloaded')

          // ── Assert all 3 tabs restored ─────────────────────────────────
          // The renderer restore flow: main calls restore() → sessions opened
          // in parallel → RESTORE_COMPLETE pushed → renderer re-calls
          // listSessions() → tabs rendered. Allow generous timeout.
          for (const name of FIXTURE_NAMES) {
            await waitForTab(page, name)
          }

          // Exactly 3 tabs — no duplicates, no missing.
          await expect(page.locator('[role="tab"]')).toHaveCount(3, {
            timeout: 10_000,
          })

          // ── Assert active tab is exactly project-c ───────────────────────
          // project-c was the last tab opened before the initial quit; the
          // activeTabCwd field (wired by T02) persists and restores the
          // active-tab CWD so the same project is re-selected on every relaunch.
          const activeTab = page
            .locator('[role="tab"][aria-selected="true"]')
            .first()
          await expect(activeTab).toBeVisible({ timeout: 5_000 })
          const activeTabText = await activeTab.innerText()
          expect(
            activeTabText.trim(),
            `Active tab on cycle ${cycle} should be "project-c" (last active before quit)`,
          ).toContain('project-c')

          // ── Assert registry is valid JSON with 3 sessions ───────────────
          const registry = readRegistry(tempAppData)
          expect(
            registry.version,
            `registry.version should be 1 on cycle ${cycle}`,
          ).toBe(1)
          expect(
            registry.sessions,
            `Expected 3 sessions in registry on cycle ${cycle}`,
          ).toHaveLength(3)

          // Assert all 3 expected cwds are present in the registry.
          const savedCwds = new Set(registry.sessions.map((s) => s.cwd))
          for (const [name, dir] of Object.entries(FIXTURE_PATHS) as [
            FixtureName,
            string,
          ][]) {
            expect(
              savedCwds.has(dir),
              `Registry missing session for ${name} (cwd="${dir}") on cycle ${cycle}`,
            ).toBe(true)
          }
        } finally {
          await app.close()
        }

        // Brief pause to release single-instance lock between relaunches.
        await new Promise<void>((r) => setTimeout(r, 1_000))
      }
    } finally {
      // Always clean up the isolated app-data directory.
      rmSync(tempAppData, { recursive: true, force: true })
    }
  },
)

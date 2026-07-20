/**
 * End-to-end tests for the UI-request bridge.
 *
 * Uses a mock pi server (test/helpers/mock-pi-server.cjs) in place of the real
 * gsd binary so every modal type can be exercised deterministically.
 *
 * Prerequisites (same as smoke.spec.ts):
 *   1. `pnpm build` — built app at out/main/index.js
 *   2. Electron binary present (node node_modules/electron/install.js)
 *
 * The mock pi server is injected via the GSD_TAU_MOCK_PI env var, which is
 * checked in main/pi/client-factory.ts before calling resolvePiBinary().
 *
 * Test cases
 * ──────────
 *  (1) select — single-choice and multi-choice
 *  (2) confirm — yes and no
 *  (3) input — plain text and secure (password)
 *  (4) editor — submit (Ctrl+Enter) and cancel
 *  (5) notify + setStatus — non-modal render, auto-acked by main process
 *  (6) two simultaneous blockers — queue badge and in-order responses
 *  (7) quit with open confirm modal — pre-shutdown hook sends cancelled:true
 */

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MOCK_PI_SERVER_PATH,
  waitForResponses,
  readResponses,
  type MockScenario,
} from './helpers/mock-pi'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const APP_ENTRY = resolve(__dirname, '../out/main/index.js')

/** Must match RECENTS_KEY in renderer/App.tsx. */
const RECENTS_KEY = 'gsd-tau:recent-projects'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BIN: string = require('electron') as string

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture directory (created once, reused across all tests)
// ─────────────────────────────────────────────────────────────────────────────

let fixtureDir = ''

test.beforeAll(() => {
  if (!existsSync(APP_ENTRY)) {
    throw new Error(
      `Built app not found: ${APP_ENTRY}\nRun 'pnpm build' before 'pnpm test:e2e'.`,
    )
  }
  fixtureDir = mkdtempSync(join(tmpdir(), 'gsd-tau-uireq-'))
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify({ name: 'ui-req-fixture', version: '1.0.0' }, null, 2),
  )
})

test.afterAll(() => {
  if (fixtureDir && existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Per-test temp dir helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTmpDir(): { tmpDir: string; responseFile: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-tau-resp-'))
  return { tmpDir, responseFile: join(tmpDir, 'responses.json') }
}

function cleanTmpDir(tmpDir: string): void {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Launch helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Launch Electron with the mock pi server injected.
 * `scenarios[N]` is the event array emitted after the N-th prompt command.
 */
async function launchWithMock(
  scenarios: MockScenario[],
  responseFile: string,
): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_ENTRY],
    timeout: 30_000,
    env: {
      ...process.env,
      GSD_TAU_MOCK_PI: MOCK_PI_SERVER_PATH,
      GSD_TAU_MOCK_SCENARIO: JSON.stringify(scenarios),
      GSD_TAU_MOCK_RESPONSE_FILE: responseFile,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Page-level helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inject the fixture into localStorage, reload, then click the Recent button
 * and wait until the composer (textarea) is enabled (Idle state).
 */
async function openViaRecents(page: Page, dir: string): Promise<void> {
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
  const name = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? dir
  await page.locator(`button:has-text("${name}")`).click()
  await expect(page.locator('header')).toBeVisible({ timeout: 20_000 })
  // Wait for Idle state — composer must be enabled before we send prompts.
  await expect(page.locator('textarea')).not.toBeDisabled({ timeout: 30_000 })
}

/**
 * Fill the composer, press Enter, then wait for [role="dialog"] to appear.
 * The mock pi emits a UI-request event soon after receiving the prompt command.
 */
async function sendAndWaitForDialog(page: Page, text = 'test'): Promise<void> {
  const composer = page.locator('textarea')
  await composer.fill(text)
  await composer.press('Enter')
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 15_000 })
}

/**
 * Wait for the active dialog to close AND for the "Waiting" state indicator
 * to disappear (= session returned to Idle after all blockers resolved).
 */
async function waitForIdle(page: Page): Promise<void> {
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 15_000 })
  // StateIndicator renders a <span> with text "Waiting" when session is Waiting.
  await expect(page.locator('span', { hasText: 'Waiting' })).not.toBeVisible({
    timeout: 10_000,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test('(1) select — single-choice and multi-choice', async () => {
  const { tmpDir, responseFile } = makeTmpDir()
  const scenarios: MockScenario[] = [
    // Prompt 1: single-select
    [
      { type: 'agent_start' },
      {
        type: 'extension_ui_request',
        id: 'sel-single',
        method: 'select',
        title: 'Pick one colour',
        options: ['Red', 'Green', 'Blue'],
      },
      { type: 'agent_end' },
    ],
    // Prompt 2: multi-select
    [
      { type: 'agent_start' },
      {
        type: 'extension_ui_request',
        id: 'sel-multi',
        method: 'select',
        title: 'Pick colours',
        options: ['Red', 'Green', 'Blue'],
        allowMultiple: true,
      },
      { type: 'agent_end' },
    ],
  ]

  const app = await launchWithMock(scenarios, responseFile)
  const page = await app.firstWindow()

  try {
    await openViaRecents(page, fixtureDir)

    // ── Part A: single-select — choose "Green" ─────────────────────────────
    await sendAndWaitForDialog(page, 'select 1')
    await page.locator('input[name="select-modal-option"][value="Green"]').check()
    await page.locator('[role="dialog"] button:has-text("Confirm")').click()
    await waitForIdle(page)

    // ── Part B: multi-select — choose "Red" and "Blue" ─────────────────────
    await sendAndWaitForDialog(page, 'select 2')
    await page.locator('input[name="select-modal-option"][value="Red"]').check()
    await page.locator('input[name="select-modal-option"][value="Blue"]').check()
    await page.locator('[role="dialog"] button:has-text("Confirm")').click()
    await waitForIdle(page)
  } finally {
    await app.close()
  }

  const resp = readResponses(responseFile)
  cleanTmpDir(tmpDir)
  // Single: { value: "Green" }
  expect(resp['sel-single']).toEqual({ value: 'Green' })
  // Multi: { values: [...] } containing Red and Blue (but not Green)
  const multi = (resp['sel-multi'] as { values?: string[] }).values ?? []
  expect(multi).toContain('Red')
  expect(multi).toContain('Blue')
  expect(multi).not.toContain('Green')
})

test('(2) confirm — yes and no', async () => {
  const { tmpDir, responseFile } = makeTmpDir()
  const scenarios: MockScenario[] = [
    [
      { type: 'agent_start' },
      { type: 'extension_ui_request', id: 'conf-yes', method: 'confirm', title: 'Proceed with yes?' },
      { type: 'agent_end' },
    ],
    [
      { type: 'agent_start' },
      { type: 'extension_ui_request', id: 'conf-no', method: 'confirm', title: 'Proceed with no?' },
      { type: 'agent_end' },
    ],
  ]

  const app = await launchWithMock(scenarios, responseFile)
  const page = await app.firstWindow()

  try {
    await openViaRecents(page, fixtureDir)

    // Yes
    await sendAndWaitForDialog(page, 'confirm yes')
    await page.locator('[role="dialog"] button:has-text("Yes")').click()
    await waitForIdle(page)

    // No
    await sendAndWaitForDialog(page, 'confirm no')
    await page.locator('[role="dialog"] button:has-text("No")').click()
    await waitForIdle(page)
  } finally {
    await app.close()
  }

  const resp = readResponses(responseFile)
  cleanTmpDir(tmpDir)
  expect(resp['conf-yes']).toEqual({ confirmed: true })
  expect(resp['conf-no']).toEqual({ confirmed: false })
})

test('(3) input — plain text and secure', async () => {
  const { tmpDir, responseFile } = makeTmpDir()
  const scenarios: MockScenario[] = [
    [
      { type: 'agent_start' },
      { type: 'extension_ui_request', id: 'inp-plain', method: 'input', title: 'Enter your name' },
      { type: 'agent_end' },
    ],
    [
      { type: 'agent_start' },
      {
        type: 'extension_ui_request',
        id: 'inp-secure',
        method: 'input',
        title: 'Enter password',
        secure: true,
      },
      { type: 'agent_end' },
    ],
  ]

  const app = await launchWithMock(scenarios, responseFile)
  const page = await app.firstWindow()

  try {
    await openViaRecents(page, fixtureDir)

    // Plain text input
    await sendAndWaitForDialog(page, 'input plain')
    await page.locator('[role="dialog"] input[type="text"]').fill('Alice')
    await page.locator('[role="dialog"] button:has-text("Submit")').click()
    await waitForIdle(page)

    // Secure (password) input
    await sendAndWaitForDialog(page, 'input secure')
    await page.locator('[role="dialog"] input[type="password"]').fill('s3cr3t')
    await page.locator('[role="dialog"] button:has-text("Submit")').click()
    await waitForIdle(page)
  } finally {
    await app.close()
  }

  const resp = readResponses(responseFile)
  cleanTmpDir(tmpDir)
  expect(resp['inp-plain']).toEqual({ value: 'Alice' })
  expect(resp['inp-secure']).toEqual({ value: 's3cr3t' })
})

test('(4) editor — submit (Ctrl+Enter) and cancel', async () => {
  const { tmpDir, responseFile } = makeTmpDir()
  const scenarios: MockScenario[] = [
    [
      { type: 'agent_start' },
      { type: 'extension_ui_request', id: 'ed-submit', method: 'editor', title: 'Write a note' },
      { type: 'agent_end' },
    ],
    [
      { type: 'agent_start' },
      { type: 'extension_ui_request', id: 'ed-cancel', method: 'editor', title: 'Write another note' },
      { type: 'agent_end' },
    ],
  ]

  const app = await launchWithMock(scenarios, responseFile)
  const page = await app.firstWindow()

  try {
    await openViaRecents(page, fixtureDir)

    // Submit via Ctrl+Enter
    await sendAndWaitForDialog(page, 'editor submit')
    const textarea = page.locator('[role="dialog"] textarea')
    await textarea.fill('hello editor')
    await textarea.press('Control+Enter')
    await waitForIdle(page)

    // Cancel
    await sendAndWaitForDialog(page, 'editor cancel')
    await page.locator('[role="dialog"] button:has-text("Cancel")').click()
    await waitForIdle(page)
  } finally {
    await app.close()
  }

  const resp = readResponses(responseFile)
  cleanTmpDir(tmpDir)
  expect(resp['ed-submit']).toEqual({ value: 'hello editor' })
  expect(resp['ed-cancel']).toEqual({ cancelled: true })
})

test('(5) notify + setStatus — non-modal render, auto-acked by main process', async () => {
  const { tmpDir, responseFile } = makeTmpDir()
  const scenarios: MockScenario[] = [
    [
      { type: 'agent_start' },
      // notify and setStatus are NOT interactive — handlers.ts auto-acks them
      // with { value: '' } and they never trigger SESSION_UI_REQUEST_ADDED.
      {
        type: 'extension_ui_request',
        id: 'notif-1',
        method: 'notify',
        title: 'System alert',
        message: 'Something happened',
      },
      {
        type: 'extension_ui_request',
        id: 'sts-1',
        method: 'setStatus',
        text: 'Processing…',
      },
      { type: 'agent_end' },
    ],
  ]

  const app = await launchWithMock(scenarios, responseFile)
  const page = await app.firstWindow()

  try {
    await openViaRecents(page, fixtureDir)

    const composer = page.locator('textarea')
    await composer.fill('notify test')
    await composer.press('Enter')

    // No blocking modal should appear.  Wait long enough for all events to be
    // processed (agent_start → notify auto-ack → setStatus auto-ack → agent_end).
    await page.waitForTimeout(1_500)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible()

    // Session returns to Idle: Working → agent_end (no blockers) → Idle.
    // The composer is disabled while Working; re-enabled when Idle.
    await expect(composer).not.toBeDisabled({ timeout: 10_000 })
  } finally {
    await app.close()
  }

  // handlers.ts auto-acked both requests with { value: '' }
  const resp = await waitForResponses(responseFile, ['notif-1', 'sts-1'], 5_000)
  cleanTmpDir(tmpDir)
  expect(resp['notif-1']).toEqual({ value: '' })
  expect(resp['sts-1']).toEqual({ value: '' })
})

test('(6) two simultaneous blockers — queue badge and in-order responses', async () => {
  const { tmpDir, responseFile } = makeTmpDir()
  const scenarios: MockScenario[] = [
    [
      { type: 'agent_start' },
      // Both requests arrive before the user answers the first one
      { type: 'extension_ui_request', id: 'q1', method: 'confirm', title: 'First question?' },
      { type: 'extension_ui_request', id: 'q2', method: 'confirm', title: 'Second question?' },
      { type: 'agent_end' },
    ],
  ]

  const app = await launchWithMock(scenarios, responseFile)
  const page = await app.firstWindow()

  try {
    await openViaRecents(page, fixtureDir)

    const composer = page.locator('textarea')
    await composer.fill('queue test')
    await composer.press('Enter')

    // Wait for the first modal (q1) to appear
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 15_000 })

    // Both requests should be in the queue — badge shows "2 requests queued"
    await expect(
      page.locator('[aria-label="2 requests queued"]'),
    ).toBeVisible({ timeout: 8_000 })

    // Answer q1 — Yes
    await page.locator('[role="dialog"] button:has-text("Yes")').click()

    // q2 becomes active: dialog still visible (re-rendered with q2's content)
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 })

    // Answer q2 — No
    await page.locator('[role="dialog"] button:has-text("No")').click()

    // Both blockers resolved, agent_end already received → Idle
    await waitForIdle(page)
  } finally {
    await app.close()
  }

  const resp = readResponses(responseFile)
  cleanTmpDir(tmpDir)
  expect(resp['q1']).toEqual({ confirmed: true })
  expect(resp['q2']).toEqual({ confirmed: false })
})

test('(7) quit with open confirm modal — pre-shutdown hook sends cancelled:true', async () => {
  const { tmpDir, responseFile } = makeTmpDir()
  // No agent_end — the session stays in Waiting when the app is closed.
  // The pre-shutdown hook in handlers.ts iterates the BlockerTracker and
  // sends { cancelled: true } for each open blocker before the pipe closes.
  const scenarios: MockScenario[] = [
    [
      { type: 'agent_start' },
      {
        type: 'extension_ui_request',
        id: 'quit-conf',
        method: 'confirm',
        title: 'Are you sure you want to quit?',
      },
      // Intentionally no agent_end — keeps the session in Waiting
    ],
  ]

  const app = await launchWithMock(scenarios, responseFile)
  const page = await app.firstWindow()

  try {
    await openViaRecents(page, fixtureDir)

    const composer = page.locator('textarea')
    await composer.fill('quit test')
    await composer.press('Enter')

    // Wait for the confirm modal — session is now in Waiting state
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 15_000 })
  } finally {
    // Close the app while the modal is still open.
    // SessionManager.close() runs the pre-shutdown hook which sends
    // { cancelled: true } for every open blocker before client.shutdown().
    await app.close()
  }

  // After app.close() the mock pi subprocess has been gracefully shut down.
  // Poll until { cancelled: true } appears in the response file.
  const resp = await waitForResponses(responseFile, ['quit-conf'], 8_000)

  cleanTmpDir(tmpDir)

  expect(resp['quit-conf']).toEqual({ cancelled: true })
})

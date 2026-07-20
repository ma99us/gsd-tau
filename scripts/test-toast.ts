/**
 * scripts/test-toast.ts
 * Manual smoke test for Windows toast notifications.
 *
 * HOW TO RUN:
 *   This script must execute as an Electron main-process entry point.
 *   After building the project (`pnpm build`), run:
 *
 *     npx electron out/main/scripts/test-toast.js
 *
 *   Or, if you have ts-node available:
 *
 *     npx electron -r @swc/register scripts/test-toast.ts
 *
 * WHAT IT VERIFIES (manual):
 *   1. AppUserModelID 'io.opengsd.gsd-tau' is set (required for toast attribution).
 *   2. A toast titled 'gsd-tau needs input' appears within 500ms of show().
 *   3. The toast body reads 'test-project: confirm'.
 *   4. Clicking the toast emits a click event and focuses the window.
 *   5. A second toast call within 3s for the same session is suppressed (debounce).
 *   6. A toast call for a different session within 3s fires (per-session debounce).
 *
 * The script exits automatically after 8s if no toast is clicked.
 */

import { app, BrowserWindow } from 'electron'
import { showBlockerToast } from '../main/os/notifications'

const APP_ID = 'io.opengsd.gsd-tau'

function log(msg: string): void {
  console.log(`[test-toast] ${msg}`)
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_ID)
  log(`AppUserModelID set to: ${APP_ID}`)

  // Create a minimal window so win.show() + app.focus() have a target.
  const win = new BrowserWindow({
    width: 600,
    height: 300,
    title: 'Toast Smoke Test — gsd-tau',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.loadURL('about:blank')
  win.webContents.once('dom-ready', () => {
    win.webContents.executeJavaScript(
      `document.body.innerHTML = '<h1 style="font-family:sans-serif;padding:20px">Toast smoke test running — check your notification centre</h1>'`,
    )
  })

  const start = Date.now()

  // ── Toast 1: project-alpha / confirm ──────────────────────────────────────
  log('firing toast #1: project-alpha / confirm')
  showBlockerToast('project-alpha', 'confirm')
  log(`toast #1 show() dispatched after ${Date.now() - start}ms`)

  // ── Toast 2: same session within 3s — should be debounced (suppressed) ────
  setTimeout(() => {
    log('firing toast #2 (same session, 500ms later — should be DEBOUNCED)')
    showBlockerToast('project-alpha', 'select')
    log('toast #2 call returned (if no toast appeared, debounce is working ✓)')
  }, 500)

  // ── Toast 3: different session within 3s — should fire ────────────────────
  setTimeout(() => {
    log('firing toast #3: project-beta / input (different session — should FIRE)')
    showBlockerToast('project-beta', 'input')
    log(`toast #3 dispatched at ${Date.now() - start}ms`)
  }, 1_000)

  // ── Toast 4: same session after 3s — should fire ──────────────────────────
  setTimeout(() => {
    log('firing toast #4: project-alpha / editor (after 3s debounce — should FIRE)')
    showBlockerToast('project-alpha', 'editor')
    log(`toast #4 dispatched at ${Date.now() - start}ms`)
  }, 3_500)

  // ── Auto-exit ──────────────────────────────────────────────────────────────
  setTimeout(() => {
    log('auto-exit after 8s — all toasts should have been shown')
    app.quit()
  }, 8_000)
})

app.on('window-all-closed', () => {
  // Keep running until auto-exit timeout so toasts can be clicked.
})

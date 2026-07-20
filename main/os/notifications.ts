import { Notification, app, BrowserWindow } from 'electron'

/** Minimum milliseconds between toasts for the same session. */
const DEBOUNCE_MS = 3_000

/**
 * Per-session last-toast timestamp (epoch ms).
 * Scoped to module lifetime — resets on app restart.
 */
const lastToastTime = new Map<string, number>()

/**
 * Show a Windows toast notification when a blocker UI request arrives for a session.
 *
 * Debounced per-session: at most one toast every {@link DEBOUNCE_MS} ms for the
 * same `sessionName`. Calls within the cooldown window are silently dropped so
 * rapid blocker storms do not flood the notification centre.
 *
 * Requires `app.setAppUserModelId('io.opengsd.gsd-tau')` to have been called on
 * `app.whenReady()` — without it Windows may not attribute the toast correctly.
 *
 * @param sessionName  Human-readable session identifier shown in the toast body.
 *                     Typically `basename(cwd)`.
 * @param method       The `extension_ui_request` method (e.g. 'confirm', 'select',
 *                     'input') shown after the session name.
 */
export function showBlockerToast(sessionName: string, method: string): void {
  const now = Date.now()
  const last = lastToastTime.get(sessionName) ?? 0

  if (now - last < DEBOUNCE_MS) {
    console.debug(
      `[notifications] toast debounced session=${sessionName} (${DEBOUNCE_MS - (now - last)}ms remaining)`,
    )
    return
  }

  lastToastTime.set(sessionName, now)

  if (!Notification.isSupported()) {
    console.warn('[notifications] Notification API not supported on this platform — skipping toast')
    return
  }

  const notification = new Notification({
    title: 'gsd-tau needs input',
    body: `${sessionName}: ${method}`,
  })

  notification.on('click', () => {
    // Bring the main window to the foreground so the user can respond immediately.
    const win = BrowserWindow.getAllWindows()[0] ?? null
    if (win) {
      win.show()
    }
    // steal:true requests focus even when another app is foregrounded (Windows).
    app.focus({ steal: true })
  })

  notification.show()
  console.log(`[notifications] toast shown session=${sessionName} method=${method}`)
}

/**
 * Reset the per-session debounce timers.
 *
 * **For testing only** — do not call in production code. The leading underscore
 * signals test-only status.
 */
export function _resetDebounce(): void {
  lastToastTime.clear()
}

// Logger must be the first import — initialises file transport and overrides
// console.* so all subsequent output is captured to %APPDATA%\gsd-tau\logs\main.log.
import './logger'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { SessionManager } from './session/session-manager'
import { registerHandlers } from './ipc/handlers'
import { showBlockerToast } from './os/notifications'

// ── SessionManager singleton ───────────────────────────────────────────────────

/**
 * Single-instance SessionManager for the main process.
 * Exported so IPC handlers (added in later phases) can share this instance.
 */
export const sessionManager = new SessionManager()

// ── Shutdown guard ─────────────────────────────────────────────────────────────

/**
 * Set to `true` once the graceful-shutdown path has been entered.
 * Guards against re-entrant `before-quit` from blocking a second time after
 * we call `app.quit()` ourselves at the end of the teardown sequence.
 */
let _quitting = false

/** Maximum milliseconds to wait for ALL sessions to close before forcing quit. */
const TOTAL_SHUTDOWN_TIMEOUT_MS = 5_000

/**
 * Gracefully close every open session before allowing Electron to quit.
 *
 * Flow:
 *  1. First `before-quit`: preventDefault(), begin async session teardown.
 *  2. A {@link TOTAL_SHUTDOWN_TIMEOUT_MS} hard deadline covers total async work.
 *  3. Once all sessions are closed (or the deadline fires), call app.quit().
 *  4. Second `before-quit`: `_quitting` is already true → return without
 *     preventDefault(), letting Electron proceed with the real quit.
 *
 * Per-session close timeout (3 s) is enforced by {@link SessionManager.close}.
 * The 5 s ceiling here is an additional safety net that covers e.g. many
 * sessions or an unexpectedly slow close() implementation.
 */
app.on('before-quit', (event) => {
  if (_quitting) return // second pass — sessions already closed, allow quit
  event.preventDefault()
  _quitting = true

  const ids = sessionManager.activeSessions
  const shutdownStart = Date.now()

  console.log(`[shutdown] starting graceful close for ${ids.length} session(s)`)

  const closeAll = Promise.all(
    ids.map((id) => {
      const sessionStart = Date.now()
      return sessionManager
        .close(id)
        .then(() => {
          console.log(
            `[shutdown] session ${id} closed in ${Date.now() - sessionStart}ms`,
          )
        })
        .catch((err: unknown) => {
          // Errors must not prevent the hard-deadline race from settling.
          console.error(`[shutdown] session ${id} close error:`, err)
        })
    }),
  )

  Promise.race([
    closeAll.then(() => 'ok' as const),
    new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), TOTAL_SHUTDOWN_TIMEOUT_MS),
    ),
  ]).then((verdict) => {
    const elapsed = Date.now() - shutdownStart
    if (verdict === 'timeout') {
      console.error(
        `[shutdown] hard deadline reached after ${elapsed}ms — forcing quit`,
      )
    } else {
      console.log(`[shutdown] all sessions closed in ${elapsed}ms`)
    }
    // Re-trigger quit. _quitting is true so the before-quit handler returns
    // without calling preventDefault(), allowing Electron to proceed.
    app.quit()
  })
})

// ── Window factory ─────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  app.setAppUserModelId('io.opengsd.gsd-tau')
  registerHandlers(sessionManager, undefined, showBlockerToast)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Logger must be the first import — initialises file transport and overrides
// console.* so all subsequent output is captured to %APPDATA%\gsd-tau\logs\main.log.
import './logger'
import { app, BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { SessionManager } from './session/session-manager'
import { RegistryStore } from './persistence/registry-store'
import { registerHandlers, PUSH } from './ipc/handlers'
import { showBlockerToast } from './os/notifications'
import { resolvePiBinary, ResolvePiError } from './pi/resolve-pi'

// ── SessionManager singleton ───────────────────────────────────────────────────

/**
 * Registry persistence store — owns load/save of `%APPDATA%\gsd-tau\registry.json`.
 * Created at module level so SessionManager can reference it at construction time.
 */
const registryStore = new RegistryStore()

/**
 * Single-instance SessionManager for the main process.
 * Exported so IPC handlers (added in later phases) can share this instance.
 */
export const sessionManager = new SessionManager({ registryStore })

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

  // Flush pending registry writes immediately — before closing sessions — so
  // the current state (sessions still open, wasAutoRunning flags) reaches disk
  // even when the debounce window has not yet elapsed.
  registryStore.flush()

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

  // Closing the window must always quit the app and cleanly shut down all
  // pi sessions. `window-all-closed` + app.quit() handles the normal path;
  // this direct handler is a belt-and-suspenders guard.
  win.on('close', () => {
    app.quit()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ── Startup diagnostics ───────────────────────────────────────────────────────

/**
 * Read a JSON file and return a parsed object, or null on any error.
 */
function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Emit verbose startup diagnostics to the log.
 * Runs after app.whenReady() so app paths are available.
 */
function logStartupDiagnostics(): void {
  const appPkg = readJson(join(__dirname, '..', '..', 'package.json'))
  const appVersion = typeof appPkg?.version === 'string' ? appPkg.version : 'unknown'

  console.log(`[startup] ── gsd-tau v${appVersion} ─────────────────────────────`)
  console.log(`[startup] app.getPath('userData'): ${app.getPath('userData')}`)
  console.log(`[startup] app.getPath('appData'):  ${app.getPath('appData')}`)
  console.log(`[startup] process.versions.electron: ${process.versions.electron}`)
  console.log(`[startup] process.versions.node:     ${process.versions.node}`)
  console.log(`[startup] process.execPath:          ${process.execPath}`)

  // ── pi binary resolution ──
  let piPath: string | null = null
  try {
    piPath = resolvePiBinary()
    console.log(`[startup] pi binary resolved: ${piPath}`)
  } catch (err) {
    const msg = err instanceof ResolvePiError ? err.message : String(err)
    console.warn(`[startup] pi binary NOT found: ${msg}`)
  }

  // ── pi version ──
  if (piPath) {
    const piPkgPath = join(dirname(piPath), '..', 'package.json')
    const piPkg = readJson(piPkgPath)
    const piVersion = typeof piPkg?.version === 'string' ? piPkg.version : 'unknown'
    console.log(`[startup] pi version: ${piVersion} (from ${piPkgPath})`)
  }

  // ── GSD_PI_PATH override ──
  if (process.env.GSD_PI_PATH) {
    console.log(`[startup] GSD_PI_PATH override: ${process.env.GSD_PI_PATH}`)
  }
  if (process.env.GSD_TAU_MOCK_PI) {
    console.log(`[startup] GSD_TAU_MOCK_PI override: ${process.env.GSD_TAU_MOCK_PI}`)
  }

  // ── sessions directory ──
  const sessionsDir = join(
    process.env.USERPROFILE ?? process.env.HOME ?? '',
    '.gsd',
    'agent',
    'sessions',
  )
  console.log(`[startup] pi sessions dir: ${sessionsDir}`)
  if (existsSync(sessionsDir)) {
    try {
      const entries = readdirSync(sessionsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .slice(-5) // last 5 project session dirs
      console.log(`[startup] recent session dirs (last 5): ${entries.join(', ') || '(none)'}`)
    } catch {
      console.log(`[startup] recent session dirs: (could not read)`)
    }
  } else {
    console.log(`[startup] pi sessions dir: (not found)`)
  }

  console.log(`[startup] ──────────────────────────────────────────────────────`)
}

app.whenReady().then(async () => {
  app.setAppUserModelId('io.opengsd.gsd-tau')
  logStartupDiagnostics()

  // Load the persisted registry synchronously before opening the main window.
  // load() never throws — falls back to registry.json.bak then an empty default.
  const registry = registryStore.load()
  console.log(`[startup] registry loaded: ${registry.sessions.length} session(s)`)

  const cleanupHandlers = registerHandlers(sessionManager, undefined, showBlockerToast)
  // Remove IPC handlers when the app fully quits so Electron does not warn
  // about lingering handlers after the main process tears down.
  app.once('will-quit', () => cleanupHandlers())
  createMainWindow()

  // Restore sessions from the registry in parallel.  All opens are attempted
  // regardless of individual failures.  The restore-complete push event is
  // emitted to all webContents once every attempt has settled so the renderer
  // can hydrate its session list.
  try {
    const restoreResult = await sessionManager.restore(registry.sessions)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(PUSH.RESTORE_COMPLETE, restoreResult)
      }
    }
    console.log(
      `[startup] restore-complete fanned out: ${
        restoreResult.restored.length
      } restored, ${restoreResult.failed.length} failed`,
    )
  } catch (err) {
    // restore() itself never throws (failures go to failed[]), but guard anyway.
    console.error('[startup] unexpected error during session restore:', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // gsd-tau is Windows-only; always quit when the last window closes.
  app.quit()
})

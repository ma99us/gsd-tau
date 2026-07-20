/**
 * Centralised logger for the main process.
 *
 * Wraps electron-log with:
 * - File transport to %APPDATA%\gsd-tau\logs\main.log (10 MB, one archive).
 * - Console transport (same level) so terminal output is preserved during dev.
 * - Global console override so every console.log/warn/error call in main is
 *   captured to the log file — no code-level changes required elsewhere.
 *
 * Import this module once, at the top of main/index.ts, before any other
 * imports that might emit console output.
 *
 * Usage anywhere in main/:
 *   import { log } from './logger'
 *   log.info('[session] opened', { cwd })
 */

import log from 'electron-log/main'
import { join } from 'path'
import { app } from 'electron'
import { mkdirSync } from 'fs'

// ── File transport ────────────────────────────────────────────────────────────

const logsDir = join(app.getPath('appData'), 'gsd-tau', 'logs')
mkdirSync(logsDir, { recursive: true })

log.transports.file.resolvePathFn = () => join(logsDir, 'main.log')
log.transports.file.maxSize = 10 * 1024 * 1024 // 10 MB

// One backup archive kept alongside main.log.
log.transports.file.archiveLog = (oldLogFile) => {
  const archivePath = join(logsDir, 'main.old.log')
  try {
    const { renameSync, unlinkSync, existsSync } = require('fs') as typeof import('fs')
    if (existsSync(archivePath)) unlinkSync(archivePath)
    renameSync(String(oldLogFile), archivePath)
  } catch {
    // Non-fatal — worst case the file grows until the next rotation.
  }
}

// ── Console transport ─────────────────────────────────────────────────────────

// Keep console output in dev; match the file transport level.
log.transports.console.level = 'debug'
log.transports.file.level = 'debug'

// ── Log file path helper ──────────────────────────────────────────────────────

/** Absolute path to the main-process log file. Useful for surfacing in UI. */
export function mainLogPath(): string {
  return join(logsDir, 'main.log')
}

// ── Override global console in main process ───────────────────────────────────
//
// This captures all console.log/warn/error calls from third-party code
// (RpcClient, electron-log itself, etc.) into the log file without requiring
// every call site to import the logger.

log.initialize()
Object.assign(console, log.functions)

// ── Named export ──────────────────────────────────────────────────────────────

export { log }
export default log

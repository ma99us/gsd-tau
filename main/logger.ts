/**
 * Centralised logger for the main process.
 *
 * Wraps electron-log with:
 * - File transport to %APPDATA%\gsd-tau\logs\main.log.
 *   The file is TRUNCATED on every app start so only the current session is
 *   kept — no historic log accumulation.
 * - Console transport (same level) so terminal output is preserved during dev.
 * - Global console override so every console.log/warn/error call in main is
 *   captured to the log file — no code-level changes required elsewhere.
 * - Prints the absolute log file path to stdout on startup.
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
import { mkdirSync, writeFileSync } from 'fs'

// ── File transport ────────────────────────────────────────────────────────────

const logsDir = join(app.getPath('appData'), 'gsd-tau', 'logs')
mkdirSync(logsDir, { recursive: true })

const logFilePath = join(logsDir, 'main.log')

// Truncate the log file on every startup so only the current session is kept.
try {
  writeFileSync(logFilePath, '')
} catch {
  // Non-fatal — if we can't truncate, logging continues to the existing file.
}

log.transports.file.resolvePathFn = () => logFilePath
// No size-based rotation — the file is wiped on each launch instead.
log.transports.file.maxSize = 0

// ── Console transport ─────────────────────────────────────────────────────────

// Keep console output in dev; match the file transport level.
log.transports.console.level = 'debug'
log.transports.file.level = 'debug'

// ── Log file path helper ──────────────────────────────────────────────────────

/** Absolute path to the main-process log file. Useful for surfacing in UI. */
export function mainLogPath(): string {
  return logFilePath
}

// ── Override global console in main process ───────────────────────────────────
//
// This captures all console.log/warn/error calls from third-party code
// (RpcClient, electron-log itself, etc.) into the log file without requiring
// every call site to import the logger.

log.initialize()
Object.assign(console, log.functions)

// Print log path to native stdout (visible in terminal / IDE run panel)
// AND into the log file itself, so the path is always the first line logged.
process.stdout.write(`[gsd-tau] log file: ${logFilePath}\n`)
log.info(`[logger] log file: ${logFilePath}`)

// ── Named export ──────────────────────────────────────────────────────────────

export { log }
export default log

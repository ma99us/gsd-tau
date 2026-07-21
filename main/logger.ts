/**
 * Centralised logger for the main process.
 *
 * Wraps electron-log with:
 * - File transport to %APPDATA%\gsd-tau\logs\main.log (current session).
 * - On every app start the previous log files are rotated:
 *     main2.log → deleted
 *     main1.log → main2.log
 *     main.log  → main1.log
 *     (new)     → main.log
 *   This keeps the last 3 sessions as separate files:
 *     main.log  — current session
 *     main1.log — previous session
 *     main2.log — session before that
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
import { mkdirSync, renameSync, rmSync, existsSync } from 'fs'

// ── File transport ────────────────────────────────────────────────────────────

const logsDir = join(app.getPath('appData'), 'gsd-tau', 'logs')
mkdirSync(logsDir, { recursive: true })

const logFilePath  = join(logsDir, 'main.log')
const logFile1Path = join(logsDir, 'main1.log')
const logFile2Path = join(logsDir, 'main2.log')

// Rotate on startup: drop oldest, shift previous logs down, start fresh.
try {
  if (existsSync(logFile2Path)) rmSync(logFile2Path)
  if (existsSync(logFile1Path)) renameSync(logFile1Path, logFile2Path)
  if (existsSync(logFilePath))  renameSync(logFilePath,  logFile1Path)
} catch {
  // Non-fatal — rotation failure does not prevent logging.
}

log.transports.file.resolvePathFn = () => logFilePath
// No size-based rotation — we rotate by session (per-launch) instead.
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

/** Absolute paths to all retained log files (current + up to 2 prior). */
export function allLogPaths(): string[] {
  return [logFilePath, logFile1Path, logFile2Path].filter(existsSync)
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
log.info(`[logger] prior logs: main1.log${existsSync(logFile1Path) ? ' ✓' : ' (none)'}, main2.log${existsSync(logFile2Path) ? ' ✓' : ' (none)'}`)

// ── Named export ──────────────────────────────────────────────────────────────

export { log }
export default log

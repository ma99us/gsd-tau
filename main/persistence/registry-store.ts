/**
 * RegistryStore — atomic JSON persistence for the gsd-tau session/window registry.
 *
 * Write strategy:
 *   1. Debounce 500 ms — rapid mutations coalesce into a single flush.
 *   2. On flush: write JSON to registry.json.tmp.
 *   3. Copy current registry.json → registry.json.bak (if it exists).
 *   4. Rename registry.json.tmp → registry.json  (atomic on same filesystem).
 *
 * Load strategy:
 *   registry.json → registry.json.bak → getDefault()
 *
 * The `.tmp` file is intentionally excluded from the load path. An orphaned
 * .tmp (process killed between write and rename) is harmless — the next
 * successful flush overwrites it.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { RegistryV1 } from '@shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultDataDir(): string {
  const appData = process.env['APPDATA'] ?? process.env['HOME'] ?? '.'
  return path.join(appData, 'gsd-tau')
}

// ---------------------------------------------------------------------------
// RegistryStore
// ---------------------------------------------------------------------------

export class RegistryStore {
  private readonly dir: string
  private readonly registryPath: string
  private readonly bakPath: string
  private readonly tmpPath: string

  private _timer: ReturnType<typeof setTimeout> | null = null
  private _pending: RegistryV1 | null = null

  /**
   * @param dataDir  Override the data directory (used in tests).
   *                 Defaults to `%APPDATA%/gsd-tau`.
   */
  constructor(dataDir?: string) {
    this.dir = dataDir ?? defaultDataDir()
    this.registryPath = path.join(this.dir, 'registry.json')
    this.bakPath = path.join(this.dir, 'registry.json.bak')
    this.tmpPath = path.join(this.dir, 'registry.json.tmp')
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Load the registry from disk synchronously.
   *
   * Fall-back chain: registry.json → registry.json.bak → getDefault()
   *
   * Intentionally does NOT read registry.json.tmp — an orphaned .tmp from
   * a previously killed process is ignored; the data is still in .bak.
   */
  load(): RegistryV1 {
    // 1. Primary
    const primary = this._tryRead(this.registryPath)
    if (primary !== null) return primary

    // 2. Backup
    const bak = this._tryRead(this.bakPath)
    if (bak !== null) return bak

    // 3. Empty default
    return this.getDefault()
  }

  /** Return a fresh, empty registry. */
  getDefault(): RegistryV1 {
    return { version: 1, sessions: [], windows: [], mruOrder: [] }
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Schedule a debounced flush (500 ms).
   *
   * Multiple rapid calls coalesce — only the registry value from the *last*
   * call within the window is written.
   */
  save(registry: RegistryV1): void {
    this._pending = registry

    if (this._timer !== null) {
      clearTimeout(this._timer)
    }

    this._timer = setTimeout(() => {
      this._timer = null
      const reg = this._pending!
      this._pending = null
      this._flush(reg)
    }, 500)
  }

  /**
   * Flush any pending save immediately (bypass debounce).
   *
   * Call this on graceful shutdown so in-flight mutations reach disk even
   * when the 500 ms window has not elapsed.
   */
  flush(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer)
      this._timer = null
    }
    if (this._pending !== null) {
      const reg = this._pending
      this._pending = null
      this._flush(reg)
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Atomic write:
   *   write → .tmp
   *   copy  → .bak   (previous .json, if present)
   *   rename .tmp → .json
   */
  private _flush(registry: RegistryV1): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true })

      const json = JSON.stringify(registry, null, 2)

      // Step 1 — write to tmp
      fs.writeFileSync(this.tmpPath, json, 'utf8')

      // Step 2 — backup existing registry.json (best-effort)
      try {
        fs.copyFileSync(this.registryPath, this.bakPath)
      } catch {
        // No previous file — that is fine on first write
      }

      // Step 3 — atomic rename
      fs.renameSync(this.tmpPath, this.registryPath)
    } catch (err) {
      // Never crash the main process over a persistence failure.
      console.error('[RegistryStore] flush failed:', err)
    }
  }

  /**
   * Try to read and parse a JSON file.
   * Returns `null` on any error (missing file, permission denied, bad JSON).
   */
  private _tryRead(filePath: string): RegistryV1 | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(raw) as RegistryV1
    } catch {
      return null
    }
  }
}

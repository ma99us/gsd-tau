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
import type { RegistryV1, WindowRecord } from '@shared/types'

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
   * Last known sessionHistory — seeded from `load()` and updated on every
   * `save()`.  Ensures that bounds-only saves (which pass `windows: []` and
   * no sessionHistory) never silently discard history written by
   * SessionManager.
   */
  private _lastSessionHistory: Record<string, string> | undefined = undefined

  /**
   * In-memory window records, seeded from `load()` and mutated by
   * `updateWindowBounds()`.  Always merged into every `save()` call so that
   * SessionManager saves (which pass `windows: []`) never silently discard
   * persisted window geometry.
   */
  private _windows: WindowRecord[] = []

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
    if (primary !== null) {
      this._windows = primary.windows ?? []
      this._lastSessionHistory = primary.sessionHistory
      return primary
    }

    // 2. Backup
    const bak = this._tryRead(this.bakPath)
    if (bak !== null) {
      this._windows = bak.windows ?? []
      this._lastSessionHistory = bak.sessionHistory
      return bak
    }

    // 3. Empty default
    this._windows = []
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
    // Preserve sessionHistory: if the incoming registry doesn't carry it
    // (e.g. a bounds-only save from updateWindowBounds), fall back to the
    // last known value so history is never silently discarded.
    const history = registry.sessionHistory ?? this._pending?.sessionHistory ?? this._lastSessionHistory
    if (history !== undefined) this._lastSessionHistory = history

    // Always merge the in-memory window records so that callers which pass
    // `windows: []` (e.g. SessionManager) never erase persisted window geometry.
    this._pending = { ...registry, windows: this._windows, sessionHistory: history }

    if (this._timer !== null) {
      clearTimeout(this._timer)
    }

    this._timer = setTimeout(() => {
      this._timer = null
      const reg = this._pending!
      this._pending = null
      const historyKeys = Object.keys(reg.sessionHistory ?? {})
      console.log(
        `[RegistryStore] debounced flush: writing registry`,
        `sessions=${reg.sessions.length}`,
        `history=[${historyKeys.map(k => `"${k}"`).join(', ')}]`,
      )
      this._flush(reg)
    }, 500)
  }

  /**
   * Upsert window bounds for `windowId` and schedule a debounced flush.
   *
   * `tabIds` and `activeTabId` on a new record are initialised to safe empty
   * values — they are managed separately by the tab-management layer.
   *
   * If a pending save is already queued the timer is restarted so that the
   * bounds update coalesces with the most recent session state rather than
   * flushing a stale snapshot.
   */
  updateWindowBounds(
    windowId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const idx = this._windows.findIndex((w) => w.id === windowId)
    if (idx >= 0) {
      this._windows[idx] = { ...this._windows[idx], bounds }
    } else {
      this._windows.push({ id: windowId, tabIds: [], activeTabId: '', bounds })
    }

    // Use the already-pending registry (current session state) if available;
    // fall back to a minimal empty registry so the window record is not lost.
    const base: RegistryV1 = this._pending ?? {
      version: 1,
      sessions: [],
      windows: [],
      mruOrder: [],
    }
    // save() will overwrite windows with this._windows — pass base for sessions.
    this.save(base)
  }

  /**
   * Upsert the active-tab CWD for `windowId` and schedule a debounced flush.
   *
   * Mutates `_windows` immediately (no debounce on the in-memory update) so
   * that the synchronous `flush()` call in `win.on('close')` always captures
   * the latest value, even when the debounce window has not yet elapsed.
   *
   * The stable CWD (not the ephemeral session ID) is stored because
   * session-manager.open() generates a new random ID on every launch.
   */
  updateWindowActiveTab(windowId: string, cwd: string): void {
    const idx = this._windows.findIndex((w) => w.id === windowId)
    if (idx >= 0) {
      this._windows[idx] = { ...this._windows[idx], activeTabCwd: cwd }
    } else {
      // Window not yet registered (e.g. very first tab open before bounds are saved).
      // Create a minimal record so the CWD is not lost.
      this._windows.push({
        id: windowId,
        tabIds: [],
        activeTabId: '',
        activeTabCwd: cwd,
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
      })
    }

    const base: RegistryV1 = this._pending ?? {
      version: 1,
      sessions: [],
      windows: [],
      mruOrder: [],
    }
    this.save(base)
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
      const historyKeys = Object.keys(reg.sessionHistory ?? {})
      console.log(
        `[RegistryStore] flush: writing registry`,
        `sessions=${reg.sessions.length}`,
        `history=[${historyKeys.map(k => `"${k}"`).join(', ')}]`,
      )
      this._flush(reg)
    } else {
      console.log('[RegistryStore] flush: nothing pending — no write')
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

/**
 * QuotaHistory — atomic-write JSON persistence for Copilot quota usage history.
 *
 * Stores up to 90 days of `QuotaHistoryEntry` records in `quota-history.json`
 * using the same write strategy as RegistryStore:
 *   1. Write JSON to quota-history.json.tmp
 *   2. Copy quota-history.json → quota-history.json.bak  (if it exists)
 *   3. Rename .tmp → quota-history.json  (atomic on same filesystem)
 *
 * Load strategy: quota-history.json → quota-history.json.bak → []
 *
 * On load, entries older than 90 days are pruned and the trimmed list is
 * immediately re-persisted so stale entries never accumulate.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { QuotaHistoryEntry } from '../../shared/types'

/** Retain entries no older than this many days. */
const PRUNE_DAYS = 90

export class QuotaHistory {
  private readonly _historyPath: string
  private readonly _tmpPath: string
  private readonly _bakPath: string
  private _entries: QuotaHistoryEntry[] = []

  constructor(dataDir: string) {
    this._historyPath = path.join(dataDir, 'quota-history.json')
    this._tmpPath = path.join(dataDir, 'quota-history.json.tmp')
    this._bakPath = path.join(dataDir, 'quota-history.json.bak')
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Load entries from disk synchronously.
   *
   * Fall-back chain: quota-history.json → quota-history.json.bak → []
   *
   * Corrupted/invalid entries are filtered out defensively.  If pruning
   * reduced the list, the trimmed result is immediately flushed so the
   * next cold start does not re-read stale data.
   */
  load(): void {
    const raw = this._tryRead(this._historyPath) ?? this._tryRead(this._bakPath) ?? []
    const pruned = this._prune(raw)
    this._entries = pruned
    if (pruned.length < raw.length) {
      // Persist the cleaned list; ignore flush errors (best-effort on load)
      this._flush()
    }
  }

  /**
   * Append a new entry, prune to 90 days, and atomically persist.
   *
   * @returns The updated (pruned) entry array after the append.
   */
  append(entry: QuotaHistoryEntry): QuotaHistoryEntry[] {
    this._entries = this._prune([...this._entries, entry])
    this._flush()
    return this._entries
  }

  /**
   * Read-only view of the current in-memory entries, in chronological order.
   * Callers must not mutate the returned array.
   */
  getEntries(): readonly QuotaHistoryEntry[] {
    return this._entries
  }

  /**
   * Find the history entry whose timestamp is the closest value that is
   * at or before `ts`.
   *
   * Returns `null` when the history is empty or all entries are strictly
   * after `ts`.
   */
  getAt(ts: Date): QuotaHistoryEntry | null {
    const target = ts.getTime()
    let best: QuotaHistoryEntry | null = null
    for (const e of this._entries) {
      const t = new Date(e.ts).getTime()
      if (t <= target) best = e
    }
    return best
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Remove entries older than PRUNE_DAYS. */
  private _prune(entries: QuotaHistoryEntry[]): QuotaHistoryEntry[] {
    const cutoff = Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000
    return entries.filter((e) => new Date(e.ts).getTime() >= cutoff)
  }

  /**
   * Atomic flush:
   *   1. Ensure data dir exists.
   *   2. Write to .tmp.
   *   3. Copy .json → .bak (best-effort; no previous file is fine).
   *   4. Rename .tmp → .json.
   *
   * Never throws — errors are logged but do not crash the main process.
   */
  private _flush(): void {
    try {
      const dir = path.dirname(this._historyPath)
      fs.mkdirSync(dir, { recursive: true })

      const json = JSON.stringify(this._entries, null, 2)

      // Step 1: write to .tmp
      fs.writeFileSync(this._tmpPath, json, 'utf8')

      // Step 2: backup existing file (best-effort; first write has no .json yet)
      try {
        fs.copyFileSync(this._historyPath, this._bakPath)
      } catch {
        // No previous file — that is fine
      }

      // Step 3: atomic rename
      fs.renameSync(this._tmpPath, this._historyPath)
    } catch (err) {
      console.error('[quota-history] flush failed:', err)
    }
  }

  /**
   * Try to read and parse a JSON file as an array of history entries.
   *
   * Returns `null` on any error (missing file, permission denied, bad JSON).
   * Filters out malformed entries (missing required numeric fields) so a
   * partially-corrupt file still yields the valid portion.
   */
  private _tryRead(filePath: string): QuotaHistoryEntry[] | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null

      return (parsed as unknown[]).filter(
        (e): e is QuotaHistoryEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as Record<string, unknown>).ts === 'string' &&
          typeof (e as Record<string, unknown>).used === 'number' &&
          typeof (e as Record<string, unknown>).remaining === 'number' &&
          typeof (e as Record<string, unknown>).entitlement === 'number',
      )
    } catch {
      return null
    }
  }
}

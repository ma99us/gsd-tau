import { useState, useCallback, useMemo } from 'react'

// ── StorageAdapter ─────────────────────────────────────────────────────────────
// Minimal interface matching the subset of localStorage we use.
// Injectable so tests run in vitest node env without window.localStorage.

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// ── MRUStore ──────────────────────────────────────────────────────────────────
// Pure, testable core — no React, no globals.

export const DEFAULT_MRU_KEY = 'gsd-tau:mru-commands'
export const DEFAULT_MRU_MAX = 20

export interface MRUStore {
  /** Load the current ordered list from storage. */
  load(): string[]
  /**
   * Prepend `id` to the list, deduplicating and capping at `maxLen`.
   * Writes to storage and returns the new list.
   */
  push(id: string): string[]
  /** Wipe the list in storage. */
  clear(): void
}

/**
 * Build an MRU store bound to a storage key.
 *
 * @param key    Storage key (default: `DEFAULT_MRU_KEY`).
 * @param maxLen Maximum items to retain (default: `DEFAULT_MRU_MAX`).
 * @param storage StorageAdapter — defaults to `window.localStorage` in browser;
 *               inject a custom adapter in tests.
 */
export function createMRUStore(
  key     = DEFAULT_MRU_KEY,
  maxLen  = DEFAULT_MRU_MAX,
  storage: StorageAdapter = liveStorage(),
): MRUStore {
  function load(): string[] {
    try {
      const raw = storage.getItem(key)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      return []
    }
  }

  function push(id: string): string[] {
    const current = load()
    const deduped = current.filter(x => x !== id)
    const next    = [id, ...deduped].slice(0, maxLen)
    storage.setItem(key, JSON.stringify(next))
    return next
  }

  function clear(): void {
    storage.setItem(key, JSON.stringify([]))
  }

  return { load, push, clear }
}

/** Return window.localStorage when available; fall back to a no-op. */
function liveStorage(): StorageAdapter {
  try {
    return window.localStorage
  } catch {
    return { getItem: () => null, setItem: () => {} }
  }
}

// ── useMRU hook ───────────────────────────────────────────────────────────────

/**
 * React hook for MRU command ordering.
 *
 * Returns `[orderedIds, record]`:
 *   - `orderedIds` — most-recently-used items first.
 *   - `record(id)` — call when a command is invoked to move it to the front.
 *
 * All parameters are optional and injectable for testing.
 */
export function useMRU(
  key?: string,
  maxLen?: number,
  storage?: StorageAdapter,
): [string[], (id: string) => void] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createMRUStore(key, maxLen, storage), [])

  const [order, setOrder] = useState<string[]>(() => store.load())

  const record = useCallback(
    (id: string) => {
      setOrder(store.push(id))
    },
    [store],
  )

  return [order, record]
}

import { useState, useCallback } from 'react'
import type { RpcSlashCommand, SessionId } from '../../shared/types'

// ── TTL Cache ─────────────────────────────────────────────────────────────────
// Module-level cache: one entry per sessionId, shared across all hook instances.
// Exported so tests can exercise the cache logic without React.

export const CACHE_TTL_MS = 60_000 // 60 seconds

export interface CacheEntry {
  data: RpcSlashCommand[]
  fetchedAt: number
}

const commandCache = new Map<string, CacheEntry>()

/** Remove all cache entries. Exposed for testing. */
export function clearCommandCache(): void {
  commandCache.clear()
}

/**
 * Return cached commands when still fresh; otherwise call `fetcher` and cache
 * the result.  Failed fetches are not cached — the next call will retry.
 *
 * Injectable `fetcher` and `now` make the function testable without IPC.
 */
export async function fetchPiCommands(
  sessionId: SessionId,
  fetcher: (id: SessionId) => Promise<RpcSlashCommand[]>,
  now = Date.now(),
): Promise<RpcSlashCommand[]> {
  const entry = commandCache.get(sessionId)
  if (entry !== undefined && now - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.data
  }
  const data = await fetcher(sessionId)
  commandCache.set(sessionId, { data, fetchedAt: now })
  return data
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UsePiCommandsReturn {
  /** Command list — empty until the first successful fetch. */
  commands: RpcSlashCommand[]
  /** True while a fetch is in flight. */
  loading: boolean
  /** Error message from the last failed fetch, or null. */
  error: string | null
  /**
   * Trigger a fetch (respects the 60s TTL cache).
   * Call this when the palette opens — not on mount.
   * No-op when `sessionId` is null.
   */
  fetch: () => void
}

export function usePiCommands(sessionId: SessionId | null): UsePiCommandsReturn {
  const [commands, setCommands] = useState<RpcSlashCommand[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(() => {
    if (sessionId === null) return
    setLoading(true)
    setError(null)
    fetchPiCommands(sessionId, id => window.gsd.getCommands(id))
      .then(data => {
        setCommands(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[usePiCommands] fetch error:', msg)
        setError(msg)
        setLoading(false)
      })
  }, [sessionId])

  return { commands, loading, error, fetch }
}

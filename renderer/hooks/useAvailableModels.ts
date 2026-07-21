import { useState, useCallback } from 'react'
import type { ModelInfo, SessionId } from '../../shared/types'

// ── TTL Cache ─────────────────────────────────────────────────────────────────
// Module-level cache: one entry per sessionId, shared across all hook instances.
// Exported so tests can exercise the cache logic without React.

export const CACHE_TTL_MS = 60_000 // 60 seconds

export interface CacheEntry {
  data: ModelInfo[]
  fetchedAt: number
}

const modelCache = new Map<string, CacheEntry>()

/** Remove all cache entries. Exposed for testing. */
export function clearModelCache(): void {
  modelCache.clear()
}

/**
 * Return cached models when still fresh; otherwise call `fetcher` and cache
 * the result.  Failed fetches are not cached — the next call will retry.
 *
 * Injectable `fetcher` and `now` make the function testable without IPC.
 */
export async function fetchAvailableModels(
  sessionId: SessionId,
  fetcher: (id: SessionId) => Promise<ModelInfo[]>,
  now = Date.now(),
): Promise<ModelInfo[]> {
  const entry = modelCache.get(sessionId)
  if (entry !== undefined && now - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.data
  }
  const data = await fetcher(sessionId)
  modelCache.set(sessionId, { data, fetchedAt: now })
  return data
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseAvailableModelsReturn {
  /** Model list — empty until the first successful fetch. */
  models: ModelInfo[]
  /** True while a fetch is in flight. */
  loading: boolean
  /** Error message from the last failed fetch, or null. */
  error: string | null
  /**
   * Trigger a fetch (respects the 60s TTL cache).
   * Call this when the dropdown opens — not on mount.
   * No-op when `sessionId` is null.
   */
  fetch: () => void
}

export function useAvailableModels(sessionId: SessionId | null): UseAvailableModelsReturn {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(() => {
    if (sessionId === null) return
    setLoading(true)
    setError(null)
    fetchAvailableModels(sessionId, id => window.gsd.getAvailableModels(id))
      .then(data => {
        setModels(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[useAvailableModels] fetch error:', msg)
        setError(msg)
        setLoading(false)
      })
  }, [sessionId])

  return { models, loading, error, fetch }
}

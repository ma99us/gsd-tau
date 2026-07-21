import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fetchAvailableModels,
  clearModelCache,
  CACHE_TTL_MS,
} from './useAvailableModels'
import type { ModelInfo } from '../../shared/types'

// ModelInfo is a type from @opengsd/contracts — erased at runtime.
// Use minimal compatible shapes cast to satisfy TypeScript.
const MODEL_A = { id: 'claude-3-5-sonnet', provider: 'anthropic', name: 'Claude 3.5 Sonnet' } as unknown as ModelInfo
const MODEL_B = { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o' } as unknown as ModelInfo

describe('useAvailableModels — cache utilities', () => {
  beforeEach(() => {
    clearModelCache()
  })

  // ── CACHE_TTL_MS ───────────────────────────────────────────────────────────
  it('exports CACHE_TTL_MS as 60 000 ms', () => {
    expect(CACHE_TTL_MS).toBe(60_000)
  })

  // ── fetchAvailableModels — happy paths ─────────────────────────────────────
  describe('fetchAvailableModels', () => {
    it('calls fetcher on first request and returns its result', async () => {
      const fetcher = vi.fn().mockResolvedValue([MODEL_A])
      const result = await fetchAvailableModels('s1', fetcher)
      expect(fetcher).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledWith('s1')
      expect(result).toEqual([MODEL_A])
    })

    it('returns cached result without re-calling fetcher within TTL', async () => {
      const fetcher = vi.fn().mockResolvedValue([MODEL_A])
      const t0 = 1_000_000
      await fetchAvailableModels('s1', fetcher, t0)
      // 1 second later — well within the 60 s window
      const result = await fetchAvailableModels('s1', fetcher, t0 + 1_000)
      expect(fetcher).toHaveBeenCalledOnce()
      expect(result).toEqual([MODEL_A])
    })

    it('re-fetches after the TTL has expired', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce([MODEL_A])
        .mockResolvedValueOnce([MODEL_B])
      const t0 = 1_000_000
      await fetchAvailableModels('s1', fetcher, t0)
      const result = await fetchAvailableModels('s1', fetcher, t0 + CACHE_TTL_MS + 1)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(result).toEqual([MODEL_B])
    })

    it('treats separate session IDs as independent cache keys', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce([MODEL_A])
        .mockResolvedValueOnce([MODEL_B])
      const t0 = 1_000_000
      const r1 = await fetchAvailableModels('s1', fetcher, t0)
      const r2 = await fetchAvailableModels('s2', fetcher, t0)
      expect(r1).toEqual([MODEL_A])
      expect(r2).toEqual([MODEL_B])
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('handles an empty model list without error', async () => {
      const fetcher = vi.fn().mockResolvedValue([])
      const result = await fetchAvailableModels('s1', fetcher)
      expect(result).toEqual([])
    })

    // ── TTL boundary ─────────────────────────────────────────────────────────

    it('still returns cached data one millisecond before TTL expires', async () => {
      const fetcher = vi.fn().mockResolvedValue([MODEL_A])
      const t0 = 1_000_000
      await fetchAvailableModels('s1', fetcher, t0)
      await fetchAvailableModels('s1', fetcher, t0 + CACHE_TTL_MS - 1)
      expect(fetcher).toHaveBeenCalledOnce()
    })

    it('re-fetches at exactly the TTL boundary (not-fresh)', async () => {
      const fetcher = vi.fn().mockResolvedValue([MODEL_A])
      const t0 = 1_000_000
      await fetchAvailableModels('s1', fetcher, t0)
      await fetchAvailableModels('s1', fetcher, t0 + CACHE_TTL_MS)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    // ── Error / negative paths ────────────────────────────────────────────────

    it('propagates fetcher errors to the caller', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('IPC error'))
      await expect(fetchAvailableModels('s1', fetcher)).rejects.toThrow('IPC error')
    })

    it('does NOT cache a failed fetch — next call retries the fetcher', async () => {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce([MODEL_A])
      // First call throws
      await expect(fetchAvailableModels('s1', fetcher)).rejects.toThrow('timeout')
      // Second call should go to the fetcher again (nothing was stored)
      const result = await fetchAvailableModels('s1', fetcher)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(result).toEqual([MODEL_A])
    })

    it('does not leak a failed session entry into subsequent different sessions', async () => {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce([MODEL_B])
      await expect(fetchAvailableModels('s1', fetcher)).rejects.toThrow('fail')
      const result = await fetchAvailableModels('s2', fetcher)
      expect(result).toEqual([MODEL_B])
    })
  })

  // ── clearModelCache ────────────────────────────────────────────────────────
  describe('clearModelCache', () => {
    it('forces a re-fetch after the cache is cleared', async () => {
      const fetcher = vi.fn().mockResolvedValue([MODEL_A])
      const t0 = 1_000_000
      await fetchAvailableModels('s1', fetcher, t0)
      clearModelCache()
      await fetchAvailableModels('s1', fetcher, t0 + 1_000)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('clears entries for all sessions', async () => {
      const fetcher = vi.fn().mockResolvedValue([MODEL_A])
      const t0 = 1_000_000
      await fetchAvailableModels('s1', fetcher, t0)
      await fetchAvailableModels('s2', fetcher, t0)
      clearModelCache()
      await fetchAvailableModels('s1', fetcher, t0 + 1_000)
      await fetchAvailableModels('s2', fetcher, t0 + 1_000)
      // 2 initial + 2 after clear
      expect(fetcher).toHaveBeenCalledTimes(4)
    })
  })
})

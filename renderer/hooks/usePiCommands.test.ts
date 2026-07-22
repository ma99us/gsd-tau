import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fetchPiCommands,
  clearCommandCache,
  CACHE_TTL_MS,
} from './usePiCommands'
import type { RpcSlashCommand } from '../../shared/types'

// RpcSlashCommand is a type from @opengsd/contracts — erased at runtime.
// Use minimal compatible shapes cast to satisfy TypeScript.
const CMD_A = { name: '/gsd', description: 'Run a GSD skill', type: 'skill' } as unknown as RpcSlashCommand
const CMD_B = { name: '/help', description: 'Show help', type: 'built-in' } as unknown as RpcSlashCommand

describe('usePiCommands — cache utilities', () => {
  beforeEach(() => {
    clearCommandCache()
  })

  // ── CACHE_TTL_MS ───────────────────────────────────────────────────────────
  it('exports CACHE_TTL_MS as 60 000 ms', () => {
    expect(CACHE_TTL_MS).toBe(60_000)
  })

  // ── fetchPiCommands — happy paths ──────────────────────────────────────────
  describe('fetchPiCommands', () => {
    it('calls fetcher on first request and returns its result', async () => {
      const fetcher = vi.fn().mockResolvedValue([CMD_A])
      const result = await fetchPiCommands('s1', fetcher)
      expect(fetcher).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledWith('s1')
      expect(result).toEqual([CMD_A])
    })

    it('returns cached result without re-calling fetcher within TTL', async () => {
      const fetcher = vi.fn().mockResolvedValue([CMD_A])
      const t0 = 1_000_000
      await fetchPiCommands('s1', fetcher, t0)
      // 1 second later — well within the 60 s window
      const result = await fetchPiCommands('s1', fetcher, t0 + 1_000)
      expect(fetcher).toHaveBeenCalledOnce()
      expect(result).toEqual([CMD_A])
    })

    it('re-fetches after the TTL has expired', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce([CMD_A])
        .mockResolvedValueOnce([CMD_B])
      const t0 = 1_000_000
      await fetchPiCommands('s1', fetcher, t0)
      const result = await fetchPiCommands('s1', fetcher, t0 + CACHE_TTL_MS + 1)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(result).toEqual([CMD_B])
    })

    it('treats separate session IDs as independent cache keys', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce([CMD_A])
        .mockResolvedValueOnce([CMD_B])
      const t0 = 1_000_000
      const r1 = await fetchPiCommands('s1', fetcher, t0)
      const r2 = await fetchPiCommands('s2', fetcher, t0)
      expect(r1).toEqual([CMD_A])
      expect(r2).toEqual([CMD_B])
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('handles an empty command list without error', async () => {
      const fetcher = vi.fn().mockResolvedValue([])
      const result = await fetchPiCommands('s1', fetcher)
      expect(result).toEqual([])
    })

    // ── TTL boundary ─────────────────────────────────────────────────────────

    it('still returns cached data one millisecond before TTL expires', async () => {
      const fetcher = vi.fn().mockResolvedValue([CMD_A])
      const t0 = 1_000_000
      await fetchPiCommands('s1', fetcher, t0)
      await fetchPiCommands('s1', fetcher, t0 + CACHE_TTL_MS - 1)
      expect(fetcher).toHaveBeenCalledOnce()
    })

    it('re-fetches at exactly the TTL boundary (not-fresh)', async () => {
      const fetcher = vi.fn().mockResolvedValue([CMD_A])
      const t0 = 1_000_000
      await fetchPiCommands('s1', fetcher, t0)
      await fetchPiCommands('s1', fetcher, t0 + CACHE_TTL_MS)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    // ── Error / negative paths ────────────────────────────────────────────────

    it('propagates fetcher errors to the caller', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('IPC error'))
      await expect(fetchPiCommands('s1', fetcher)).rejects.toThrow('IPC error')
    })

    it('does NOT cache a failed fetch — next call retries the fetcher', async () => {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce([CMD_A])
      // First call throws
      await expect(fetchPiCommands('s1', fetcher)).rejects.toThrow('timeout')
      // Second call should go to the fetcher again (nothing was stored)
      const result = await fetchPiCommands('s1', fetcher)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(result).toEqual([CMD_A])
    })

    it('does not leak a failed session entry into subsequent different sessions', async () => {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce([CMD_B])
      await expect(fetchPiCommands('s1', fetcher)).rejects.toThrow('fail')
      const result = await fetchPiCommands('s2', fetcher)
      expect(result).toEqual([CMD_B])
    })

    it('caches multiple commands in the result list', async () => {
      const fetcher = vi.fn().mockResolvedValue([CMD_A, CMD_B])
      const t0 = 1_000_000
      const r1 = await fetchPiCommands('s1', fetcher, t0)
      const r2 = await fetchPiCommands('s1', fetcher, t0 + 1_000)
      expect(r1).toEqual([CMD_A, CMD_B])
      expect(r2).toEqual([CMD_A, CMD_B])
      expect(fetcher).toHaveBeenCalledOnce()
    })
  })

  // ── clearCommandCache ──────────────────────────────────────────────────────
  describe('clearCommandCache', () => {
    it('forces a re-fetch after the cache is cleared', async () => {
      const fetcher = vi.fn().mockResolvedValue([CMD_A])
      const t0 = 1_000_000
      await fetchPiCommands('s1', fetcher, t0)
      clearCommandCache()
      await fetchPiCommands('s1', fetcher, t0 + 1_000)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('clears entries for all sessions', async () => {
      const fetcher = vi.fn().mockResolvedValue([CMD_A])
      const t0 = 1_000_000
      await fetchPiCommands('s1', fetcher, t0)
      await fetchPiCommands('s2', fetcher, t0)
      clearCommandCache()
      await fetchPiCommands('s1', fetcher, t0 + 1_000)
      await fetchPiCommands('s2', fetcher, t0 + 1_000)
      // 2 initial + 2 after clear
      expect(fetcher).toHaveBeenCalledTimes(4)
    })
  })
})

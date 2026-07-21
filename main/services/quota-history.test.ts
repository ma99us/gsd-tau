/**
 * Unit tests for main/services/quota-history.ts
 *
 * Mocks `node:fs` to avoid real filesystem I/O.  The class uses the CJS
 * default import (`import fs from 'node:fs'`), so the factory returns both
 * a `default` property and top-level keys for full ESM/CJS interop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

vi.mock('node:fs', () => {
  const methods = {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    renameSync: vi.fn(),
    readFileSync: vi.fn(),
  }
  return { default: methods, ...methods }
})

import fs from 'node:fs'
import { QuotaHistory } from './quota-history'
import type { QuotaHistoryEntry } from '../../shared/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const DATA_DIR    = '/app/data'
const HISTORY_PATH = path.join(DATA_DIR, 'quota-history.json')
const TMP_PATH     = path.join(DATA_DIR, 'quota-history.json.tmp')
const BAK_PATH     = path.join(DATA_DIR, 'quota-history.json.bak')

function entry(ts: string, used = 10, remaining = 90, entitlement = 100): QuotaHistoryEntry {
  return { ts, used, remaining, entitlement }
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('QuotaHistory', () => {
  let history: QuotaHistory

  beforeEach(() => {
    vi.mocked(fs.mkdirSync).mockReset()
    vi.mocked(fs.writeFileSync).mockReset()
    vi.mocked(fs.copyFileSync).mockReset()
    vi.mocked(fs.renameSync).mockReset()
    vi.mocked(fs.readFileSync).mockReset()
    history = new QuotaHistory(DATA_DIR)
  })

  // ── load() ─────────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('starts with empty in-memory entries before any load', () => {
      expect(history.getEntries()).toHaveLength(0)
    })

    it('reads entries from quota-history.json', () => {
      const data = [entry(daysAgo(1))]
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(data))
      history.load()
      expect(history.getEntries()).toHaveLength(1)
    })

    it('falls back to quota-history.json.bak when main file throws', () => {
      const bakData = [entry(daysAgo(2), 20, 80, 100)]
      vi.mocked(fs.readFileSync)
        .mockImplementationOnce(() => { throw new Error('ENOENT') })
        .mockReturnValueOnce(JSON.stringify(bakData))
      history.load()
      expect(history.getEntries()).toHaveLength(1)
      expect(history.getEntries()[0]).toMatchObject({ used: 20 })
    })

    it('falls back to an empty array when both files throw', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
      history.load()
      expect(history.getEntries()).toHaveLength(0)
    })

    it('prunes entries older than 90 days on load', () => {
      const data = [
        entry(daysAgo(91), 5,  95, 100), // stale — pruned
        entry(daysAgo(1),  10, 90, 100), // fresh — kept
      ]
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(data))
      history.load()
      expect(history.getEntries()).toHaveLength(1)
      expect(history.getEntries()[0]).toMatchObject({ used: 10 })
    })

    it('flushes atomically (write .tmp → rename) when pruning removes entries', () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce(
        JSON.stringify([entry(daysAgo(92), 1, 99, 100)]),
      )
      history.load()
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(TMP_PATH, expect.any(String), 'utf8')
      expect(vi.mocked(fs.renameSync)).toHaveBeenCalledWith(TMP_PATH, HISTORY_PATH)
    })

    it('does NOT flush when no entries are pruned', () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce(
        JSON.stringify([entry(daysAgo(1))]),
      )
      history.load()
      expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled()
    })

    it('filters out entries with missing required fields', () => {
      const mixed = [
        { ts: daysAgo(1), used: 10, remaining: 90, entitlement: 100 },    // valid
        { ts: daysAgo(2), remaining: 80, entitlement: 100 },               // missing used
        { ts: daysAgo(3), used: 'ten', remaining: 70, entitlement: 100 },  // wrong type
      ]
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(mixed))
      history.load()
      expect(history.getEntries()).toHaveLength(1)
    })

    it('filters out the entry missing "remaining"', () => {
      const data = [
        { ts: daysAgo(1), used: 10, entitlement: 100 },                   // missing remaining
        { ts: daysAgo(2), used: 20, remaining: 80, entitlement: 100 },    // valid
      ]
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(data))
      history.load()
      expect(history.getEntries()).toHaveLength(1)
      expect(history.getEntries()[0]).toMatchObject({ used: 20 })
    })

    it('returns empty when the file contains non-array JSON', () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({ not: 'array' }))
      history.load()
      expect(history.getEntries()).toHaveLength(0)
    })

    it('returns empty when the file contains invalid JSON', () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce('}{not json')
      history.load()
      expect(history.getEntries()).toHaveLength(0)
    })
  })

  // ── append() ──────────────────────────────────────────────────────────────

  describe('append()', () => {
    it('returns the updated array containing the new entry', () => {
      const result = history.append(entry(new Date().toISOString(), 10, 90, 100))
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ used: 10 })
    })

    it('accumulates entries across multiple appends', () => {
      history.append(entry(daysAgo(2), 10, 90, 100))
      history.append(entry(daysAgo(1), 20, 80, 100))
      const result = history.append(entry(new Date().toISOString(), 30, 70, 100))
      expect(result).toHaveLength(3)
    })

    it('prunes entries older than 90 days during append', () => {
      history.append(entry(daysAgo(91), 5, 95, 100)) // stale — pruned on next append
      const result = history.append(entry(new Date().toISOString(), 10, 90, 100))
      expect(result).toHaveLength(1)
    })

    it('atomic flush: mkdirSync + writeFileSync(.tmp) + renameSync', () => {
      history.append(entry(new Date().toISOString(), 10, 90, 100))
      // path.dirname uses OS path separator — derive expected dir from HISTORY_PATH
      // to stay correct on both Unix (/app/data) and Windows (\app\data).
      expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(
        path.dirname(HISTORY_PATH),
        { recursive: true },
      )
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(TMP_PATH, expect.any(String), 'utf8')
      expect(vi.mocked(fs.renameSync)).toHaveBeenCalledWith(TMP_PATH, HISTORY_PATH)
    })

    it('copies existing history file to .bak before renaming .tmp', () => {
      history.append(entry(new Date().toISOString(), 10, 90, 100))
      expect(vi.mocked(fs.copyFileSync)).toHaveBeenCalledWith(HISTORY_PATH, BAK_PATH)
    })

    it('does not throw when copyFileSync fails (first write — no existing .json)', () => {
      vi.mocked(fs.copyFileSync).mockImplementationOnce(() => { throw new Error('ENOENT') })
      expect(() => history.append(entry(new Date().toISOString(), 10, 90, 100))).not.toThrow()
    })

    it('does not throw when writeFileSync fails (disk full)', () => {
      vi.mocked(fs.writeFileSync).mockImplementationOnce(() => { throw new Error('ENOSPC') })
      expect(() => history.append(entry(new Date().toISOString(), 10, 90, 100))).not.toThrow()
    })

    it('updates getEntries() to reflect the appended entry', () => {
      history.append(entry(new Date().toISOString(), 42, 58, 100))
      expect(history.getEntries()[0]).toMatchObject({ used: 42 })
    })

    it('serialises entries as valid JSON written to the tmp file', () => {
      history.append(entry(new Date().toISOString(), 15, 85, 100))
      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string
      const parsed = JSON.parse(written) as QuotaHistoryEntry[]
      expect(parsed[0]).toMatchObject({ used: 15, remaining: 85, entitlement: 100 })
    })
  })

  // ── getEntries() ──────────────────────────────────────────────────────────

  describe('getEntries()', () => {
    it('returns empty array before any load or append', () => {
      expect(history.getEntries()).toHaveLength(0)
    })

    it('returns all appended entries in insertion order', () => {
      history.append(entry(daysAgo(2), 10, 90, 100))
      history.append(entry(daysAgo(1), 20, 80, 100))
      const entries = history.getEntries()
      expect(entries[0]).toMatchObject({ used: 10 })
      expect(entries[1]).toMatchObject({ used: 20 })
    })

    it('returns the same reference on repeated calls (no defensive copy)', () => {
      history.append(entry(new Date().toISOString(), 10, 90, 100))
      expect(history.getEntries()).toBe(history.getEntries())
    })
  })

  // ── getAt() ───────────────────────────────────────────────────────────────

  describe('getAt()', () => {
    it('returns null when history is empty', () => {
      expect(history.getAt(new Date())).toBeNull()
    })

    it('returns null when all entries are strictly after the target time', () => {
      const future = new Date(Date.now() + 60_000)
      history.append(entry(future.toISOString(), 10, 90, 100))
      expect(history.getAt(new Date())).toBeNull()
    })

    it('returns the entry at the exact target timestamp', () => {
      // Use a recent timestamp so _prune does not remove the entry (cutoff = 90 days ago).
      const ts = new Date(Date.now() - 30 * 60 * 1000)  // 30 min ago
      history.append(entry(ts.toISOString(), 10, 90, 100))
      const result = history.getAt(ts)
      expect(result).not.toBeNull()
      expect(result!.used).toBe(10)
    })

    it('returns the closest entry at-or-before the target', () => {
      // Use recent timestamps to avoid the 90-day prune cutoff.
      const t1 = new Date(Date.now() - 4 * 60 * 60 * 1000)  // 4 h ago
      const t2 = new Date(Date.now() - 2 * 60 * 60 * 1000)  // 2 h ago
      const t3 = new Date(Date.now() - 1 * 60 * 60 * 1000)  // 1 h ago
      history.append(entry(t1.toISOString(), 10, 90, 100))
      history.append(entry(t2.toISOString(), 20, 80, 100))
      history.append(entry(t3.toISOString(), 30, 70, 100))
      // query at 1.5 h ago — closest at-or-before is t2 (2 h ago, used=20)
      const query = new Date(Date.now() - 90 * 60 * 1000)
      expect(history.getAt(query)!.used).toBe(20)
    })

    it('returns the newest entry when target is after all entries', () => {
      const t1 = new Date(Date.now() - 2 * 60 * 60 * 1000)  // 2 h ago
      const t2 = new Date(Date.now() - 1 * 60 * 60 * 1000)  // 1 h ago
      history.append(entry(t1.toISOString(), 10, 90, 100))
      history.append(entry(t2.toISOString(), 20, 80, 100))
      expect(history.getAt(new Date())!.used).toBe(20)
    })

    it('returns the first entry when target exactly matches the first timestamp', () => {
      const t = new Date(Date.now() - 2 * 60 * 60 * 1000)  // 2 h ago
      history.append(entry(t.toISOString(), 5, 95, 100))
      history.append(entry(new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), 15, 85, 100))
      expect(history.getAt(t)!.used).toBe(5)
    })
  })
})

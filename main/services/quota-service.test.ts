/**
 * Unit tests for main/services/quota-service.ts
 *
 * Mocks:
 * - node:fs         — auth-file I/O (readFileSync, rmSync, watchFile, etc.)
 * - ./quota-history — isolated per-test via `mockHistInst` captured from the
 *                     QuotaHistory constructor factory.
 * - global fetch    — GitHub API responses via vi.stubGlobal
 *
 * The `mockHistInst` variable starts with `mock` so Vitest's hoisting transform
 * allows it to be referenced inside the vi.mock('./quota-history') factory
 * closure (vitest hoisting rule: factory closures may only reference module-scope
 * variables whose names start with `mock`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs', () => {
  const methods = {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
    copyFileSync: vi.fn(),
    renameSync: vi.fn(),
  }
  return { default: methods, ...methods }
})

let mockHistInst: {
  load: ReturnType<typeof vi.fn>
  append: ReturnType<typeof vi.fn>
  getEntries: ReturnType<typeof vi.fn>
  getAt: ReturnType<typeof vi.fn>
}

vi.mock('./quota-history', () => ({
  QuotaHistory: vi.fn().mockImplementation(() => {
    mockHistInst = {
      load: vi.fn(),
      append: vi.fn().mockReturnValue([]),
      getEntries: vi.fn().mockReturnValue([]),
      getAt: vi.fn().mockReturnValue(null),
    }
    return mockHistInst
  }),
}))

import fs from 'node:fs'
import { QuotaService, QUOTA_UPDATE_CHANNEL } from './quota-service'
import type { QuotaHistoryEntry } from '../../shared/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const DATA_DIR = '/app-data'

function makeWc(destroyed = false) {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(destroyed),
  }
}

function ghAuthJson(token = 'ghp_test', login?: string) {
  const o: Record<string, string> = { access_token: token }
  if (login) o.login = login
  return JSON.stringify(o)
}

function copilotApiBody(opts?: {
  used?: number
  remaining?: number
  entitlement?: number
  resetDate?: string
  overagePermitted?: boolean
  noPremiumInteractions?: boolean
}) {
  if (opts?.noPremiumInteractions) return { login: 'user', copilot_plan: 'free' }
  return {
    login: 'user',
    copilot_plan: 'copilot_enterprise',
    premium_interactions: {
      used: opts?.used ?? 50,
      remaining: opts?.remaining ?? 50,
      entitlement: opts?.entitlement ?? 100,
      reset_date: opts?.resetDate ?? '2027-08-01',
      overage_permitted: opts?.overagePermitted ?? false,
    },
  }
}

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 401,
    json: () => Promise.resolve(body),
  }))
}

function histEntry(ts: string, used: number, remaining: number, entitlement: number): QuotaHistoryEntry {
  return { ts, used, remaining, entitlement }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('QuotaService', () => {
  let service: QuotaService
  let wc: ReturnType<typeof makeWc>
  let getAllWc: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReset()
    vi.mocked(fs.writeFileSync).mockReset()
    vi.mocked(fs.mkdirSync).mockReset()
    vi.mocked(fs.rmSync).mockReset()
    vi.mocked(fs.watchFile).mockReset()
    vi.mocked(fs.unwatchFile).mockReset()

    wc = makeWc()
    getAllWc = vi.fn().mockReturnValue([wc])
    service = new QuotaService(DATA_DIR, getAllWc)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    service.stop()
  })

  // ── QUOTA_UPDATE_CHANNEL constant ─────────────────────────────────────────

  it('exports QUOTA_UPDATE_CHANNEL as "quota:update"', () => {
    expect(QUOTA_UPDATE_CHANNEL).toBe('quota:update')
  })

  // ── getLastSnapshot() ─────────────────────────────────────────────────────

  it('getLastSnapshot() returns null before any fetch', () => {
    expect(service.getLastSnapshot()).toBeNull()
  })

  // ── start() / stop() ──────────────────────────────────────────────────────

  describe('start() / stop()', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      // No auth file — _fetchAndBroadcast called from start() returns null quickly
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('calls history.load() on start()', () => {
      service.start()
      expect(mockHistInst.load).toHaveBeenCalledOnce()
    })

    it('starts watching the auth file on start()', () => {
      service.start()
      expect(vi.mocked(fs.watchFile)).toHaveBeenCalledOnce()
    })

    it('stop() before start() does not throw', () => {
      expect(() => service.stop()).not.toThrow()
    })

    it('stop() calls fs.unwatchFile after start()', () => {
      service.start()
      service.stop()
      expect(vi.mocked(fs.unwatchFile)).toHaveBeenCalledOnce()
    })

    it('second stop() is a safe no-op', () => {
      service.start()
      service.stop()
      expect(() => service.stop()).not.toThrow()
    })

    it('poll interval fires _fetchAndBroadcast every 15 min', async () => {
      service.start()
      const callsBefore = vi.mocked(fs.readFileSync).mock.calls.length
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 100)
      expect(vi.mocked(fs.readFileSync).mock.calls.length).toBeGreaterThan(callsBefore)
    })

    it('poll interval does not fire after stop()', async () => {
      service.start()
      service.stop()
      const callsAfterStop = vi.mocked(fs.readFileSync).mock.calls.length
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 100)
      expect(vi.mocked(fs.readFileSync).mock.calls.length).toBe(callsAfterStop)
    })
  })

  // ── refreshNow() — unauthenticated ────────────────────────────────────────

  describe('refreshNow() — unauthenticated', () => {
    it('returns null when gh-auth.json is absent', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
      expect(await service.refreshNow()).toBeNull()
    })

    it('returns null when gh-auth.json has no access_token field', async () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({ not_a_token: true }))
      expect(await service.refreshNow()).toBeNull()
    })

    it('returns null when gh-auth.json contains invalid JSON', async () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce('{bad json')
      expect(await service.refreshNow()).toBeNull()
    })

    it('does NOT fan-out to renderers when unauthenticated', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
      await service.refreshNow()
      expect(wc.send).not.toHaveBeenCalled()
    })
  })

  // ── refreshNow() — successful fetch ───────────────────────────────────────

  describe('refreshNow() — successful API fetch', () => {
    beforeEach(() => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson('ghp_secret', 'alice'))
      stubFetch(copilotApiBody({ used: 30, remaining: 70, entitlement: 100 }))
    })

    it('returns a non-null snapshot', async () => {
      expect(await service.refreshNow()).not.toBeNull()
    })

    it('snapshot has correct usage fields', async () => {
      const snap = await service.refreshNow()
      expect(snap).toMatchObject({ used: 30, remaining: 70, entitlement: 100 })
    })

    it('computes percentRemaining = round(remaining / entitlement * 100)', async () => {
      const snap = await service.refreshNow()
      expect(snap!.percentRemaining).toBe(70)
    })

    it('sets stale to false on a fresh fetch', async () => {
      const snap = await service.refreshNow()
      expect(snap!.stale).toBe(false)
    })

    it('caches snapshot in getLastSnapshot()', async () => {
      await service.refreshNow()
      expect(service.getLastSnapshot()).not.toBeNull()
    })

    it('fans out snapshot to all live WebContents via QUOTA_UPDATE_CHANNEL', async () => {
      await service.refreshNow()
      expect(wc.send).toHaveBeenCalledWith(
        QUOTA_UPDATE_CHANNEL,
        expect.objectContaining({ used: 30 }),
      )
    })

    it('skips destroyed WebContents during fan-out', async () => {
      const dead = makeWc(true)
      getAllWc.mockReturnValue([wc, dead])
      await service.refreshNow()
      expect(dead.send).not.toHaveBeenCalled()
    })

    it('appends entry to history when all numeric fields are present', async () => {
      await service.refreshNow()
      expect(mockHistInst.append).toHaveBeenCalledWith(
        expect.objectContaining({ used: 30, remaining: 70, entitlement: 100 }),
      )
    })

    it('does NOT include the access_token value in any console.log output', async () => {
      const logSpy = vi.spyOn(console, 'log').mockReturnValue(undefined)
      await service.refreshNow()
      for (const [msg] of logSpy.mock.calls) {
        if (typeof msg === 'string') expect(msg).not.toContain('ghp_secret')
      }
    })
  })

  // ── refreshNow() — premium_interactions absent ────────────────────────────

  describe('refreshNow() — no premium_interactions', () => {
    it('returns null when premium_interactions is absent', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      stubFetch(copilotApiBody({ noPremiumInteractions: true }))
      expect(await service.refreshNow()).toBeNull()
    })

    it('clears lastSnapshot when subsequent fetch has no premium_interactions', async () => {
      // Prime with a successful snapshot
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      stubFetch(copilotApiBody())
      await service.refreshNow()
      expect(service.getLastSnapshot()).not.toBeNull()

      // Next call: account plan is now free — no premium_interactions
      stubFetch(copilotApiBody({ noPremiumInteractions: true }))
      await service.refreshNow()
      expect(service.getLastSnapshot()).toBeNull()
    })
  })

  // ── refreshNow() — error handling / stale snapshots ───────────────────────

  describe('refreshNow() — error handling', () => {
    it('returns null on network error when there is no cached snapshot', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
      expect(await service.refreshNow()).toBeNull()
    })

    it('returns stale snapshot on error when a previous snapshot exists', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(copilotApiBody()) })
        .mockRejectedValue(new Error('offline')),
      )
      await service.refreshNow() // prime cache
      const stale = await service.refreshNow()
      expect(stale).not.toBeNull()
      expect(stale!.stale).toBe(true)
    })

    it('fans out stale snapshot to renderers on error', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(copilotApiBody()) })
        .mockRejectedValue(new Error('offline')),
      )
      await service.refreshNow()
      wc.send.mockClear()
      await service.refreshNow()
      expect(wc.send).toHaveBeenCalledWith(
        QUOTA_UPDATE_CHANNEL,
        expect.objectContaining({ stale: true }),
      )
    })

    it('treats non-2xx GitHub response as an error (returns null, no prior cache)', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
      expect(await service.refreshNow()).toBeNull()
    })
  })

  // ── verdict computation ────────────────────────────────────────────────────

  describe('verdict computation (via refreshNow)', () => {
    afterEach(() => vi.unstubAllGlobals())

    async function fetchVerdict(
      used: number,
      remaining: number,
      entitlement: number,
      overagePermitted = false,
    ) {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      stubFetch(copilotApiBody({ used, remaining, entitlement, overagePermitted }))
      return (await service.refreshNow())!.verdict
    }

    it('"safe" when remaining > 30% of entitlement', async () => {
      expect(await fetchVerdict(20, 80, 100)).toBe('safe')
    })

    it('"tight" when remaining is exactly 30% of entitlement', async () => {
      expect(await fetchVerdict(70, 30, 100)).toBe('tight')
    })

    it('"tight" when remaining is below 30% but not zero', async () => {
      expect(await fetchVerdict(79, 21, 100)).toBe('tight')
    })

    it('"runout" when remaining is 0', async () => {
      expect(await fetchVerdict(100, 0, 100)).toBe('runout')
    })

    it('"overage" when used > entitlement and overagePermitted is true', async () => {
      expect(await fetchVerdict(110, 0, 100, true)).toBe('overage')
    })

    it('"runout" when used > entitlement and overagePermitted is false', async () => {
      expect(await fetchVerdict(110, 0, 100, false)).toBe('runout')
    })

    it('"unknown" when entitlement is absent from the API response', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      stubFetch({ login: 'user', premium_interactions: { used: 10 } })
      const snap = await service.refreshNow()
      expect(snap!.verdict).toBe('unknown')
    })
  })

  // ── projection computation ────────────────────────────────────────────────

  describe('projection computation (via refreshNow)', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('sets projection to null when history has fewer than 2 entries', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      mockHistInst.getEntries.mockReturnValue([
        histEntry(new Date().toISOString(), 50, 50, 100),
      ])
      stubFetch(copilotApiBody())
      expect((await service.refreshNow())!.projection).toBeNull()
    })

    it('sets projection to null when oldest and newest share the same timestamp', async () => {
      const ts = new Date().toISOString()
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      mockHistInst.getEntries.mockReturnValue([
        histEntry(ts, 10, 90, 100),
        histEntry(ts, 20, 80, 100),
      ])
      stubFetch(copilotApiBody())
      expect((await service.refreshNow())!.projection).toBeNull()
    })

    it('computes burnPerDay from oldest → newest consumption over the span', async () => {
      const now = Date.now()
      const t1 = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
      const t2 = new Date(now).toISOString()
      const entries = [
        histEntry(t1, 10, 90, 100), // 2 days ago: used=10
        histEntry(t2, 30, 70, 100), // now:        used=30  → consumed 20 / 2d = 10/day
      ]
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      mockHistInst.getEntries.mockReturnValue(entries)
      // Return entries[0] for both 24h and 7d base lookups
      mockHistInst.getAt.mockReturnValue(entries[0])
      stubFetch(copilotApiBody({ used: 30, remaining: 70, entitlement: 100, resetDate: '2027-09-01' }))

      const snap = await service.refreshNow()
      expect(snap!.projection).not.toBeNull()
      expect(snap!.projection!.burnPerDay).toBe(10)
    })

    it('sets burnPerDay to null when consumption decreased (reset / refund)', async () => {
      const now = Date.now()
      const t1 = new Date(now - 24 * 60 * 60 * 1000).toISOString()
      const t2 = new Date(now).toISOString()
      const entries = [
        histEntry(t1, 80, 20, 100), // yesterday: used=80 (high)
        histEntry(t2, 10, 90, 100), // today:     used=10 (quota reset)
      ]
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      mockHistInst.getEntries.mockReturnValue(entries)
      mockHistInst.getAt.mockReturnValue(entries[0])
      stubFetch(copilotApiBody({ used: 10, remaining: 90 }))

      const snap = await service.refreshNow()
      expect(snap!.projection!.burnPerDay).toBeNull()
    })
  })

  // ── onAgentEnd() — debounce ────────────────────────────────────────────────

  describe('onAgentEnd()', () => {
    it('always fetches when _lastFetchAt is 0 (no prior fetch)', () => {
      // _lastFetchAt starts at 0; Date.now() - 0 >> AGENT_END_DEBOUNCE_MS
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(copilotApiBody()),
      })
      vi.stubGlobal('fetch', fetchMock)

      // fetch() is called synchronously up to the first internal await
      service.onAgentEnd()
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('does NOT trigger fetch within the 5-min debounce window', async () => {
      vi.useFakeTimers()
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(copilotApiBody()),
      })
      vi.stubGlobal('fetch', fetchMock)

      await service.refreshNow() // sets _lastFetchAt to current fake time
      const callsBefore = fetchMock.mock.calls.length

      service.onAgentEnd() // 0 ms elapsed — debounce not satisfied
      expect(fetchMock.mock.calls.length).toBe(callsBefore)

      vi.unstubAllGlobals()
      vi.useRealTimers()
    })

    it('triggers fetch once 5+ min have elapsed since last fetch', async () => {
      vi.useFakeTimers()
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(copilotApiBody()),
      })
      vi.stubGlobal('fetch', fetchMock)

      await service.refreshNow() // prime _lastFetchAt
      const callsBefore = fetchMock.mock.calls.length

      vi.advanceTimersByTime(5 * 60 * 1000 + 1) // advance past debounce

      service.onAgentEnd()
      // fetch() is called synchronously at the first internal await boundary
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore)

      vi.unstubAllGlobals()
      vi.useRealTimers()
    })
  })

  // ── disconnect() ──────────────────────────────────────────────────────────

  describe('disconnect()', () => {
    it('calls fs.rmSync to remove gh-auth.json', async () => {
      await service.disconnect()
      expect(vi.mocked(fs.rmSync)).toHaveBeenCalledWith(
        expect.stringContaining('gh-auth.json'),
        { force: true },
      )
    })

    it('resets getLastSnapshot() to null after disconnect', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(ghAuthJson())
      stubFetch(copilotApiBody())
      await service.refreshNow()
      expect(service.getLastSnapshot()).not.toBeNull()

      vi.unstubAllGlobals()
      await service.disconnect()
      expect(service.getLastSnapshot()).toBeNull()
    })

    it('fans out null snapshot via QUOTA_UPDATE_CHANNEL on disconnect', async () => {
      await service.disconnect()
      expect(wc.send).toHaveBeenCalledWith(QUOTA_UPDATE_CHANNEL, null)
    })

    it('does not throw when rmSync fails (EPERM)', async () => {
      vi.mocked(fs.rmSync).mockImplementationOnce(() => { throw new Error('EPERM') })
      await expect(service.disconnect()).resolves.not.toThrow()
    })

    it('still fans out null even when rmSync fails', async () => {
      vi.mocked(fs.rmSync).mockImplementationOnce(() => { throw new Error('EPERM') })
      await service.disconnect()
      expect(wc.send).toHaveBeenCalledWith(QUOTA_UPDATE_CHANNEL, null)
    })
  })

  // ── startDeviceCodeFlow() ─────────────────────────────────────────────────

  describe('startDeviceCodeFlow()', () => {
    it('throws a descriptive error when GSD_TAU_GITHUB_CLIENT_ID is not set', async () => {
      // The env var is absent in test environments
      await expect(service.startDeviceCodeFlow(vi.fn())).rejects.toThrow(
        'GSD_TAU_GITHUB_CLIENT_ID is not configured',
      )
    })
  })
})

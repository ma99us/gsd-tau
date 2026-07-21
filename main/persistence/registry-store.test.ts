import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { RegistryStore } from './registry-store'
import type { RegistryV1, SessionRecord } from '@shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-tau-reg-test-'))
}

function makeRegistry(overrides: Partial<RegistryV1> = {}): RegistryV1 {
  return { version: 1, sessions: [], windows: [], mruOrder: [], ...overrides }
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's_test',
    cwd: 'D:/Projects/test',
    displayName: 'test',
    lastOpenedAt: '2026-01-01T00:00:00Z',
    wasAutoRunning: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('RegistryStore', () => {
  let tmpDir: string
  let store: RegistryStore

  beforeEach(() => {
    tmpDir = makeTmpDir()
    store = new RegistryStore(tmpDir)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── 1. Normal round-trip ─────────────────────────────────────────────────

  describe('round-trip', () => {
    it('save + load returns an equal registry', async () => {
      const reg = makeRegistry({ mruOrder: ['s_abc', 's_def'] })
      store.save(reg)
      await vi.advanceTimersByTimeAsync(500)

      expect(store.load()).toEqual(reg)
    })

    it('version field is preserved as literal 1 across save/load', async () => {
      store.save(makeRegistry())
      await vi.advanceTimersByTimeAsync(500)

      expect(store.load().version).toBe(1)
    })

    it('sessions array is preserved', async () => {
      const session = makeSession({ id: 's_round', cwd: 'D:/foo', displayName: 'foo' })
      const reg = makeRegistry({ sessions: [session] })
      store.save(reg)
      await vi.advanceTimersByTimeAsync(500)

      const loaded = store.load()
      expect(loaded.sessions).toHaveLength(1)
      expect(loaded.sessions[0]).toEqual(session)
    })

    it('windows array is preserved', async () => {
      const reg = makeRegistry({
        windows: [{ id: 'w_1', tabIds: ['s_a'], activeTabId: 's_a', bounds: { x: 0, y: 0, width: 1280, height: 800 } }],
      })
      store.save(reg)
      await vi.advanceTimersByTimeAsync(500)

      expect(store.load().windows).toHaveLength(1)
    })

    it('getDefault() returns a valid empty RegistryV1', () => {
      const def = store.getDefault()
      expect(def).toEqual({ version: 1, sessions: [], windows: [], mruOrder: [] })
    })

    it('getDefault() always returns a new object (not the same reference)', () => {
      const a = store.getDefault()
      const b = store.getDefault()
      expect(a).not.toBe(b)
    })

    it('second save creates registry.json.bak from the first write', async () => {
      const reg1 = makeRegistry({ mruOrder: ['s_first'] })
      const reg2 = makeRegistry({ mruOrder: ['s_second'] })

      store.save(reg1)
      await vi.advanceTimersByTimeAsync(500)

      store.save(reg2)
      await vi.advanceTimersByTimeAsync(500)

      const main = JSON.parse(fs.readFileSync(path.join(tmpDir, 'registry.json'), 'utf8')) as RegistryV1
      const bak = JSON.parse(fs.readFileSync(path.join(tmpDir, 'registry.json.bak'), 'utf8')) as RegistryV1

      expect(main.mruOrder).toEqual(['s_second'])
      expect(bak.mruOrder).toEqual(['s_first'])
    })
  })

  // ── 2. .bak corruption recovery ─────────────────────────────────────────

  describe('bak corruption recovery', () => {
    it('falls back to .bak when registry.json is corrupt JSON', async () => {
      const reg = makeRegistry({ mruOrder: ['s_backup'] })
      // Write first version to establish .bak
      store.save(reg)
      await vi.advanceTimersByTimeAsync(500)

      // Write second version — now .bak = s_backup, main = s_overwrite
      store.save(makeRegistry({ mruOrder: ['s_overwrite'] }))
      await vi.advanceTimersByTimeAsync(500)

      // Corrupt the primary
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), '{ NOT_VALID_JSON !!!', 'utf8')

      const loaded = store.load()
      expect(loaded.mruOrder).toEqual(['s_backup'])
    })

    it('falls back to .bak when registry.json is completely empty', async () => {
      store.save(makeRegistry({ mruOrder: ['s_bak_only'] }))
      await vi.advanceTimersByTimeAsync(500)
      store.save(makeRegistry({ mruOrder: ['s_main'] }))
      await vi.advanceTimersByTimeAsync(500)

      fs.writeFileSync(path.join(tmpDir, 'registry.json'), '', 'utf8')

      expect(store.load().mruOrder).toEqual(['s_bak_only'])
    })

    it('returns getDefault() when both registry.json and .bak are corrupt', () => {
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), 'garbage', 'utf8')
      fs.writeFileSync(path.join(tmpDir, 'registry.json.bak'), 'garbage', 'utf8')

      expect(store.load()).toEqual(store.getDefault())
    })

    it('returns getDefault() when no files exist at all', () => {
      expect(store.load()).toEqual(store.getDefault())
    })

    it('returns getDefault() when registry.json is missing and .bak is also missing', () => {
      // Only the directory exists, nothing inside
      expect(store.load()).toEqual(store.getDefault())
    })
  })

  // ── 3. Mid-write kill simulation ─────────────────────────────────────────

  describe('mid-write kill simulation', () => {
    /**
     * Simulates: process was killed after writing .tmp but before rename.
     * The .tmp file is orphaned. load() must ignore it and use registry.json.
     */
    it('orphaned .tmp is ignored — load returns existing registry.json', async () => {
      const reg = makeRegistry({ mruOrder: ['s_existing'] })
      store.save(reg)
      await vi.advanceTimersByTimeAsync(500)

      // Simulate orphaned .tmp from a killed prior run
      fs.writeFileSync(
        path.join(tmpDir, 'registry.json.tmp'),
        JSON.stringify(makeRegistry({ mruOrder: ['s_killed'] })),
        'utf8',
      )

      const loaded = store.load()
      expect(loaded.mruOrder).toEqual(['s_existing'])
    })

    /**
     * Simulates: process killed after writing .tmp + copying .bak,
     * but before rename. The primary registry.json is now absent.
     * load() falls back to .bak.
     */
    it('orphaned .tmp + missing registry.json falls back to .bak', async () => {
      // Write v1 (goes to main) then v2 (main=v2, bak=v1)
      store.save(makeRegistry({ mruOrder: ['s_bak_v1'] }))
      await vi.advanceTimersByTimeAsync(500)

      store.save(makeRegistry({ mruOrder: ['s_bak_v2'] }))
      await vi.advanceTimersByTimeAsync(500)

      // "Kill" right after writing .tmp, before rename — delete main to mimic
      fs.writeFileSync(path.join(tmpDir, 'registry.json.tmp'), 'incomplete partial write', 'utf8')
      fs.unlinkSync(path.join(tmpDir, 'registry.json'))

      // .bak still holds s_bak_v1
      const loaded = store.load()
      expect(loaded.mruOrder).toEqual(['s_bak_v1'])
    })

    /**
     * Simulates complete fresh start: .tmp from a prior run exists, but both
     * .json and .bak are absent. load() must return getDefault(), not throw.
     */
    it('orphaned .tmp + no registry files → returns getDefault()', () => {
      fs.writeFileSync(path.join(tmpDir, 'registry.json.tmp'), 'stale', 'utf8')

      expect(store.load()).toEqual(store.getDefault())
    })

    /**
     * Next successful flush after a kill must overwrite the orphaned .tmp
     * and produce a clean registry.json.
     */
    it('next flush after kill overwrites orphaned .tmp and writes clean registry.json', async () => {
      // Orphaned .tmp
      fs.writeFileSync(path.join(tmpDir, 'registry.json.tmp'), '{"corrupted":true}', 'utf8')

      const reg = makeRegistry({ mruOrder: ['s_recovered'] })
      store.save(reg)
      await vi.advanceTimersByTimeAsync(500)

      // .tmp should be gone (renamed to .json)
      expect(fs.existsSync(path.join(tmpDir, 'registry.json.tmp'))).toBe(false)
      expect(store.load().mruOrder).toEqual(['s_recovered'])
    })
  })

  // ── 4. Debounce ──────────────────────────────────────────────────────────

  describe('debounce', () => {
    it('rapid saves coalesce — only the last write reaches disk', async () => {
      store.save(makeRegistry({ mruOrder: ['s_one'] }))
      store.save(makeRegistry({ mruOrder: ['s_two'] }))
      store.save(makeRegistry({ mruOrder: ['s_three'] }))

      await vi.advanceTimersByTimeAsync(500)

      expect(store.load().mruOrder).toEqual(['s_three'])
    })

    it('no file is written before 500 ms elapses', async () => {
      store.save(makeRegistry({ mruOrder: ['s_pending'] }))
      await vi.advanceTimersByTimeAsync(499)

      expect(fs.existsSync(path.join(tmpDir, 'registry.json'))).toBe(false)
    })

    it('file is written after exactly 500 ms', async () => {
      store.save(makeRegistry({ mruOrder: ['s_after500'] }))
      await vi.advanceTimersByTimeAsync(500)

      expect(fs.existsSync(path.join(tmpDir, 'registry.json'))).toBe(true)
    })

    it('flush() forces immediate write without waiting for debounce', () => {
      store.save(makeRegistry({ mruOrder: ['s_flush'] }))
      // Do NOT advance fake timers at all
      store.flush()

      expect(store.load().mruOrder).toEqual(['s_flush'])
    })

    it('flush() when no pending save is a no-op', () => {
      // Should not throw
      expect(() => store.flush()).not.toThrow()
    })

    it('flush() cancels the pending debounce timer', async () => {
      store.save(makeRegistry({ mruOrder: ['s_flush_cancel'] }))
      store.flush()

      // Advance past 500 ms — the timer was cancelled so no second write
      await vi.advanceTimersByTimeAsync(600)

      // Data was written exactly once (by flush) and load still returns it
      expect(store.load().mruOrder).toEqual(['s_flush_cancel'])
    })
  })
})

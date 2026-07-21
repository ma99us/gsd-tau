/**
 * Tests for main/persistence/registry-store.ts
 *
 * Uses a temp directory so every test runs against a real, isolated filesystem.
 * Vitest fake timers control the 500 ms debounce.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { RegistryStore } from './registry-store'
import type { RegistryV1 } from '@shared/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRegistry(overrides: Partial<RegistryV1> = {}): RegistryV1 {
  return { version: 1, sessions: [], windows: [], mruOrder: [], ...overrides }
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'registry-store-test-'))
}

function readRegistry(dir: string): RegistryV1 {
  return JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')) as RegistryV1
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('RegistryStore', () => {
  let tmpDir: string
  let store: RegistryStore

  beforeEach(() => {
    vi.useFakeTimers()
    tmpDir = makeTempDir()
    store = new RegistryStore(tmpDir)
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── load() ──────────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('returns the default registry when no files exist', () => {
      const reg = store.load()
      expect(reg).toEqual(store.getDefault())
    })

    it('loads and parses registry.json successfully', () => {
      const data: RegistryV1 = makeRegistry({
        sessions: [{ id: 's1', cwd: '/p', displayName: 'p', lastOpenedAt: '2026-01-01T00:00:00.000Z', wasAutoRunning: false }],
      })
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), JSON.stringify(data))

      const reg = store.load()
      expect(reg.sessions).toHaveLength(1)
      expect(reg.sessions[0].id).toBe('s1')
    })

    it('seeds _windows from persisted window records (verified via save→flush)', () => {
      const onDisk: RegistryV1 = makeRegistry({
        windows: [{ id: 'w1', tabIds: ['s1'], activeTabId: 's1', bounds: { x: 10, y: 20, width: 800, height: 600 } }],
      })
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), JSON.stringify(onDisk))

      store.load()

      // SessionManager-style save: passes windows: []
      store.save(makeRegistry({ windows: [] }))
      vi.runAllTimers()

      const written = readRegistry(tmpDir)
      // _windows should have been preserved
      expect(written.windows).toHaveLength(1)
      expect(written.windows[0].id).toBe('w1')
      expect(written.windows[0].bounds).toEqual({ x: 10, y: 20, width: 800, height: 600 })
    })

    it('falls back to .bak when registry.json is absent', () => {
      const bakData: RegistryV1 = makeRegistry({
        sessions: [{ id: 's-bak', cwd: '/bak', displayName: 'bak', lastOpenedAt: '2026-01-01T00:00:00.000Z', wasAutoRunning: false }],
      })
      fs.writeFileSync(path.join(tmpDir, 'registry.json.bak'), JSON.stringify(bakData))

      const reg = store.load()
      expect(reg.sessions[0].id).toBe('s-bak')
    })

    it('falls back to .bak when registry.json is corrupt', () => {
      const bakData: RegistryV1 = makeRegistry({
        sessions: [{ id: 'from-bak', cwd: '/b', displayName: 'b', lastOpenedAt: '2026-01-01T00:00:00.000Z', wasAutoRunning: false }],
      })
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), 'CORRUPT_JSON')
      fs.writeFileSync(path.join(tmpDir, 'registry.json.bak'), JSON.stringify(bakData))

      const reg = store.load()
      expect(reg.sessions[0].id).toBe('from-bak')
    })

    it('returns default when both registry.json and .bak are invalid', () => {
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), '{bad')
      fs.writeFileSync(path.join(tmpDir, 'registry.json.bak'), 'also bad')

      const reg = store.load()
      expect(reg).toEqual(store.getDefault())
    })

    it('does not throw when registry.json contains invalid JSON', () => {
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), 'NOT_JSON')
      expect(() => store.load()).not.toThrow()
    })
  })

  // ── save() — window record preservation ────────────────────────────────────

  describe('save() — window record preservation', () => {
    it('persists the registry to disk after debounce elapses', () => {
      store.load()
      store.save(makeRegistry({ sessions: [] }))
      vi.runAllTimers()

      expect(fs.existsSync(path.join(tmpDir, 'registry.json'))).toBe(true)
    })

    it('preserves window records when caller passes windows: []', () => {
      const initial: RegistryV1 = makeRegistry({
        windows: [{ id: 'w1', tabIds: [], activeTabId: '', bounds: { x: 0, y: 0, width: 1200, height: 800 } }],
      })
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), JSON.stringify(initial))
      store.load()

      // SessionManager-style save — windows empty
      store.save(makeRegistry({
        sessions: [{ id: 's1', cwd: '/p', displayName: 'p', lastOpenedAt: '2026-01-01T00:00:00.000Z', wasAutoRunning: false }],
        windows: [],
      }))
      vi.runAllTimers()

      const written = readRegistry(tmpDir)
      expect(written.sessions).toHaveLength(1)
      expect(written.windows).toHaveLength(1)
      expect(written.windows[0].id).toBe('w1')
    })

    it('does not erase window bounds across multiple SessionManager saves', () => {
      const initial: RegistryV1 = makeRegistry({
        windows: [{ id: 'w1', tabIds: [], activeTabId: '', bounds: { x: 5, y: 5, width: 800, height: 600 } }],
      })
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), JSON.stringify(initial))
      store.load()

      store.save(makeRegistry({ windows: [] }))
      store.save(makeRegistry({ windows: [] }))
      store.save(makeRegistry({ windows: [] }))
      vi.runAllTimers()

      const written = readRegistry(tmpDir)
      expect(written.windows).toHaveLength(1)
      expect(written.windows[0].bounds).toEqual({ x: 5, y: 5, width: 800, height: 600 })
    })

    it('coalesces rapid saves into a single disk write', () => {
      const renameSpy = vi.spyOn(fs, 'renameSync')
      store.load()

      store.save(makeRegistry())
      store.save(makeRegistry())
      store.save(makeRegistry())

      vi.runAllTimers()
      expect(renameSpy).toHaveBeenCalledTimes(1)
      renameSpy.mockRestore()
    })

    it('rotates registry.json → registry.json.bak on second write', () => {
      store.load()

      store.save(makeRegistry({ mruOrder: ['first'] }))
      vi.runAllTimers()

      store.save(makeRegistry({ mruOrder: ['second'] }))
      vi.runAllTimers()

      expect(fs.existsSync(path.join(tmpDir, 'registry.json.bak'))).toBe(true)
    })
  })

  // ── updateWindowBounds() ─────────────────────────────────────────────────────

  describe('updateWindowBounds()', () => {
    it('creates a new WindowRecord when the windowId is not known', () => {
      store.load()
      store.updateWindowBounds('w-new', { x: 100, y: 200, width: 900, height: 700 })
      vi.runAllTimers()

      const written = readRegistry(tmpDir)
      expect(written.windows).toHaveLength(1)
      expect(written.windows[0].id).toBe('w-new')
      expect(written.windows[0].bounds).toEqual({ x: 100, y: 200, width: 900, height: 700 })
    })

    it('initialises tabIds and activeTabId to safe empty values for a new record', () => {
      store.load()
      store.updateWindowBounds('w-brand-new', { x: 0, y: 0, width: 1200, height: 800 })
      vi.runAllTimers()

      const written = readRegistry(tmpDir)
      expect(written.windows[0].tabIds).toEqual([])
      expect(written.windows[0].activeTabId).toBe('')
    })

    it('updates only bounds on an existing record (tabIds and activeTabId preserved)', () => {
      const initial: RegistryV1 = makeRegistry({
        windows: [{ id: 'w1', tabIds: ['s1', 's2'], activeTabId: 's1', bounds: { x: 0, y: 0, width: 800, height: 600 } }],
      })
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), JSON.stringify(initial))
      store.load()

      store.updateWindowBounds('w1', { x: 50, y: 60, width: 1280, height: 900 })
      vi.runAllTimers()

      const written = readRegistry(tmpDir)
      const win = written.windows[0]
      expect(win.id).toBe('w1')
      expect(win.tabIds).toEqual(['s1', 's2'])
      expect(win.activeTabId).toBe('s1')
      expect(win.bounds).toEqual({ x: 50, y: 60, width: 1280, height: 900 })
    })

    it('coalesces with a pending session save (bounds + sessions in one flush)', () => {
      store.load()

      store.save(makeRegistry({
        sessions: [{ id: 's1', cwd: '/p', displayName: 'p', lastOpenedAt: '2026-01-01T00:00:00.000Z', wasAutoRunning: false }],
      }))

      // updateWindowBounds before the debounce fires
      store.updateWindowBounds('w1', { x: 0, y: 0, width: 1200, height: 800 })

      vi.runAllTimers()

      const written = readRegistry(tmpDir)
      expect(written.sessions).toHaveLength(1)
      expect(written.windows).toHaveLength(1)
    })

    it('multiple updateWindowBounds calls for the same window converge to the last value', () => {
      store.load()
      store.updateWindowBounds('w1', { x: 0, y: 0, width: 800, height: 600 })
      store.updateWindowBounds('w1', { x: 10, y: 10, width: 900, height: 700 })
      store.updateWindowBounds('w1', { x: 20, y: 20, width: 1000, height: 800 })
      vi.runAllTimers()

      const written = readRegistry(tmpDir)
      expect(written.windows).toHaveLength(1)
      expect(written.windows[0].bounds).toEqual({ x: 20, y: 20, width: 1000, height: 800 })
    })
  })

  // ── flush() ──────────────────────────────────────────────────────────────────

  describe('flush()', () => {
    it('writes pending data synchronously without advancing timers', () => {
      store.load()
      store.save(makeRegistry({ mruOrder: ['flushed'] }))

      store.flush() // bypass debounce

      expect(fs.existsSync(path.join(tmpDir, 'registry.json'))).toBe(true)
      const written = readRegistry(tmpDir)
      expect(written.mruOrder).toEqual(['flushed'])
    })

    it('is a no-op when nothing is pending (no throw)', () => {
      store.load()
      expect(() => store.flush()).not.toThrow()
    })

    it('includes window bounds in the flushed payload', () => {
      store.load()
      store.updateWindowBounds('w1', { x: 10, y: 20, width: 400, height: 300 })

      store.flush() // bypass debounce

      const written = readRegistry(tmpDir)
      expect(written.windows[0].bounds).toEqual({ x: 10, y: 20, width: 400, height: 300 })
    })

    it('cancels the pending debounce timer so it does not fire again', () => {
      const renameSpy = vi.spyOn(fs, 'renameSync')
      store.load()
      store.save(makeRegistry())

      store.flush() // writes once synchronously
      vi.runAllTimers() // timer should already be cancelled

      expect(renameSpy).toHaveBeenCalledTimes(1) // exactly one write, not two
      renameSpy.mockRestore()
    })
  })

  // ── Negative / edge cases ─────────────────────────────────────────────────────

  describe('negative and edge cases', () => {
    it('does not throw when flush fails due to a filesystem error', () => {
      // Point a store at a path that cannot be created/written to.
      // On Windows, pick an invalid path character.
      const badPath = path.join(tmpDir, 'sub\0bad') // null byte → invalid on all OSes
      const badStore = new RegistryStore(badPath)
      badStore.load()
      badStore.save(makeRegistry())
      expect(() => { vi.runAllTimers() }).not.toThrow()
    })

    it('does not throw when .bak is corrupted (no crash on backup failure)', () => {
      // Make .bak a directory so copyFileSync throws
      const bakDir = path.join(tmpDir, 'registry.json.bak')
      fs.mkdirSync(bakDir)
      store.load()
      store.save(makeRegistry())
      // The backup step is best-effort — should not crash
      expect(() => { vi.runAllTimers() }).not.toThrow()
    })

    it('returns the default registry after repeated failed loads', () => {
      fs.writeFileSync(path.join(tmpDir, 'registry.json'), '')
      fs.writeFileSync(path.join(tmpDir, 'registry.json.bak'), '')

      const reg = store.load()
      expect(reg.version).toBe(1)
      expect(reg.sessions).toEqual([])
    })

    it('getDefault() always returns a structurally valid RegistryV1', () => {
      const def = store.getDefault()
      expect(def.version).toBe(1)
      expect(Array.isArray(def.sessions)).toBe(true)
      expect(Array.isArray(def.windows)).toBe(true)
      expect(Array.isArray(def.mruOrder)).toBe(true)
    })
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMRUStore,
  DEFAULT_MRU_KEY,
  DEFAULT_MRU_MAX,
  type StorageAdapter,
} from './useMRU'

// ── In-memory StorageAdapter ──────────────────────────────────────────────────
// Map-based store — no window.localStorage required in vitest node env.

function makeStorage(initial: Record<string, string> = {}): StorageAdapter {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem:  (k) => map.get(k) ?? null,
    setItem:  (k, v) => { map.set(k, v) },
  }
}

describe('createMRUStore', () => {
  // ── Exports ───────────────────────────────────────────────────────────────

  it('exports DEFAULT_MRU_KEY', () => {
    expect(typeof DEFAULT_MRU_KEY).toBe('string')
    expect(DEFAULT_MRU_KEY.length).toBeGreaterThan(0)
  })

  it('exports DEFAULT_MRU_MAX as 20', () => {
    expect(DEFAULT_MRU_MAX).toBe(20)
  })

  // ── load — empty / initial state ─────────────────────────────────────────

  describe('load', () => {
    it('returns [] when storage key is absent', () => {
      const store = createMRUStore('k', 5, makeStorage())
      expect(store.load()).toEqual([])
    })

    it('returns [] when storage value is null', () => {
      const store = createMRUStore('k', 5, { getItem: () => null, setItem: () => {} })
      expect(store.load()).toEqual([])
    })

    it('round-trips a pre-seeded list from storage', () => {
      const storage = makeStorage({ k: JSON.stringify(['a', 'b', 'c']) })
      const store = createMRUStore('k', 5, storage)
      expect(store.load()).toEqual(['a', 'b', 'c'])
    })

    it('is scoped to its storage key — different keys do not interfere', () => {
      const storage = makeStorage({
        k1: JSON.stringify(['x']),
        k2: JSON.stringify(['y']),
      })
      expect(createMRUStore('k1', 5, storage).load()).toEqual(['x'])
      expect(createMRUStore('k2', 5, storage).load()).toEqual(['y'])
    })

    // ── Negative: corrupted storage ───────────────────────────────────────

    it('returns [] for malformed JSON', () => {
      const storage = makeStorage({ k: 'NOT_JSON' })
      const store = createMRUStore('k', 5, storage)
      expect(store.load()).toEqual([])
    })

    it('returns [] when stored value is a JSON non-array (e.g. object)', () => {
      const storage = makeStorage({ k: JSON.stringify({ foo: 'bar' }) })
      const store = createMRUStore('k', 5, storage)
      expect(store.load()).toEqual([])
    })

    it('filters out non-string items from the stored array', () => {
      const storage = makeStorage({ k: JSON.stringify(['a', 42, null, 'b', true]) })
      const store = createMRUStore('k', 5, storage)
      expect(store.load()).toEqual(['a', 'b'])
    })
  })

  // ── push — happy paths ────────────────────────────────────────────────────

  describe('push', () => {
    let storage: StorageAdapter
    let store: ReturnType<typeof createMRUStore>

    beforeEach(() => {
      storage = makeStorage()
      store   = createMRUStore('k', 5, storage)
    })

    it('prepends new item to empty list', () => {
      expect(store.push('cmd-a')).toEqual(['cmd-a'])
    })

    it('prepends new item to front of existing list', () => {
      store.push('cmd-a')
      expect(store.push('cmd-b')).toEqual(['cmd-b', 'cmd-a'])
    })

    it('deduplicates — re-pushing an existing item moves it to front', () => {
      store.push('cmd-a')
      store.push('cmd-b')
      store.push('cmd-c')
      expect(store.push('cmd-a')).toEqual(['cmd-a', 'cmd-c', 'cmd-b'])
    })

    it('deduplicates — re-pushing the most-recent item is idempotent', () => {
      store.push('cmd-a')
      expect(store.push('cmd-a')).toEqual(['cmd-a'])
    })

    it('persists the updated list to storage', () => {
      store.push('cmd-a')
      store.push('cmd-b')
      const loaded = store.load()
      expect(loaded).toEqual(['cmd-b', 'cmd-a'])
    })

    it('returns the new list synchronously', () => {
      const result = store.push('x')
      expect(result).toEqual(['x'])
    })

    // ── Max-length cap ────────────────────────────────────────────────────

    it('caps the list at maxLen', () => {
      for (let i = 0; i < 6; i++) store.push(`cmd-${i}`)
      const list = store.load()
      expect(list.length).toBe(5)
    })

    it('drops the oldest entry when cap is exceeded', () => {
      for (let i = 0; i < 5; i++) store.push(`cmd-${i}`)
      store.push('cmd-new')
      const list = store.load()
      expect(list).not.toContain('cmd-0') // oldest pushed first
      expect(list[0]).toBe('cmd-new')
    })

    it('respects a custom maxLen of 1 (only keeps latest)', () => {
      const s = createMRUStore('k', 1, makeStorage())
      s.push('a')
      s.push('b')
      expect(s.load()).toEqual(['b'])
    })
  })

  // ── clear ─────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('empties the list in storage', () => {
      const store = createMRUStore('k', 5, makeStorage())
      store.push('a')
      store.push('b')
      store.clear()
      expect(store.load()).toEqual([])
    })

    it('push after clear starts fresh', () => {
      const store = createMRUStore('k', 5, makeStorage())
      store.push('a')
      store.clear()
      expect(store.push('b')).toEqual(['b'])
    })
  })

  // ── Key isolation ─────────────────────────────────────────────────────────

  it('two stores sharing the same StorageAdapter but different keys do not interfere', () => {
    const storage = makeStorage()
    const s1 = createMRUStore('k1', 5, storage)
    const s2 = createMRUStore('k2', 5, storage)
    s1.push('alpha')
    s2.push('beta')
    expect(s1.load()).toEqual(['alpha'])
    expect(s2.load()).toEqual(['beta'])
  })
})

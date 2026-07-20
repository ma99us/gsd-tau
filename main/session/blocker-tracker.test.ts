import { describe, it, expect, vi } from 'vitest'
import { BlockerTracker } from './blocker-tracker'
import type { RpcExtensionUIRequest } from '../../shared/types'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Minimal fixture that satisfies the RpcExtensionUIRequest shape. */
function makeReq(id: string, message = `message-${id}`): RpcExtensionUIRequest {
  return {
    id,
    method: 'select' as RpcExtensionUIRequest['method'],
    message,
  } as unknown as RpcExtensionUIRequest
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('BlockerTracker', () => {
  // ── initial state ──────────────────────────────────────────────────────────

  it('starts empty', () => {
    const tracker = new BlockerTracker()
    expect(tracker.size).toBe(0)
    expect(tracker.getAll()).toEqual({})
  })

  // ── add ────────────────────────────────────────────────────────────────────

  it('add() increases size', () => {
    const tracker = new BlockerTracker()
    tracker.add(makeReq('req-1'))
    expect(tracker.size).toBe(1)
  })

  it('add() stores the request in getAll()', () => {
    const tracker = new BlockerTracker()
    const req = makeReq('req-1')
    tracker.add(req)
    expect(tracker.getAll()).toEqual({ 'req-1': req })
  })

  it('add() emits ui-request-added with the request', () => {
    const tracker = new BlockerTracker()
    const req = makeReq('req-1')
    const added: RpcExtensionUIRequest[] = []
    tracker.on('ui-request-added', (r) => added.push(r))

    tracker.add(req)

    expect(added).toHaveLength(1)
    expect(added[0]).toBe(req)
  })

  it('add() with duplicate id overwrites and still emits', () => {
    const tracker = new BlockerTracker()
    const req1 = makeReq('req-1', 'first')
    const req2 = makeReq('req-1', 'second')
    const added: RpcExtensionUIRequest[] = []
    tracker.on('ui-request-added', (r) => added.push(r))

    tracker.add(req1)
    tracker.add(req2)

    expect(tracker.size).toBe(1)
    expect(tracker.getAll()['req-1']).toBe(req2)
    expect(added).toHaveLength(2)
  })

  // ── remove ─────────────────────────────────────────────────────────────────

  it('remove() decreases size', () => {
    const tracker = new BlockerTracker()
    tracker.add(makeReq('req-1'))
    tracker.remove('req-1')
    expect(tracker.size).toBe(0)
  })

  it('remove() deletes the request from getAll()', () => {
    const tracker = new BlockerTracker()
    tracker.add(makeReq('req-1'))
    tracker.remove('req-1')
    expect(tracker.getAll()).toEqual({})
  })

  it('remove() emits ui-request-removed with the request id', () => {
    const tracker = new BlockerTracker()
    tracker.add(makeReq('req-1'))
    const removed: string[] = []
    tracker.on('ui-request-removed', (id) => removed.push(id))

    tracker.remove('req-1')

    expect(removed).toHaveLength(1)
    expect(removed[0]).toBe('req-1')
  })

  // ── add/remove round trip ──────────────────────────────────────────────────

  it('add → remove round trip leaves tracker empty', () => {
    const tracker = new BlockerTracker()
    const added: RpcExtensionUIRequest[] = []
    const removed: string[] = []
    tracker.on('ui-request-added', (r) => added.push(r))
    tracker.on('ui-request-removed', (id) => removed.push(id))

    const req = makeReq('req-42')
    tracker.add(req)
    tracker.remove('req-42')

    expect(tracker.size).toBe(0)
    expect(tracker.getAll()).toEqual({})
    expect(added).toHaveLength(1)
    expect(removed).toHaveLength(1)
    expect(removed[0]).toBe('req-42')
  })

  // ── multiple blockers ──────────────────────────────────────────────────────

  it('tracks multiple blockers independently', () => {
    const tracker = new BlockerTracker()
    const r1 = makeReq('req-1')
    const r2 = makeReq('req-2')
    const r3 = makeReq('req-3')
    tracker.add(r1)
    tracker.add(r2)
    tracker.add(r3)

    expect(tracker.size).toBe(3)
    expect(tracker.getAll()).toEqual({ 'req-1': r1, 'req-2': r2, 'req-3': r3 })
  })

  it('removing one of multiple blockers leaves others intact', () => {
    const tracker = new BlockerTracker()
    const r1 = makeReq('req-1')
    const r2 = makeReq('req-2')
    tracker.add(r1)
    tracker.add(r2)

    tracker.remove('req-1')

    expect(tracker.size).toBe(1)
    expect(tracker.getAll()).toEqual({ 'req-2': r2 })
  })

  it('removing all blockers one-by-one leaves tracker empty', () => {
    const tracker = new BlockerTracker()
    tracker.add(makeReq('req-1'))
    tracker.add(makeReq('req-2'))
    tracker.add(makeReq('req-3'))

    tracker.remove('req-1')
    tracker.remove('req-2')
    tracker.remove('req-3')

    expect(tracker.size).toBe(0)
    expect(tracker.getAll()).toEqual({})
  })

  // ── remove non-existent id (no-op) ─────────────────────────────────────────

  it('remove() on unknown id is a no-op — no event emitted', () => {
    const tracker = new BlockerTracker()
    const removed: string[] = []
    tracker.on('ui-request-removed', (id) => removed.push(id))

    tracker.remove('does-not-exist')

    expect(removed).toHaveLength(0)
    expect(tracker.size).toBe(0)
  })

  it('remove() on unknown id does not affect existing blockers', () => {
    const tracker = new BlockerTracker()
    const req = makeReq('req-1')
    tracker.add(req)

    tracker.remove('does-not-exist')

    expect(tracker.size).toBe(1)
    expect(tracker.getAll()).toEqual({ 'req-1': req })
  })

  it('double-remove of same id is a no-op on the second call', () => {
    const tracker = new BlockerTracker()
    tracker.add(makeReq('req-1'))
    const removed: string[] = []
    tracker.on('ui-request-removed', (id) => removed.push(id))

    tracker.remove('req-1')
    tracker.remove('req-1')  // second call — id no longer present

    expect(removed).toHaveLength(1)
  })

  // ── getAll() snapshot isolation ────────────────────────────────────────────

  it('getAll() returns a new plain object each call (not the internal map)', () => {
    const tracker = new BlockerTracker()
    tracker.add(makeReq('req-1'))

    const snapshot1 = tracker.getAll()
    tracker.add(makeReq('req-2'))
    const snapshot2 = tracker.getAll()

    // Snapshot taken before req-2 should not see it
    expect(Object.keys(snapshot1)).toHaveLength(1)
    expect(Object.keys(snapshot2)).toHaveLength(2)
  })

  // ── event listener independence ────────────────────────────────────────────

  it('multiple listeners on ui-request-added all receive the event', () => {
    const tracker = new BlockerTracker()
    const calls1: string[] = []
    const calls2: string[] = []
    tracker.on('ui-request-added', (r) => calls1.push(r.id))
    tracker.on('ui-request-added', (r) => calls2.push(r.id))

    tracker.add(makeReq('req-1'))

    expect(calls1).toEqual(['req-1'])
    expect(calls2).toEqual(['req-1'])
  })

  it('removeAllListeners() stops event emission', () => {
    const tracker = new BlockerTracker()
    const added: string[] = []
    tracker.on('ui-request-added', (r) => added.push(r.id))
    tracker.removeAllListeners()

    tracker.add(makeReq('req-1'))

    expect(added).toHaveLength(0)
    // Internal state still updated correctly
    expect(tracker.size).toBe(1)
  })

  // ── size getter ────────────────────────────────────────────────────────────

  it('size accurately reflects the count through a full add/remove sequence', () => {
    const tracker = new BlockerTracker()
    expect(tracker.size).toBe(0)

    tracker.add(makeReq('a'))
    expect(tracker.size).toBe(1)

    tracker.add(makeReq('b'))
    expect(tracker.size).toBe(2)

    tracker.remove('a')
    expect(tracker.size).toBe(1)

    tracker.remove('b')
    expect(tracker.size).toBe(0)
  })

  // ── vi.fn() spy integration ────────────────────────────────────────────────

  it('event listeners can be Vitest spies', () => {
    const tracker = new BlockerTracker()
    const onAdded = vi.fn()
    const onRemoved = vi.fn()
    tracker.on('ui-request-added', onAdded)
    tracker.on('ui-request-removed', onRemoved)

    const req = makeReq('req-spy')
    tracker.add(req)
    tracker.remove('req-spy')

    expect(onAdded).toHaveBeenCalledOnce()
    expect(onAdded).toHaveBeenCalledWith(req)
    expect(onRemoved).toHaveBeenCalledOnce()
    expect(onRemoved).toHaveBeenCalledWith('req-spy')
  })
})

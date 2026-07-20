/**
 * Unit tests for modal-queue pure helper functions.
 *
 * Tests cover isBlockingMethod, enqueueModal, dequeueModal, and removeFromQueue.
 * No React rendering required — all helpers are pure functions.
 *
 * Negative-test coverage:
 *   - isBlockingMethod: each non-modal method returns false; blocking + unknown return true
 *   - dequeueModal: safe on an empty queue (returns empty, does not throw)
 *   - removeFromQueue: no-op when id is absent; immutability preserved in all cases
 */
import { describe, expect, it } from 'vitest'
import {
  isBlockingMethod,
  NON_MODAL_METHODS,
  enqueueModal,
  dequeueModal,
  removeFromQueue,
} from './modal-queue'
import type { ModalQueue } from './modal-queue'

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Minimal mock object that satisfies the `.id` and `.method` shape used by the
 * queue helpers.  Cast through `unknown` because we only populate the fields
 * that the helpers actually access.
 */
function makeReq(id: string, method = 'select'): ModalQueue[number] {
  return { id, method } as unknown as ModalQueue[number]
}

// ── isBlockingMethod ──────────────────────────────────────────────────────────

describe('isBlockingMethod', () => {
  // ── Non-modal methods return false ────────────────────────────────────────

  it('returns false for every method in NON_MODAL_METHODS', () => {
    for (const method of NON_MODAL_METHODS) {
      expect(isBlockingMethod(method)).toBe(false)
    }
  })

  it('returns false for notify (informational, no user response needed)', () => {
    expect(isBlockingMethod('notify')).toBe(false)
  })

  it('returns false for setStatus', () => {
    expect(isBlockingMethod('setStatus')).toBe(false)
  })

  it('returns false for setWidget', () => {
    expect(isBlockingMethod('setWidget')).toBe(false)
  })

  it('returns false for setTitle', () => {
    expect(isBlockingMethod('setTitle')).toBe(false)
  })

  it('returns false for set_editor_text', () => {
    expect(isBlockingMethod('set_editor_text')).toBe(false)
  })

  // ── Known blocking methods return true ───────────────────────────────────

  it('returns true for select', () => {
    expect(isBlockingMethod('select')).toBe(true)
  })

  it('returns true for confirm', () => {
    expect(isBlockingMethod('confirm')).toBe(true)
  })

  it('returns true for input', () => {
    expect(isBlockingMethod('input')).toBe(true)
  })

  it('returns true for editor', () => {
    expect(isBlockingMethod('editor')).toBe(true)
  })

  // ── Unknown future methods return true (FallbackModal handles them) ───────

  it('returns true for an unknown_future_method', () => {
    expect(isBlockingMethod('unknown_future_method')).toBe(true)
  })

  it('returns true for an empty string (unrecognised method)', () => {
    expect(isBlockingMethod('')).toBe(true)
  })

  it('returns true for a completely novel method name', () => {
    expect(isBlockingMethod('showBrowser')).toBe(true)
  })
})

// ── enqueueModal ──────────────────────────────────────────────────────────────

describe('enqueueModal', () => {
  it('appends the request to an empty queue', () => {
    const req = makeReq('r1')
    const result = enqueueModal([], req)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(req)
  })

  it('appends to the end of a non-empty queue (preserves order)', () => {
    const r1 = makeReq('r1')
    const r2 = makeReq('r2')
    const r3 = makeReq('r3')
    const result = enqueueModal([r1, r2], r3)
    expect(result).toEqual([r1, r2, r3])
  })

  it('never mutates the original queue', () => {
    const original: ModalQueue = [makeReq('r1')]
    enqueueModal(original, makeReq('r2'))
    expect(original).toHaveLength(1)
  })

  it('allows duplicate ids to be queued (pi controls uniqueness)', () => {
    const req = makeReq('r1')
    const result = enqueueModal([req], req)
    expect(result).toHaveLength(2)
  })
})

// ── dequeueModal ──────────────────────────────────────────────────────────────

describe('dequeueModal', () => {
  it('removes the first element from a single-item queue', () => {
    const result = dequeueModal([makeReq('r1')])
    expect(result).toEqual([])
  })

  it('removes the head and leaves the rest in order', () => {
    const r1 = makeReq('r1')
    const r2 = makeReq('r2')
    const r3 = makeReq('r3')
    const result = dequeueModal([r1, r2, r3])
    expect(result).toEqual([r2, r3])
  })

  it('returns an empty array when called on an empty queue (safe no-op)', () => {
    expect(dequeueModal([])).toEqual([])
  })

  it('never mutates the original queue', () => {
    const r1 = makeReq('r1')
    const original: ModalQueue = [r1, makeReq('r2')]
    dequeueModal(original)
    expect(original).toHaveLength(2)
    expect(original[0]).toBe(r1)
  })

  it('the new queue[0] after dequeue is the second item of the original', () => {
    const r1 = makeReq('r1')
    const r2 = makeReq('r2')
    const result = dequeueModal([r1, r2])
    expect(result[0]).toBe(r2)
  })
})

// ── removeFromQueue ───────────────────────────────────────────────────────────

describe('removeFromQueue', () => {
  it('removes the matching request from a single-item queue', () => {
    const req = makeReq('r1')
    const result = removeFromQueue([req], 'r1')
    expect(result).toEqual([])
  })

  it('removes only the matching request when multiple items are present', () => {
    const r1 = makeReq('r1')
    const r2 = makeReq('r2')
    const r3 = makeReq('r3')
    const result = removeFromQueue([r1, r2, r3], 'r2')
    expect(result).toEqual([r1, r3])
  })

  it('removes the head element by id', () => {
    const r1 = makeReq('r1')
    const r2 = makeReq('r2')
    const result = removeFromQueue([r1, r2], 'r1')
    expect(result).toEqual([r2])
  })

  it('is a no-op when the id is not in the queue (returns equivalent array)', () => {
    const r1 = makeReq('r1')
    const r2 = makeReq('r2')
    const original = [r1, r2]
    const result = removeFromQueue(original, 'does-not-exist')
    expect(result).toEqual([r1, r2])
  })

  it('is a no-op on an empty queue', () => {
    expect(removeFromQueue([], 'r1')).toEqual([])
  })

  it('never mutates the original queue', () => {
    const r1 = makeReq('r1')
    const original: ModalQueue = [r1, makeReq('r2')]
    removeFromQueue(original, 'r1')
    expect(original).toHaveLength(2)
    expect(original[0]).toBe(r1)
  })

  it('preserves the relative order of remaining items', () => {
    const r1 = makeReq('r1')
    const r2 = makeReq('r2')
    const r3 = makeReq('r3')
    const r4 = makeReq('r4')
    const result = removeFromQueue([r1, r2, r3, r4], 'r2')
    expect(result).toEqual([r1, r3, r4])
  })
})

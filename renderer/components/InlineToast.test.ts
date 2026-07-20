import { describe, it, expect } from 'vitest'
import {
  buildToastEntry,
  addToastCapped,
  TOAST_MAX,
  TOAST_TTL_MS,
} from './InlineToast'
import type { ToastEntry, NotifyRequest } from './InlineToast'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNotifyReq(
  id: string,
  message: string,
  notifyType?: 'info' | 'warning' | 'error',
): NotifyRequest {
  const req: NotifyRequest = { type: 'extension_ui_request', id, method: 'notify', message }
  if (notifyType !== undefined) (req as Record<string, unknown>).notifyType = notifyType
  return req
}

function makeToast(id: string, notifyType: ToastEntry['notifyType'] = 'info'): ToastEntry {
  return { id, message: `msg-${id}`, notifyType }
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('TOAST_MAX', () => {
  it('equals 3', () => {
    expect(TOAST_MAX).toBe(3)
  })
})

describe('TOAST_TTL_MS', () => {
  it('equals 4000', () => {
    expect(TOAST_TTL_MS).toBe(4_000)
  })
})

// ── buildToastEntry ───────────────────────────────────────────────────────────

describe('buildToastEntry', () => {
  it('maps id and message from the request', () => {
    const req = makeNotifyReq('req-1', 'Hello world', 'info')
    const entry = buildToastEntry(req)
    expect(entry.id).toBe('req-1')
    expect(entry.message).toBe('Hello world')
  })

  it('defaults notifyType to "info" when absent', () => {
    const req = makeNotifyReq('req-2', 'No type')
    const entry = buildToastEntry(req)
    expect(entry.notifyType).toBe('info')
  })

  it('preserves notifyType = "warning"', () => {
    const entry = buildToastEntry(makeNotifyReq('r', 'Watch out', 'warning'))
    expect(entry.notifyType).toBe('warning')
  })

  it('preserves notifyType = "error"', () => {
    const entry = buildToastEntry(makeNotifyReq('r', 'Failed', 'error'))
    expect(entry.notifyType).toBe('error')
  })
})

// ── addToastCapped ────────────────────────────────────────────────────────────

describe('addToastCapped', () => {
  it('adds a toast to an empty list', () => {
    const entry = makeToast('t1')
    const result = addToastCapped([], entry)
    expect(result).toEqual([entry])
  })

  it('appends after existing toasts', () => {
    const toasts = [makeToast('t1'), makeToast('t2')]
    const result = addToastCapped(toasts, makeToast('t3'))
    expect(result).toHaveLength(3)
    expect(result[2].id).toBe('t3')
  })

  it('does not exceed TOAST_MAX (3)', () => {
    const toasts = [makeToast('t1'), makeToast('t2'), makeToast('t3')]
    const result = addToastCapped(toasts, makeToast('t4'))
    expect(result).toHaveLength(TOAST_MAX)
  })

  it('removes the oldest (first) entry when cap is exceeded', () => {
    const toasts = [makeToast('t1'), makeToast('t2'), makeToast('t3')]
    const result = addToastCapped(toasts, makeToast('t4'))
    // t1 is the oldest and must be evicted
    expect(result.map(t => t.id)).toEqual(['t2', 't3', 't4'])
  })

  it('removes oldest again when adding a 5th toast to a full list', () => {
    // Simulate two successive overflows
    let toasts: ToastEntry[] = [makeToast('t1'), makeToast('t2'), makeToast('t3')]
    toasts = addToastCapped(toasts, makeToast('t4'))
    toasts = addToastCapped(toasts, makeToast('t5'))
    expect(toasts.map(t => t.id)).toEqual(['t3', 't4', 't5'])
  })

  it('never mutates the input array', () => {
    const toasts = [makeToast('t1')]
    const before = toasts.length
    addToastCapped(toasts, makeToast('t2'))
    expect(toasts).toHaveLength(before)
  })

  it('preserves the entry exactly as passed', () => {
    const entry: ToastEntry = { id: 'x', message: 'Hello!', notifyType: 'error' }
    const result = addToastCapped([], entry)
    expect(result[0]).toEqual(entry)
  })
})

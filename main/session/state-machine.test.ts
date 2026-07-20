import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionStateMachine } from './state-machine'
import type { StateChangedPayload } from './state-machine'

// Use a short watchdog value so fake-timer advances stay small
const WATCHDOG_MS = 30_000

describe('SessionStateMachine', () => {
  let sm: SessionStateMachine

  beforeEach(() => {
    vi.useFakeTimers()
    sm = new SessionStateMachine({ watchdogMs: WATCHDOG_MS })
  })

  afterEach(() => {
    sm.destroy()
    vi.useRealTimers()
  })

  // ── initial state ─────────────────────────────────────────────────────────

  it('starts in Idle state', () => {
    expect(sm.state).toBe('Idle')
  })

  // ── valid transitions ─────────────────────────────────────────────────────

  it('agent_start transitions Idle → Working', () => {
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('agent_start')

    expect(sm.state).toBe('Working')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({ from: 'Idle', to: 'Working', trigger: 'agent_start' })
  })

  it('agent_end transitions Working → Idle', () => {
    sm.feed('agent_start')
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('agent_end')

    expect(sm.state).toBe('Idle')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({ from: 'Working', to: 'Idle', trigger: 'agent_end' })
  })

  it('transport-error transitions Working → Stopped', () => {
    sm.feed('agent_start')
    sm.feed('transport-error')
    expect(sm.state).toBe('Stopped')
  })

  it('transport-error transitions Idle → Stopped', () => {
    sm.feed('transport-error')
    expect(sm.state).toBe('Stopped')
  })

  it('session can cycle Idle → Working → Idle multiple times', () => {
    sm.feed('agent_start')
    expect(sm.state).toBe('Working')
    sm.feed('agent_end')
    expect(sm.state).toBe('Idle')
    sm.feed('agent_start')
    expect(sm.state).toBe('Working')
    sm.feed('agent_end')
    expect(sm.state).toBe('Idle')
  })

  it('agent_start while already Working is a no-op (no event emitted)', () => {
    sm.feed('agent_start')
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('agent_start')

    expect(sm.state).toBe('Working')
    expect(changes).toHaveLength(0)
  })

  // ── state-changed payload ─────────────────────────────────────────────────

  it('emits state-changed with correct payload on every transition', () => {
    const payloads: StateChangedPayload[] = []
    sm.on('state-changed', (p) => payloads.push(p))

    sm.feed('agent_start')
    sm.feed('agent_end')
    sm.feed('agent_start')
    sm.feed('transport-error')

    expect(payloads).toHaveLength(4)
    expect(payloads[0]).toEqual({ from: 'Idle', to: 'Working', trigger: 'agent_start' })
    expect(payloads[1]).toEqual({ from: 'Working', to: 'Idle', trigger: 'agent_end' })
    expect(payloads[2]).toEqual({ from: 'Idle', to: 'Working', trigger: 'agent_start' })
    expect(payloads[3]).toEqual({ from: 'Working', to: 'Stopped', trigger: 'transport-error' })
  })

  // ── Stopped is terminal ───────────────────────────────────────────────────

  it('agent_start is ignored when Stopped — no transition, no event', () => {
    sm.feed('transport-error')
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('agent_start')

    expect(sm.state).toBe('Stopped')
    expect(changes).toHaveLength(0)
  })

  it('agent_end is ignored when Stopped', () => {
    sm.feed('transport-error')
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('agent_end')

    expect(sm.state).toBe('Stopped')
    expect(changes).toHaveLength(0)
  })

  it('redundant transport-error when already Stopped emits no event', () => {
    sm.feed('transport-error')
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('transport-error')

    expect(changes).toHaveLength(0)
  })

  // ── ignored / no-op transitions ───────────────────────────────────────────

  it('agent_end in Idle emits no event', () => {
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('agent_end')

    expect(sm.state).toBe('Idle')
    expect(changes).toHaveLength(0)
  })

  // ── watchdog: fires ───────────────────────────────────────────────────────

  it('watchdog fires after 30 s in Working and transitions to Stopped', () => {
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('agent_start')
    vi.advanceTimersByTime(WATCHDOG_MS)

    expect(sm.state).toBe('Stopped')
    const wd = changes.find((c) => c.trigger === 'watchdog-timeout')
    expect(wd).toBeDefined()
    expect(wd).toEqual({ from: 'Working', to: 'Stopped', trigger: 'watchdog-timeout' })
  })

  it('watchdog does NOT fire before 30 s', () => {
    sm.feed('agent_start')
    vi.advanceTimersByTime(WATCHDOG_MS - 1)
    expect(sm.state).toBe('Working')
  })

  // ── watchdog: cleared on exit from Working ────────────────────────────────

  it('watchdog is cancelled when agent_end moves state to Idle', () => {
    sm.feed('agent_start')
    sm.feed('agent_end')  // Working → Idle, clears watchdog

    vi.advanceTimersByTime(WATCHDOG_MS * 2)  // would have fired if timer remained

    expect(sm.state).toBe('Idle')
  })

  it('watchdog is cancelled when transport-error moves state to Stopped', () => {
    sm.feed('agent_start')
    sm.feed('transport-error')  // Working → Stopped, clears watchdog

    vi.advanceTimersByTime(WATCHDOG_MS * 2)

    expect(sm.state).toBe('Stopped')  // no second transition
  })

  it('watchdog does not fire in Idle state', () => {
    vi.advanceTimersByTime(WATCHDOG_MS * 2)
    expect(sm.state).toBe('Idle')
  })

  // ── watchdog: heartbeat resets timer ─────────────────────────────────────

  it('heartbeat() resets the 30 s inactivity window', () => {
    sm.feed('agent_start')

    vi.advanceTimersByTime(20_000)  // 20 s in
    sm.heartbeat()                  // reset — watchdog now counts from 0 again
    vi.advanceTimersByTime(20_000)  // only 20 s since last heartbeat

    expect(sm.state).toBe('Working')  // not yet timed out
  })

  it('watchdog fires 30 s after the last heartbeat', () => {
    sm.feed('agent_start')

    vi.advanceTimersByTime(20_000)
    sm.heartbeat()
    vi.advanceTimersByTime(WATCHDOG_MS)  // 30 s after heartbeat

    expect(sm.state).toBe('Stopped')
  })

  it('feed() while Working also resets the watchdog', () => {
    sm.feed('agent_start')

    vi.advanceTimersByTime(20_000)
    sm.feed('agent_start')          // no-op transition, but resets timer
    vi.advanceTimersByTime(20_000)  // only 20 s since last feed

    expect(sm.state).toBe('Working')
  })

  it('heartbeat() is a no-op when not in Working state', () => {
    // Idle
    sm.heartbeat()
    expect(sm.state).toBe('Idle')

    // Stopped
    sm.feed('transport-error')
    sm.heartbeat()
    expect(sm.state).toBe('Stopped')

    vi.advanceTimersByTime(WATCHDOG_MS * 2)  // no timer running, no crash
    expect(sm.state).toBe('Stopped')
  })

  // ── watchdog: fresh timer on re-entry to Working ──────────────────────────

  it('re-entering Working starts a fresh 30 s watchdog', () => {
    sm.feed('agent_start')
    vi.advanceTimersByTime(20_000)
    sm.feed('agent_end')     // Working → Idle, cancels watchdog
    sm.feed('agent_start')   // Idle → Working, starts fresh 30 s timer
    vi.advanceTimersByTime(WATCHDOG_MS)

    expect(sm.state).toBe('Stopped')  // fresh timer expired
  })

  it('partial time in first Working session does not bleed into second', () => {
    sm.feed('agent_start')
    vi.advanceTimersByTime(25_000)  // 25 s into first Working stint
    sm.feed('agent_end')            // cancel that watchdog
    sm.feed('agent_start')          // start fresh
    vi.advanceTimersByTime(25_000)  // only 25 s into second stint

    expect(sm.state).toBe('Working')  // still alive — new 30 s window
  })

  // ── destroy ───────────────────────────────────────────────────────────────

  it('destroy() cancels the watchdog so no events fire after teardown', () => {
    const changes: StateChangedPayload[] = []
    sm.on('state-changed', (p) => changes.push(p))

    sm.feed('agent_start')  // 1 event emitted, watchdog armed
    sm.destroy()
    vi.advanceTimersByTime(WATCHDOG_MS * 2)

    // Only the agent_start transition should have fired
    expect(changes).toHaveLength(1)
  })

  it('destroy() removes all listeners', () => {
    sm.on('state-changed', () => { /* noop */ })
    expect(sm.listenerCount('state-changed')).toBe(1)

    sm.destroy()

    expect(sm.listenerCount('state-changed')).toBe(0)
  })
})

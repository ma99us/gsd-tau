/**
 * Unit tests for main/os/tray.ts
 *
 * Mocks electron (Tray, Menu, app, nativeImage) so TrayManager and the pure
 * helper functions can be exercised in plain Node without starting Electron.
 *
 * All TrayManager tests inject `{ schedule: (fn) => fn() }` so deferred
 * updates run synchronously — no setImmediate flushing needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TrayManager,
  computeAggregate,
  countByState,
  buildTooltip,
  buildContextMenu,
} from './tray'
import type { SessionState } from '../session/state-machine'

// ── Electron mock ──────────────────────────────────────────────────────────────
// vi.hoisted ensures these refs are created before the vi.mock factory runs,
// making them accessible from both the factory and the test body.

const {
  MockTrayClass,
  mockTraySetImage,
  mockTraySetToolTip,
  mockTraySetContextMenu,
  mockTrayDestroy,
  mockMenuBuildFromTemplate,
  mockAppQuit,
  mockNativeImageCreateFromBuffer,
} = vi.hoisted(() => {
  const mockTraySetImage = vi.fn()
  const mockTraySetToolTip = vi.fn()
  const mockTraySetContextMenu = vi.fn()
  const mockTrayDestroy = vi.fn()

  // Constructor mock: each `new Tray(...)` returns the same shared instance
  // stubs so tests can inspect calls via the individual mock functions.
  const MockTrayClass = vi.fn().mockImplementation(() => ({
    setImage: mockTraySetImage,
    setToolTip: mockTraySetToolTip,
    setContextMenu: mockTraySetContextMenu,
    destroy: mockTrayDestroy,
  }))

  const mockMenuBuildFromTemplate = vi.fn().mockImplementation((template: unknown) => ({
    _template: template,
  }))

  const mockAppQuit = vi.fn()

  // createFromBuffer returns a plain object — sufficient for setImage assertions.
  const mockNativeImageCreateFromBuffer = vi.fn().mockReturnValue({ _isNativeImage: true })

  return {
    MockTrayClass,
    mockTraySetImage,
    mockTraySetToolTip,
    mockTraySetContextMenu,
    mockTrayDestroy,
    mockMenuBuildFromTemplate,
    mockAppQuit,
    mockNativeImageCreateFromBuffer,
  }
})

vi.mock('electron', () => ({
  Tray: MockTrayClass,
  Menu: { buildFromTemplate: mockMenuBuildFromTemplate },
  app: { quit: mockAppQuit },
  nativeImage: { createFromBuffer: mockNativeImageCreateFromBuffer },
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Extract the menu template array from the last mockMenuBuildFromTemplate call. */
function lastTemplate(): Array<{ label?: string; type?: string; click?: () => void }> {
  const call = mockMenuBuildFromTemplate.mock.calls.at(-1)
  return (call?.[0] as Array<{ label?: string; type?: string; click?: () => void }>) ?? []
}

/** Build a sessions Map from a plain object for concise test setup. */
function sessionsFrom(obj: Record<string, SessionState>): Map<string, SessionState> {
  return new Map(Object.entries(obj))
}

/** Create a TrayManager with synchronous scheduling for test use. */
function makeTray(onFocusWindow = vi.fn()): TrayManager {
  return new TrayManager(onFocusWindow, { schedule: (fn) => fn() })
}

// ── Tests: computeAggregate ────────────────────────────────────────────────────

describe('computeAggregate', () => {
  it('returns idle for empty sessions', () => {
    expect(computeAggregate(new Map())).toBe('idle')
  })

  it('returns idle when all sessions are Idle', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Idle', b: 'Idle' }))).toBe('idle')
  })

  it('returns working when at least one session is Working', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Working' }))).toBe('working')
  })

  it('returns working when multiple sessions are Working', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Working', b: 'Working' }))).toBe('working')
  })

  it('returns working when Working + Idle (no Stopped or Waiting)', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Working', b: 'Idle' }))).toBe('working')
  })

  it('returns stopped when at least one Stopped and none Waiting', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Stopped' }))).toBe('stopped')
  })

  it('returns stopped (not working) when Stopped + Working coexist', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Stopped', b: 'Working' }))).toBe('stopped')
  })

  it('returns stopped when all sessions are Stopped', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Stopped', b: 'Stopped' }))).toBe('stopped')
  })

  it('returns waiting when any session is Waiting', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Waiting' }))).toBe('waiting')
  })

  it('returns waiting (highest priority) when Waiting + Stopped coexist', () => {
    expect(computeAggregate(sessionsFrom({ a: 'Waiting', b: 'Stopped' }))).toBe('waiting')
  })

  it('returns waiting (highest priority) when all four states are present', () => {
    const sessions = sessionsFrom({ a: 'Waiting', b: 'Stopped', c: 'Working', d: 'Idle' })
    expect(computeAggregate(sessions)).toBe('waiting')
  })

  it('short-circuits on first Waiting without scanning remaining entries', () => {
    // Validates that a large mix including Waiting resolves correctly
    const sessions = sessionsFrom({
      s1: 'Idle', s2: 'Stopped', s3: 'Working', s4: 'Waiting', s5: 'Idle',
    })
    expect(computeAggregate(sessions)).toBe('waiting')
  })
})

// ── Tests: countByState ───────────────────────────────────────────────────────

describe('countByState', () => {
  it('returns 0 for empty map', () => {
    expect(countByState(new Map(), 'Waiting')).toBe(0)
  })

  it('returns 0 when no session matches the target state', () => {
    expect(countByState(sessionsFrom({ a: 'Idle', b: 'Working' }), 'Waiting')).toBe(0)
  })

  it('counts correctly when one session matches', () => {
    expect(countByState(sessionsFrom({ a: 'Waiting', b: 'Working' }), 'Waiting')).toBe(1)
  })

  it('counts correctly when multiple sessions match', () => {
    expect(
      countByState(sessionsFrom({ a: 'Waiting', b: 'Waiting', c: 'Idle' }), 'Waiting'),
    ).toBe(2)
  })

  it('counts Working sessions', () => {
    expect(countByState(sessionsFrom({ a: 'Working', b: 'Working' }), 'Working')).toBe(2)
  })

  it('counts Stopped sessions', () => {
    expect(countByState(sessionsFrom({ a: 'Stopped', b: 'Idle' }), 'Stopped')).toBe(1)
  })
})

// ── Tests: buildTooltip ───────────────────────────────────────────────────────

describe('buildTooltip', () => {
  it('returns bare app name when there are no sessions', () => {
    expect(buildTooltip(0, 0)).toBe('gsd-tau')
  })

  it('uses singular "session" for count 1 with no waiting', () => {
    expect(buildTooltip(1, 0)).toBe('gsd-tau — 1 session')
  })

  it('uses plural "sessions" for count 2 with no waiting', () => {
    expect(buildTooltip(2, 0)).toBe('gsd-tau — 2 sessions')
  })

  it('uses plural "sessions" for count 5 with no waiting', () => {
    expect(buildTooltip(5, 0)).toBe('gsd-tau — 5 sessions')
  })

  it('appends waiting count when waitingCount > 0', () => {
    expect(buildTooltip(2, 1)).toBe('gsd-tau — 2 sessions (1 waiting)')
  })

  it('appends waiting count with singular session', () => {
    expect(buildTooltip(1, 1)).toBe('gsd-tau — 1 session (1 waiting)')
  })

  it('appends correct waiting count for 3 waiting sessions', () => {
    expect(buildTooltip(4, 3)).toBe('gsd-tau — 4 sessions (3 waiting)')
  })

  it('does not append waiting clause when waitingCount is 0', () => {
    expect(buildTooltip(3, 0)).not.toContain('waiting')
  })
})

// ── Tests: buildContextMenu ───────────────────────────────────────────────────

describe('buildContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Item counts ─────────────────────────────────────────────────────────────

  it('produces only a Quit item when sessions is empty (no separator)', () => {
    buildContextMenu(new Map(), vi.fn())
    const template = lastTemplate()
    expect(template).toHaveLength(1)
    expect(template[0].label).toBe('Quit')
    expect(template[0].type).toBeUndefined()
  })

  it('produces [session, separator, Quit] for one session', () => {
    buildContextMenu(sessionsFrom({ 'proj-a': 'Idle' }), vi.fn())
    const template = lastTemplate()
    expect(template).toHaveLength(3)
    expect(template[1].type).toBe('separator')
    expect(template[2].label).toBe('Quit')
  })

  it('produces [s1, s2, separator, Quit] for two sessions', () => {
    buildContextMenu(sessionsFrom({ 'a': 'Working', 'b': 'Idle' }), vi.fn())
    const template = lastTemplate()
    expect(template).toHaveLength(4)
    expect(template[2].type).toBe('separator')
    expect(template[3].label).toBe('Quit')
  })

  it('produces correct count for three sessions', () => {
    buildContextMenu(sessionsFrom({ a: 'Idle', b: 'Working', c: 'Waiting' }), vi.fn())
    expect(lastTemplate()).toHaveLength(5) // 3 sessions + separator + Quit
  })

  // ── State emoji labels ───────────────────────────────────────────────────────

  it('prefixes Idle session with "–"', () => {
    buildContextMenu(sessionsFrom({ 'proj-a': 'Idle' }), vi.fn())
    expect(lastTemplate()[0].label).toBe('– proj-a (Idle)')
  })

  it('prefixes Working session with "◌"', () => {
    buildContextMenu(sessionsFrom({ 'proj-a': 'Working' }), vi.fn())
    expect(lastTemplate()[0].label).toBe('◌ proj-a (Working)')
  })

  it('prefixes Waiting session with "●"', () => {
    buildContextMenu(sessionsFrom({ 'proj-a': 'Waiting' }), vi.fn())
    expect(lastTemplate()[0].label).toBe('● proj-a (Waiting)')
  })

  it('prefixes Stopped session with "✕"', () => {
    buildContextMenu(sessionsFrom({ 'proj-a': 'Stopped' }), vi.fn())
    expect(lastTemplate()[0].label).toBe('✕ proj-a (Stopped)')
  })

  // ── Click handlers ──────────────────────────────────────────────────────────

  it('session item click calls onFocusWindow', () => {
    const onFocus = vi.fn()
    buildContextMenu(sessionsFrom({ 'proj-a': 'Idle' }), onFocus)
    const sessionItem = lastTemplate()[0]
    expect(sessionItem.click).toBeDefined()
    sessionItem.click!()
    expect(onFocus).toHaveBeenCalledOnce()
  })

  it('Quit item click calls app.quit()', () => {
    buildContextMenu(sessionsFrom({ 'proj-a': 'Idle' }), vi.fn())
    const quitItem = lastTemplate().at(-1)!
    expect(quitItem.label).toBe('Quit')
    quitItem.click!()
    expect(mockAppQuit).toHaveBeenCalledOnce()
  })

  it('each session click calls onFocusWindow (independent closures)', () => {
    const onFocus = vi.fn()
    buildContextMenu(sessionsFrom({ 'a': 'Working', 'b': 'Idle' }), onFocus)
    const template = lastTemplate()
    template[0].click!()
    template[1].click!()
    expect(onFocus).toHaveBeenCalledTimes(2)
  })

  it('calls Menu.buildFromTemplate exactly once', () => {
    buildContextMenu(sessionsFrom({ 'a': 'Idle' }), vi.fn())
    expect(mockMenuBuildFromTemplate).toHaveBeenCalledOnce()
  })
})

// ── Tests: TrayManager ─────────────────────────────────────────────────────────

describe('TrayManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── init() ──────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('creates a Tray instance', () => {
      const tray = makeTray()
      tray.init()
      expect(MockTrayClass).toHaveBeenCalledOnce()
    })

    it('passes a NativeImage to the Tray constructor', () => {
      const tray = makeTray()
      tray.init()
      expect(mockNativeImageCreateFromBuffer).toHaveBeenCalled()
      const img = mockNativeImageCreateFromBuffer.mock.results[0].value
      expect(MockTrayClass).toHaveBeenCalledWith(img)
    })

    it('sets initial tooltip to "gsd-tau"', () => {
      const tray = makeTray()
      tray.init()
      expect(mockTraySetToolTip).toHaveBeenCalledWith('gsd-tau')
    })

    it('sets an initial context menu with only a Quit item (empty sessions)', () => {
      const tray = makeTray()
      tray.init()
      const template = lastTemplate()
      expect(template).toHaveLength(1)
      expect(template[0].label).toBe('Quit')
    })
  })

  // ── update() — icon selection ────────────────────────────────────────────────

  describe('update() icon selection', () => {
    it('calls setImage when updating with an Idle session', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ a: 'Idle' }))
      expect(mockTraySetImage).toHaveBeenCalledOnce()
    })

    it('calls setImage for each state (one call per update)', () => {
      const tray = makeTray()
      tray.init()

      for (const state of ['Working', 'Waiting', 'Stopped', 'Idle'] as SessionState[]) {
        vi.clearAllMocks()
        tray.update(sessionsFrom({ a: state }))
        expect(mockTraySetImage).toHaveBeenCalledOnce()
      }
    })

    it('creates different RGBA buffers for different aggregate states', () => {
      const tray = makeTray()
      tray.init()

      vi.clearAllMocks()
      tray.update(sessionsFrom({ a: 'Waiting' }))
      const waitingCallArgs = mockNativeImageCreateFromBuffer.mock.calls.at(-1)!

      vi.clearAllMocks()
      tray.update(sessionsFrom({ a: 'Working' }))
      const workingCallArgs = mockNativeImageCreateFromBuffer.mock.calls.at(-1)!

      // Both calls use 16×16 size.
      expect(waitingCallArgs[1]).toEqual({ width: 16, height: 16 })
      expect(workingCallArgs[1]).toEqual({ width: 16, height: 16 })

      // Buffers differ between states (different colour fills).
      expect(waitingCallArgs[0]).not.toEqual(workingCallArgs[0])
    })

    it('does not call setImage if init() was not called', () => {
      const tray = makeTray()
      tray.update(sessionsFrom({ a: 'Working' }))
      expect(mockTraySetImage).not.toHaveBeenCalled()
    })
  })

  // ── update() — tooltip ───────────────────────────────────────────────────────

  describe('update() tooltip', () => {
    it('sets "gsd-tau" tooltip for empty sessions', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.update(new Map())
      expect(mockTraySetToolTip).toHaveBeenCalledWith('gsd-tau')
    })

    it('sets session count in tooltip for one Working session', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ 'my-proj': 'Working' }))
      expect(mockTraySetToolTip).toHaveBeenCalledWith('gsd-tau — 1 session')
    })

    it('includes waiting count in tooltip when sessions are Waiting', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ a: 'Waiting', b: 'Working' }))
      expect(mockTraySetToolTip).toHaveBeenCalledWith('gsd-tau — 2 sessions (1 waiting)')
    })
  })

  // ── update() — context menu ──────────────────────────────────────────────────

  describe('update() context menu', () => {
    it('rebuilds context menu with session items on each update', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ 'proj-a': 'Working', 'proj-b': 'Idle' }))
      expect(mockTraySetContextMenu).toHaveBeenCalledOnce()
      const template = lastTemplate()
      expect(template).toHaveLength(4) // 2 sessions + separator + Quit
    })

    it('shows Waiting session with "●" emoji in menu', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ 'api-work': 'Waiting' }))
      expect(lastTemplate()[0].label).toBe('● api-work (Waiting)')
    })

    it('shows Stopped session with "✕" emoji in menu', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ 'crashed': 'Stopped' }))
      expect(lastTemplate()[0].label).toBe('✕ crashed (Stopped)')
    })
  })

  // ── update() — debounce / scheduling ────────────────────────────────────────

  describe('update() scheduling', () => {
    it('applies the update synchronously when schedule is (fn) => fn()', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ a: 'Working' }))
      // With sync schedule, setContextMenu was called immediately.
      expect(mockTraySetContextMenu).toHaveBeenCalledOnce()
    })

    it('coalesces two rapid calls into one setContextMenu invocation', () => {
      let capturedFn: (() => void) | undefined
      const captureSchedule = (fn: () => void) => { capturedFn = fn }

      const tray = new TrayManager(vi.fn(), { schedule: captureSchedule })
      tray.init()

      // init() uses _applyUpdate directly (no schedule), so reset mocks now.
      vi.clearAllMocks()

      tray.update(sessionsFrom({ a: 'Working' }))  // schedules fn (1st call)
      tray.update(sessionsFrom({ a: 'Waiting' }))  // second call: no new schedule

      // Nothing applied yet — schedule hasn't fired.
      expect(mockTraySetContextMenu).not.toHaveBeenCalled()

      // Flush the single scheduled callback.
      capturedFn!()

      // Only one setContextMenu call.
      expect(mockTraySetContextMenu).toHaveBeenCalledOnce()
    })

    it('applies the LAST (not the first) pending update when coalesced', () => {
      let capturedFn: (() => void) | undefined
      const captureSchedule = (fn: () => void) => { capturedFn = fn }

      const tray = new TrayManager(vi.fn(), { schedule: captureSchedule })
      tray.init()
      vi.clearAllMocks()

      tray.update(sessionsFrom({ a: 'Working' }))  // first call
      tray.update(sessionsFrom({ a: 'Waiting' }))  // second — should win

      capturedFn!()

      // Tooltip reflects the last update (Waiting with 1 session).
      expect(mockTraySetToolTip).toHaveBeenCalledWith('gsd-tau — 1 session (1 waiting)')
    })

    it('schedules a new callback after the first batch is flushed', () => {
      let scheduleCount = 0
      let capturedFn: (() => void) | undefined
      const trackingSchedule = (fn: () => void) => {
        scheduleCount++
        capturedFn = fn
      }

      const tray = new TrayManager(vi.fn(), { schedule: trackingSchedule })
      tray.init()
      vi.clearAllMocks()

      tray.update(sessionsFrom({ a: 'Working' }))
      capturedFn!()  // flush first batch

      tray.update(sessionsFrom({ a: 'Idle' }))  // should schedule a second batch
      capturedFn!()  // flush second batch

      expect(scheduleCount).toBe(2)
      expect(mockTraySetContextMenu).toHaveBeenCalledTimes(2)
    })

    it('is a no-op when _tray is null (before init)', () => {
      let capturedFn: (() => void) | undefined
      const captureSchedule = (fn: () => void) => { capturedFn = fn }

      const tray = new TrayManager(vi.fn(), { schedule: captureSchedule })
      // init() NOT called
      tray.update(sessionsFrom({ a: 'Working' }))
      capturedFn!()

      expect(MockTrayClass).not.toHaveBeenCalled()
      expect(mockTraySetContextMenu).not.toHaveBeenCalled()
    })
  })

  // ── destroy() ───────────────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('calls tray.destroy() on the Electron Tray instance', () => {
      const tray = makeTray()
      tray.init()
      vi.clearAllMocks()
      tray.destroy()
      expect(mockTrayDestroy).toHaveBeenCalledOnce()
    })

    it('is a no-op before init() (does not throw)', () => {
      const tray = makeTray()
      expect(() => tray.destroy()).not.toThrow()
      expect(mockTrayDestroy).not.toHaveBeenCalled()
    })

    it('is a no-op on the second call (does not double-destroy)', () => {
      const tray = makeTray()
      tray.init()
      tray.destroy()
      vi.clearAllMocks()
      tray.destroy()
      expect(mockTrayDestroy).not.toHaveBeenCalled()
    })

    it('prevents further updates from applying after destroy', () => {
      const tray = makeTray()
      tray.init()
      tray.destroy()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ a: 'Working' }))
      expect(mockTraySetContextMenu).not.toHaveBeenCalled()
      expect(mockTraySetImage).not.toHaveBeenCalled()
    })
  })

  // ── onFocusWindow callback ───────────────────────────────────────────────────

  describe('onFocusWindow callback', () => {
    it('is passed through to session menu items and fires on click', () => {
      const onFocus = vi.fn()
      const tray = new TrayManager(onFocus, { schedule: (fn) => fn() })
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ 'my-proj': 'Idle' }))
      const template = lastTemplate()
      // First item is the session row.
      template[0].click!()
      expect(onFocus).toHaveBeenCalledOnce()
    })

    it('is not called by the Quit menu item', () => {
      const onFocus = vi.fn()
      const tray = new TrayManager(onFocus, { schedule: (fn) => fn() })
      tray.init()
      vi.clearAllMocks()
      tray.update(sessionsFrom({ 'my-proj': 'Idle' }))
      const template = lastTemplate()
      const quitItem = template.at(-1)!
      expect(quitItem.label).toBe('Quit')
      quitItem.click!()
      expect(onFocus).not.toHaveBeenCalled()
    })
  })

  // ── full aggregate state round-trips ────────────────────────────────────────

  describe('full state round-trips', () => {
    it('Waiting (red) → Working (blue) → Idle (grey) via sequential updates', () => {
      const tray = makeTray()
      tray.init()

      vi.clearAllMocks()
      tray.update(sessionsFrom({ a: 'Waiting' }))
      const waitingBuf = mockNativeImageCreateFromBuffer.mock.calls.at(-1)![0] as Buffer
      const r_waiting = waitingBuf[0]
      const g_waiting = waitingBuf[1]

      vi.clearAllMocks()
      tray.update(sessionsFrom({ a: 'Working' }))
      const workingBuf = mockNativeImageCreateFromBuffer.mock.calls.at(-1)![0] as Buffer
      const r_working = workingBuf[0]
      const g_working = workingBuf[1]

      vi.clearAllMocks()
      tray.update(new Map())
      const idleBuf = mockNativeImageCreateFromBuffer.mock.calls.at(-1)![0] as Buffer
      const r_idle = idleBuf[0]

      // Waiting = red (high R, low G), Working = blue (low R), Idle = grey.
      expect(r_waiting).toBeGreaterThan(r_working) // red > blue in R channel
      expect(g_waiting).toBeLessThan(g_working)    // red has less green than blue
      expect(r_idle).toBe(128)                      // grey = 128 in all channels
    })

    it('tooltip reverts to bare "gsd-tau" after all sessions close', () => {
      const tray = makeTray()
      tray.init()
      tray.update(sessionsFrom({ a: 'Working' }))
      vi.clearAllMocks()
      tray.update(new Map())
      expect(mockTraySetToolTip).toHaveBeenCalledWith('gsd-tau')
    })
  })
})

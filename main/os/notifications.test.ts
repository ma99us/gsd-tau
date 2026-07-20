/**
 * Unit tests for main/os/notifications.ts
 *
 * Mocks electron (Notification, app, BrowserWindow) so the debounce logic,
 * toast construction, and click handler can be exercised in plain Node without
 * starting Electron.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { showBlockerToast, _resetDebounce } from './notifications'

// ── Electron mock ──────────────────────────────────────────────────────────────
// vi.hoisted ensures these refs are created before the vi.mock factory runs,
// making them accessible from both the factory and the test body.

const {
  mockNotificationOn,
  mockNotificationShow,
  MockNotificationClass,
  mockIsSupported,
  mockAppFocus,
  mockGetAllWindows,
} = vi.hoisted(() => {
  const mockNotificationOn = vi.fn()
  const mockNotificationShow = vi.fn()
  const mockIsSupported = vi.fn().mockReturnValue(true)

  // vi.fn() acting as a constructor; each call returns the same shared instance
  // stubs so tests can inspect calls via mockNotificationOn / mockNotificationShow.
  const MockNotificationClass = vi.fn().mockImplementation(() => ({
    on: mockNotificationOn,
    show: mockNotificationShow,
  }))
  // Attach the static method after construction (TypeScript-safe via any cast).
  ;(MockNotificationClass as unknown as { isSupported: typeof mockIsSupported }).isSupported =
    mockIsSupported

  const mockAppFocus = vi.fn()
  const mockGetAllWindows = vi.fn()

  return {
    mockNotificationOn,
    mockNotificationShow,
    MockNotificationClass,
    mockIsSupported,
    mockAppFocus,
    mockGetAllWindows,
  }
})

vi.mock('electron', () => ({
  Notification: MockNotificationClass,
  app: { focus: mockAppFocus },
  BrowserWindow: { getAllWindows: mockGetAllWindows },
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Retrieve the handler registered via notification.on('click', handler). */
function getClickHandler(): (() => void) | undefined {
  const clickCall = mockNotificationOn.mock.calls.find(
    (c: unknown[]) => c[0] === 'click',
  )
  return clickCall?.[1] as (() => void) | undefined
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('showBlockerToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetDebounce()
    // Default: Notification is supported and one window is open.
    mockIsSupported.mockReturnValue(true)
    mockGetAllWindows.mockReturnValue([{ show: vi.fn() }])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('creates a Notification with the correct title and body', () => {
    showBlockerToast('my-project', 'confirm')
    expect(MockNotificationClass).toHaveBeenCalledOnce()
    expect(MockNotificationClass).toHaveBeenCalledWith({
      title: 'gsd-tau needs input',
      body: 'my-project: confirm',
    })
  })

  it('registers a click listener and calls show() on the notification', () => {
    showBlockerToast('my-project', 'confirm')
    expect(mockNotificationOn).toHaveBeenCalledWith('click', expect.any(Function))
    expect(mockNotificationShow).toHaveBeenCalledOnce()
  })

  it('renders the session name and method in the body', () => {
    showBlockerToast('api-refactor', 'select')
    expect(MockNotificationClass).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'api-refactor: select' }),
    )
  })

  // ── Debounce ─────────────────────────────────────────────────────────────────

  it('suppresses a second call within 3s for the same session', () => {
    showBlockerToast('my-project', 'confirm')
    showBlockerToast('my-project', 'select') // should be debounced
    expect(MockNotificationClass).toHaveBeenCalledOnce()
  })

  it('allows a second toast for a different session within the debounce window', () => {
    showBlockerToast('project-a', 'confirm')
    showBlockerToast('project-b', 'select')
    expect(MockNotificationClass).toHaveBeenCalledTimes(2)
  })

  it('allows a second toast after the 3s debounce window has elapsed', () => {
    vi.useFakeTimers()
    showBlockerToast('my-project', 'confirm')
    vi.advanceTimersByTime(3_001)
    showBlockerToast('my-project', 'select')
    expect(MockNotificationClass).toHaveBeenCalledTimes(2)
  })

  it('still debounces a call 1ms before the window expires', () => {
    vi.useFakeTimers()
    showBlockerToast('my-project', 'confirm')
    vi.advanceTimersByTime(2_999)
    showBlockerToast('my-project', 'select')
    expect(MockNotificationClass).toHaveBeenCalledOnce()
  })

  it('each session has its own independent debounce timer', () => {
    vi.useFakeTimers()
    showBlockerToast('session-a', 'confirm')
    vi.advanceTimersByTime(1_500)
    showBlockerToast('session-b', 'select') // different session — should fire
    vi.advanceTimersByTime(1_500)
    showBlockerToast('session-a', 'input') // session-a: 3000ms elapsed — should fire
    vi.advanceTimersByTime(1_500)
    showBlockerToast('session-b', 'editor') // session-b: 3000ms elapsed — should fire

    expect(MockNotificationClass).toHaveBeenCalledTimes(4)
  })

  // ── Platform guard ──────────────────────────────────────────────────────────

  it('skips toast creation when Notification.isSupported() returns false', () => {
    mockIsSupported.mockReturnValue(false)
    showBlockerToast('my-project', 'confirm')
    expect(MockNotificationClass).not.toHaveBeenCalled()
    expect(mockNotificationShow).not.toHaveBeenCalled()
  })

  it('still advances the debounce timer even when isSupported is false', () => {
    vi.useFakeTimers()
    mockIsSupported.mockReturnValue(false)
    showBlockerToast('my-project', 'confirm')
    // Debounce timestamp was set — second call within window is also suppressed.
    mockIsSupported.mockReturnValue(true)
    showBlockerToast('my-project', 'select')
    expect(MockNotificationClass).not.toHaveBeenCalled()
  })

  // ── Click handler ───────────────────────────────────────────────────────────

  describe('click handler', () => {
    it('calls win.show() and app.focus({ steal: true }) when clicked', () => {
      const mockWinShow = vi.fn()
      mockGetAllWindows.mockReturnValue([{ show: mockWinShow }])

      showBlockerToast('my-project', 'confirm')
      const clickHandler = getClickHandler()
      expect(clickHandler).toBeDefined()

      clickHandler!()
      expect(mockWinShow).toHaveBeenCalledOnce()
      expect(mockAppFocus).toHaveBeenCalledOnce()
      expect(mockAppFocus).toHaveBeenCalledWith({ steal: true })
    })

    it('calls app.focus() even when no window is open (empty getAllWindows)', () => {
      mockGetAllWindows.mockReturnValue([])

      showBlockerToast('my-project', 'confirm')
      const clickHandler = getClickHandler()
      clickHandler!()

      expect(mockAppFocus).toHaveBeenCalledWith({ steal: true })
    })

    it('calls win.show() on only the first window when multiple windows exist', () => {
      const mockWinShow1 = vi.fn()
      const mockWinShow2 = vi.fn()
      mockGetAllWindows.mockReturnValue([{ show: mockWinShow1 }, { show: mockWinShow2 }])

      showBlockerToast('my-project', 'confirm')
      getClickHandler()!()

      expect(mockWinShow1).toHaveBeenCalledOnce()
      expect(mockWinShow2).not.toHaveBeenCalled()
    })
  })
})

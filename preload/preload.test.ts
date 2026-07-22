/**
 * Unit tests for preload/preload.ts
 *
 * Mocks electron (contextBridge + ipcRenderer) so the preload bridge logic
 * can be exercised in plain Node/Vitest without starting Electron.
 *
 * Structure
 * ─────────
 * 1. "module registration" — verifies the side effect at module load time:
 *    contextBridge.exposeInMainWorld('gsd', ...) was called with the correct shape.
 *    These tests must run before any vi.clearAllMocks() so the initial
 *    call record is intact.
 *
 * 2. "createGsdApi" — exercises every method on the API factory.
 *    beforeEach calls vi.clearAllMocks() and createGsdApi() to ensure a
 *    clean slate for every test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionId } from '../shared/types'

// ── Mock electron BEFORE any import that uses it ──────────────────────────────
// vi.mock is hoisted above all imports by Vitest's transform.  The factory
// therefore executes before the module-level `const mockX = vi.fn()` lines
// (which would be in the temporal dead zone at that point).
//
// Solution: vi.hoisted() runs its callback before vi.mock factories, so the
// returned values are initialised and available when the factory executes.
const { mockInvoke, mockOn, mockOff, mockExposeInMainWorld } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockExposeInMainWorld: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    off: mockOff,
  },
}))

// Import AFTER mock registration — this triggers the module side effect
// (contextBridge.exposeInMainWorld) exactly once.
import { createGsdApi } from './preload'

// ─────────────────────────────────────────────────────────────────────────────

const SESSION_ID: SessionId = 's_test_abc123'

// ── 1. Module registration ────────────────────────────────────────────────────
// These tests validate the one-time side effect at module load time.
// They MUST appear before the describe block that calls vi.clearAllMocks().
describe('module registration', () => {
  it('calls contextBridge.exposeInMainWorld("gsd", ...) at load time', () => {
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('gsd', expect.any(Object))
  })

  it('exposes all six required GsdApi methods', () => {
    const exposed = mockExposeInMainWorld.mock.calls[0][1]
    expect(exposed).toMatchObject({
      openProject: expect.any(Function),
      prompt: expect.any(Function),
      abort: expect.any(Function),
      getState: expect.any(Function),
      onEvent: expect.any(Function),
      onStateChange: expect.any(Function),
    })
  })

  it('does NOT expose ipcRenderer directly (no raw IPC access for renderer)', () => {
    const exposed = mockExposeInMainWorld.mock.calls[0][1]
    expect(exposed).not.toHaveProperty('ipcRenderer')
    expect(exposed).not.toHaveProperty('invoke')
    expect(exposed).not.toHaveProperty('on')
    expect(exposed).not.toHaveProperty('off')
  })
})

// ── 2. createGsdApi method tests ──────────────────────────────────────────────

describe('createGsdApi', () => {
  let api: ReturnType<typeof createGsdApi>

  beforeEach(() => {
    vi.clearAllMocks()
    api = createGsdApi()
  })

  // ── openProject ─────────────────────────────────────────────────────────────

  describe('openProject', () => {
    it('invokes the openProject channel with the provided cwd', async () => {
      mockInvoke.mockResolvedValue(SESSION_ID)
      await api.openProject('/my/project')
      expect(mockInvoke).toHaveBeenCalledWith('openProject', '/my/project')
    })

    it('returns the sessionId resolved by ipcRenderer.invoke', async () => {
      mockInvoke.mockResolvedValue('s_returned')
      const result = await api.openProject('/proj')
      expect(result).toBe('s_returned')
    })

    it('propagates IPC rejection to the caller', async () => {
      mockInvoke.mockRejectedValue(new Error('pi spawn failed'))
      await expect(api.openProject('/bad')).rejects.toThrow('pi spawn failed')
    })
  })

  // ── prompt ───────────────────────────────────────────────────────────────────

  describe('prompt', () => {
    it('invokes the prompt channel with sessionId and text', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await api.prompt(SESSION_ID, 'hello world')
      expect(mockInvoke).toHaveBeenCalledWith('prompt', SESSION_ID, 'hello world')
    })

    it('resolves to void on success', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await expect(api.prompt(SESSION_ID, 'hi')).resolves.toBeUndefined()
    })

    it('propagates IPC rejection (unknown session) to the caller', async () => {
      mockInvoke.mockRejectedValue(new Error("session not found: 's_bad'"))
      await expect(api.prompt('s_bad' as SessionId, 'text')).rejects.toThrow(
        "session not found: 's_bad'",
      )
    })
  })

  // ── abort ────────────────────────────────────────────────────────────────────

  describe('abort', () => {
    it('invokes the abort channel with sessionId', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await api.abort(SESSION_ID)
      expect(mockInvoke).toHaveBeenCalledWith('abort', SESSION_ID)
    })

    it('resolves to void on success', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await expect(api.abort(SESSION_ID)).resolves.toBeUndefined()
    })

    it('propagates IPC rejection to the caller', async () => {
      mockInvoke.mockRejectedValue(new Error('abort failed'))
      await expect(api.abort(SESSION_ID)).rejects.toThrow('abort failed')
    })
  })

  // ── getState ──────────────────────────────────────────────────────────────────

  describe('getState', () => {
    it('invokes the getState channel with sessionId', async () => {
      mockInvoke.mockResolvedValue('Idle')
      await api.getState(SESSION_ID)
      expect(mockInvoke).toHaveBeenCalledWith('getState', SESSION_ID)
    })

    it('returns the state value resolved by ipcRenderer.invoke', async () => {
      mockInvoke.mockResolvedValue('Working')
      const result = await api.getState(SESSION_ID)
      expect(result).toBe('Working')
    })

    it('propagates IPC rejection for unknown sessions', async () => {
      mockInvoke.mockRejectedValue(new Error("getState: unknown session 's_bad'"))
      await expect(api.getState('s_bad' as SessionId)).rejects.toThrow(
        "getState: unknown session 's_bad'",
      )
    })
  })

  // ── setThinkingLevel ──────────────────────────────────────────────────────────

  describe('setThinkingLevel', () => {
    it('invokes the setThinkingLevel channel with sessionId and level', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await api.setThinkingLevel(SESSION_ID, 'high')
      expect(mockInvoke).toHaveBeenCalledWith('setThinkingLevel', SESSION_ID, 'high')
    })

    it('resolves to void on success', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await expect(api.setThinkingLevel(SESSION_ID, 'medium')).resolves.toBeUndefined()
    })

    it('resolves to null when the handler returns null (unknown session or error signal)', async () => {
      // The main-process handler returns null on error; the preload passes it through.
      mockInvoke.mockResolvedValue(null)
      const result = await api.setThinkingLevel(SESSION_ID, 'high')
      expect(result).toBeNull()
    })

    it('propagates IPC rejection to the caller', async () => {
      mockInvoke.mockRejectedValue(new Error('IPC transport error'))
      await expect(api.setThinkingLevel(SESSION_ID, 'max')).rejects.toThrow(
        'IPC transport error',
      )
    })
  })

  // ── onEvent ───────────────────────────────────────────────────────────────────

  describe('onEvent', () => {
    it('registers a listener on the session:event channel', () => {
      api.onEvent(SESSION_ID, vi.fn())
      expect(mockOn).toHaveBeenCalledWith('session:event', expect.any(Function))
    })

    it('returns a function (unsubscribe)', () => {
      const unsubscribe = api.onEvent(SESSION_ID, vi.fn())
      expect(typeof unsubscribe).toBe('function')
    })

    it('calls callback when event payload sessionId matches', () => {
      const cb = vi.fn()
      api.onEvent(SESSION_ID, cb)

      const listener = mockOn.mock.calls[0][1]
      const event = { type: 'text_delta', text: 'hello' }
      listener({}, { sessionId: SESSION_ID, event })

      expect(cb).toHaveBeenCalledWith(event)
    })

    it('does NOT call callback when sessionId does not match', () => {
      const cb = vi.fn()
      api.onEvent(SESSION_ID, cb)

      const listener = mockOn.mock.calls[0][1]
      listener({}, { sessionId: 's_other', event: { type: 'text_delta' } })

      expect(cb).not.toHaveBeenCalled()
    })

    it('unsubscribe calls ipcRenderer.off with the exact registered listener', () => {
      const unsubscribe = api.onEvent(SESSION_ID, vi.fn())
      const registeredListener = mockOn.mock.calls[0][1]

      unsubscribe()

      expect(mockOff).toHaveBeenCalledWith('session:event', registeredListener)
    })

    it('unsubscribe is idempotent (safe to call multiple times)', () => {
      const unsubscribe = api.onEvent(SESSION_ID, vi.fn())
      expect(() => {
        unsubscribe()
        unsubscribe()
      }).not.toThrow()
    })

    it('two subscriptions for different sessions do not interfere', () => {
      const cbA = vi.fn()
      const cbB = vi.fn()
      api.onEvent('s_a' as SessionId, cbA)
      api.onEvent('s_b' as SessionId, cbB)

      const listenerA = mockOn.mock.calls[0][1]
      const listenerB = mockOn.mock.calls[1][1]

      const ev = { type: 'agent_end' }

      // s_a event triggers only cbA
      listenerA({}, { sessionId: 's_a', event: ev })
      expect(cbA).toHaveBeenCalledTimes(1)
      expect(cbB).not.toHaveBeenCalled()

      cbA.mockClear()

      // s_b event triggers only cbB
      listenerB({}, { sessionId: 's_b', event: ev })
      expect(cbB).toHaveBeenCalledTimes(1)
      expect(cbA).not.toHaveBeenCalled()
    })

    it('unsubscribing one session does not affect another', () => {
      const cbA = vi.fn()
      const cbB = vi.fn()
      const unsubA = api.onEvent('s_a' as SessionId, cbA)
      api.onEvent('s_b' as SessionId, cbB)

      const listenerA = mockOn.mock.calls[0][1]
      unsubA()

      // Only s_a's listener should be removed
      expect(mockOff).toHaveBeenCalledTimes(1)
      expect(mockOff).toHaveBeenCalledWith('session:event', listenerA)
    })

    it('forwards the full event object to the callback', () => {
      const cb = vi.fn()
      api.onEvent(SESSION_ID, cb)

      const listener = mockOn.mock.calls[0][1]
      const richEvent = { type: 'tool_use', toolName: 'read', input: { path: '/x' } }
      listener({}, { sessionId: SESSION_ID, event: richEvent })

      expect(cb).toHaveBeenCalledWith(richEvent)
    })
  })

  // ── onStateChange ─────────────────────────────────────────────────────────────

  describe('onStateChange', () => {
    it('registers a listener on the session:state-change channel', () => {
      api.onStateChange(SESSION_ID, vi.fn())
      expect(mockOn).toHaveBeenCalledWith('session:state-change', expect.any(Function))
    })

    it('returns a function (unsubscribe)', () => {
      const unsubscribe = api.onStateChange(SESSION_ID, vi.fn())
      expect(typeof unsubscribe).toBe('function')
    })

    it('calls callback with state when sessionId matches', () => {
      const cb = vi.fn()
      api.onStateChange(SESSION_ID, cb)

      const listener = mockOn.mock.calls[0][1]
      listener({}, { sessionId: SESSION_ID, state: 'Working' })

      expect(cb).toHaveBeenCalledWith('Working')
    })

    it('does NOT call callback when sessionId does not match', () => {
      const cb = vi.fn()
      api.onStateChange(SESSION_ID, cb)

      const listener = mockOn.mock.calls[0][1]
      listener({}, { sessionId: 's_other', state: 'Idle' })

      expect(cb).not.toHaveBeenCalled()
    })

    it('unsubscribe calls ipcRenderer.off with the exact registered listener', () => {
      const unsubscribe = api.onStateChange(SESSION_ID, vi.fn())
      const registeredListener = mockOn.mock.calls[0][1]

      unsubscribe()

      expect(mockOff).toHaveBeenCalledWith('session:state-change', registeredListener)
    })

    it('unsubscribe is idempotent (safe to call multiple times)', () => {
      const unsubscribe = api.onStateChange(SESSION_ID, vi.fn())
      expect(() => {
        unsubscribe()
        unsubscribe()
      }).not.toThrow()
    })

    it('two subscriptions for different sessions do not interfere', () => {
      const cbA = vi.fn()
      const cbB = vi.fn()
      api.onStateChange('s_a' as SessionId, cbA)
      api.onStateChange('s_b' as SessionId, cbB)

      const listenerA = mockOn.mock.calls[0][1]
      const listenerB = mockOn.mock.calls[1][1]

      // s_b state change triggers only cbB
      listenerB({}, { sessionId: 's_b', state: 'Stopped' })
      expect(cbB).toHaveBeenCalledWith('Stopped')
      expect(cbA).not.toHaveBeenCalled()

      // s_a state change triggers only cbA
      cbB.mockClear()
      listenerA({}, { sessionId: 's_a', state: 'Idle' })
      expect(cbA).toHaveBeenCalledWith('Idle')
      expect(cbB).not.toHaveBeenCalled()
    })

    it('delivers each distinct state value correctly', () => {
      const cb = vi.fn()
      api.onStateChange(SESSION_ID, cb)
      const listener = mockOn.mock.calls[0][1]

      for (const state of ['Working', 'Idle', 'Stopped'] as const) {
        listener({}, { sessionId: SESSION_ID, state })
      }

      expect(cb).toHaveBeenNthCalledWith(1, 'Working')
      expect(cb).toHaveBeenNthCalledWith(2, 'Idle')
      expect(cb).toHaveBeenNthCalledWith(3, 'Stopped')
    })
  })

  // ── getProgress ────────────────────────────────────────────────────────────────

  describe('getProgress', () => {
    it('invokes the getProgress channel with sessionId', async () => {
      mockInvoke.mockResolvedValue(null)
      await api.getProgress(SESSION_ID)
      expect(mockInvoke).toHaveBeenCalledWith('getProgress', SESSION_ID)
    })

    it('returns the GsdProgress snapshot from ipcRenderer.invoke', async () => {
      const snapshot = {
        milestone: null,
        currentSliceId: null,
        currentTaskId: null,
        lastToolAt: null,
      }
      mockInvoke.mockResolvedValue(snapshot)
      const result = await api.getProgress(SESSION_ID)
      expect(result).toEqual(snapshot)
    })

    it('returns null when the session is unknown', async () => {
      mockInvoke.mockResolvedValue(null)
      const result = await api.getProgress(SESSION_ID)
      expect(result).toBeNull()
    })
  })

  // ── onProgressUpdate ────────────────────────────────────────────────────────

  describe('onProgressUpdate', () => {
    it('registers a listener on the session:progress-update channel', () => {
      api.onProgressUpdate(SESSION_ID, vi.fn())
      expect(mockOn).toHaveBeenCalledWith('session:progress-update', expect.any(Function))
    })

    it('returns an unsubscribe function', () => {
      const unsubscribe = api.onProgressUpdate(SESSION_ID, vi.fn())
      expect(typeof unsubscribe).toBe('function')
    })

    it('calls callback when sessionId matches', () => {
      const cb = vi.fn()
      api.onProgressUpdate(SESSION_ID, cb)

      const listener = mockOn.mock.calls[0][1]
      const progress = {
        milestone: null,
        currentSliceId: null,
        currentTaskId: null,
        lastToolAt: null,
      }
      listener({}, { sessionId: SESSION_ID, progress })

      expect(cb).toHaveBeenCalledWith(progress)
    })

    it('does NOT call callback when sessionId does not match', () => {
      const cb = vi.fn()
      api.onProgressUpdate(SESSION_ID, cb)

      const listener = mockOn.mock.calls[0][1]
      listener({}, { sessionId: 's_other', progress: {} })

      expect(cb).not.toHaveBeenCalled()
    })

    it('unsubscribe calls ipcRenderer.off with the exact registered listener', () => {
      const unsubscribe = api.onProgressUpdate(SESSION_ID, vi.fn())
      const registeredListener = mockOn.mock.calls[0][1]

      unsubscribe()

      expect(mockOff).toHaveBeenCalledWith('session:progress-update', registeredListener)
    })

    it('unsubscribe is idempotent', () => {
      const unsubscribe = api.onProgressUpdate(SESSION_ID, vi.fn())
      expect(() => {
        unsubscribe()
        unsubscribe()
      }).not.toThrow()
    })
  })

  // ── openRoadmap ──────────────────────────────────────────────────────────────

  describe('openRoadmap', () => {
    it('invokes the openRoadmap channel with sessionId', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await api.openRoadmap(SESSION_ID)
      expect(mockInvoke).toHaveBeenCalledWith('openRoadmap', SESSION_ID)
    })

    it('resolves to void on success', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await expect(api.openRoadmap(SESSION_ID)).resolves.toBeUndefined()
    })

    it('propagates IPC rejection to the caller', async () => {
      mockInvoke.mockRejectedValue(new Error('shell.openPath failed'))
      await expect(api.openRoadmap(SESSION_ID)).rejects.toThrow('shell.openPath failed')
    })
  })
})

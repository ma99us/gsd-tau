/**
 * Unit tests for main/ipc/handlers.ts
 *
 * Mocks electron (ipcMain + webContents) and a fake SessionManager so the
 * handler logic can be exercised in plain Node without starting Electron.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { SessionId } from '../../shared/types'
import { IPC, PUSH, registerHandlers } from './handlers'

// ── Mock electron ──────────────────────────────────────────────────────────────
// vi.mock is hoisted to before all imports by Vitest's transform; the factory
// runs at module-init time and only needs to return static vi.fn() stubs.
// Real implementations are wired up per-test in beforeEach.
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  webContents: {
    getAllWebContents: vi.fn(),
  },
}))

import { ipcMain, webContents as electronWc } from 'electron'

// ── Helpers ────────────────────────────────────────────────────────────────────

type IpcHandler = (event: null, ...args: unknown[]) => unknown

/** Minimal mock SessionHandle — just an EventEmitter with a sessionId. */
class MockHandle extends EventEmitter {
  readonly sessionId: SessionId
  constructor(id: SessionId = 's_test123abc') {
    super()
    this.sessionId = id
  }
}

function makeMockWc(destroyed = false) {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(destroyed),
  }
}

/** Cast mock for `electronWc` to access its mocked getAllWebContents. */
type WcMock = { getAllWebContents: ReturnType<typeof vi.fn> }
/** Cast mock for `ipcMain` to access its mocked handle/removeHandler. */
type IpcMock = { handle: ReturnType<typeof vi.fn>; removeHandler: ReturnType<typeof vi.fn> }

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('registerHandlers', () => {
  let capturedHandlers: Map<string, IpcHandler>
  let mockHandle: MockHandle
  let mockWcList: Array<ReturnType<typeof makeMockWc>>
  let manager: {
    open: ReturnType<typeof vi.fn>
    prompt: ReturnType<typeof vi.fn>
    abort: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  let cleanup: () => void

  beforeEach(() => {
    // Prevent state-machine watchdog timers from firing during tests.
    vi.useFakeTimers()

    capturedHandlers = new Map()
    mockHandle = new MockHandle()
    mockWcList = [makeMockWc()]

    // Capture handlers registered via ipcMain.handle so tests can invoke them.
    const ipcMock = ipcMain as unknown as IpcMock
    ipcMock.handle.mockImplementation((channel: string, fn: IpcHandler) => {
      capturedHandlers.set(channel, fn)
    })
    ipcMock.removeHandler.mockImplementation((channel: string) => {
      capturedHandlers.delete(channel)
    })

    // Provide mock webContents for fanOut calls.
    ;(electronWc as unknown as WcMock).getAllWebContents.mockReturnValue(mockWcList)

    // Mock SessionManager — only the surface that handlers.ts touches.
    manager = {
      open: vi.fn().mockResolvedValue(mockHandle),
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }

    cleanup = registerHandlers(manager as never)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ── Handler registration ────────────────────────────────────────────────────

  describe('handler registration', () => {
    it('registers handlers for all 4 IPC channels', () => {
      const ipcMock = ipcMain as unknown as IpcMock
      expect(ipcMock.handle).toHaveBeenCalledTimes(4)
      expect(capturedHandlers.has(IPC.OPEN_PROJECT)).toBe(true)
      expect(capturedHandlers.has(IPC.PROMPT)).toBe(true)
      expect(capturedHandlers.has(IPC.ABORT)).toBe(true)
      expect(capturedHandlers.has(IPC.GET_STATE)).toBe(true)
    })
  })

  // ── openProject ─────────────────────────────────────────────────────────────

  describe('openProject', () => {
    it('calls manager.open() with cwd and returns the sessionId', async () => {
      const result = await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/my/project')
      expect(manager.open).toHaveBeenCalledWith('/my/project')
      expect(result).toBe(mockHandle.sessionId)
    })

    it('propagates errors thrown by manager.open()', async () => {
      manager.open.mockRejectedValue(new Error('spawn failed'))
      await expect(
        capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/bad/path'),
      ).rejects.toThrow('spawn failed')
    })

    it('fans out session:event when handle emits event', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      const ev = { type: 'message', text: 'hello' }
      mockHandle.emit('event', ev)
      expect(mockWcList[0].send).toHaveBeenCalledWith(PUSH.SESSION_EVENT, {
        sessionId: mockHandle.sessionId,
        event: ev,
      })
    })

    it('fans out session:event when handle emits transport-error', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      const err = new Error('pipe broken')
      mockHandle.emit('transport-error', { error: err })
      expect(mockWcList[0].send).toHaveBeenCalledWith(PUSH.SESSION_EVENT, {
        sessionId: mockHandle.sessionId,
        event: { type: 'transport-error', error: err },
      })
    })

    it('fans out session:state-change to Working on agent_start', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', { type: 'agent_start' })
      expect(mockWcList[0].send).toHaveBeenCalledWith(PUSH.SESSION_STATE_CHANGE, {
        sessionId: mockHandle.sessionId,
        state: 'Working',
      })
    })

    it('fans out state-change Idle after agent_start then agent_end', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', { type: 'agent_start' })
      mockHandle.emit('event', { type: 'agent_end' })

      const stateChangeCalls = mockWcList[0].send.mock.calls.filter(
        (c) => c[0] === PUSH.SESSION_STATE_CHANGE,
      )
      expect(stateChangeCalls.at(-1)?.[1]).toEqual({
        sessionId: mockHandle.sessionId,
        state: 'Idle',
      })
    })

    it('fans out state-change Stopped on transport-error', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('transport-error', { error: new Error('boom') })

      const stateChangeCalls = mockWcList[0].send.mock.calls.filter(
        (c) => c[0] === PUSH.SESSION_STATE_CHANGE,
      )
      expect(stateChangeCalls).toHaveLength(1)
      expect(stateChangeCalls[0][1]).toEqual({
        sessionId: mockHandle.sessionId,
        state: 'Stopped',
      })
    })

    it('sends to live webContents and skips destroyed ones', async () => {
      const live1 = makeMockWc(false)
      const dead = makeMockWc(true)
      const live2 = makeMockWc(false)
      ;(electronWc as unknown as WcMock).getAllWebContents.mockReturnValue([live1, dead, live2])

      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', { type: 'tool_use' })

      expect(live1.send).toHaveBeenCalled()
      expect(live2.send).toHaveBeenCalled()
      expect(dead.send).not.toHaveBeenCalled()
    })

    it('does not fan out for named handle channels outside event/transport-error', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      // Emit directly on the named channel — handlers only subscribe to 'event'.
      mockHandle.emit('agent_start', { type: 'agent_start' })
      expect(mockWcList[0].send).not.toHaveBeenCalled()
    })
  })

  // ── prompt ──────────────────────────────────────────────────────────────────

  describe('prompt', () => {
    it('delegates to manager.prompt() with sessionId and message', async () => {
      await capturedHandlers.get(IPC.PROMPT)!(null, 's_abc', 'hello world')
      expect(manager.prompt).toHaveBeenCalledWith('s_abc', 'hello world')
    })

    it('propagates errors from manager.prompt()', async () => {
      manager.prompt.mockRejectedValue(new Error("unknown session 's_bad'"))
      await expect(
        capturedHandlers.get(IPC.PROMPT)!(null, 's_bad', 'text'),
      ).rejects.toThrow("unknown session 's_bad'")
    })
  })

  // ── abort ───────────────────────────────────────────────────────────────────

  describe('abort', () => {
    it('delegates to manager.abort() with sessionId', async () => {
      await capturedHandlers.get(IPC.ABORT)!(null, 's_abc')
      expect(manager.abort).toHaveBeenCalledWith('s_abc')
    })

    it('propagates errors from manager.abort()', async () => {
      manager.abort.mockRejectedValue(new Error("abort failed for 's_bad'"))
      await expect(
        capturedHandlers.get(IPC.ABORT)!(null, 's_bad'),
      ).rejects.toThrow("abort failed for 's_bad'")
    })
  })

  // ── getState ─────────────────────────────────────────────────────────────────

  describe('getState', () => {
    it('returns Idle (initial state) for a newly opened session', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      expect(capturedHandlers.get(IPC.GET_STATE)!(null, mockHandle.sessionId)).toBe('Idle')
    })

    it('returns Working after agent_start event', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', { type: 'agent_start' })
      expect(capturedHandlers.get(IPC.GET_STATE)!(null, mockHandle.sessionId)).toBe('Working')
    })

    it('returns Idle after agent_start → agent_end', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', { type: 'agent_start' })
      mockHandle.emit('event', { type: 'agent_end' })
      expect(capturedHandlers.get(IPC.GET_STATE)!(null, mockHandle.sessionId)).toBe('Idle')
    })

    it('returns Stopped after transport-error', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('transport-error', { error: new Error('transport failed') })
      expect(capturedHandlers.get(IPC.GET_STATE)!(null, mockHandle.sessionId)).toBe('Stopped')
    })

    it('throws with a descriptive message for an unknown sessionId', () => {
      expect(() =>
        capturedHandlers.get(IPC.GET_STATE)!(null, 's_unknown'),
      ).toThrow("getState: unknown session 's_unknown'")
    })
  })

  // ── cleanup ──────────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removes all 4 ipcMain handlers', () => {
      const ipcMock = ipcMain as unknown as IpcMock
      cleanup()
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.OPEN_PROJECT)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.PROMPT)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.ABORT)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.GET_STATE)
    })

    it('stops event fan-out after cleanup', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      cleanup()
      mockWcList[0].send.mockClear()

      // After cleanup the 'event' listener should be removed from the handle.
      mockHandle.emit('event', { type: 'message' })
      expect(mockWcList[0].send).not.toHaveBeenCalled()
    })

    it('stops transport-error fan-out after cleanup', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      cleanup()
      mockWcList[0].send.mockClear()

      mockHandle.emit('transport-error', { error: new Error() })
      expect(mockWcList[0].send).not.toHaveBeenCalled()
    })

    it('is safe to call cleanup multiple times without throwing', () => {
      expect(() => {
        cleanup()
        cleanup()
      }).not.toThrow()
    })
  })
})

/**
 * Unit tests for main/ipc/handlers.ts
 *
 * Mocks electron (ipcMain + webContents) and a fake SessionManager so the
 * handler logic can be exercised in plain Node without starting Electron.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { SessionId } from '../../shared/types'
import { IPC, PUSH, registerHandlers, validateUiResponse, parseOpenProjectArg } from './handlers'

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
  readonly sendUIResponse = vi.fn()
  readonly setThinkingLevel = vi.fn().mockResolvedValue(undefined)
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
    registerPreShutdownHook: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    rename: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    getHistorySessionFile: ReturnType<typeof vi.fn>
    updateSessionFile: ReturnType<typeof vi.fn>
    getRpcState: ReturnType<typeof vi.fn>
    getSessionStats: ReturnType<typeof vi.fn>
    listMissingPaths: ReturnType<typeof vi.fn>
    removeMissingPath: ReturnType<typeof vi.fn>
    getAvailableModels: ReturnType<typeof vi.fn>
    setModel: ReturnType<typeof vi.fn>
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
      registerPreShutdownHook: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      rename: vi.fn(),
      resume: vi.fn().mockResolvedValue(undefined),
      getHistorySessionFile: vi.fn().mockReturnValue(undefined),
      updateSessionFile: vi.fn(),
      getRpcState: vi.fn().mockResolvedValue(null),
      getSessionStats: vi.fn().mockResolvedValue(null),
      listMissingPaths: vi.fn().mockReturnValue([]),
      removeMissingPath: vi.fn(),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      setModel: vi.fn().mockResolvedValue(undefined),
    }

    ;({ cleanup } = registerHandlers(manager as never))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ── Handler registration ────────────────────────────────────────────────────

  describe('handler registration', () => {
    it('registers handlers for all 18 IPC channels', () => {
      const ipcMock = ipcMain as unknown as IpcMock
      expect(ipcMock.handle).toHaveBeenCalledTimes(18)
      expect(capturedHandlers.has(IPC.SHOW_FOLDER_PICKER)).toBe(true)
      expect(capturedHandlers.has(IPC.OPEN_PROJECT)).toBe(true)
      expect(capturedHandlers.has(IPC.PROMPT)).toBe(true)
      expect(capturedHandlers.has(IPC.ABORT)).toBe(true)
      expect(capturedHandlers.has(IPC.GET_STATE)).toBe(true)
      expect(capturedHandlers.has(IPC.RESPOND_UI)).toBe(true)
      expect(capturedHandlers.has(IPC.GET_COMMANDS)).toBe(true)
      expect(capturedHandlers.has(IPC.GET_AVAILABLE_MODELS)).toBe(true)
      expect(capturedHandlers.has(IPC.SET_MODEL)).toBe(true)
      expect(capturedHandlers.has(IPC.LIST_SESSIONS)).toBe(true)
      expect(capturedHandlers.has(IPC.CLOSE_SESSION)).toBe(true)
      expect(capturedHandlers.has(IPC.RENAME_SESSION)).toBe(true)
      // Channels added after initial 12:
      expect(capturedHandlers.has(IPC.LIST_MISSING_PATHS)).toBe(true)
      expect(capturedHandlers.has(IPC.REASSIGN_SESSION_CWD)).toBe(true)
      expect(capturedHandlers.has(IPC.SAVE_WINDOW_ACTIVE_TAB)).toBe(true)
      expect(capturedHandlers.has(IPC.GET_RPC_STATE)).toBe(true)
      expect(capturedHandlers.has(IPC.GET_SESSION_STATS)).toBe(true)
      expect(capturedHandlers.has(IPC.SET_THINKING_LEVEL)).toBe(true)
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

    it('auto-acks non-interactive extension_ui_request and does NOT track it', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', {
        type: 'extension_ui_request',
        id: 'req-status-1',
        method: 'setStatus',
        title: 'status',
      })
      // Auto-ack: sendUIResponse called directly
      expect(mockHandle.sendUIResponse).toHaveBeenCalledWith('req-status-1', { value: '' })
      // Not tracked: respondUI returns error for unknown request
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        'req-status-1',
        { value: '' },
      )
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('unknown request') })
    })

    it('fans out session:ui-request-added for interactive extension_ui_request', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockWcList[0].send.mockClear()
      const req = {
        type: 'extension_ui_request',
        id: 'req-c1',
        method: 'confirm',
        title: 'Continue?',
        message: 'Do you want to continue?',
      }
      mockHandle.emit('event', req)
      expect(mockWcList[0].send).toHaveBeenCalledWith(PUSH.SESSION_UI_REQUEST_ADDED, {
        sessionId: mockHandle.sessionId,
        request: req,
      })
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

    it('returns Waiting after an interactive extension_ui_request', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', {
        type: 'extension_ui_request',
        id: 'req-w1',
        method: 'confirm',
        title: 'Continue?',
        message: 'Do you want to continue?',
      })
      expect(capturedHandlers.get(IPC.GET_STATE)!(null, mockHandle.sessionId)).toBe('Waiting')
    })

    it('returns Idle once the last blocker is cleared via respondUI', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', {
        type: 'extension_ui_request',
        id: 'req-w2',
        method: 'confirm',
        title: 'Continue?',
        message: 'Do you want to continue?',
      })
      await capturedHandlers.get(IPC.RESPOND_UI)!(null, mockHandle.sessionId, 'req-w2', {
        confirmed: true,
      })
      expect(capturedHandlers.get(IPC.GET_STATE)!(null, mockHandle.sessionId)).toBe('Idle')
    })

    it('throws with a descriptive message for an unknown sessionId', () => {
      expect(() =>
        capturedHandlers.get(IPC.GET_STATE)!(null, 's_unknown'),
      ).toThrow("getState: unknown session 's_unknown'")
    })
  })

  // ── cleanup ──────────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removes all 18 ipcMain handlers', () => {
      const ipcMock = ipcMain as unknown as IpcMock
      cleanup()
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.SHOW_FOLDER_PICKER)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.OPEN_PROJECT)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.PROMPT)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.ABORT)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.GET_STATE)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.RESPOND_UI)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.GET_COMMANDS)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.GET_AVAILABLE_MODELS)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.SET_MODEL)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.LIST_SESSIONS)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.CLOSE_SESSION)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.RENAME_SESSION)
      // Channels added after initial 12:
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.LIST_MISSING_PATHS)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.REASSIGN_SESSION_CWD)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.SAVE_WINDOW_ACTIVE_TAB)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.GET_RPC_STATE)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.GET_SESSION_STATS)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.SET_THINKING_LEVEL)
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

  // ── validateUiResponse ────────────────────────────────────────────────────────
  //
  // Tests the exported pure function directly; no IPC setup needed.

  describe('validateUiResponse', () => {
    const confirmReq = {
      type: 'extension_ui_request' as const,
      id: 'r1',
      method: 'confirm' as const,
      title: 'T',
      message: 'M',
    }
    const selectReq = {
      type: 'extension_ui_request' as const,
      id: 'r2',
      method: 'select' as const,
      title: 'T',
      options: ['a', 'b'],
    }
    const selectMultiReq = {
      type: 'extension_ui_request' as const,
      id: 'r3',
      method: 'select' as const,
      title: 'T',
      options: ['a', 'b'],
      allowMultiple: true,
    }
    const inputReq = {
      type: 'extension_ui_request' as const,
      id: 'r4',
      method: 'input' as const,
      title: 'T',
    }
    const editorReq = {
      type: 'extension_ui_request' as const,
      id: 'r5',
      method: 'editor' as const,
      title: 'T',
    }

    // Happy paths

    it('accepts { confirmed: true } for confirm', () => {
      expect(validateUiResponse(confirmReq, { confirmed: true })).toEqual({
        ok: true,
        validated: { confirmed: true },
      })
    })

    it('accepts { confirmed: false } for confirm', () => {
      expect(validateUiResponse(confirmReq, { confirmed: false })).toEqual({
        ok: true,
        validated: { confirmed: false },
      })
    })

    it('accepts { value: string } for select (single)', () => {
      expect(validateUiResponse(selectReq, { value: 'a' })).toEqual({
        ok: true,
        validated: { value: 'a' },
      })
    })

    it('accepts { values: string[] } for select (allowMultiple)', () => {
      expect(validateUiResponse(selectMultiReq, { values: ['a', 'b'] })).toEqual({
        ok: true,
        validated: { values: ['a', 'b'] },
      })
    })

    it('accepts empty values array for select (allowMultiple)', () => {
      expect(validateUiResponse(selectMultiReq, { values: [] })).toEqual({
        ok: true,
        validated: { values: [] },
      })
    })

    it('accepts { value: string } for input', () => {
      expect(validateUiResponse(inputReq, { value: 'hello' })).toEqual({
        ok: true,
        validated: { value: 'hello' },
      })
    })

    it('accepts { value: string } for editor', () => {
      expect(validateUiResponse(editorReq, { value: 'content' })).toEqual({
        ok: true,
        validated: { value: 'content' },
      })
    })

    it('accepts cancelled: true for any method', () => {
      expect(validateUiResponse(confirmReq, { cancelled: true })).toEqual({
        ok: true,
        validated: { cancelled: true },
      })
      expect(validateUiResponse(selectReq, { cancelled: true })).toEqual({
        ok: true,
        validated: { cancelled: true },
      })
      expect(validateUiResponse(inputReq, { cancelled: true })).toEqual({
        ok: true,
        validated: { cancelled: true },
      })
    })

    // Negative / validation failures

    it('rejects non-boolean confirmed for confirm', () => {
      expect(validateUiResponse(confirmReq, { confirmed: 'yes' })).toMatchObject({
        ok: false,
        error: expect.stringContaining('confirm'),
      })
    })

    it('rejects missing confirmed for confirm', () => {
      expect(validateUiResponse(confirmReq, { value: 'yes' })).toMatchObject({
        ok: false,
        error: expect.stringContaining('confirm'),
      })
    })

    it('rejects non-string value for select (single)', () => {
      expect(validateUiResponse(selectReq, { value: 42 })).toMatchObject({
        ok: false,
        error: expect.stringContaining('select'),
      })
    })

    it('rejects missing value for select (single)', () => {
      expect(validateUiResponse(selectReq, {})).toMatchObject({
        ok: false,
        error: expect.stringContaining('select'),
      })
    })

    it('rejects { value: string } instead of { values } for select (allowMultiple)', () => {
      expect(validateUiResponse(selectMultiReq, { value: 'a' })).toMatchObject({
        ok: false,
        error: expect.stringContaining('allowMultiple'),
      })
    })

    it('rejects non-string array for select (allowMultiple)', () => {
      expect(validateUiResponse(selectMultiReq, { values: [1, 2] })).toMatchObject({
        ok: false,
        error: expect.stringContaining('allowMultiple'),
      })
    })

    it('rejects non-string value for input', () => {
      expect(validateUiResponse(inputReq, { value: null })).toMatchObject({
        ok: false,
        error: expect.stringContaining('input'),
      })
    })

    it('rejects non-string value for editor', () => {
      expect(validateUiResponse(editorReq, {})).toMatchObject({
        ok: false,
        error: expect.stringContaining('editor'),
      })
    })

    it('rejects null response', () => {
      expect(validateUiResponse(confirmReq, null)).toMatchObject({
        ok: false,
        error: expect.stringContaining('object'),
      })
    })

    it('rejects string response', () => {
      expect(validateUiResponse(confirmReq, 'yes')).toMatchObject({
        ok: false,
        error: expect.stringContaining('object'),
      })
    })

    it('rejects number response', () => {
      expect(validateUiResponse(confirmReq, 42)).toMatchObject({
        ok: false,
        error: expect.stringContaining('object'),
      })
    })
  })

  // ── respondUI ────────────────────────────────────────────────────────────────

  describe('respondUI', () => {
    const confirmReq = {
      type: 'extension_ui_request',
      id: 'req-confirm-1',
      method: 'confirm',
      title: 'Continue?',
      message: 'Do you want to continue?',
    } as const

    const selectReq = {
      type: 'extension_ui_request',
      id: 'req-select-1',
      method: 'select',
      title: 'Choose one',
      options: ['a', 'b'],
    } as const

    const selectMultiReq = {
      type: 'extension_ui_request',
      id: 'req-select-multi-1',
      method: 'select',
      title: 'Choose many',
      options: ['a', 'b', 'c'],
      allowMultiple: true,
    } as const

    const inputReq = {
      type: 'extension_ui_request',
      id: 'req-input-1',
      method: 'input',
      title: 'Enter text',
    } as const

    const editorReq = {
      type: 'extension_ui_request',
      id: 'req-editor-1',
      method: 'editor',
      title: 'Edit content',
    } as const

    beforeEach(async () => {
      // Open a project so a session is registered.
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
    })

    // Happy paths

    it('forwards { confirmed: true } for a confirm request', async () => {
      mockHandle.emit('event', confirmReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        confirmReq.id,
        { confirmed: true },
      )
      expect(result).toEqual({ ok: true })
      expect(mockHandle.sendUIResponse).toHaveBeenCalledWith(confirmReq.id, { confirmed: true })
    })

    it('forwards { confirmed: false } for a confirm request', async () => {
      mockHandle.emit('event', confirmReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        confirmReq.id,
        { confirmed: false },
      )
      expect(result).toEqual({ ok: true })
      expect(mockHandle.sendUIResponse).toHaveBeenCalledWith(confirmReq.id, { confirmed: false })
    })

    it('forwards { value } for a select (single) request', async () => {
      mockHandle.emit('event', selectReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        selectReq.id,
        { value: 'a' },
      )
      expect(result).toEqual({ ok: true })
      expect(mockHandle.sendUIResponse).toHaveBeenCalledWith(selectReq.id, { value: 'a' })
    })

    it('forwards { values } for a select (allowMultiple) request', async () => {
      mockHandle.emit('event', selectMultiReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        selectMultiReq.id,
        { values: ['a', 'c'] },
      )
      expect(result).toEqual({ ok: true })
      expect(mockHandle.sendUIResponse).toHaveBeenCalledWith(selectMultiReq.id, {
        values: ['a', 'c'],
      })
    })

    it('forwards { value } for an input request', async () => {
      mockHandle.emit('event', inputReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        inputReq.id,
        { value: 'hello' },
      )
      expect(result).toEqual({ ok: true })
      expect(mockHandle.sendUIResponse).toHaveBeenCalledWith(inputReq.id, { value: 'hello' })
    })

    it('forwards { value } for an editor request', async () => {
      mockHandle.emit('event', editorReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        editorReq.id,
        { value: 'some content' },
      )
      expect(result).toEqual({ ok: true })
      expect(mockHandle.sendUIResponse).toHaveBeenCalledWith(editorReq.id, { value: 'some content' })
    })

    it('forwards { cancelled: true } for any method', async () => {
      mockHandle.emit('event', confirmReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        confirmReq.id,
        { cancelled: true },
      )
      expect(result).toEqual({ ok: true })
      expect(mockHandle.sendUIResponse).toHaveBeenCalledWith(confirmReq.id, { cancelled: true })
    })

    // Fan-out

    it('fans out session:ui-request-removed after successful response', async () => {
      mockHandle.emit('event', confirmReq)
      mockWcList[0].send.mockClear()

      await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        confirmReq.id,
        { confirmed: true },
      )
      expect(mockWcList[0].send).toHaveBeenCalledWith(PUSH.SESSION_UI_REQUEST_REMOVED, {
        sessionId: mockHandle.sessionId,
        requestId: confirmReq.id,
      })
    })

    it('does NOT fan out session:ui-request-removed on validation failure', async () => {
      mockHandle.emit('event', confirmReq)
      mockWcList[0].send.mockClear()

      await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        confirmReq.id,
        { value: 'wrong-shape' }, // invalid for confirm
      )
      const removedCalls = mockWcList[0].send.mock.calls.filter(
        (c) => c[0] === PUSH.SESSION_UI_REQUEST_REMOVED,
      )
      expect(removedCalls).toHaveLength(0)
    })

    // Negative / error returns

    it('returns error for unknown session', async () => {
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        's_unknown',
        'req-1',
        { confirmed: true },
      )
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("unknown session 's_unknown'"),
      })
    })

    it('returns error for unknown request id', async () => {
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        'req-does-not-exist',
        { confirmed: true },
      )
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("unknown request 'req-does-not-exist'"),
      })
    })

    it('returns error when confirm response is missing confirmed boolean', async () => {
      mockHandle.emit('event', confirmReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        confirmReq.id,
        { value: 'not-a-boolean' },
      )
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('confirm') })
      expect(mockHandle.sendUIResponse).not.toHaveBeenCalled()
    })

    it('returns error when select response has wrong shape', async () => {
      mockHandle.emit('event', selectReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        selectReq.id,
        { confirmed: true }, // wrong shape for select
      )
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('select') })
      expect(mockHandle.sendUIResponse).not.toHaveBeenCalled()
    })

    it('returns error when select (allowMultiple) gets value instead of values', async () => {
      mockHandle.emit('event', selectMultiReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        selectMultiReq.id,
        { value: 'should-be-values-array' },
      )
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining('allowMultiple'),
      })
      expect(mockHandle.sendUIResponse).not.toHaveBeenCalled()
    })

    it('returns error when response is not an object', async () => {
      mockHandle.emit('event', confirmReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        confirmReq.id,
        'not-an-object',
      )
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('object') })
      expect(mockHandle.sendUIResponse).not.toHaveBeenCalled()
    })

    it('returns error when response is null', async () => {
      mockHandle.emit('event', confirmReq)
      const result = await capturedHandlers.get(IPC.RESPOND_UI)!(
        null,
        mockHandle.sessionId,
        confirmReq.id,
        null,
      )
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('null') })
      expect(mockHandle.sendUIResponse).not.toHaveBeenCalled()
    })
  })

  // ── listSessions ─────────────────────────────────────────────────────────────

  describe('listSessions', () => {
    it('returns the result of manager.list()', () => {
      const records = [
        {
          id: 's_abc',
          cwd: '/project-a',
          displayName: 'project-a',
          lastOpenedAt: '2024-01-01T00:00:00.000Z',
          wasAutoRunning: false,
        },
      ]
      manager.list.mockReturnValue(records)
      expect(capturedHandlers.get(IPC.LIST_SESSIONS)!(null)).toEqual(records)
      expect(manager.list).toHaveBeenCalledTimes(1)
    })

    it('returns an empty array when no sessions are open', () => {
      manager.list.mockReturnValue([])
      expect(capturedHandlers.get(IPC.LIST_SESSIONS)!(null)).toEqual([])
    })

    it('does not require a sessionId argument', () => {
      // listSessions takes no arguments — calling with none should not throw.
      manager.list.mockReturnValue([])
      expect(() => capturedHandlers.get(IPC.LIST_SESSIONS)!(null)).not.toThrow()
    })
  })

  // ── closeSession ─────────────────────────────────────────────────────────────

  describe('closeSession', () => {
    it('calls manager.close() with the sessionId', async () => {
      await capturedHandlers.get(IPC.CLOSE_SESSION)!(null, 's_xyz')
      expect(manager.close).toHaveBeenCalledWith('s_xyz')
    })

    it('tears down the session entry so getState throws afterward', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      const sessionId = mockHandle.sessionId
      // Session is open — getState should work.
      expect(capturedHandlers.get(IPC.GET_STATE)!(null, sessionId)).toBe('Idle')

      // Close it.
      await capturedHandlers.get(IPC.CLOSE_SESSION)!(null, sessionId)

      // After close the entry is gone — getState must throw.
      expect(() => capturedHandlers.get(IPC.GET_STATE)!(null, sessionId)).toThrow(
        `getState: unknown session '${sessionId}'`,
      )
    })

    it('stops event fan-out after the session is closed', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      const sessionId = mockHandle.sessionId
      await capturedHandlers.get(IPC.CLOSE_SESSION)!(null, sessionId)
      mockWcList[0].send.mockClear()

      // Events emitted on the handle after close should NOT reach the renderer.
      mockHandle.emit('event', { type: 'message' })
      expect(mockWcList[0].send).not.toHaveBeenCalled()
    })

    it('is safe to close an unknown sessionId (idempotent)', async () => {
      await expect(
        capturedHandlers.get(IPC.CLOSE_SESSION)!(null, 's_does_not_exist'),
      ).resolves.toBeUndefined()
      expect(manager.close).toHaveBeenCalledWith('s_does_not_exist')
    })
  })

  // ── renameSession ─────────────────────────────────────────────────────────────

  describe('renameSession', () => {
    it('delegates to manager.rename() with sessionId and name', () => {
      capturedHandlers.get(IPC.RENAME_SESSION)!(null, 's_abc', 'My Project')
      expect(manager.rename).toHaveBeenCalledWith('s_abc', 'My Project')
    })

    it('delegates an empty name (the manager decides what to do)', () => {
      capturedHandlers.get(IPC.RENAME_SESSION)!(null, 's_abc', '')
      expect(manager.rename).toHaveBeenCalledWith('s_abc', '')
    })

    it('is safe to rename an unknown sessionId (manager.rename is a no-op)', () => {
      expect(() =>
        capturedHandlers.get(IPC.RENAME_SESSION)!(null, 's_no_such_session', 'Name'),
      ).not.toThrow()
      expect(manager.rename).toHaveBeenCalledWith('s_no_such_session', 'Name')
    })
  })

  // ── setThinkingLevel ────────────────────────────────────────────────────────

  describe('setThinkingLevel', () => {
    beforeEach(async () => {
      // Open a project so a session entry is registered in `sessions`.
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
    })

    it('calls entry.setThinkingLevel with the given level', async () => {
      await capturedHandlers.get(IPC.SET_THINKING_LEVEL)!(null, mockHandle.sessionId, 'high')
      expect(mockHandle.setThinkingLevel).toHaveBeenCalledWith('high')
    })

    it('returns undefined on success', async () => {
      const result = await capturedHandlers.get(IPC.SET_THINKING_LEVEL)!(
        null,
        mockHandle.sessionId,
        'medium',
      )
      expect(result).toBeUndefined()
    })

    it('returns null for an unknown session', async () => {
      const result = await capturedHandlers.get(IPC.SET_THINKING_LEVEL)!(
        null,
        's_unknown',
        'high',
      )
      expect(result).toBeNull()
    })

    it('returns null and logs console.error when setThinkingLevel rejects', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mockHandle.setThinkingLevel.mockRejectedValueOnce(new Error('RPC failure'))
      const result = await capturedHandlers.get(IPC.SET_THINKING_LEVEL)!(
        null,
        mockHandle.sessionId,
        'max',
      )
      expect(result).toBeNull()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('setThinkingLevel'),
        expect.any(Error),
      )
      spy.mockRestore()
    })
  })
})

// ── parseOpenProjectArg ───────────────────────────────────────────────────────
//
// Tests the exported pure function directly — no Electron setup needed.

describe('parseOpenProjectArg', () => {
  it('returns null for an empty argv array', () => {
    expect(parseOpenProjectArg([])).toBeNull()
  })

  it('returns null when the flag is absent', () => {
    expect(parseOpenProjectArg(['node', 'app.js', '--other-flag'])).toBeNull()
  })

  it('returns null when the flag is the last element (no value follows)', () => {
    expect(parseOpenProjectArg(['--open-project'])).toBeNull()
  })

  it('returns null when the value is another flag', () => {
    expect(
      parseOpenProjectArg(['--open-project', '--another-flag', '/project']),
    ).toBeNull()
  })

  it('returns null when the value is an empty string', () => {
    expect(parseOpenProjectArg(['--open-project', ''])).toBeNull()
  })

  it('returns the path when the flag has a valid posix value', () => {
    expect(
      parseOpenProjectArg(['node', 'app.js', '--open-project', '/my/project']),
    ).toBe('/my/project')
  })

  it('returns the path when the flag has a Windows-style value', () => {
    expect(
      parseOpenProjectArg(['--open-project', 'D:\\Projects\\my-app']),
    ).toBe('D:\\Projects\\my-app')
  })

  it('handles normal process.argv layout (exe + script at indices 0 and 1)', () => {
    expect(
      parseOpenProjectArg([
        'C:\\node.exe',
        'C:\\app.js',
        '--open-project',
        'D:\\work\\my-project',
      ]),
    ).toBe('D:\\work\\my-project')
  })

  it('returns the first match when the flag appears more than once', () => {
    expect(
      parseOpenProjectArg(['--open-project', '/a', '--open-project', '/b']),
    ).toBe('/a')
  })

  it('handles extra argv flags before the open-project flag', () => {
    expect(
      parseOpenProjectArg(['--some-flag', 'value', '--open-project', '/proj']),
    ).toBe('/proj')
  })
})

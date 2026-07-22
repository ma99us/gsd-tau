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
  shell: {
    openPath: vi.fn(),
  },
}))

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

vi.mock('../session/progress-reconciler', () => ({
  reconcileProgress: vi.fn(),
  parseRoadmapCheckboxes: vi.fn(),
}))

import { ipcMain, webContents as electronWc, shell } from 'electron'
import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { reconcileProgress } from '../session/progress-reconciler'

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
    compact: ReturnType<typeof vi.fn>
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
      compact: vi.fn().mockResolvedValue({ summary: 'compacted', firstKeptEntryId: 'e1', tokensBefore: 1000 }),
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
    it('registers handlers for all 26 IPC channels', () => {
      const ipcMock = ipcMain as unknown as IpcMock
      expect(ipcMock.handle).toHaveBeenCalledTimes(26)
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
      expect(capturedHandlers.has(IPC.COMPACT)).toBe(true)
      // Copilot quota channels (T03):
      expect(capturedHandlers.has(IPC.GET_QUOTA)).toBe(true)
      expect(capturedHandlers.has(IPC.REFRESH_QUOTA)).toBe(true)
      expect(capturedHandlers.has(IPC.START_QUOTA_AUTH)).toBe(true)
      expect(capturedHandlers.has(IPC.DISCONNECT_QUOTA_AUTH)).toBe(true)
      // Auto-run progress – open roadmap (T01):
      expect(capturedHandlers.has(IPC.OPEN_ROADMAP)).toBe(true)
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

    it('fans out PUSH.PROGRESS_UPDATE on tool_execution_end for a GSD planning tool (Path A)', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', {
        type: 'tool_execution_end',
        toolName: 'gsd_plan_milestone',
        args: { milestoneId: 'M001' },
      })
      const progressUpdates = mockWcList[0].send.mock.calls.filter(
        (c) => c[0] === PUSH.PROGRESS_UPDATE,
      )
      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[0][1]).toMatchObject({ sessionId: mockHandle.sessionId })
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
    it('removes all 23 ipcMain handlers', () => {
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
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.COMPACT)
      // Copilot quota channels (T03):
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.GET_QUOTA)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.REFRESH_QUOTA)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.START_QUOTA_AUTH)
      expect(ipcMock.removeHandler).toHaveBeenCalledWith(IPC.DISCONNECT_QUOTA_AUTH)
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

  // ── compact ─────────────────────────────────────────────────────────────────

  describe('compact', () => {
    beforeEach(async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
    })

    it('calls manager.compact() and returns the CompactionResult', async () => {
      const result = await capturedHandlers.get(IPC.COMPACT)!(null, mockHandle.sessionId)
      expect(manager.compact).toHaveBeenCalledWith(mockHandle.sessionId, undefined)
      expect(result).toEqual({ summary: 'compacted', firstKeptEntryId: 'e1', tokensBefore: 1000 })
    })

    it('forwards customInstructions when provided', async () => {
      await capturedHandlers.get(IPC.COMPACT)!(null, mockHandle.sessionId, 'focus on auth')
      expect(manager.compact).toHaveBeenCalledWith(mockHandle.sessionId, 'focus on auth')
    })

    it('returns null and logs console.error when manager.compact() rejects', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      manager.compact.mockRejectedValueOnce(new Error('RPC compact failed'))
      const result = await capturedHandlers.get(IPC.COMPACT)!(null, mockHandle.sessionId)
      expect(result).toBeNull()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('compact'),
        expect.any(Error),
      )
      spy.mockRestore()
    })

    it('returns null when manager.compact() throws for unknown session', async () => {
      manager.compact.mockRejectedValueOnce(new Error("SessionManager.compact(): unknown session 's_ghost'"))
      const result = await capturedHandlers.get(IPC.COMPACT)!(null, 's_ghost')
      expect(result).toBeNull()
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

// ── openRoadmap ───────────────────────────────────────────────────────────────
//
// Tests the OPEN_ROADMAP IPC handler (Path A milestone resolution +
// shell.openPath).

describe('openRoadmap', () => {
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
    compact: ReturnType<typeof vi.fn>
    listMissingPaths: ReturnType<typeof vi.fn>
    removeMissingPath: ReturnType<typeof vi.fn>
    getAvailableModels: ReturnType<typeof vi.fn>
    setModel: ReturnType<typeof vi.fn>
  }
  let cleanup: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    capturedHandlers = new Map()
    mockHandle = new MockHandle()
    mockWcList = [makeMockWc()]
    const ipcMock = ipcMain as unknown as { handle: ReturnType<typeof vi.fn>; removeHandler: ReturnType<typeof vi.fn> }
    ipcMock.handle.mockImplementation((channel: string, fn: IpcHandler) => {
      capturedHandlers.set(channel, fn)
    })
    ipcMock.removeHandler.mockImplementation((channel: string) => {
      capturedHandlers.delete(channel)
    })
    ;(electronWc as unknown as { getAllWebContents: ReturnType<typeof vi.fn> }).getAllWebContents.mockReturnValue(mockWcList)
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
      compact: vi.fn().mockResolvedValue({ summary: 'compacted', firstKeptEntryId: 'e1', tokensBefore: 1000 }),
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

  /** Open a project and emit a tool_execution_end for a GSD milestone tool. */
  async function openProjectWithMilestone(milestoneId: string): Promise<void> {
    await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/project')
    mockHandle.emit('event', {
      type: 'tool_execution_end',
      toolName: 'gsd_plan_milestone',
      args: { milestoneId },
    })
  }

  it('returns without calling shell.openPath for an unknown sessionId', async () => {
    await capturedHandlers.get(IPC.OPEN_ROADMAP)!(null, 's_unknown')
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('returns without calling shell.openPath when no active milestone', async () => {
    await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/project')
    // No tool_execution_end emitted — ProgressTracker has no milestone.
    await capturedHandlers.get(IPC.OPEN_ROADMAP)!(null, mockHandle.sessionId)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('returns without calling shell.openPath when milestoneId is unparseable', async () => {
    await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/project')
    mockHandle.emit('event', {
      type: 'tool_execution_end',
      toolName: 'gsd_plan_milestone',
      args: { milestoneId: 'INVALID' },
    })
    await capturedHandlers.get(IPC.OPEN_ROADMAP)!(null, mockHandle.sessionId)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('returns without calling shell.openPath when phases directory cannot be read', async () => {
    ;(readdirSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    await openProjectWithMilestone('M007')
    await capturedHandlers.get(IPC.OPEN_ROADMAP)!(null, mockHandle.sessionId)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('returns without calling shell.openPath when no matching milestone directory is found', async () => {
    ;(readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: '08-other-phase', isDirectory: () => true },
    ])
    await openProjectWithMilestone('M007')
    await capturedHandlers.get(IPC.OPEN_ROADMAP)!(null, mockHandle.sessionId)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('calls shell.openPath with the ROADMAP.md path when milestone directory is found', async () => {
    ;(readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: '07-auto-run-panel', isDirectory: () => true },
    ])
    ;(shell.openPath as ReturnType<typeof vi.fn>).mockResolvedValue('')
    await openProjectWithMilestone('M007')
    await capturedHandlers.get(IPC.OPEN_ROADMAP)!(null, mockHandle.sessionId)
    expect(shell.openPath).toHaveBeenCalledWith(
      expect.stringContaining('07-auto-run-panel'),
    )
    expect(shell.openPath).toHaveBeenCalledWith(
      expect.stringMatching(/ROADMAP\.md$/),
    )
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

// ── quota IPC handlers ────────────────────────────────────────────────────────
//
// Exercised with a mock QuotaService injected as the 6th parameter so quota
// logic is isolated from session state.

describe('quota IPC handlers', () => {
  let capturedHandlers: Map<string, IpcHandler>
  let mockHandle: MockHandle
  let mockWcList: Array<ReturnType<typeof makeMockWc>>
  let mockQuotaService: {
    getLastSnapshot: ReturnType<typeof vi.fn>
    refreshNow: ReturnType<typeof vi.fn>
    startDeviceCodeFlow: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    onAgentEnd: ReturnType<typeof vi.fn>
  }
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
    compact: ReturnType<typeof vi.fn>
    listMissingPaths: ReturnType<typeof vi.fn>
    removeMissingPath: ReturnType<typeof vi.fn>
    getAvailableModels: ReturnType<typeof vi.fn>
    setModel: ReturnType<typeof vi.fn>
  }
  let cleanup: () => void

  beforeEach(() => {
    vi.useFakeTimers()

    capturedHandlers = new Map()
    mockHandle = new MockHandle()
    mockWcList = [makeMockWc()]

    const ipcMock = ipcMain as unknown as IpcMock
    ipcMock.handle.mockImplementation((channel: string, fn: IpcHandler) => {
      capturedHandlers.set(channel, fn)
    })
    ipcMock.removeHandler.mockImplementation((channel: string) => {
      capturedHandlers.delete(channel)
    })
    ;(electronWc as unknown as WcMock).getAllWebContents.mockReturnValue(mockWcList)

    mockQuotaService = {
      getLastSnapshot: vi.fn().mockReturnValue(null),
      refreshNow: vi.fn().mockResolvedValue(null),
      startDeviceCodeFlow: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      onAgentEnd: vi.fn(),
    }

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
      compact: vi.fn().mockResolvedValue(null),
      listMissingPaths: vi.fn().mockReturnValue([]),
      removeMissingPath: vi.fn(),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      setModel: vi.fn().mockResolvedValue(undefined),
    }

    ;({ cleanup } = registerHandlers(
      manager as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockQuotaService as never,
    ))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ── getQuota ────────────────────────────────────────────────────────────────

  it('getQuota returns the last snapshot from quotaService', () => {
    const snapshot = { fetchedAt: '2025-01-01T00:00:00.000Z', stale: false } as const
    mockQuotaService.getLastSnapshot.mockReturnValue(snapshot)
    const result = capturedHandlers.get(IPC.GET_QUOTA)!(null)
    expect(result).toBe(snapshot)
    expect(mockQuotaService.getLastSnapshot).toHaveBeenCalledTimes(1)
  })

  it('getQuota returns null when quotaService is absent', () => {
    // Re-register without a quota service
    cleanup()
    const ipcMock = ipcMain as unknown as IpcMock
    const handlers2 = new Map<string, IpcHandler>()
    ipcMock.handle.mockImplementation((ch: string, fn: IpcHandler) => handlers2.set(ch, fn))
    const { cleanup: c2 } = registerHandlers(manager as never)
    const result = handlers2.get(IPC.GET_QUOTA)!(null)
    expect(result).toBeNull()
    c2()
  })

  // ── refreshQuota ────────────────────────────────────────────────────────────

  it('refreshQuota calls quotaService.refreshNow() and returns the snapshot', async () => {
    const snapshot = { fetchedAt: '2025-01-01T00:00:00.000Z', stale: false } as const
    mockQuotaService.refreshNow.mockResolvedValue(snapshot)
    const result = await capturedHandlers.get(IPC.REFRESH_QUOTA)!(null)
    expect(mockQuotaService.refreshNow).toHaveBeenCalledTimes(1)
    expect(result).toBe(snapshot)
  })

  it('refreshQuota returns null when quotaService is absent', async () => {
    cleanup()
    const ipcMock = ipcMain as unknown as IpcMock
    const handlers2 = new Map<string, IpcHandler>()
    ipcMock.handle.mockImplementation((ch: string, fn: IpcHandler) => handlers2.set(ch, fn))
    const { cleanup: c2 } = registerHandlers(manager as never)
    const result = await handlers2.get(IPC.REFRESH_QUOTA)!(null)
    expect(result).toBeNull()
    c2()
  })

  // ── startQuotaAuth ──────────────────────────────────────────────────────────

  it('startQuotaAuth calls quotaService.startDeviceCodeFlow with a fanOut callback', async () => {
    await capturedHandlers.get(IPC.START_QUOTA_AUTH)!(null)
    expect(mockQuotaService.startDeviceCodeFlow).toHaveBeenCalledTimes(1)
    // Verify the callback fans out on PUSH.QUOTA_DEVICE_CODE
    const [onDeviceCode] = mockQuotaService.startDeviceCodeFlow.mock.calls[0] as [
      (info: unknown) => void,
    ]
    const mockInfo = {
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
      deviceCode: 'dev-code-xyz',
    }
    onDeviceCode(mockInfo)
    expect(mockWcList[0].send).toHaveBeenCalledWith(PUSH.QUOTA_DEVICE_CODE, mockInfo)
  })

  it('startQuotaAuth warns and returns when quotaService is absent', async () => {
    cleanup()
    const ipcMock = ipcMain as unknown as IpcMock
    const handlers2 = new Map<string, IpcHandler>()
    ipcMock.handle.mockImplementation((ch: string, fn: IpcHandler) => handlers2.set(ch, fn))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { cleanup: c2 } = registerHandlers(manager as never)
    await handlers2.get(IPC.START_QUOTA_AUTH)!(null)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('startQuotaAuth'))
    spy.mockRestore()
    c2()
  })

  // ── disconnectQuotaAuth ─────────────────────────────────────────────────────

  it('disconnectQuotaAuth calls quotaService.disconnect()', async () => {
    await capturedHandlers.get(IPC.DISCONNECT_QUOTA_AUTH)!(null)
    expect(mockQuotaService.disconnect).toHaveBeenCalledTimes(1)
  })

  it('disconnectQuotaAuth is a no-op when quotaService is absent', async () => {
    cleanup()
    const ipcMock = ipcMain as unknown as IpcMock
    const handlers2 = new Map<string, IpcHandler>()
    ipcMock.handle.mockImplementation((ch: string, fn: IpcHandler) => handlers2.set(ch, fn))
    const { cleanup: c2 } = registerHandlers(manager as never)
    await expect(handlers2.get(IPC.DISCONNECT_QUOTA_AUTH)!(null)).resolves.toBeUndefined()
    c2()
  })

  // ── agent_end → onAgentEnd ─────────────────────────────────────────────────

  it('agent_end event triggers quotaService.onAgentEnd()', async () => {
    await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
    mockHandle.emit('event', { type: 'agent_start' })
    mockHandle.emit('event', { type: 'agent_end' })
    expect(mockQuotaService.onAgentEnd).toHaveBeenCalledTimes(1)
  })

  it('agent_start event does NOT trigger quotaService.onAgentEnd()', async () => {
    await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
    mockHandle.emit('event', { type: 'agent_start' })
    expect(mockQuotaService.onAgentEnd).not.toHaveBeenCalled()
  })
})

// ── Path B open-time seeding ──────────────────────────────────────────────────

describe('Path B open-time seeding', () => {
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
    compact: ReturnType<typeof vi.fn>
    listMissingPaths: ReturnType<typeof vi.fn>
    removeMissingPath: ReturnType<typeof vi.fn>
    getAvailableModels: ReturnType<typeof vi.fn>
    setModel: ReturnType<typeof vi.fn>
  }
  let cleanup: () => void

  beforeEach(() => {
    vi.useFakeTimers()

    capturedHandlers = new Map()
    mockHandle = new MockHandle()
    mockWcList = [makeMockWc()]

    const ipcMock = ipcMain as unknown as IpcMock
    ipcMock.handle.mockImplementation((channel: string, fn: IpcHandler) => {
      capturedHandlers.set(channel, fn)
    })
    ipcMock.removeHandler.mockImplementation((channel: string) => {
      capturedHandlers.delete(channel)
    })
    ;(electronWc as unknown as WcMock).getAllWebContents.mockReturnValue(mockWcList)

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
      compact: vi.fn().mockResolvedValue(null),
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

  it('calls reconcileProgress with milestoneId parsed from STATE.md on project open', async () => {
    vi.mocked(readFile).mockResolvedValue('Active Milestone: M001\n# State\n' as never)
    vi.mocked(reconcileProgress).mockResolvedValue({
      hasData: true,
      sliceStatuses: new Map([['S01', 'complete' as const]]),
    })

    await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/my/proj')
    await vi.runAllTimersAsync()

    expect(reconcileProgress).toHaveBeenCalledWith('/my/proj', 'M001')
  })

  it('applies reconciliation to progressTracker when reconcileProgress returns hasData true', async () => {
    vi.mocked(readFile).mockResolvedValue('Active Milestone: M002\n' as never)
    const sliceStatuses = new Map([
      ['S01', 'complete' as const],
      ['S02', 'pending' as const],
    ])
    vi.mocked(reconcileProgress).mockResolvedValue({ hasData: true, sliceStatuses })

    await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/my/proj')
    await vi.runAllTimersAsync()

    // reconcileProgress must have been called exactly once (the open-time seeding pass)
    expect(reconcileProgress).toHaveBeenCalledOnce()
    // GET_PROGRESS returns non-null, confirming the session entry is live and
    // the progressTracker was not discarded by a seeding error
    const progress = capturedHandlers.get(IPC.GET_PROGRESS)!(null, mockHandle.sessionId)
    expect(progress).not.toBeNull()
  })

  it('does not call reconcileProgress when STATE.md has no Active Milestone line', async () => {
    vi.mocked(readFile).mockResolvedValue(
      '# State\nStatus: idle\nNo milestone here\n' as never,
    )

    await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/my/proj')
    await vi.runAllTimersAsync()

    expect(reconcileProgress).not.toHaveBeenCalled()
  })

  it('opens session without error when STATE.md read throws ENOENT', async () => {
    vi.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
    )

    const sessionId = await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/my/proj')
    await vi.runAllTimersAsync()

    // Session opened successfully despite the STATE.md read error
    expect(sessionId).toBe(mockHandle.sessionId)
    expect(manager.open).toHaveBeenCalledWith('/my/proj')
    // reconcileProgress must NOT have been called — error was caught before it
    expect(reconcileProgress).not.toHaveBeenCalled()
  })

  // ── toast callbacks ──────────────────────────────────────────────────────────

  describe('stopped and milestone-complete toast callbacks', () => {
    let showStoppedToastFn: ReturnType<typeof vi.fn>
    let showMilestoneCompleteToastFn: ReturnType<typeof vi.fn>

    beforeEach(() => {
      // Tear down the no-toast registration from the outer beforeEach, then
      // re-register with injected toast mocks so assertions can inspect calls.
      cleanup()

      showStoppedToastFn = vi.fn()
      showMilestoneCompleteToastFn = vi.fn()

      ;({ cleanup } = registerHandlers(
        manager as never,
        undefined,
        undefined,
        showStoppedToastFn,
        showMilestoneCompleteToastFn,
      ))
    })

    it('calls showStoppedToastFn with the session basename on transport-error', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/path/to/my-project')
      mockHandle.emit('transport-error', { error: new Error('pi crashed') })
      expect(showStoppedToastFn).toHaveBeenCalledWith('my-project')
      expect(showStoppedToastFn).toHaveBeenCalledTimes(1)
    })

    it('does NOT call showStoppedToastFn for agent_start or agent_end events', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', { type: 'agent_start' })
      mockHandle.emit('event', { type: 'agent_end' })
      expect(showStoppedToastFn).not.toHaveBeenCalled()
    })

    it('calls showMilestoneCompleteToastFn with session basename and milestone title', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/path/to/my-project')
      // Plan the milestone so ProgressTracker has a title to emit.
      mockHandle.emit('event', {
        type: 'tool_execution_end',
        toolName: 'gsd_plan_milestone',
        args: { milestoneId: 'M001', title: 'Phase 1: Session Manager', slices: [] },
      })
      // Complete it — triggers progressTracker \'milestone-complete\' event.
      mockHandle.emit('event', {
        type: 'tool_execution_end',
        toolName: 'gsd_complete_milestone',
        args: { milestoneId: 'M001' },
      })
      expect(showMilestoneCompleteToastFn).toHaveBeenCalledWith(
        'my-project',
        'Phase 1: Session Manager',
      )
      expect(showMilestoneCompleteToastFn).toHaveBeenCalledTimes(1)
    })

    it('does NOT call showMilestoneCompleteToastFn for non-complete tool events', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', {
        type: 'tool_execution_end',
        toolName: 'gsd_plan_milestone',
        args: { milestoneId: 'M001', title: 'Test Milestone', slices: [] },
      })
      mockHandle.emit('event', {
        type: 'tool_execution_end',
        toolName: 'gsd_plan_slice',
        args: { milestoneId: 'M001', sliceId: 'S01', goal: 'test goal' },
      })
      expect(showMilestoneCompleteToastFn).not.toHaveBeenCalled()
    })

    it('does NOT call showMilestoneCompleteToastFn when milestoneId does not match active milestone', async () => {
      await capturedHandlers.get(IPC.OPEN_PROJECT)!(null, '/proj')
      mockHandle.emit('event', {
        type: 'tool_execution_end',
        toolName: 'gsd_plan_milestone',
        args: { milestoneId: 'M001', title: 'Test Milestone', slices: [] },
      })
      // Attempt to complete a different (non-active) milestone.
      mockHandle.emit('event', {
        type: 'tool_execution_end',
        toolName: 'gsd_complete_milestone',
        args: { milestoneId: 'M999' },
      })
      expect(showMilestoneCompleteToastFn).not.toHaveBeenCalled()
    })
  })
})

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  SessionId,
  SessionState,
  SessionEvent,
  GsdApi,
  Unsubscribe,
  RpcExtensionUIRequest,
  UiResponseInput,
  RpcSlashCommand,
  ModelInfo,
  SessionRecord,
  RestoreResult,
  MissingPathInfo,
} from '../shared/types'

// ── IPC channel constants ─────────────────────────────────────────────────────
// Mirrored from main/ipc/handlers.ts — do NOT import from main/ in the preload.
// Keeping them local avoids bundling main-process code into the preload bundle.
const IPC = {
  SHOW_FOLDER_PICKER: 'showFolderPicker',
  OPEN_PROJECT: 'openProject',
  PROMPT: 'prompt',
  ABORT: 'abort',
  GET_STATE: 'getState',
  RESPOND_UI: 'respondUI',
  GET_COMMANDS: 'getCommands',
  GET_AVAILABLE_MODELS: 'getAvailableModels',
  SET_MODEL: 'setModel',
  LIST_SESSIONS: 'listSessions',
  CLOSE_SESSION: 'closeSession',
  RENAME_SESSION: 'renameSession',
  LIST_MISSING_PATHS: 'listMissingPaths',
  REASSIGN_SESSION_CWD: 'reassignSessionCwd',
} as const

const PUSH = {
  SESSION_EVENT: 'session:event',
  SESSION_STATE_CHANGE: 'session:state-change',
  SESSION_UI_REQUEST_ADDED: 'session:ui-request-added',
  SESSION_UI_REQUEST_REMOVED: 'session:ui-request-removed',
  /**
   * Emitted once on startup after all registry sessions have been
   * restored (or attempted).  Payload: {@link RestoreResult}.
   */
  RESTORE_COMPLETE: 'session:restore-complete',
  /**
   * Emitted once per missing-path session shortly before RESTORE_COMPLETE.
   * Payload: {@link MissingPathInfo}.
   */
  MISSING_PATH: 'session:missing-path',
} as const

// ── GSD API factory ────────────────────────────────────────────────────────────
/**
 * Builds the `window.gsd` API object.
 *
 * Exported so Vitest unit tests can call `createGsdApi()` directly without
 * needing to exercise `contextBridge.exposeInMainWorld`.  The module body
 * calls it exactly once at load time.
 *
 * All methods are thin delegations to `ipcRenderer.invoke` or
 * `ipcRenderer.on/off`.  No Node or Electron APIs are captured in the
 * returned object — contextBridge serialises the result before handing it
 * to the renderer, so this is safe with contextIsolation enabled.
 */
export function createGsdApi(): GsdApi {
  return {
    // ── invoke methods ─────────────────────────────────────────────────────────

    showFolderPicker: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SHOW_FOLDER_PICKER),

    openProject: (cwd: string): Promise<SessionId> =>
      ipcRenderer.invoke(IPC.OPEN_PROJECT, cwd),

    prompt: (sessionId: SessionId, text: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PROMPT, sessionId, text),

    abort: (sessionId: SessionId): Promise<void> =>
      ipcRenderer.invoke(IPC.ABORT, sessionId),

    getState: (sessionId: SessionId): Promise<SessionState> =>
      ipcRenderer.invoke(IPC.GET_STATE, sessionId),

    respondUI: (
      sessionId: SessionId,
      requestId: string,
      response: UiResponseInput,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.RESPOND_UI, sessionId, requestId, response),

    getCommands: (sessionId: SessionId): Promise<RpcSlashCommand[]> =>
      ipcRenderer.invoke(IPC.GET_COMMANDS, sessionId),

    getAvailableModels: (sessionId: SessionId): Promise<ModelInfo[]> =>
      ipcRenderer.invoke(IPC.GET_AVAILABLE_MODELS, sessionId),

    setModel: (
      sessionId: SessionId,
      provider: string,
      modelId: string,
    ): Promise<{ provider: string; id: string }> =>
      ipcRenderer.invoke(IPC.SET_MODEL, sessionId, provider, modelId),

    listSessions: (): Promise<SessionRecord[]> =>
      ipcRenderer.invoke(IPC.LIST_SESSIONS),

    closeSession: (sessionId: SessionId): Promise<void> =>
      ipcRenderer.invoke(IPC.CLOSE_SESSION, sessionId),

    renameSession: (sessionId: SessionId, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC.RENAME_SESSION, sessionId, name),

    listMissingPaths: (): Promise<MissingPathInfo[]> =>
      ipcRenderer.invoke(IPC.LIST_MISSING_PATHS),

    reassignSessionCwd: (
      sessionId: SessionId,
      newCwd: string,
    ): Promise<{ newSessionId: SessionId }> =>
      ipcRenderer.invoke(IPC.REASSIGN_SESSION_CWD, sessionId, newCwd),

    // ── push subscriptions ─────────────────────────────────────────────────────

    /**
     * Subscribe to `session:event` pushes for one session.
     *
     * The listener is registered once per call.  It filters by `sessionId` so
     * callers for different sessions never see each other's events.
     *
     * @returns An unsubscribe function.  Calling it multiple times is safe.
     */
    onEvent: (
      sessionId: SessionId,
      cb: (event: SessionEvent) => void,
    ): Unsubscribe => {
      const listener = (
        _ev: IpcRendererEvent,
        payload: { sessionId: SessionId; event: SessionEvent },
      ): void => {
        if (payload.sessionId === sessionId) {
          cb(payload.event)
        }
      }
      ipcRenderer.on(PUSH.SESSION_EVENT, listener)
      return (): void => {
        ipcRenderer.off(PUSH.SESSION_EVENT, listener)
      }
    },

    /**
     * Subscribe to `session:state-change` pushes for one session.
     *
     * The listener is registered once per call.  It filters by `sessionId`.
     *
     * @returns An unsubscribe function.  Calling it multiple times is safe.
     */
    onStateChange: (
      sessionId: SessionId,
      cb: (state: SessionState) => void,
    ): Unsubscribe => {
      const listener = (
        _ev: IpcRendererEvent,
        payload: { sessionId: SessionId; state: SessionState },
      ): void => {
        if (payload.sessionId === sessionId) {
          cb(payload.state)
        }
      }
      ipcRenderer.on(PUSH.SESSION_STATE_CHANGE, listener)
      return (): void => {
        ipcRenderer.off(PUSH.SESSION_STATE_CHANGE, listener)
      }
    },

    /**
     * Subscribe to `session:ui-request-added` pushes for one session.
     * Fires whenever a new interactive UI-request blocker arrives.
     *
     * @returns An unsubscribe function.
     */
    onUiRequestAdded: (
      sessionId: SessionId,
      cb: (request: RpcExtensionUIRequest) => void,
    ): Unsubscribe => {
      const listener = (
        _ev: IpcRendererEvent,
        payload: { sessionId: SessionId; request: RpcExtensionUIRequest },
      ): void => {
        if (payload.sessionId === sessionId) {
          cb(payload.request)
        }
      }
      ipcRenderer.on(PUSH.SESSION_UI_REQUEST_ADDED, listener)
      return (): void => {
        ipcRenderer.off(PUSH.SESSION_UI_REQUEST_ADDED, listener)
      }
    },

    /**
     * Subscribe to `session:ui-request-removed` pushes for one session.
     * Fires after a blocker has been cleared via respondUI or cancellation.
     *
     * @returns An unsubscribe function.
     */
    onUiRequestRemoved: (
      sessionId: SessionId,
      cb: (requestId: string) => void,
    ): Unsubscribe => {
      const listener = (
        _ev: IpcRendererEvent,
        payload: { sessionId: SessionId; requestId: string },
      ): void => {
        if (payload.sessionId === sessionId) {
          cb(payload.requestId)
        }
      }
      ipcRenderer.on(PUSH.SESSION_UI_REQUEST_REMOVED, listener)
      return (): void => {
        ipcRenderer.off(PUSH.SESSION_UI_REQUEST_REMOVED, listener)
      }
    },

    /**
     * Subscribe to the global `session:restore-complete` push.
     * Fires once on startup after all registry sessions have been restored.
     *
     * @returns An unsubscribe function.  Calling it multiple times is safe.
     */
    onRestoreComplete: (
      cb: (result: RestoreResult) => void,
    ): Unsubscribe => {
      const listener = (_ev: IpcRendererEvent, result: RestoreResult): void => {
        cb(result)
      }
      ipcRenderer.on(PUSH.RESTORE_COMPLETE, listener)
      return (): void => {
        ipcRenderer.off(PUSH.RESTORE_COMPLETE, listener)
      }
    },

    /**
     * Subscribe to `session:missing-path` pushes.
     * One push per missing-path session fires shortly before `restore-complete`.
     *
     * @returns An unsubscribe function.  Calling it multiple times is safe.
     */
    onSessionMissingPath: (
      cb: (info: MissingPathInfo) => void,
    ): Unsubscribe => {
      const listener = (_ev: IpcRendererEvent, info: MissingPathInfo): void => {
        cb(info)
      }
      ipcRenderer.on(PUSH.MISSING_PATH, listener)
      return (): void => {
        ipcRenderer.off(PUSH.MISSING_PATH, listener)
      }
    },
  }
}

// ── Expose to renderer via contextBridge ──────────────────────────────────────
// contextIsolation MUST be true in the BrowserWindow webPreferences.
// After this call:
//   - window.gsd is the only way the renderer reaches IPC.
//   - window.require, window.process, and window.module are NOT exposed.
//   - Direct ipcRenderer access is NOT available in the renderer.
contextBridge.exposeInMainWorld('gsd', createGsdApi())

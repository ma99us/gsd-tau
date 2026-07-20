import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  SessionId,
  SessionState,
  SessionEvent,
  GsdApi,
  Unsubscribe,
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
} as const

const PUSH = {
  SESSION_EVENT: 'session:event',
  SESSION_STATE_CHANGE: 'session:state-change',
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
  }
}

// ── Expose to renderer via contextBridge ──────────────────────────────────────
// contextIsolation MUST be true in the BrowserWindow webPreferences.
// After this call:
//   - window.gsd is the only way the renderer reaches IPC.
//   - window.require, window.process, and window.module are NOT exposed.
//   - Direct ipcRenderer access is NOT available in the renderer.
contextBridge.exposeInMainWorld('gsd', createGsdApi())

import { ipcMain, dialog, BrowserWindow, webContents as electronWebContents } from 'electron'
import type { WebContents } from 'electron'
import type { SdkAgentEvent } from '@opengsd/rpc-client'
import type { SessionId } from '../../shared/types'
import { SessionStateMachine } from '../session/state-machine'
import type {
  SessionState,
  StateMachineInputEvent,
  StateChangedPayload,
} from '../session/state-machine'
import type { SessionManager } from '../session/session-manager'

// ── IPC channel constants ──────────────────────────────────────────────────────

/** Renderer → main request/response channels (ipcRenderer.invoke). */
export const IPC = {
  SHOW_FOLDER_PICKER: 'showFolderPicker',
  OPEN_PROJECT: 'openProject',
  PROMPT: 'prompt',
  ABORT: 'abort',
  GET_STATE: 'getState',
} as const

/** Main → renderer push channels (ipcRenderer.on). */
export const PUSH = {
  SESSION_EVENT: 'session:event',
  SESSION_STATE_CHANGE: 'session:state-change',
} as const

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Injectable source of active WebContents instances.
 *
 * The default implementation calls `electronWebContents.getAllWebContents()`.
 * Tests inject a function returning a list of mock objects so they can verify
 * fan-out without starting Electron.
 */
export type GetAllWebContents = () => WebContents[]

/** Bookkeeping held per open session inside the handler registry. */
interface SessionEntry {
  machine: SessionStateMachine
  /** Tears down the handle listeners and destroys the state machine. */
  cleanup: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Broadcast `payload` on `channel` to every non-destroyed WebContents.
 * Skips destroyed instances to avoid Electron IPC errors after window close.
 */
function fanOut(getAllWc: GetAllWebContents, channel: string, payload: unknown): void {
  for (const wc of getAllWc()) {
    if (!wc.isDestroyed()) {
      wc.send(channel, payload)
    }
  }
}

// ── registerHandlers ───────────────────────────────────────────────────────────

/**
 * Register all IPC handlers for the session bridge.
 *
 * Wires up four `ipcMain.handle` endpoints:
 * - `openProject(cwd)`           → `SessionId`
 * - `prompt(sessionId, text)`    → `void`
 * - `abort(sessionId)`           → `void`
 * - `getState(sessionId)`        → `SessionState`
 *
 * Per-session side effects performed inside `openProject`:
 * 1. A new {@link SessionStateMachine} is created.
 * 2. The handle's `event` channel is subscribed to feed the machine and
 *    fan out `session:event` to all webContents.
 * 3. The handle's `transport-error` channel is subscribed similarly.
 * 4. The machine's `state-changed` emission fans out `session:state-change`.
 *
 * @param manager          The live {@link SessionManager} that owns pi sessions.
 * @param getAllWebContents Injected source of active webContents (injectable for tests).
 * @returns A cleanup function that removes all registered ipcMain handlers and
 *          tears down per-session state machines + listeners.
 */
export function registerHandlers(
  manager: SessionManager,
  getAllWebContents: GetAllWebContents = () => electronWebContents.getAllWebContents(),
): () => void {
  const sessions = new Map<SessionId, SessionEntry>()

  // ── showFolderPicker ─────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.SHOW_FOLDER_PICKER,
    async (event): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        title: 'Open Project Folder',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
  )

  // ── openProject ──────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.OPEN_PROJECT,
    async (_event, cwd: string): Promise<SessionId> => {
      const handle = await manager.open(cwd)
      const id = handle.sessionId

      const machine = new SessionStateMachine()

      // Event types that drive state transitions in the machine.
      // turn_start/turn_end are emitted by newer pi versions as aliases
      // for agent_start/agent_end.
      const STATE_TRANSITIONS: Record<string, StateMachineInputEvent> = {
        agent_start: 'agent_start',
        turn_start: 'agent_start',
        agent_end: 'agent_end',
        turn_end: 'agent_end',
        execution_complete: 'agent_end',
      }

      // ── handle 'event' ───────────────────────────────────────────────────────
      // Fires for every non-error, non-transport-error event (including throttled
      // text_delta). Used to keep the watchdog alive and to fan out to renderers.
      const onEvent = (ev: SdkAgentEvent): void => {
        // Reset the 30 s inactivity watchdog while the session is Working.
        machine.heartbeat()

        const machineEvent = STATE_TRANSITIONS[ev.type]
        if (machineEvent) {
          machine.feed(machineEvent)
        }

        // extension_ui_request handling — Phase 1 partial bridge.
        //
        // Non-interactive methods (setStatus, setWidget) are auto-acknowledged
        // so pi stops retrying them every 30 s. Interactive methods (ask,
        // confirm, prompt) are left pending — Phase 2 will show real dialogs.
        if (ev.type === 'extension_ui_request') {
          const req = ev as { type: string; id?: string; method?: string }
          const NON_INTERACTIVE = new Set(['setStatus', 'setWidget', 'updateStatus', 'clearStatus'])
          if (req.id && req.method && NON_INTERACTIVE.has(req.method)) {
            console.debug(`[handlers] ack non-interactive extension_ui_request method=${req.method} id=${req.id}`)
            handle.sendUIResponse(req.id, { confirmed: true })
          } else {
            console.info(`[handlers] unhandled extension_ui_request (phase 2):`, JSON.stringify(ev))
          }
        }
        if (ev.type === 'extension_ui_snapshot') {
          console.debug(`[handlers] extension_ui_snapshot:`, JSON.stringify(ev))
        }

        fanOut(getAllWebContents, PUSH.SESSION_EVENT, { sessionId: id, event: ev })
      }

      // ── handle 'transport-error' ─────────────────────────────────────────────
      // Emitted by SessionHandle when the RPC stream throws and the handle is not
      // already stopping.  Drives the machine to Stopped.
      const onTransportError = (payload: { error: unknown }): void => {
        machine.feed('transport-error')
        fanOut(getAllWebContents, PUSH.SESSION_EVENT, {
          sessionId: id,
          event: { type: 'transport-error', error: payload.error },
        })
      }

      // ── state-changed → fan out ──────────────────────────────────────────────
      const onStateChange = (payload: StateChangedPayload): void => {
        fanOut(getAllWebContents, PUSH.SESSION_STATE_CHANGE, {
          sessionId: id,
          state: payload.to,
        })
      }

      handle.on('event', onEvent)
      handle.on('transport-error', onTransportError)
      machine.on('state-changed', onStateChange)

      sessions.set(id, {
        machine,
        cleanup: () => {
          handle.off('event', onEvent)
          handle.off('transport-error', onTransportError)
          machine.off('state-changed', onStateChange)
          machine.destroy()
        },
      })

      return id
    },
  )

  // ── prompt ──────────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.PROMPT,
    async (_event, sessionId: SessionId, text: string): Promise<void> => {
      await manager.prompt(sessionId, text)
    },
  )

  // ── abort ───────────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.ABORT,
    async (_event, sessionId: SessionId): Promise<void> => {
      await manager.abort(sessionId)
    },
  )

  // ── getState ────────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.GET_STATE,
    (_event, sessionId: SessionId): SessionState => {
      const entry = sessions.get(sessionId)
      if (!entry) {
        throw new Error(`getState: unknown session '${sessionId}'`)
      }
      return entry.machine.state
    },
  )

  // ── cleanup ─────────────────────────────────────────────────────────────────
  return function cleanup(): void {
    ipcMain.removeHandler(IPC.SHOW_FOLDER_PICKER)
    ipcMain.removeHandler(IPC.OPEN_PROJECT)
    ipcMain.removeHandler(IPC.PROMPT)
    ipcMain.removeHandler(IPC.ABORT)
    ipcMain.removeHandler(IPC.GET_STATE)

    for (const [, entry] of sessions) {
      entry.cleanup()
    }
    sessions.clear()
  }
}

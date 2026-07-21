import { ipcMain, dialog, BrowserWindow, webContents as electronWebContents } from 'electron'
import type { WebContents } from 'electron'
import { basename } from 'node:path'
import type { SdkAgentEvent } from '@opengsd/rpc-client'
import type { SessionId, SessionRecord, RpcExtensionUIRequest, UiResponseInput, MissingPathInfo } from '../../shared/types'
import { BlockerTracker } from '../session/blocker-tracker'
import { SessionStateMachine } from '../session/state-machine'
import type {
  SessionState,
  StateMachineInputEvent,
  StateChangedPayload,
} from '../session/state-machine'
import type { SessionManager } from '../session/session-manager'
import type { RegistryStore } from '../persistence/registry-store'

// ── IPC channel constants ──────────────────────────────────────────────────────

/** Renderer → main request/response channels (ipcRenderer.invoke). */
export const IPC = {
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
  /**
   * Return all sessions whose project directories were not found at restore time.
   * Renderer calls this during init() to catch races with the missing-path pushes.
   */
  LIST_MISSING_PATHS: 'listMissingPaths',
  /**
   * Reassign a missing-path session to a new directory and re-open it.
   * Removes the old missing-path entry, opens pi at the new cwd, and returns
   * the new session id.
   */
  REASSIGN_SESSION_CWD: 'reassignSessionCwd',
  /**
   * Persist the active tab's project CWD for restore across reboots.
   * The renderer fires this on every setActiveTab call (fire-and-forget).
   * CWD is used instead of session id because session ids are regenerated
   * by session-manager.open() on every launch.
   */
  SAVE_WINDOW_ACTIVE_TAB: 'saveWindowActiveTab',
} as const

/** Main → renderer push channels (ipcRenderer.on). */
export const PUSH = {
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

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Injectable source of active WebContents instances.
 *
 * The default implementation calls `electronWebContents.getAllWebContents()`.
 * Tests inject a function returning a list of mock objects so they can verify
 * fan-out without starting Electron.
 */
export type GetAllWebContents = () => WebContents[]

/**
 * Injectable toast callback — called when an interactive blocker UI request
 * arrives for a session.
 *
 * The default is a no-op so tests that don't exercise notifications can call
 * `registerHandlers` with only the required arguments.
 *
 * @param sessionName  Human-readable session identifier (typically `basename(cwd)`).
 * @param method       The `extension_ui_request` method (e.g. 'confirm', 'select').
 */
export type ShowBlockerToastFn = (sessionName: string, method: string) => void

/** Bookkeeping held per open session inside the handler registry. */
interface SessionEntry {
  machine: SessionStateMachine
  tracker: BlockerTracker
  /** Forward a UI response to pi for the given request id. */
  sendUIResponse: (id: string, response: UiResponseInput) => void
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

// ── validateUiResponse ─────────────────────────────────────────────────────────

/**
 * Validate that a renderer-supplied response matches the shape required by
 * the given UI-request method.
 *
 * Rules:
 * - `cancelled: true` is universally valid for any method.
 * - `confirm` → `{ confirmed: boolean }`
 * - `select` (single) → `{ value: string }`
 * - `select` (allowMultiple) → `{ values: string[] }`
 * - `input` / `editor` → `{ value: string }`
 * - All other methods (informational) → any object is accepted.
 *
 * Never throws; always returns `{ ok: true | false }`.
 */
export function validateUiResponse(
  request: RpcExtensionUIRequest,
  response: unknown,
): { ok: true; validated: UiResponseInput } | { ok: false; error: string } {
  if (response === null || typeof response !== 'object') {
    return {
      ok: false,
      error: `response must be an object, got ${response === null ? 'null' : typeof response}`,
    }
  }

  const r = response as Record<string, unknown>

  // cancelled: true is universally valid regardless of method
  if (r.cancelled === true) {
    return { ok: true, validated: { cancelled: true } }
  }

  switch (request.method) {
    case 'confirm': {
      if (typeof r.confirmed !== 'boolean') {
        return { ok: false, error: `confirm: response must have confirmed: boolean` }
      }
      return { ok: true, validated: { confirmed: r.confirmed } }
    }

    case 'select': {
      if (request.allowMultiple) {
        if (
          !Array.isArray(r.values) ||
          !(r.values as unknown[]).every((v) => typeof v === 'string')
        ) {
          return {
            ok: false,
            error: `select (allowMultiple=true): response must have values: string[]`,
          }
        }
        return { ok: true, validated: { values: r.values as string[] } }
      }
      if (typeof r.value !== 'string') {
        return { ok: false, error: `select: response must have value: string` }
      }
      return { ok: true, validated: { value: r.value } }
    }

    case 'input':
    case 'editor': {
      if (typeof r.value !== 'string') {
        return { ok: false, error: `${request.method}: response must have value: string` }
      }
      return { ok: true, validated: { value: r.value } }
    }

    default: {
      // Informational methods (notify, setStatus, setWidget, setTitle,
      // set_editor_text) or unknown future methods — any ack is accepted.
      return {
        ok: true,
        validated: { value: typeof r.value === 'string' ? r.value : '' },
      }
    }
  }
}

// ── parseOpenProjectArg ──────────────────────────────────────────────────────────

/**
 * Extract the `--open-project <path>` value from a `process.argv`-style array.
 *
 * Returns the path string when the flag and a non-empty, non-flag value are
 * both present; returns `null` otherwise.  Pure — no side effects.
 *
 * @param argv  Command-line argument array (may include the executable + script
 *              paths at indices 0 and 1, as in `process.argv`).
 */
export function parseOpenProjectArg(argv: string[]): string | null {
  const idx = argv.indexOf('--open-project')
  if (idx === -1 || idx + 1 >= argv.length) return null
  const value = argv[idx + 1]
  // Treat empty strings and other flag-like values as absent.
  if (!value || value.startsWith('-')) return null
  return value
}

// ── registerHandlers ───────────────────────────────────────────────────────────

/**
 * Register all IPC handlers for the session bridge.
 *
 * Wires up six `ipcMain.handle` endpoints:
 * - `showFolderPicker()`              → `string | null`
 * - `openProject(cwd)`                → `SessionId`
 * - `prompt(sessionId, text)`         → `void`
 * - `abort(sessionId)`                → `void`
 * - `getState(sessionId)`             → `SessionState`
 * - `respondUI(sessionId, id, resp)`  → `{ ok: boolean; error?: string }`
 *
 * Per-session side effects performed inside `openProject`:
 * 1. A new {@link SessionStateMachine} and {@link BlockerTracker} are created.
 * 2. The handle's `event` channel drives the machine and fans out
 *    `session:event` to all webContents.
 * 3. Interactive `extension_ui_request` events are tracked in the tracker;
 *    informational ones are auto-acked immediately with `{ value: '' }`.
 * 4. The tracker's `ui-request-added/removed` events drive the Waiting state
 *    and fan out `session:ui-request-added/removed`.
 * 5. The machine's `state-changed` emission fans out `session:state-change`.
 *
 * @param manager              The live {@link SessionManager} that owns pi sessions.
 * @param getAllWebContents     Injected source of active webContents (injectable for tests).
 *                             Pass `undefined` to use the real Electron webContents.
 * @param showBlockerToastFn   Injected toast callback fired on blocker arrival.
 *                             Pass `undefined` to use a silent no-op.
 * @returns An object with `cleanup` (removes all handlers) and
 *          `handleOpenProject` (shared with the second-instance handler so a
 *          forwarded `--open-project` path can open a new tab in the first
 *          instance without going through the IPC layer).
 */
export function registerHandlers(
  manager: SessionManager,
  getAllWebContents?: GetAllWebContents,
  showBlockerToastFn: ShowBlockerToastFn = () => {},
  registryStore?: RegistryStore,
  getWinId?: () => string,
): { cleanup: () => void; handleOpenProject: (cwd: string) => Promise<SessionId> } {
  const getWc: GetAllWebContents =
    getAllWebContents ?? (() => electronWebContents.getAllWebContents())
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

  // ── doOpenProject ─────────────────────────────────────────────────────────────
  // Extracted from the openProject IPC handler so the second-instance handler
  // can call it directly (in-process) without going through Electron IPC.
  async function doOpenProject(cwd: string): Promise<SessionId> {
      const handle = await manager.open(cwd)
      const id = handle.sessionId

      const machine = new SessionStateMachine()
      const tracker = new BlockerTracker()

      // ── Wire tracker → state machine (inline) ────────────────────────────────
      // Inline rather than via handle.wireBlockerTracker so the handler owns the
      // wiring and tests never need to mock wireBlockerTracker on SessionHandle.
      const onBlockerAdded = (): void => {
        machine.blockerAdded()
      }
      const onBlockerRemoved = (): void => {
        machine.blockerRemoved(tracker.size)
      }
      tracker.on('ui-request-added', onBlockerAdded)
      tracker.on('ui-request-removed', onBlockerRemoved)

      // ── Wire tracker → IPC fan-out + toast notification ─────────────────────
      const onBlockerAddedFanOut = (req: RpcExtensionUIRequest): void => {
        fanOut(getWc, PUSH.SESSION_UI_REQUEST_ADDED, { sessionId: id, request: req })
        // Notify the user via a Windows toast. Debounced inside showBlockerToastFn.
        showBlockerToastFn(basename(cwd), req.method)
      }
      const onBlockerRemovedFanOut = (requestId: string): void => {
        fanOut(getWc, PUSH.SESSION_UI_REQUEST_REMOVED, { sessionId: id, requestId })
      }
      tracker.on('ui-request-added', onBlockerAddedFanOut)
      tracker.on('ui-request-removed', onBlockerRemovedFanOut)

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

      // Interactive methods that require user input and must be tracked.
      // Everything else is an informational method (setStatus, setWidget,
      // notify, setTitle, set_editor_text) that is auto-acked so pi does not hang.
      const INTERACTIVE_METHODS = new Set(['select', 'confirm', 'input', 'editor'])

      // ── handle 'event' ───────────────────────────────────────────────────────
      const onEvent = (ev: SdkAgentEvent): void => {
        // Reset the 30 s inactivity watchdog while the session is Working.
        machine.heartbeat()

        const machineEvent = STATE_TRANSITIONS[ev.type]
        if (machineEvent) {
          machine.feed(machineEvent)
        }

        // extension_ui_request handling.
        //
        // Interactive methods (select, confirm, input, editor) are added to the
        // BlockerTracker, driving Waiting state and SESSION_UI_REQUEST_ADDED
        // fan-out via the tracker listeners wired above.
        //
        // Informational methods are auto-acked immediately with { value: '' }
        // so pi stops retrying them.
        if (ev.type === 'extension_ui_request') {
          const req = ev as { type: string; id: string; method: string } & SdkAgentEvent
          if (INTERACTIVE_METHODS.has(req.method)) {
            tracker.add(req as unknown as RpcExtensionUIRequest)
          } else {
            console.debug(
              `[handlers] ack non-interactive extension_ui_request method=${req.method} id=${req.id}`,
            )
            handle.sendUIResponse(req.id, { value: '' })
          }
        }
        if (ev.type === 'extension_ui_snapshot') {
          console.debug(`[handlers] extension_ui_snapshot:`, JSON.stringify(ev))
        }

        fanOut(getWc, PUSH.SESSION_EVENT, { sessionId: id, event: ev })
      }

      // ── handle 'transport-error' ─────────────────────────────────────────────
      const onTransportError = (payload: { error: unknown }): void => {
        machine.feed('transport-error')
        fanOut(getWc, PUSH.SESSION_EVENT, {
          sessionId: id,
          event: { type: 'transport-error', error: payload.error },
        })
      }

      // ── state-changed → fan out ──────────────────────────────────────────────
      const onStateChange = (payload: StateChangedPayload): void => {
        fanOut(getWc, PUSH.SESSION_STATE_CHANGE, {
          sessionId: id,
          state: payload.to,
        })
      }

      handle.on('event', onEvent)
      handle.on('transport-error', onTransportError)
      machine.on('state-changed', onStateChange)

      sessions.set(id, {
        machine,
        tracker,
        sendUIResponse: (respId, resp) => handle.sendUIResponse(respId, resp),
        cleanup: () => {
          handle.off('event', onEvent)
          handle.off('transport-error', onTransportError)
          machine.off('state-changed', onStateChange)
          tracker.off('ui-request-added', onBlockerAdded)
          tracker.off('ui-request-removed', onBlockerRemoved)
          tracker.off('ui-request-added', onBlockerAddedFanOut)
          tracker.off('ui-request-removed', onBlockerRemovedFanOut)
          machine.destroy()
        },
      })

      // Register a pre-shutdown hook so every open blocker receives
      // { cancelled: true } before the pi pipe is closed on app quit or
      // tab close.  Runs inside SessionManager.close() before handle.stop().
      manager.registerPreShutdownHook(id, async () => {
        const allBlockers = tracker.getAll()
        const requestIds = Object.keys(allBlockers)
        if (requestIds.length === 0) return
        console.log(
          `[shutdown] session ${id}: cancelling ${requestIds.length} open blocker(s)`,
        )
        for (const requestId of requestIds) {
          const t = Date.now()
          handle.sendUIResponse(requestId, { cancelled: true })
          tracker.remove(requestId)
          console.log(
            `[shutdown] session ${id}: cancelled blocker requestId=${requestId} elapsed=${Date.now() - t}ms`,
          )
        }
      })

      return id
  }

  // ── openProject ──────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.OPEN_PROJECT,
    (_event, cwd: string): Promise<SessionId> => doOpenProject(cwd),
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

  // ── respondUI ────────────────────────────────────────────────────────────────
  //
  // Validates the renderer-supplied response against the shape expected by the
  // request method, sends it to pi via the handle, and removes the blocker from
  // the tracker.  The SESSION_UI_REQUEST_REMOVED fan-out fires automatically
  // via the tracker's 'ui-request-removed' listener wired in openProject.
  //
  // Never throws to the renderer — all failures return { ok: false, error }.
  ipcMain.handle(
    IPC.RESPOND_UI,
    async (
      _event,
      sessionId: SessionId,
      requestId: string,
      response: unknown,
    ): Promise<{ ok: boolean; error?: string }> => {
      const entry = sessions.get(sessionId)
      if (!entry) {
        return { ok: false, error: `respondUI: unknown session '${sessionId}'` }
      }

      const request = entry.tracker.get(requestId)
      if (!request) {
        return {
          ok: false,
          error: `respondUI: unknown request '${requestId}' in session '${sessionId}'`,
        }
      }

      const validation = validateUiResponse(request, response)
      if (!validation.ok) {
        return { ok: false, error: validation.error }
      }

      entry.sendUIResponse(requestId, validation.validated)
      entry.tracker.remove(requestId)
      // SESSION_UI_REQUEST_REMOVED is fanned out via the tracker listener above.

      return { ok: true }
    },
  )

  // ── getCommands ──────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.GET_COMMANDS,
    async (_event, sessionId: SessionId) => {
      return manager.getCommands(sessionId)
    },
  )

  // ── getAvailableModels ───────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.GET_AVAILABLE_MODELS,
    async (_event, sessionId: SessionId) => {
      return manager.getAvailableModels(sessionId)
    },
  )

  // ── setModel ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.SET_MODEL,
    async (_event, sessionId: SessionId, provider: string, modelId: string) => {
      return manager.setModel(sessionId, provider, modelId)
    },
  )

  // ── listSessions ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.LIST_SESSIONS,
    (_event): SessionRecord[] => manager.list(),
  )

  // ── closeSession ─────────────────────────────────────────────────────────────
  //
  // Tears down the handler-level state machine + listeners FIRST so no more
  // fan-out events reach the renderer after the tab is closed, then delegates
  // the actual pi process shutdown to SessionManager.
  ipcMain.handle(
    IPC.CLOSE_SESSION,
    async (_event, sessionId: SessionId): Promise<void> => {
      const entry = sessions.get(sessionId)
      if (entry) {
        entry.cleanup()
        sessions.delete(sessionId)
      }
      // SessionManager.close() is idempotent for unknown ids.
      await manager.close(sessionId)
    },
  )

  // ── renameSession ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.RENAME_SESSION,
    (_event, sessionId: SessionId, name: string): void => {
      manager.rename(sessionId, name)
    },
  )

  // ── listMissingPaths ──────────────────────────────────────────────────────────
  //
  // Returns all sessions whose project directories were not found at restore time.
  // The renderer calls this during init() to catch races where MISSING_PATH push
  // events arrived before the subscription was set up.
  ipcMain.handle(
    IPC.LIST_MISSING_PATHS,
    (_event): MissingPathInfo[] => manager.listMissingPaths(),
  )

  // ── reassignSessionCwd ────────────────────────────────────────────────────────
  //
  // Cleans up the missing-path tracking for `sessionId`, then opens a full pi
  // session at the new `newCwd` path (wires state machine, tracker, shutdown
  // hook, etc. via the shared doOpenProject helper).
  //
  // Returns the stable id of the newly opened session so the renderer can
  // replace the phantom tab entry with the live one.
  ipcMain.handle(
    IPC.REASSIGN_SESSION_CWD,
    async (
      _event,
      sessionId: SessionId,
      newCwd: string,
    ): Promise<{ newSessionId: SessionId }> => {
      // Remove the missing-path entry before opening at the new location.
      manager.removeMissingPath(sessionId)
      const newSessionId = await doOpenProject(newCwd)
      console.log(
        `[handlers] reassign missing-path ${sessionId} → new session ${newSessionId} at "${newCwd}"`,
      )
      return { newSessionId }
    },
  )

  // ── saveWindowActiveTab ─────────────────────────────────────────────────────
  //
  // Persists the active tab's project CWD so it survives a reboot.
  // The CWD is the stable cross-reboot identifier — session ids are regenerated
  // by session-manager.open() on every launch, making them useless for restore.
  //
  // The handler is a no-op if registryStore or winId are not available (e.g.
  // in unit tests that call registerHandlers without injecting them).
  ipcMain.handle(
    IPC.SAVE_WINDOW_ACTIVE_TAB,
    (_event, cwd: string): void => {
      const winId = getWinId?.()
      if (registryStore && winId) {
        registryStore.updateWindowActiveTab(winId, cwd)
        console.log(
          `[window-active-tab] saved activeTabCwd="${cwd}" for window ${winId}`,
        )
      }
    },
  )

  // ── cleanup ─────────────────────────────────────────────────────────────────
  function cleanup(): void {
    ipcMain.removeHandler(IPC.SHOW_FOLDER_PICKER)
    ipcMain.removeHandler(IPC.OPEN_PROJECT)
    ipcMain.removeHandler(IPC.PROMPT)
    ipcMain.removeHandler(IPC.ABORT)
    ipcMain.removeHandler(IPC.GET_STATE)
    ipcMain.removeHandler(IPC.RESPOND_UI)
    ipcMain.removeHandler(IPC.GET_COMMANDS)
    ipcMain.removeHandler(IPC.GET_AVAILABLE_MODELS)
    ipcMain.removeHandler(IPC.SET_MODEL)
    ipcMain.removeHandler(IPC.LIST_SESSIONS)
    ipcMain.removeHandler(IPC.CLOSE_SESSION)
    ipcMain.removeHandler(IPC.RENAME_SESSION)
    ipcMain.removeHandler(IPC.LIST_MISSING_PATHS)
    ipcMain.removeHandler(IPC.REASSIGN_SESSION_CWD)
    ipcMain.removeHandler(IPC.SAVE_WINDOW_ACTIVE_TAB)

    for (const [, entry] of sessions) {
      entry.cleanup()
    }
    sessions.clear()
  }

  return { cleanup, handleOpenProject: doOpenProject }
}

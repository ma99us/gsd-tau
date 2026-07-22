import { ipcMain, dialog, BrowserWindow, webContents as electronWebContents, shell } from 'electron'
import type { WebContents } from 'electron'
import { basename, join } from 'node:path'
import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { SdkAgentEvent } from '@opengsd/rpc-client'
import type { SessionId, SessionRecord, RpcExtensionUIRequest, UiResponseInput, MissingPathInfo, ThinkingLevel, QuotaSnapshot, GsdProgress, GsdMilestone } from '../../shared/types'
import type { QuotaService } from '../services/quota-service'
import { BlockerTracker } from '../session/blocker-tracker'
import { ProgressTracker } from '../session/progress-tracker'
import { reconcileProgress } from '../session/progress-reconciler'
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
  /**
   * Fetch the RPC session state (active model, thinking level, streaming status).
   * Returns `null` on unknown session or RPC error.
   */
  GET_RPC_STATE: 'getRpcState',
  /**
   * Fetch cumulative session statistics (cost, token counts, message counts).
   * Returns `null` on unknown session or RPC error.
   */
  GET_SESSION_STATS: 'getSessionStats',
  /**
   * Set the thinking level for a pi session.
   * Returns null on error rather than throwing (callers roll back optimistic state).
   */
  SET_THINKING_LEVEL: 'setThinkingLevel',
  /**
   * Trigger pi context compaction for a session.
   * Returns the CompactionResult on success, null on error.
   */
  COMPACT: 'compact',

  // ---------------------------------------------------------------------------
  // Auto-run progress
  // ---------------------------------------------------------------------------

  /**
   * Return the current GsdProgress snapshot for a session.
   * Returns null when the session is unknown or no milestone has been planned yet.
   */
  GET_PROGRESS: 'getProgress',
  /**
   * Trigger an immediate Path B reconciliation against ROADMAP.md and return
   * the refreshed GsdProgress snapshot.  Returns null on unknown session.
   */
  REFRESH_PROGRESS: 'refreshProgress',
  /**
   * Open the active milestone's ROADMAP.md in the OS default editor.
   * Resolves the prefixed milestone directory in the main process.
   * No-op (logs a warning) when no active milestone or directory not found.
   */
  OPEN_ROADMAP: 'openRoadmap',

  // ---------------------------------------------------------------------------
  // Copilot quota
  // ---------------------------------------------------------------------------

  /** Fetch the latest cached quota snapshot (unauthenticated → null). */
  GET_QUOTA: 'getQuota',
  /** Trigger an immediate on-demand quota refresh. */
  REFRESH_QUOTA: 'refreshQuota',
  /** Start the GitHub device-code OAuth flow. */
  START_QUOTA_AUTH: 'startQuotaAuth',
  /** Remove gh-auth.json and disconnect the quota account. */
  DISCONNECT_QUOTA_AUTH: 'disconnectQuotaAuth',
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
  /**
   * Emitted when the user closes the app window.  The renderer shows a
   * blocking overlay while the main process shuts down all sessions.
   */
  APP_CLOSING: 'app:closing',
  /**
   * Emitted whenever ProgressTracker.snapshot() changes for a session.
   * Payload: { sessionId: SessionId; progress: GsdProgress }.
   */
  PROGRESS_UPDATE: 'session:progress-update',
  /**
   * Broadcast whenever a fresh QuotaSnapshot is available.
   * Value matches QUOTA_UPDATE_CHANNEL exported from quota-service.ts.
   */
  QUOTA_UPDATE: 'quota:update',
  /**
   * Broadcast once when the GitHub device-code flow begins, so the renderer
   * can display the user-facing code and verification URL in a modal.
   */
  QUOTA_DEVICE_CODE: 'quota:device-code',
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

/**
 * Injectable toast callback — called when a session transitions to the Stopped
 * state (transport-error / pi crash).
 *
 * The default is a no-op so tests that don't exercise notifications can call
 * `registerHandlers` without this argument.
 *
 * @param sessionName  Human-readable session identifier (typically `basename(cwd)`).
 */
export type ShowStoppedToastFn = (sessionName: string) => void

/**
 * Injectable toast callback — called when a milestone completes.
 *
 * The default is a no-op so tests that don't exercise notifications can call
 * `registerHandlers` without this argument.
 *
 * @param sessionName     Human-readable session identifier (typically `basename(cwd)`).
 * @param milestoneTitle  Display title of the completed milestone.
 */
export type ShowMilestoneCompleteToastFn = (sessionName: string, milestoneTitle: string) => void

/** Bookkeeping held per open session inside the handler registry. */
interface SessionEntry {
  machine: SessionStateMachine
  tracker: BlockerTracker
  /** Tracks GsdProgress for the auto-run panel (Path A + Path B reconciliation). */
  progressTracker: ProgressTracker
  /** Absolute path to the project directory — used for Path B ROADMAP.md reads. */
  cwd: string
  /** Forward a UI response to pi for the given request id. */
  sendUIResponse: (id: string, response: UiResponseInput) => void
  /** Set the thinking level for this session; rejects on RPC error. */
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>
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
 * @param showBlockerToastFn            Injected toast callback fired on blocker arrival.
 *                                    Pass `undefined` to use a silent no-op.
 * @param showStoppedToastFn           Injected toast callback fired when a session transitions
 *                                    to Stopped (transport-error / pi crash).
 *                                    Pass `undefined` to use a silent no-op.
 * @param showMilestoneCompleteToastFn Injected toast callback fired when a milestone completes.
 *                                    Pass `undefined` to use a silent no-op.
 * @returns An object with `cleanup` (removes all handlers) and
 *          `handleOpenProject` (shared with the second-instance handler so a
 *          forwarded `--open-project` path can open a new tab in the first
 *          instance without going through the IPC layer).
 */
export function registerHandlers(
  manager: SessionManager,
  getAllWebContents?: GetAllWebContents,
  showBlockerToastFn: ShowBlockerToastFn = () => {},
  showStoppedToastFn: ShowStoppedToastFn = () => {},
  showMilestoneCompleteToastFn: ShowMilestoneCompleteToastFn = () => {},
  registryStore?: RegistryStore,
  getWinId?: () => string,
  quotaService?: QuotaService,
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
      console.log(`[handlers] doOpenProject cwd="${cwd}"`)

      const handle = await manager.open(cwd)
      const id = handle.sessionId

      const machine = new SessionStateMachine()
      const tracker = new BlockerTracker()
      const progressTracker = new ProgressTracker()

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
          // After a session ends, give the quota service a chance to fetch
          // fresh usage data (subject to its own 5-min debounce).
          if (machineEvent === 'agent_end' && quotaService) {
            quotaService.onAgentEnd()
          }
        }

        // Forward tool_execution_end events to ProgressTracker (Path A — live tracking).
        // pi 1.11+ sends `tool_execution_end` (not `tool_use`) with fields
        // `toolName` and `args` when a tool completes execution.
        if (ev.type === 'tool_execution_end') {
          const toolEv = ev as { type: string; toolName?: string; args?: unknown }
          if (toolEv.toolName) {
            progressTracker.handleToolUse(toolEv.toolName, toolEv.args)
          }
        }
        // Forward cost_update events to ProgressTracker.
        if (ev.type === 'cost_update') {
          const costEv = ev as { type: string; totalCostUsd?: number }
          if (typeof costEv.totalCostUsd === 'number') {
            progressTracker.handleCostUpdate(costEv.totalCostUsd)
          }
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

        // Capture the session file path so the registry can resume this
        // conversation on the next open.
        if (ev.type === 'execution_complete') {
          const statsFile = (ev as unknown as { stats?: { sessionFile?: string } }).stats?.sessionFile
          if (statsFile) {
            console.log(`[handlers] execution_complete: capturing sessionFile for session ${id}`,
              `\n  file="${statsFile}"`)
            manager.updateSessionFile(id, statsFile)
          } else {
            console.warn(`[handlers] execution_complete: no stats.sessionFile in payload for session ${id}`)
          }
          // Path B: reconcile slice statuses from ROADMAP.md checkboxes.
          const milestoneId = progressTracker.snapshot().milestone?.id
          if (milestoneId) {
            console.log(
              `[handlers] execution_complete: triggering Path B reconciliation for session ${id}, milestone ${milestoneId}`,
            )
            void reconcileProgress(cwd, milestoneId).then((result) => {
              if (result.hasData) {
                progressTracker.applyReconciliation(result.sliceStatuses)
                console.log(
                  `[handlers] Path B: reconciled ${result.sliceStatuses.size} slice(s) for milestone ${milestoneId}`,
                )
              } else {
                console.log(
                  `[handlers] Path B: no data from ROADMAP.md for milestone ${milestoneId}, keeping Path A data`,
                )
              }
            }).catch((err) => {
              console.warn(`[handlers] Path B reconciliation error for session ${id}:`, err)
            })
          } else {
            console.warn(
              `[handlers] execution_complete: no milestone id for session ${id}, skipping Path B reconciliation`,
            )
          }
        }

        fanOut(getWc, PUSH.SESSION_EVENT, { sessionId: id, event: ev })
      }

      // ── handle 'transport-error' ─────────────────────────────────────────────
      const onTransportError = (payload: { error: unknown }): void => {
        machine.feed('transport-error')
        showStoppedToastFn(basename(cwd))
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

      const onMilestoneComplete = (milestone: GsdMilestone): void => {
        showMilestoneCompleteToastFn(basename(cwd), milestone.title)
      }
      progressTracker.on('milestone-complete', onMilestoneComplete)

      const onProgressUpdated = (progress: GsdProgress): void => {
        console.log(
          `[handlers] progress update for session ${id}: milestone=${progress.milestone?.id ?? 'none'}`,
        )
        fanOut(getWc, PUSH.PROGRESS_UPDATE, { sessionId: id, progress })
      }
      progressTracker.on('updated', onProgressUpdated)

      // ── Path B: seed reconciliation at open time ───────────────────────────
      // Read the active milestone from STATE.md and run a reconciliation pass
      // so the progress panel shows correct slice statuses immediately on open,
      // before any tool_use events arrive (Path A has no data yet at this point).
      void (async () => {
        try {
          const stateContent = await readFile(join(cwd, '.gsd', 'STATE.md'), 'utf-8')
          const m = stateContent.match(/^Active Milestone:\s*(\S+)/m)
          const milestoneId = m?.[1]
          if (!milestoneId) return
          const result = await reconcileProgress(cwd, milestoneId)
          if (result.hasData) {
            progressTracker.applyReconciliation(result.sliceStatuses)
            console.debug(
              `[handlers] open-time Path B: reconciled ${result.sliceStatuses.size} slice(s) for milestone ${milestoneId} (session ${id})`,
            )
          } else {
            console.debug(
              `[handlers] open-time Path B: no ROADMAP.md data for milestone ${milestoneId}, keeping Path A state (session ${id})`,
            )
          }
        } catch {
          // Silent — STATE.md may not exist (new project) or file I/O may fail.
          // Never block session open on reconciliation errors.
        }
      })()

      handle.on('event', onEvent)
      handle.on('transport-error', onTransportError)
      machine.on('state-changed', onStateChange)

      sessions.set(id, {
        machine,
        tracker,
        progressTracker,
        cwd,
        sendUIResponse: (respId, resp) => handle.sendUIResponse(respId, resp),
        setThinkingLevel: (level) => handle.setThinkingLevel(level),
        cleanup: () => {
          handle.off('event', onEvent)
          handle.off('transport-error', onTransportError)
          machine.off('state-changed', onStateChange)
          tracker.off('ui-request-added', onBlockerAdded)
          tracker.off('ui-request-removed', onBlockerRemoved)
          tracker.off('ui-request-added', onBlockerAddedFanOut)
          tracker.off('ui-request-removed', onBlockerRemovedFanOut)
          machine.destroy()
          progressTracker.removeAllListeners()
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

  // ── getRpcState ───────────────────────────────────────────────────────────────
  //
  // Returns null rather than throwing so the renderer can handle RPC errors
  // gracefully (e.g. session closed while the request was in-flight).
  ipcMain.handle(
    IPC.GET_RPC_STATE,
    async (_event, sessionId: SessionId) => {
      try {
        return await manager.getRpcState(sessionId)
      } catch (err) {
        console.warn(`[handlers] getRpcState failed for session ${sessionId}:`, err)
        return null
      }
    },
  )

  // ── getSessionStats ──────────────────────────────────────────────────────────
  //
  // Same null-on-error pattern as getRpcState.
  ipcMain.handle(
    IPC.GET_SESSION_STATS,
    async (_event, sessionId: SessionId) => {
      try {
        return await manager.getSessionStats(sessionId)
      } catch (err) {
        console.warn(`[handlers] getSessionStats failed for session ${sessionId}:`, err)
        return null
      }
    },
  )

  // ── setThinkingLevel ──────────────────────────────────────────────────────────
  //
  // Uses the null-on-error pattern (like getRpcState) so the renderer can roll
  // back optimistic state on transport failures without a full page crash.
  // Main-process logs surface errors so they are visible in electron-log.
  ipcMain.handle(
    IPC.SET_THINKING_LEVEL,
    async (_event, sessionId: SessionId, level: ThinkingLevel) => {
      const entry = sessions.get(sessionId)
      if (!entry) {
        console.warn(`[handlers] setThinkingLevel: unknown session '${sessionId}'`)
        return null
      }
      try {
        await entry.setThinkingLevel(level)
      } catch (err) {
        console.error(`[handlers] setThinkingLevel failed for session ${sessionId}:`, err)
        return null
      }
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

  // ── compact ───────────────────────────────────────────────────────────────────
  //
  // Same null-on-error pattern as getRpcState / getSessionStats so the renderer
  // can handle RPC failures without crashing (session may be closed in-flight).
  ipcMain.handle(
    IPC.COMPACT,
    async (_event, sessionId: SessionId, customInstructions?: string) => {
      try {
        return await manager.compact(sessionId, customInstructions)
      } catch (err) {
        console.error(`[handlers] compact failed for session ${sessionId}:`, err)
        return null
      }
    },
  )

  // ── getProgress ────────────────────────────────────────────────────────────────
  //
  // Returns the current GsdProgress snapshot for a session (null when unknown
  // or no milestone has been planned).  Synchronous — no RPC round-trip.
  ipcMain.handle(
    IPC.GET_PROGRESS,
    (_event, sessionId: SessionId): GsdProgress | null => {
      const entry = sessions.get(sessionId)
      if (!entry) return null
      return entry.progressTracker.snapshot()
    },
  )

  // ── refreshProgress ───────────────────────────────────────────────────────────
  //
  // Triggers an immediate Path B reconciliation against ROADMAP.md and returns
  // the refreshed snapshot.  The null-on-error pattern is consistent with other
  // session handlers (getRpcState, getSessionStats) that may race with session
  // close.
  ipcMain.handle(
    IPC.REFRESH_PROGRESS,
    async (_event, sessionId: SessionId): Promise<GsdProgress | null> => {
      const entry = sessions.get(sessionId)
      if (!entry) return null
      const milestoneId = entry.progressTracker.snapshot().milestone?.id
      if (!milestoneId) {
        console.warn(`[handlers] refreshProgress: no milestone id for session ${sessionId}`)
        return entry.progressTracker.snapshot()
      }
      try {
        const result = await reconcileProgress(entry.cwd, milestoneId)
        if (result.hasData) {
          entry.progressTracker.applyReconciliation(result.sliceStatuses)
          console.log(
            `[handlers] refreshProgress: reconciled ${result.sliceStatuses.size} slice(s) for milestone ${milestoneId}`,
          )
        }
      } catch (err) {
        console.warn(`[handlers] refreshProgress error for session ${sessionId}:`, err)
      }
      return entry.progressTracker.snapshot()
    },
  )

  // ── openRoadmap ────────────────────────────────────────────────────────────────
  //
  // Resolves the ROADMAP.md path for the session's active milestone and opens
  // it in the OS default editor.  Milestone directories use a numeric prefix
  // (e.g. 'M007' → '07-auto-run-panel') so path resolution requires a
  // directory scan rather than a direct path construction.
  //
  // Uses the null/warn pattern — no-op with console.warn on missing session,
  // missing milestone, or unresolvable directory.  console.log when path is
  // resolved (slice verification requirement).
  ipcMain.handle(
    IPC.OPEN_ROADMAP,
    async (_event, sessionId: SessionId): Promise<void> => {
      const entry = sessions.get(sessionId)
      if (!entry) {
        console.warn(`[handlers] openRoadmap: unknown session '${sessionId}'`)
        return
      }
      const milestoneId = entry.progressTracker.snapshot().milestone?.id
      if (!milestoneId) {
        console.warn(
          `[handlers] openRoadmap: no active milestone for session '${sessionId}'`,
        )
        return
      }
      // Milestone directories use a numeric prefix derived from the milestone ID
      // (e.g. 'M007' → '07-auto-run-panel').  Parse the numeric portion and
      // zero-pad to at least 2 digits for the directory prefix scan.
      const num = parseInt(milestoneId.replace(/^M/i, ''), 10)
      if (isNaN(num)) {
        console.warn(
          `[handlers] openRoadmap: cannot parse milestone number from '${milestoneId}'`,
        )
        return
      }
      const numericPrefix = String(num).padStart(2, '0')
      const phasesDir = join(entry.cwd, '.gsd', 'phases')
      let matchDir: string | undefined
      try {
        const dirEntries = readdirSync(phasesDir, { withFileTypes: true })
        const match = dirEntries.find(
          (d) => d.isDirectory() && d.name.startsWith(`${numericPrefix}-`),
        )
        if (match) matchDir = match.name
      } catch {
        console.warn(
          `[handlers] openRoadmap: could not read phases directory: ${phasesDir}`,
        )
        return
      }
      if (!matchDir) {
        console.warn(
          `[handlers] openRoadmap: milestone directory not found for ${milestoneId} in ${phasesDir}`,
        )
        return
      }
      const roadmapPath = join(phasesDir, matchDir, 'ROADMAP.md')
      console.log(`[handlers] openRoadmap: opening ${roadmapPath}`)
      await shell.openPath(roadmapPath)
    },
  )

  // ── getQuota ──────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.GET_QUOTA, (): QuotaSnapshot | null => {
    return quotaService?.getLastSnapshot() ?? null
  })

  // ── refreshQuota ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.REFRESH_QUOTA,
    async (): Promise<QuotaSnapshot | null> => {
      return quotaService?.refreshNow() ?? null
    },
  )

  // ── startQuotaAuth ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC.START_QUOTA_AUTH, async (): Promise<void> => {
    if (!quotaService) {
      console.warn('[handlers] startQuotaAuth: quota service not available')
      return
    }
    await quotaService.startDeviceCodeFlow((info) => {
      fanOut(getWc, PUSH.QUOTA_DEVICE_CODE, info)
    })
  })

  // ── disconnectQuotaAuth ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.DISCONNECT_QUOTA_AUTH, async (): Promise<void> => {
    await quotaService?.disconnect()
  })

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
    ipcMain.removeHandler(IPC.GET_RPC_STATE)
    ipcMain.removeHandler(IPC.GET_SESSION_STATS)
    ipcMain.removeHandler(IPC.SET_THINKING_LEVEL)
    ipcMain.removeHandler(IPC.COMPACT)
    ipcMain.removeHandler(IPC.GET_PROGRESS)
    ipcMain.removeHandler(IPC.REFRESH_PROGRESS)
    ipcMain.removeHandler(IPC.OPEN_ROADMAP)
    ipcMain.removeHandler(IPC.GET_QUOTA)
    ipcMain.removeHandler(IPC.REFRESH_QUOTA)
    ipcMain.removeHandler(IPC.START_QUOTA_AUTH)
    ipcMain.removeHandler(IPC.DISCONNECT_QUOTA_AUTH)

    for (const [, entry] of sessions) {
      entry.cleanup()
    }
    sessions.clear()
  }

  return { cleanup, handleOpenProject: doOpenProject }
}

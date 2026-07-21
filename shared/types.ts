/**
 * Shared types used across main and renderer processes.
 * Must not import from electron, Node.js APIs, or browser-only APIs.
 */

// `import type` is fully erased at compile/bundle time — zero runtime footprint
// in the renderer bundle.  Bundlers (Vite, esbuild) strip type-only imports before
// emitting JS, so @opengsd/contracts never ships to the browser context.
import type { RpcExtensionUIRequest, RpcExtensionUIResponse, RpcSlashCommand, ModelInfo } from '@opengsd/contracts'

// Re-export so callers import from @shared/types, not directly from the package.
export type { RpcExtensionUIRequest, RpcExtensionUIResponse, RpcSlashCommand, ModelInfo }

export type SessionId = string

/**
 * Identifies a session whose project directory was not found on disk at restore time.
 * Sent as the payload for each `session:missing-path` push event and included in
 * `RestoreResult.missingPath` for race-safe initialisation.
 */
export interface MissingPathInfo {
  /** The session id from the registry (no live pi process exists for this id). */
  sessionId: SessionId
  /** The project directory path that no longer exists. */
  cwd: string
  /** Human-readable display name (registry basename). */
  displayName: string
}

/**
 * Session state returned by getState() and pushed via the
 * session:state-change push channel.  Matches the 4-state machine
 * in main/session/state-machine.ts — kept here so the renderer never
 * needs to import from main/.
 */
export type SessionState = 'Working' | 'Idle' | 'Stopped' | 'Waiting'

/** State of a pi session from the UI's perspective (extended in later phases). */
export type SessionUiState = 'Working' | 'Waiting' | 'Idle' | 'Stopped' | 'Auto'

/**
 * A serialisable agent event from the pi RPC stream, received via IPC.
 * The `type` discriminant matches pi event types (e.g. 'agent_start',
 * 'text_delta').  No rpc-client imports — safe in both main and renderer.
 */
export interface SessionEvent {
  type: string
  [key: string]: unknown
}

/** Removes a previously registered IPC listener. */
export type Unsubscribe = () => void

/**
 * The `window.gsd` API surface exposed by the preload script via
 * contextBridge.  Renderer code imports only this interface; it must
 * never import from main/ or preload/.
 */
export interface GsdApi {
  showFolderPicker(): Promise<string | null>
  openProject(cwd: string): Promise<SessionId>
  prompt(sessionId: SessionId, text: string): Promise<void>
  abort(sessionId: SessionId): Promise<void>
  getState(sessionId: SessionId): Promise<SessionState>
  respondUI(
    sessionId: SessionId,
    requestId: string,
    response: UiResponseInput,
  ): Promise<{ ok: boolean; error?: string }>
  getCommands(sessionId: SessionId): Promise<RpcSlashCommand[]>
  getAvailableModels(sessionId: SessionId): Promise<ModelInfo[]>
  setModel(
    sessionId: SessionId,
    provider: string,
    modelId: string,
  ): Promise<{ provider: string; id: string }>
  listSessions(): Promise<SessionRecord[]>
  closeSession(sessionId: SessionId): Promise<void>
  renameSession(sessionId: SessionId, name: string): Promise<void>
  onEvent(sessionId: SessionId, cb: (event: SessionEvent) => void): Unsubscribe
  onStateChange(sessionId: SessionId, cb: (state: SessionState) => void): Unsubscribe
  onUiRequestAdded(
    sessionId: SessionId,
    cb: (request: RpcExtensionUIRequest) => void,
  ): Unsubscribe
  onUiRequestRemoved(
    sessionId: SessionId,
    cb: (requestId: string) => void,
  ): Unsubscribe
  /** Subscribe to the one-time `session:restore-complete` push fired after relaunch restore. */
  onRestoreComplete(cb: (result: RestoreResult) => void): Unsubscribe
  /**
   * Subscribe to `session:missing-path` pushes.
   * One push per missing-path session fires shortly before `restore-complete`.
   * Also call `listMissingPaths()` in `init()` to handle any race with window load.
   */
  onSessionMissingPath(cb: (info: MissingPathInfo) => void): Unsubscribe
  /**
   * Fetch all sessions whose project directories were not found at restore time.
   * Called during store initialisation to catch missing-path sessions that fired
   * before the renderer's push subscription was set up.
   */
  listMissingPaths(): Promise<MissingPathInfo[]>
  /**
   * Reassign a missing-path session to a new directory and re-open it.
   * Cleans up the old missing-path entry and opens a fresh pi session at `newCwd`.
   * @returns The stable id of the newly opened session.
   */
  reassignSessionCwd(sessionId: SessionId, newCwd: string): Promise<{ newSessionId: SessionId }>
  /**
   * Persist the active tab's project CWD so it can be restored on next reboot.
   * Fire-and-forget — call from `setActiveTab` without awaiting.
   */
  saveWindowActiveTab(cwd: string): Promise<void>
}

/** Lightweight summary passed over IPC and persisted in the registry. */
export interface SessionSummary {
  id: SessionId
  cwd: string
  state: SessionUiState
  /** True if the session was in auto-mode when last seen — used for the relaunch heuristic. */
  wasAutoRunning: boolean
}

/** Current milestone/slice/task progress for a session. */
export interface GsdProgress {
  milestoneId: string | null
  sliceId: string | null
  taskId: string | null
  phase: 'planning' | 'executing' | 'validating' | null
}

/**
 * Serialisable snapshot of all open UI-request blockers for a session.
 * Keyed by request id; values are the full request payloads received from pi.
 * Passed over IPC as a plain object, so `Record` (not `Map`) is intentional.
 */
export type UiRequestState = Record<string, RpcExtensionUIRequest>

/**
 * The valid response shapes we send back to pi via `client.sendUIResponse()`.
 * Mirrors the `RpcExtensionUIResponse` union but is defined here so that
 * renderer code can construct responses without importing the contracts package
 * at runtime.
 */
export type UiResponseInput =
  | { value: string }       // select (single), input, editor, and informational ack
  | { values: string[] }    // select (multiple)
  | { confirmed: boolean }  // confirm
  | { cancelled: true }     // user-close or app-shutdown cancellation

/** Stable identifier for a renderer BrowserWindow. */
export type WindowId = number

/** Stable identifier for a tab within a renderer window. */
export type TabId = string

/**
 * Negotiated capabilities returned by the pi init handshake.
 * Plain type — no SDK imports, safe to use in both main and renderer.
 */
export interface PiCapabilities {
  events: string[]
  commands: string[]
}

/**
 * Stored after a successful pi init handshake.
 * Used by SessionHandle and IPC state forwarding.
 */
export interface PiInitInfo {
  protocolVersion: 2
  sessionId: string
  capabilities: PiCapabilities
}

// ---------------------------------------------------------------------------
// Persistence registry types (Phase 4 — multi-project persistence)
// ---------------------------------------------------------------------------

/**
 * Persistent record for one pi session.
 * Stored in the app-data registry so the session can be restored on relaunch.
 */
export interface SessionRecord {
  /** Stable identifier — matches the pi RPC session id. */
  id: SessionId
  /** Absolute path to the project directory. */
  cwd: string
  /** Human-readable label (directory base-name by default). */
  displayName: string
  /**
   * Path to the pi session file used by `--resume`.
   * Absent when the session was never saved by pi.
   */
  sessionFile?: string
  /** ISO-8601 timestamp of the most recent open. */
  lastOpenedAt: string
  /** True when the session was in auto-mode at last checkpoint. */
  wasAutoRunning: boolean
}

/**
 * Persistent record for one BrowserWindow.
 * Owns an ordered list of tab (session) ids and tracks the active tab.
 */
export interface WindowRecord {
  /** Electron BrowserWindow id (number cast to string for JSON-safety). */
  id: string
  /** Ordered list of session ids displayed as tabs in this window. */
  tabIds: string[]
  /** Which tab is currently focused. */
  activeTabId: string
  /**
   * Project CWD of the last-active tab — stable across reboots unlike activeTabId
   * (session IDs are regenerated by session-manager.open() on every launch).
   */
  activeTabCwd?: string
  /** Last-known window geometry for restore. */
  bounds: { x: number; y: number; width: number; height: number }
}

/**
 * Payload emitted once on startup after all registry sessions have been
 * restored (or attempted).  Mirrors the `RestoreResult` type used in main.
 */
export interface RestoreResult {
  /** Session ids that were successfully restored. */
  succeeded: SessionId[]
  /** Session ids that failed to restore. */
  failed: SessionId[]
  /**
   * Sessions whose project directories were not found on disk.
   * These sessions have NO live pi process — they are tracked as phantom tabs
   * in the renderer until the user reassigns or removes them.
   */
  missingPath?: MissingPathInfo[]
  /**
   * Project CWD of the tab that was active at last shutdown.
   * Used by the renderer to restore the correct active tab after reboot.
   */
  activeTabCwd?: string
}

/**
 * Root registry schema v1.
 * The `version` literal enables future schema migration — never widen it
 * without bumping the value and writing a migration in RegistryStore.
 */
export interface RegistryV1 {
  version: 1
  sessions: SessionRecord[]
  windows: WindowRecord[]
  /**
   * Most-recently-used order: session ids ordered from most to least recent.
   * Used to populate the [+] flyout recents list.
   */
  mruOrder: string[]
}

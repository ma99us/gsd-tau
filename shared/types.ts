/**
 * Shared types used across main and renderer processes.
 * Must not import from electron, Node.js APIs, or browser-only APIs.
 */

export type SessionId = string

/**
 * Phase-1 machine state returned by getState() and pushed via
 * the session:state-change push channel.  Matches the 3-state machine
 * in main/session/state-machine.ts — kept here so the renderer never
 * needs to import from main/.
 */
export type SessionState = 'Working' | 'Idle' | 'Stopped'

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
  openProject(cwd: string): Promise<SessionId>
  prompt(sessionId: SessionId, text: string): Promise<void>
  abort(sessionId: SessionId): Promise<void>
  getState(sessionId: SessionId): Promise<SessionState>
  onEvent(sessionId: SessionId, cb: (event: SessionEvent) => void): Unsubscribe
  onStateChange(sessionId: SessionId, cb: (state: SessionState) => void): Unsubscribe
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

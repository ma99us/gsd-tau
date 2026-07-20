/**
 * Shared types used across main and renderer processes.
 * Must not import from electron, Node.js APIs, or browser-only APIs.
 */

// `import type` is fully erased at compile/bundle time — zero runtime footprint
// in the renderer bundle.  Bundlers (Vite, esbuild) strip type-only imports before
// emitting JS, so @opengsd/contracts never ships to the browser context.
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from '@opengsd/contracts'

// Re-export so callers import from @shared/types, not directly from the package.
export type { RpcExtensionUIRequest, RpcExtensionUIResponse }

export type SessionId = string

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

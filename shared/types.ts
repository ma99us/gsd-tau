/**
 * Shared types used across main and renderer processes.
 * Must not import from electron, Node.js APIs, or browser-only APIs.
 */

export type SessionId = string

/** State of a pi session from the UI's perspective. */
export type SessionUiState = 'Working' | 'Waiting' | 'Idle' | 'Stopped' | 'Auto'

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

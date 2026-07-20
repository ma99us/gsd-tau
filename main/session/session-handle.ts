import { EventEmitter } from 'node:events'
import type { RpcClient, SdkAgentEvent } from '@opengsd/rpc-client'
import type { SessionId } from '../../shared/types'

// ── Types ──────────────────────────────────────────────────────────────────────

/** Lifecycle state of the handle, exposed to callers via {@link SessionHandle.clientState}. */
export type SessionClientState = 'idle' | 'running' | 'stopped'

/** Milliseconds between consecutive text_delta flushes (≈ 60 fps). */
const TEXT_DELTA_THROTTLE_MS = 16

/**
 * Agent event types that have a dedicated named channel on the emitter.
 * text_delta is intentionally absent — it is routed through the throttle path.
 *
 * turn_start/turn_end/message_update are emitted by newer pi versions as
 * aliases for agent_start/agent_end/text_delta respectively.
 */
const KNOWN_TYPES = new Set([
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'execution_complete',
  'message',
  'message_start',
  'message_end',
  'message_update',
  'tool_use',
  'tool_result',
])

// ── SessionHandle ──────────────────────────────────────────────────────────────

/**
 * Wraps a live {@link RpcClient} and fans its event stream to a typed
 * {@link EventEmitter}.
 *
 * Dispatch rules:
 * - `agent_start`, `agent_end`, `message`, `tool_use`, `tool_result` → emitted
 *   on their named channel **and** the generic `event` channel.
 * - `text_delta` → throttled to ≤ 60 fps (leading-edge emit + trailing flush
 *   when the throttle window closes or the pump exits), then emitted on both
 *   `text_delta` and `event`.
 * - All other types → `console.debug` + `unknown-event` + `event`.
 * - Generator throws → `transport-error` (suppressed if `stop()` was called).
 *
 * Exposed surface: `start()`, `stop()`, `on()` (inherited), `sessionId`,
 * `clientState`.
 */
export class SessionHandle extends EventEmitter {
  /** Stable session identifier supplied at construction. */
  readonly sessionId: SessionId

  private readonly _client: RpcClient
  private _state: SessionClientState = 'idle'
  private _stopped = false

  // ── text_delta throttle state ──────────────────────────────────────────────
  /** Latest unprocessed delta waiting for the throttle window to close. */
  private _pendingDelta: SdkAgentEvent | null = null
  /** Active throttle timer handle; null when no window is open. */
  private _throttleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(client: RpcClient, sessionId: SessionId) {
    super()
    this._client = client
    this.sessionId = sessionId
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Current lifecycle state. Read-only via getter. */
  get clientState(): SessionClientState {
    return this._state
  }

  /**
   * Forward a UI response to the underlying RpcClient.
   * Used to respond to `extension_ui_request` events (Phase 2 bridge;
   * Phase 1 callers send `{ cancelled: true }` to unblock pi).
   */
  sendUIResponse(
    id: string,
    response: {
      value?: string
      values?: string[]
      confirmed?: boolean
      cancelled?: boolean
    },
  ): void {
    this._client.sendUIResponse(id, response)
  }

  /**
   * Launch the event pump as a fire-and-forget background task.
   * Transitions `clientState`: `idle` → `running`.
   *
   * @throws If called when not in `idle` state (i.e. already started or stopped).
   */
  start(): void {
    if (this._state !== 'idle') {
      throw new Error(
        `SessionHandle(${this.sessionId}).start() called in state '${this._state}'`
      )
    }
    this._state = 'running'
    // Unawaited — runs until the generator exhausts, errors, or stop() is called.
    void this._pump()
  }

  /**
   * Stop the event pump and shut down the underlying {@link RpcClient}.
   * Idempotent — safe to call before `start()`, during a run, or repeatedly.
   */
  async stop(): Promise<void> {
    if (this._stopped) return
    this._stopped = true
    this._state = 'stopped'
    this._cancelThrottle()
    await this._client.stop().catch(() => undefined)
  }

  // ── Private: pump ──────────────────────────────────────────────────────────

  private async _pump(): Promise<void> {
    try {
      for await (const ev of this._client.events()) {
        if (this._stopped) break
        this._dispatch(ev)
      }
    } catch (err) {
      // Suppress transport errors that race with an explicit stop().
      if (!this._stopped) {
        this.emit('transport-error', { error: err })
      }
    } finally {
      // Return to idle only when the pump ended naturally (not via stop()).
      if (this._state === 'running') {
        this._state = 'idle'
      }
      // Drain any pending throttled delta so callers always receive the last token.
      this._flushDelta()
    }
  }

  // ── Private: dispatch ──────────────────────────────────────────────────────

  private _dispatch(ev: SdkAgentEvent): void {
    if (ev.type === 'text_delta') {
      // Route through throttle; 'text_delta' + 'event' are emitted by _flushDelta.
      this._throttleTextDelta(ev)
      return
    }

    // Log ALL events (known and unknown) at debug level so nothing is invisible.
    const payload = JSON.stringify(ev).slice(0, 300)
    console.debug(`[SessionHandle:${this.sessionId}] dispatch "${ev.type}" payload=${payload}`)

    if (KNOWN_TYPES.has(ev.type)) {
      this.emit(ev.type, ev)
    } else {
      this.emit('unknown-event', { event: ev })
    }

    // Every non-text_delta event also fires on the generic channel.
    this.emit('event', ev)
  }

  // ── Private: throttle ──────────────────────────────────────────────────────

  /**
   * Throttle text_delta to ≤ 60 fps.
   *
   * Leading edge: the first delta in each burst is emitted immediately.
   * While the 16 ms window is open subsequent deltas overwrite `_pendingDelta`.
   * Trailing edge: the latest delta seen during the window is emitted when the
   * timer fires, or synchronously in the pump's `finally` block on generator
   * exhaustion.
   */
  private _throttleTextDelta(ev: SdkAgentEvent): void {
    this._pendingDelta = ev

    if (this._throttleTimer === null) {
      // Leading edge — emit the first delta of each burst immediately.
      this._flushDelta()

      // Open throttle window; trailing edge fires when the timer expires.
      this._throttleTimer = setTimeout(() => {
        this._throttleTimer = null
        if (this._pendingDelta !== null) {
          this._flushDelta()
        }
      }, TEXT_DELTA_THROTTLE_MS)
    }
    // While timer is active: _pendingDelta holds the latest value; no emission.
  }

  /**
   * Emit the pending delta (if any) on both `text_delta` and `event` channels.
   * Clears `_pendingDelta` after emission.
   */
  private _flushDelta(): void {
    if (this._pendingDelta !== null) {
      const ev = this._pendingDelta
      this._pendingDelta = null
      this.emit('text_delta', ev)
      this.emit('event', ev)
    }
  }

  /**
   * Cancel the active throttle timer and discard any pending delta.
   * Called by `stop()` so stale content is not emitted after shutdown.
   */
  private _cancelThrottle(): void {
    if (this._throttleTimer !== null) {
      clearTimeout(this._throttleTimer)
      this._throttleTimer = null
    }
    this._pendingDelta = null
  }
}

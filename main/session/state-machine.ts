import { EventEmitter } from 'node:events'

// ── types ─────────────────────────────────────────────────────────────────────

/** Phase-1 session states (Waiting / Auto added in later phases). */
export type SessionState = 'Working' | 'Idle' | 'Stopped'

/**
 * Events that drive state transitions.
 *
 * Callers feed pi events as they arrive from the RPC event stream:
 *   - `agent_start`     → Working
 *   - `agent_end`       → Idle
 *   - `transport-error` → Stopped
 *   - `watchdog-timeout`→ Stopped  (emitted internally; may also be fed externally)
 */
export type StateMachineInputEvent =
  | 'agent_start'
  | 'agent_end'
  | 'transport-error'
  | 'watchdog-timeout'

export interface StateChangedPayload {
  from: SessionState
  to: SessionState
  trigger: StateMachineInputEvent
}

export interface SessionStateMachineOptions {
  /**
   * Inactivity threshold while Working before the watchdog fires (ms).
   * Default: 30_000 (30 s).  Override in tests to keep them fast.
   */
  watchdogMs?: number
}

// ── events emitted ────────────────────────────────────────────────────────────

export interface SessionStateMachineEvents {
  'state-changed': (payload: StateChangedPayload) => void
}

declare interface SessionStateMachine {
  on(event: 'state-changed', listener: (payload: StateChangedPayload) => void): this
  emit(event: 'state-changed', payload: StateChangedPayload): boolean
}

// ── implementation ────────────────────────────────────────────────────────────

/**
 * Minimal 3-state session state machine: Working | Idle | Stopped.
 *
 * Usage
 * -----
 * ```ts
 * const sm = new SessionStateMachine()
 *
 * // Wire up your event pump
 * sm.on('state-changed', ({ from, to, trigger }) => { ... })
 *
 * // As events arrive from the pi RPC stream:
 * sm.feed('agent_start')    // → Working
 * sm.heartbeat()            // reset the 30 s inactivity watchdog
 * sm.feed('agent_end')      // → Idle
 *
 * // On teardown:
 * sm.destroy()
 * ```
 *
 * Watchdog
 * --------
 * The machine starts a 30 s inactivity timer whenever it enters Working.
 * Any call to `heartbeat()` (or any `feed()` call while Working) resets it.
 * If the timer fires the machine feeds itself a synthetic `watchdog-timeout`
 * and transitions to Stopped.
 */
class SessionStateMachine extends EventEmitter {
  private _state: SessionState = 'Idle'
  private _watchdogTimer: ReturnType<typeof setTimeout> | null = null
  private readonly _watchdogMs: number

  constructor(opts?: SessionStateMachineOptions) {
    super()
    this._watchdogMs = opts?.watchdogMs ?? 30_000
  }

  // ── public API ──────────────────────────────────────────────────────────────

  /** Current state. */
  get state(): SessionState {
    return this._state
  }

  /**
   * Feed an event from the pi RPC stream into the state machine.
   *
   * Any call while in Working state (except `watchdog-timeout`) resets the
   * inactivity timer — you don't need to call `heartbeat()` separately for
   * events you already pass to `feed()`.
   */
  feed(event: StateMachineInputEvent): void {
    const from = this._state

    // Treat every pi event as activity — reset watchdog before applying
    // the transition so the new timer only starts from a clean slate.
    if (from === 'Working' && event !== 'watchdog-timeout') {
      this._resetWatchdog()
    }

    const to = this._nextState(from, event)

    // No valid transition — ignore.
    if (to === null || to === from) return

    this._state = to

    if (to === 'Working') {
      this._startWatchdog()
    } else {
      this._clearWatchdog()
    }

    this.emit('state-changed', { from, to, trigger: event })
  }

  /**
   * Signal that a pi RPC event was received, resetting the inactivity watchdog.
   *
   * Call this for every event that arrives from the event stream so that normal
   * streaming activity (text_delta, tool_use, …) keeps the watchdog from firing
   * even when none of those events drive a state transition.
   */
  heartbeat(): void {
    if (this._state === 'Working') {
      this._resetWatchdog()
    }
  }

  /**
   * Release all timers and listeners.  Call on session teardown.
   */
  destroy(): void {
    this._clearWatchdog()
    this.removeAllListeners()
  }

  // ── transition table ────────────────────────────────────────────────────────

  private _nextState(
    current: SessionState,
    event: StateMachineInputEvent,
  ): SessionState | null {
    switch (event) {
      case 'agent_start':
        // Stopped is terminal in Phase 1 — a new process/handle is required.
        return current === 'Stopped' ? null : 'Working'

      case 'agent_end':
        return current === 'Working' ? 'Idle' : null

      case 'transport-error':
      case 'watchdog-timeout':
        return current !== 'Stopped' ? 'Stopped' : null

      default: {
        // Exhaustiveness guard — unknown events are ignored silently.
        const _exhaustive: never = event
        void _exhaustive
        return null
      }
    }
  }

  // ── watchdog ────────────────────────────────────────────────────────────────

  private _startWatchdog(): void {
    this._clearWatchdog()
    this._watchdogTimer = setTimeout(() => {
      this._watchdogTimer = null
      this.feed('watchdog-timeout')
    }, this._watchdogMs)
  }

  /** Restart the watchdog only if one is already running (i.e. we are Working). */
  private _resetWatchdog(): void {
    if (this._watchdogTimer !== null) {
      this._startWatchdog()
    }
  }

  private _clearWatchdog(): void {
    if (this._watchdogTimer !== null) {
      clearTimeout(this._watchdogTimer)
      this._watchdogTimer = null
    }
  }
}

export { SessionStateMachine }

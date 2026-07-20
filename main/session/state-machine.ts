import { EventEmitter } from 'node:events'

// ── types ─────────────────────────────────────────────────────────────────────

/** Session states. Waiting is entered while at least one UI-request blocker is open. */
export type SessionState = 'Working' | 'Idle' | 'Stopped' | 'Waiting'

/**
 * Events that drive state transitions via {@link SessionStateMachine.feed}.
 *
 * Callers feed pi events as they arrive from the RPC event stream:
 *   - `agent_start`     → Working
 *   - `agent_end`       → Idle
 *   - `transport-error` → Stopped
 *   - `watchdog-timeout`→ Stopped  (emitted internally; may also be fed externally)
 *
 * Blocker events are NOT in this union — use {@link SessionStateMachine.blockerAdded}
 * and {@link SessionStateMachine.blockerRemoved} directly.
 */
export type StateMachineInputEvent =
  | 'agent_start'
  | 'agent_end'
  | 'transport-error'
  | 'watchdog-timeout'

/**
 * All possible transition triggers — includes both feedable events and
 * blocker-driven triggers emitted by {@link SessionStateMachine.blockerAdded}
 * and {@link SessionStateMachine.blockerRemoved}.
 */
export type StateMachineTrigger =
  | StateMachineInputEvent
  | 'blocker-added'
  | 'blocker-removed'

export interface StateChangedPayload {
  from: SessionState
  to: SessionState
  trigger: StateMachineTrigger
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
 * 4-state session state machine: Working | Idle | Stopped | Waiting.
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
 * // Wire a BlockerTracker so blockers drive state (see SessionHandle):
 * tracker.on('ui-request-added',   ()  => sm.blockerAdded())
 * tracker.on('ui-request-removed', ()  => sm.blockerRemoved(tracker.size))
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
 * The watchdog is paused while in Waiting — it resumes if the machine returns
 * to Working when the last blocker is removed.
 *
 * Waiting
 * -------
 * While Waiting, `agent_start` / `agent_end` events silently update the
 * "return-to" state so that when all blockers are cleared the machine knows
 * whether to go back to Working or Idle.  `transport-error` and
 * `watchdog-timeout` can still transition to Stopped from Waiting.
 */
class SessionStateMachine extends EventEmitter {
  private _state: SessionState = 'Idle'
  private _watchdogTimer: ReturnType<typeof setTimeout> | null = null
  private readonly _watchdogMs: number

  /**
   * Tracks what state the machine was in when the first blocker was added so
   * we know where to return when all blockers are cleared.
   * Only non-null while `_state === 'Waiting'`.
   */
  private _preWaitingState: 'Working' | 'Idle' | null = null

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
   *
   * While in Waiting state, `agent_start` and `agent_end` silently update
   * the return-to state without changing the visible state.
   */
  feed(event: StateMachineInputEvent): void {
    const from = this._state

    // While Waiting, agent lifecycle events update the return-to state so
    // blockerRemoved() knows where to go when the last blocker clears.
    // transport-error and watchdog-timeout fall through to normal handling.
    if (from === 'Waiting') {
      if (event === 'agent_start') {
        this._preWaitingState = 'Working'
        return
      }
      if (event === 'agent_end') {
        this._preWaitingState = 'Idle'
        return
      }
      // transport-error / watchdog-timeout fall through below
    }

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

    // Clear waiting-state tracking when leaving Waiting (e.g. via transport-error)
    if (from === 'Waiting') {
      this._preWaitingState = null
    }

    this.emit('state-changed', { from, to, trigger: event })
  }

  /**
   * Notify the state machine that a UI-request blocker was added.
   *
   * Transitions to Waiting from any non-Stopped, non-Waiting state.
   * No-op from Stopped (terminal) or Waiting (already blocked — multiple
   * concurrent blockers are tracked externally by {@link BlockerTracker}).
   */
  blockerAdded(): void {
    const from = this._state
    if (from === 'Stopped' || from === 'Waiting') return

    // Pause the watchdog — we're waiting for the user, not the agent.
    if (from === 'Working') {
      this._clearWatchdog()
    }

    this._preWaitingState = from
    this._state = 'Waiting'
    this.emit('state-changed', { from, to: 'Waiting', trigger: 'blocker-added' })
  }

  /**
   * Notify the state machine that a UI-request blocker was removed.
   *
   * @param remainingCount Number of blockers still open (from
   *   {@link BlockerTracker.size}).  When > 0 the machine stays in Waiting.
   *   When 0, transitions back to Working or Idle depending on what state the
   *   session was in before the first blocker was added.
   *
   * No-op when not in Waiting state or when blockers remain.
   */
  blockerRemoved(remainingCount: number): void {
    if (this._state !== 'Waiting') return
    if (remainingCount > 0) return

    const from = this._state
    // Defensive fallback to Idle if somehow _preWaitingState is null.
    const to: SessionState = this._preWaitingState === 'Working' ? 'Working' : 'Idle'
    this._preWaitingState = null
    this._state = to

    // Re-arm the watchdog if returning to Working (agent is still active).
    if (to === 'Working') {
      this._startWatchdog()
    }

    this.emit('state-changed', { from, to, trigger: 'blocker-removed' })
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
    this._preWaitingState = null
    this.removeAllListeners()
  }

  // ── transition table ────────────────────────────────────────────────────────

  private _nextState(
    current: SessionState,
    event: StateMachineInputEvent,
  ): SessionState | null {
    switch (event) {
      case 'agent_start':
        // Stopped is terminal — a new process/handle is required.
        // Waiting is handled early in feed() before _nextState is reached.
        return current === 'Stopped' || current === 'Waiting' ? null : 'Working'

      case 'agent_end':
        // Waiting is handled early in feed() before _nextState is reached.
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

---
id: T04
parent: S02
milestone: M002
key_files:
  - main/session/session-handle.ts
  - main/session/session-handle.test.ts
key_decisions:
  - text_delta uses leading-edge throttle with trailing flush-on-generator-end: first delta emitted immediately, burst deltas collapse to latest, pump finally block drains remaining pending — no fake timers needed for deterministic tests
  - transport-error suppression relies on _stopped being set synchronously before any await in stop() — callers can fire-and-forget stop() and the pump's catch branch will skip emit
  - stop() before start() is safe (sets _stopped=true, calls client.stop(), state='stopped') because the pump never launched; idempotent guard short-circuits repeat calls
  - _cancelThrottle() discards pending delta on stop() — prevents stale token content being flushed after session teardown
duration: 
verification_result: passed
completed_at: 2026-07-20T14:19:13.407Z
blocker_discovered: false
---

# T04: Implemented SessionHandle with unawaited async event pump, per-type dispatch, 16ms text_delta throttle, and transport-error handling — 26 Vitest tests green

**Implemented SessionHandle with unawaited async event pump, per-type dispatch, 16ms text_delta throttle, and transport-error handling — 26 Vitest tests green**

## What Happened



## Failure Modes (Q5)

| Dependency | Failure | Handling |
|---|---|---|
| `client.events()` generator throws | Transport error (EPIPE, ECONNRESET, etc.) | Caught in `_pump`'s try/catch; emits `transport-error: { error }`. Suppressed if `_stopped` is true (stop() races with throw). |
| `client.stop()` rejects | Teardown failure | Swallowed via `.catch(() => undefined)` in `stop()` — callers always get a resolved promise. State transitions to 'stopped' regardless. |
| `client.events()` generator ends prematurely | Session closed by pi | `for await` exits naturally; `finally` resets state to 'idle' and flushes any pending delta. Not treated as an error. |
| `start()` called twice | Logic error in caller | Throws synchronously with a descriptive message including `sessionId` and current state. |

## Load Profile (Q6)

The high-frequency resource is `text_delta` events. At 60fps input (the max pi streaming rate), the throttle emits exactly 60 events/second regardless of how many raw deltas arrive. `_pendingDelta` is a single object reference — memory usage is O(1) regardless of burst size.

For all other event types, dispatch is synchronous in-process EventEmitter.emit with no buffering. At 10x normal load (~600 tool_use/s), the EventEmitter queue would grow but there is no explicit protection; this is acceptable because IPC fan-out (the expensive step) is one layer up in the SessionManager which owns the throttle budget.

## Negative Tests (Q7)

| Scenario | Test |
|---|---|
| `start()` while running | `throws if start() is called a second time (state "running")` |
| `start()` after stopped | `throws if start() is called after stop()` |
| Repeated `stop()` | `stop() is idempotent — second call resolves without error` |
| `stop()` before any `start()` | `stop() is safe before start()` |
| Generator throws → transport-error | `emits "transport-error" with the thrown error` |
| Transport-error suppressed after stop() | `suppresses "transport-error" when stop() is called before pump processes throw` |
| `client.stop()` rejects | `stop() resolves even if client.stop() rejects` |
| Middle text_delta suppressed | `throttles rapid text_delta bursts — emits leading edge + latest, drops middle` |
| Unknown type not on named channel | `emits "unknown-event" for unrecognised event types` |
| Suppressed deltas not on unknown-event | `suppressed text_delta events are NOT emitted on "unknown-event"` |


## Verification

pnpm test -- session-handle: 26/26 passed (11ms test runtime, 455ms total). Test file: main/session/session-handle.test.ts. Coverage: lifecycle state transitions (idle/running/idle/stopped), double-start guard, post-stop-start guard, idempotent stop, stop-before-start safety, sessionId exposure, all 5 known event types via it.each, generic 'event' channel fan-out, unknown-event wrapping, console.debug for unknowns, transport-error emission, transport-error suppression after stop, text_delta leading-edge, throttle burst (leading+trailing, middle dropped), text_delta on 'event' channel, suppressed deltas not on unknown-event, client.stop() called once, client.stop() rejection swallowed.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- session-handle` | 0 | ✅ pass — 26/26 tests | 455ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `main/session/session-handle.ts`
- `main/session/session-handle.test.ts`

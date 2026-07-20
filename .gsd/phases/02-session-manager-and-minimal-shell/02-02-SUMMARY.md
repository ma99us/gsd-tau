---
id: S02
parent: M002
milestone: M002
provides:
  - createClient() factory — creates, starts, and inits an RpcClient against a real gsd install
  - SessionHandle — subscribes to RPC event stream and fans typed events to an EventEmitter with throttled text_delta
  - ClientInitError type with piPath for structured error surfacing
  - PiCapabilities and PiInitInfo types in shared/types.ts for IPC-safe capability detection
requires:
  []
affects:
  - S03
key_files:
  - main/pi/client-factory.ts
  - main/pi/client-factory.test.ts
  - main/session/session-handle.ts
  - main/session/session-handle.test.ts
  - shared/types.ts
key_decisions:
  - ClientInitError carries a readonly piPath so the session manager can surface the binary path in error UI without reparsing the message string
  - start() failures are NOT wrapped in ClientInitError — they propagate as raw OS errors to let callers distinguish process-spawn vs protocol failures
  - text_delta uses leading-edge throttle with trailing flush-on-generator-end — first delta emitted immediately, burst collapses to latest, pump finally block drains remaining pending
  - transport-error suppression relies on _stopped being set synchronously before any await in stop() — fire-and-forget stop() is safe
  - stop() before start() is safe — sets _stopped=true and calls client.stop() without the pump ever launching
patterns_established:
  - createClient() factory pattern: resolve binary → create RpcClient → start() → init() → validate protocol → return or throw ClientInitError
  - SessionHandle leading-edge throttle with generator-end trailing flush for high-frequency streaming events (text_delta)
  - Synchronous _stopped flag set before first await in stop() to guard async pump error handlers without race conditions
observability_surfaces:
  - console.debug for unknown event types in SessionHandle pump
  - ClientInitError message includes piPath and upgrade hint for structured error surfacing
drill_down_paths:
  - .gsd/phases/02-session-manager-and-minimal-shell/S02-T03-SUMMARY.md
  - .gsd/phases/02-session-manager-and-minimal-shell/S02-T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-20T14:20:26.313Z
blocker_discovered: false
---

# S02: pi Client and Event Pump

**RpcClient factory and SessionHandle event pump implemented with 41 Vitest tests covering all lifecycle paths, throttling, and error handling**

## What Happened

T03 delivered `createClient()` in `main/pi/client-factory.ts` — it resolves the binary, creates an RpcClient, calls `start()` then `init()` in order, enforces v2 protocol, and throws `ClientInitError` (with `piPath` and upgrade hint) on any init failure. 15 Vitest tests cover ordering, binary resolution priority, timeout/ECONNRESET wrapping, protocol-version guard, and stop-failure swallowing.

T04 delivered `SessionHandle` in `main/session/session-handle.ts` — constructor accepts a started RpcClient and sessionId; `start()` launches an unawaited async pump over `client.events()`. Typed events (`agent_start`, `agent_end`, `message`, `text_delta`, `tool_use`, `tool_result`) are dispatched per-type and also fan-out to the generic `event` channel. Unknown event types are logged at debug and re-emitted as `unknown-event`. A leading-edge 16ms throttle collapses text_delta bursts; the pump's `finally` block drains any pending delta before exit. Transport errors are caught and emitted as `transport-error`, suppressed after `stop()` by synchronously setting `_stopped` before any await. 26 Vitest tests cover all lifecycle transitions, idempotence, per-type dispatch, throttle behaviour, and error paths.

Combined: 2 test files, 41 tests, all green. Duration 476ms.

## Verification

pnpm test -- client-factory session-handle: 2 test files, 41/41 passed (exec e1b9c587). T03: 15/15 tests — ordering, binary resolution, ClientInitError wrapping, protocol guard, stop-failure swallow. T04: 26/26 tests — lifecycle states, double-start guard, post-stop-start guard, idempotent stop, stop-before-start safety, sessionId exposure, all 5 known event types via it.each, generic event fan-out, unknown-event wrapping, transport-error emission and suppression, text_delta leading-edge throttle with trailing flush.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

["binary option uses nullish coalescing (??) rather than OR (||) — explicit empty string bypasses resolver intentionally, covered by test"]

## Known Limitations

["No live pi process integration tested — all tests use mocked RpcClient. Live integration deferred to S03/S04.", "Phase-1 restriction: single concurrent session only (lifted in M004)"]

## Follow-ups

["S03 can directly consume createClient() and SessionHandle — no interface changes expected", "Live integration smoke (real gsd --mode rpc) should be added in S03 or S06 verification"]

## Files Created/Modified

- `main/pi/client-factory.ts` — createClient() factory with binary resolution, ordered start/init, v2 protocol guard, and ClientInitError
- `main/pi/client-factory.test.ts` — 15 Vitest tests for factory ordering, binary priority, all failure paths
- `shared/types.ts` — ClientInitError, PiCapabilities, PiInitInfo types — no SDK imports, safe across IPC boundary
- `main/session/session-handle.ts` — SessionHandle with async event pump, per-type dispatch, 16ms text_delta throttle, transport-error handling
- `main/session/session-handle.test.ts` — 26 Vitest tests covering full lifecycle, all event types, throttle, transport-error suppression

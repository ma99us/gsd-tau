---
id: S03
parent: M002
milestone: M002
provides:
  - SessionStateMachine class — importable by SessionHandle (S04)
  - SessionManager class — importable by IPC bridge (S04)
  - Stable session ID scheme (s_ prefix)
requires:
  - slice: S02
    provides: createClient / SessionHandle from pi-client wrapper
affects:
  - S04
key_files:
  - main/session/state-machine.ts
  - main/session/state-machine.test.ts
  - main/session/session-manager.ts
  - main/session/session-manager.test.ts
key_decisions:
  - Stopped is terminal in Phase 1 — agent_start is a no-op; new process/handle required to restart.
  - feed() resets watchdog on any non-watchdog-timeout event while Working; heartbeat() is for streaming events.
  - Used crypto.randomBytes(9).toString('base64url') instead of nanoid — stdlib, same entropy, no extra dep.
  - Session removed from Map before async teardown to prevent re-entrant double-close.
  - client.shutdown() takes no arguments — plan's 'shutdown({ graceful: true })' notation was from docs, not SDK signature.
  - watchdogMs is configurable so tests can run fast with a short timeout while defaulting to 30 000ms.
patterns_established:
  - State machine emits 'state-changed' events on every transition — consumers subscribe rather than polling.
  - SessionManager single-session guard enforced at open() time with a clear thrown error for Phase-1 constraint.
  - IDs use s_<base64url> prefix pattern for session handles — stable across process lifetime.
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/phases/02-session-manager-and-minimal-shell/S03-T05-SUMMARY.md
  - .gsd/phases/02-session-manager-and-minimal-shell/S03-T06-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-20T14:33:47.436Z
blocker_discovered: false
---

# S03: Session State Machine and Manager

**SessionStateMachine (3-state + 30s watchdog) and SessionManager (stable IDs, single-session guard, 3s shutdown timeout) implemented with 54 Vitest tests all passing.**

## What Happened

T05 implemented `SessionStateMachine` in `main/session/state-machine.ts` with three states (Working / Idle / Stopped), four transitions (agent_start → Working; agent_end → Idle; transport-error / watchdog-timeout → Stopped), and a configurable 30s inactivity watchdog. `feed()` resets the watchdog for any non-watchdog-timeout event while Working; `heartbeat()` is provided for streaming events that don't drive transitions. Stopped is terminal in Phase 1 — a new handle/process is required to restart. 25 Vitest unit tests cover all transitions, watchdog fire, and negative cases.

T06 implemented `SessionManager` in `main/session/session-manager.ts` wrapping `SessionHandle` objects with stable `s_`-prefixed IDs generated via `crypto.randomBytes(9).toString('base64url')` (no extra dependency vs nanoid). Phase-1 single-session guard throws if `open()` is called while a session is active. `close()` calls `handle.stop()` then `client.shutdown()` with a 3s timeout fallback to `client.stop()`. Sessions are removed from the Map before async teardown to prevent re-entrant double-close. 29 Vitest unit tests cover open/get/close lifecycle, guard, shutdown timeout, and error paths — all with mocked `createClient`.

## Verification

Ran `pnpm test -- state-machine` (1 file, 25 tests, all passed, ~511ms) and `pnpm test -- session-manager` (1 file, 29 tests, all passed, ~517ms) via gsd_exec (node + pwsh). Both exit 0. Total: 54 tests passing, 0 failing.

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

Used `crypto.randomBytes` instead of `nanoid` for ID generation. nanoid is a transitive dep but not declared in package.json; crypto.randomBytes is stdlib with equivalent entropy. No functional deviation from the plan's intent.

## Known Limitations

Phase-1 enforces one session at a time. Multi-session support is deferred to a later phase. Stopped state is terminal — no restart without a new SessionHandle.

## Follow-ups

None.

## Files Created/Modified

- `main/session/state-machine.ts` — SessionStateMachine: Working/Idle/Stopped states, transitions, 30s inactivity watchdog, feed()/heartbeat() API
- `main/session/state-machine.test.ts` — 25 Vitest unit tests covering all transitions, watchdog, and negative cases
- `main/session/session-manager.ts` — SessionManager: open/get/close lifecycle, stable s_-prefixed IDs, Phase-1 single-session guard, 3s shutdown timeout
- `main/session/session-manager.test.ts` — 29 Vitest unit tests with mocked createClient covering full lifecycle, guard, and error paths

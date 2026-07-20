---
id: T05
parent: S03
milestone: M002
key_files:
  - main/session/state-machine.ts
  - main/session/state-machine.test.ts
key_decisions:
  - Stopped is terminal in Phase 1 — agent_start is a no-op; a new process/handle is required to restart
  - feed() resets the watchdog on any non-watchdog-timeout event while Working, so callers don't need to call heartbeat() separately for events already passed to feed()
  - heartbeat() is provided for streaming events (text_delta, tool_use) that don't drive transitions but should extend the inactivity window
  - watchdogMs is configurable to keep tests fast while defaulting to the spec's 30s
duration: 
verification_result: passed
completed_at: 2026-07-20T14:25:22.886Z
blocker_discovered: false
---

# T05: Implemented SessionStateMachine (Working/Idle/Stopped) with 30s inactivity watchdog; 25 Vitest tests all pass covering all transitions, watchdog, and negative cases.

**Implemented SessionStateMachine (Working/Idle/Stopped) with 30s inactivity watchdog; 25 Vitest tests all pass covering all transitions, watchdog, and negative cases.**

## What Happened


Implemented `main/session/state-machine.ts` — a minimal 3-state machine (Working | Idle | Stopped) as specified for Phase 1.

**Design decisions:**
- Extends `node:events` EventEmitter; emits `state-changed` with `{ from, to, trigger }` on every valid transition.
- `feed(event)` drives transitions: `agent_start` → Working (unless Stopped, which is terminal); `agent_end` → Idle (from Working only); `transport-error` | `watchdog-timeout` → Stopped (from any non-Stopped).
- `heartbeat()` resets the inactivity watchdog without triggering a transition — callers should call this for every RPC event (text_delta, tool_use, etc.) that doesn't drive a transition.
- `feed()` itself also resets the watchdog for any non-`watchdog-timeout` event received while Working, so callers don't need to call both.
- `destroy()` clears the timer and removes all listeners — required for clean session teardown.
- Watchdog is only active while in Working state. Exiting Working always cancels it. Re-entering Working always starts a fresh timer.
- `watchdogMs` is configurable (default 30,000) — tests use the real 30s value with Vitest fake timers.

**Transition table:**
- Stopped is terminal in Phase 1; `agent_start` is silently ignored.
- Default exhaustiveness guard in the switch handles future unknown events without crashing.

**Tests (25 total):** all transitions, state-changed payload shape, Stopped terminal enforcement, watchdog fires at 30s / not at 29,999ms, heartbeat resets timer, feed() resets timer, watchdog cleared on exit, fresh timer on re-entry, no timer bleed between Working stints, destroy() cancels timer and removes listeners.


## Verification


Ran `pnpm test -- state-machine` via gsd_exec (node + pwsh).
Result: 1 test file, 25 tests — all passed. Duration ~476ms.


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- state-machine` | 0 | ✅ pass — 25/25 tests passed | 2177ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `main/session/state-machine.ts`
- `main/session/state-machine.test.ts`

---
id: S01
parent: M003
milestone: M003
provides:
  - UiRequestState and UiResponseInput types in shared/types.ts
  - BlockerTracker class in main/session/blocker-tracker.ts
  - Waiting-on-you state in SessionStateMachine
  - wireBlockerTracker integration in SessionHandle
requires:
  []
affects:
  - S02
key_files:
  - shared/types.ts
  - main/session/blocker-tracker.ts
  - main/session/blocker-tracker.test.ts
  - main/session/state-machine.ts
  - main/session/state-machine.test.ts
  - main/session/session-handle.ts
key_decisions:
  - Used `import type` from @opengsd/contracts in shared/types.ts — zero runtime footprint in renderer bundle
  - UiRequestState typed as Record<string, RpcExtensionUIRequest> (not Map) — must be JSON-serialisable across IPC
  - BlockerTracker.remove() is a strict no-op for unknown ids — idempotent cancel-all on shutdown
  - blockerAdded/blockerRemoved are separate methods (not feed() variants) because blockerRemoved needs remainingCount context
  - _preWaitingState stores return-to state; agent_start/agent_end while Waiting silently update it so the transition knows where to land
  - wireBlockerTracker returns a cleanup closure — callers control the lifetime
patterns_established:
  - Typed EventEmitter overload pattern (declare interface + overloaded on/emit) for type-safe events without runtime overhead
  - wireBlockerTracker cleanup-closure pattern for lifetime management
  - getAll() returns plain Record (Object.fromEntries) rather than Map — IPC-serialisable snapshots
observability_surfaces:
  - none
drill_down_paths:
  []
duration: ""
verification_result: passed
completed_at: 2026-07-20T18:26:09.619Z
blocker_discovered: false
---

# S01: Contract Types and BlockerTracker

**Shared UI-request contract types, a Map-backed BlockerTracker with typed EventEmitter events, and a Waiting-on-you state added to SessionStateMachine — 65 unit tests all green.**

## What Happened

T01 added `RpcExtensionUIRequest`/`RpcExtensionUIResponse` re-exports and `UiRequestState`/`UiResponseInput` types to `shared/types.ts` using `import type` so the renderer bundle never pulls in Node modules from `@opengsd/contracts`. T02 implemented `BlockerTracker` in `main/session/blocker-tracker.ts` — a `Map<requestId, RpcExtensionUIRequest>` per session with `add`, `remove`, `getAll`, `size` methods and typed EventEmitter events (`ui-request-added`, `ui-request-removed`); 20 Vitest tests cover all boundary conditions including duplicate-id overwrite and idempotent remove. T03 extended `SessionStateMachine` with the `Waiting on you` state: `blockerAdded` transitions from any non-Stopped state to Waiting, storing the pre-wait state; `blockerRemoved` returns to Working or Idle based on agent activity and remaining blocker count. `SessionHandle.wireBlockerTracker` wires `BlockerTracker` events into the state machine and returns a cleanup closure. 45 state-machine tests pass, covering all new Waiting transitions.

## Verification

Ran `pnpm test -- blocker-tracker state-machine --reporter=verbose`: 2 test files, 65 tests, all passed (0 failed), 477ms. Ran `pnpm tsc --noEmit`: 0 errors in S01 files; 2 pre-existing errors in session-manager.test.ts (M002 scope, not regressed by S01).

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

None.

## Known Limitations

None. All planned outcomes delivered.

## Follow-ups

None.

## Files Created/Modified

- `shared/types.ts` — Added RpcExtensionUIRequest/Response re-exports and UiRequestState/UiResponseInput type definitions
- `main/session/blocker-tracker.ts` — New: Map-backed BlockerTracker with typed EventEmitter events
- `main/session/blocker-tracker.test.ts` — New: 20 Vitest tests for BlockerTracker
- `main/session/state-machine.ts` — Added Waiting-on-you state, blockerAdded/blockerRemoved methods, _preWaitingState
- `main/session/state-machine.test.ts` — Updated: 45 tests including new Waiting transition coverage
- `main/session/session-handle.ts` — Added wireBlockerTracker method wiring BlockerTracker events into state machine

---
id: T02
parent: S01
milestone: M003
key_files:
  - main/session/blocker-tracker.ts
  - main/session/blocker-tracker.test.ts
key_decisions:
  - Followed declare-interface typed-overload pattern from state-machine.ts so EventEmitter.on/emit calls are fully type-safe without runtime overhead
  - getAll() returns Object.fromEntries() (plain Record) not the Map itself — keeps IPC serialisation safe and snapshot isolation free
  - add() overwrites duplicate ids and re-emits — handles retry/re-delivery from pi without special-casing at the call site
  - remove() is a strict no-op (no event) for unknown ids — lets callers call remove() idempotently on cancel-all shutdown without guard checks
duration: 
verification_result: passed
completed_at: 2026-07-20T18:18:10.112Z
blocker_discovered: false
---

# T02: Implemented BlockerTracker with Map-backed add/remove/getAll/size, typed EventEmitter events, and 20 Vitest tests covering all boundary conditions

**Implemented BlockerTracker with Map-backed add/remove/getAll/size, typed EventEmitter events, and 20 Vitest tests covering all boundary conditions**

## What Happened

## Failure Modes

BlockerTracker has no external dependencies (no filesystem, network, subprocesses, or APIs). It is a pure in-memory EventEmitter backed by a `Map`. No failure-mode section applies; gate recorded as omitted.

## Load Profile

BlockerTracker is bounded by concurrent `extension_ui_request` events from a single pi session. In practice this is 1–5 simultaneous blockers. Even a 10× spike (≈50 blockers) is negligible for O(1) `Map` operations. No pool sizing, rate limiting, or pagination is needed. Gate recorded as omitted.

## Negative Tests

Covered in `main/session/blocker-tracker.test.ts`:
- `'remove() on unknown id is a no-op — no event emitted'` — verifies no `ui-request-removed` fires for an absent id
- `'remove() on unknown id does not affect existing blockers'` — verifies Map is unchanged
- `'double-remove of same id is a no-op on the second call'` — verifies exactly one event fires
- `'add() with duplicate id overwrites and still emits'` — verifies idempotent overwrite emits twice with second payload
- `'removeAllListeners() stops event emission'` — verifies internal Map still mutates correctly after listener teardown

## Verification

Ran: `pnpm test -- blocker-tracker` → 1 test file, 20 tests, all passed, exit 0, 508 ms. No TypeScript errors (types resolved via shared/types.ts import type re-export established in T01).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- blocker-tracker` | 0 | ✅ pass — 20/20 tests passed | 2664ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `main/session/blocker-tracker.ts`
- `main/session/blocker-tracker.test.ts`

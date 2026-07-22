---
id: T03
parent: S01
milestone: M008
key_files:
  - main/ipc/handlers.ts
  - main/ipc/handlers.test.ts
key_decisions:
  - ShowStoppedToastFn and ShowMilestoneCompleteToastFn inserted before registryStore in the parameter list so all three toast callbacks are adjacent; T04 must update index.ts to pass real implementations in the new positions.
  - onTransportError fires showStoppedToastFn synchronously before the fan-out — consistent with how showBlockerToastFn is called.
  - progressTracker.removeAllListeners() in session cleanup already tears down onMilestoneComplete — no separate off() call needed.
duration: 
verification_result: passed
completed_at: 2026-07-22T20:04:25.091Z
blocker_discovered: false
---

# T03: Wired ShowStoppedToastFn and ShowMilestoneCompleteToastFn into registerHandlers via MEM016 injectable-callback pattern with 5 new tests; all 116 handlers tests pass

**Wired ShowStoppedToastFn and ShowMilestoneCompleteToastFn into registerHandlers via MEM016 injectable-callback pattern with 5 new tests; all 116 handlers tests pass**

## What Happened

Added two new exported type aliases to handlers.ts — `ShowStoppedToastFn` and `ShowMilestoneCompleteToastFn` — after the existing `ShowBlockerToastFn`. Both default to no-ops in `registerHandlers` so existing callers need no changes.

In `doOpenProject`:
- `onTransportError` now calls `showStoppedToastFn(basename(cwd))` immediately after feeding the `'transport-error'` event into the state machine.
- A new `onMilestoneComplete` listener subscribes to `progressTracker.on('milestone-complete', ...)` and calls `showMilestoneCompleteToastFn(basename(cwd), milestone.title)`. ProgressTracker already emits this event from `_completeMilestone` (wired in T02). The existing `progressTracker.removeAllListeners()` in session cleanup automatically tears down this listener.

`registerHandlers` signature updated to insert the two new optional params between `showBlockerToastFn` and `registryStore`:
```
(manager, getAllWebContents, showBlockerToastFn, showStoppedToastFn, showMilestoneCompleteToastFn, registryStore, getWinId, quotaService)
```

The quota-service describe block in handlers.test.ts was passing `mockQuotaService` in positional slot 6 (registryStore). Fixed by adding two `undefined` slots so it lands correctly in slot 8 (quotaService). Verified all pre-existing quota tests still pass.

Added a new `describe('stopped and milestone-complete toast callbacks', ...)` inside the outer `describe('registerHandlers', ...)`. The nested `beforeEach` calls the outer `cleanup()`, creates fresh `vi.fn()` mocks, and re-registers with them. Five tests cover:
1. `showStoppedToastFn` called with `basename(cwd)` on transport-error
2. `showStoppedToastFn` NOT called for agent_start/agent_end events
3. `showMilestoneCompleteToastFn` called with correct session name and milestone title
4. `showMilestoneCompleteToastFn` NOT called for non-complete tool events (e.g. gsd_plan_slice)
5. `showMilestoneCompleteToastFn` NOT called when milestoneId doesn't match the active milestone

## Verification

Ran `npx vitest run handlers --reporter=verbose` — 1 test file, 116 tests, 0 failures (3.46s). All 5 new toast tests pass. All pre-existing quota, progress, state-machine, and IPC handler tests unaffected.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx vitest run handlers --reporter=verbose` | 0 | ✅ pass — 116/116 tests pass, including 5 new toast callback tests | 8772ms |

## Deviations

None. The new params were inserted before `registryStore` (not appended at the end) to keep all three toast callbacks adjacent; this required fixing the quota-describe `registerHandlers` call in handlers.test.ts (2 extra `undefined`s). T04 will need to update index.ts accordingly.

## Known Issues

None.

## Files Created/Modified

- `main/ipc/handlers.ts`
- `main/ipc/handlers.test.ts`

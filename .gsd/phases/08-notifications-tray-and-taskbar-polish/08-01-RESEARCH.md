# M008/S01 — Expand toast coverage to Stopped and milestone complete

**Date:** 2026-07-22

## Summary

The blocker-toast infrastructure already exists and is clean. `main/os/notifications.ts` exports `showBlockerToast(sessionName, method)` (debounced per-session, 3 s). `main/ipc/handlers.ts` accepts it as an injectable callback (`ShowBlockerToastFn`) following the MEM016 pattern, and fires it from the `onBlockerAdded` handler. The `onStateChange` and `onProgressUpdated` handlers currently only fan out IPC pushes — neither fires a toast. Two new toast types are needed: one for session → Stopped transitions, one for `gsd_complete_milestone` tool calls.

All three wiring points (notifications module, ProgressTracker, handlers) follow the same injectable-callback pattern already in place. No new libraries needed. Risk is low.

## Recommendation

Add two new exported functions to `notifications.ts` (`showStoppedToast`, `showMilestoneCompleteToast`), emit a dedicated `'milestone-complete'` event from `ProgressTracker._completeMilestone()`, and wire both into `handlers.ts` as injectable callbacks matching the existing MEM016 pattern. Pass real implementations in `main/index.ts`.

## Implementation Landscape

### Key Files

- `main/os/notifications.ts` — add `showStoppedToast(sessionName)` and `showMilestoneCompleteToast(sessionName, milestoneTitle)`. Same debounce guard and `Notification.isSupported()` check as `showBlockerToast`. Click handler raises window.
- `main/ipc/handlers.ts` — add `ShowStoppedToastFn` and `ShowMilestoneCompleteToastFn` injectable types; add both as optional params to `registerHandlers` (default no-op). Wire `onStateChange` to call `showStoppedToastFn(sessionName)` when `payload.to === 'Stopped'`. Subscribe `progressTracker.on('milestone-complete', ...)` and call `showMilestoneCompleteToastFn(sessionName, title)`.
- `main/session/progress-tracker.ts` — emit `'milestone-complete'` event from `_completeMilestone()` with `{ milestoneId: string; title: string }` payload. Add the event type to the `ProgressTrackerEvents` interface. The existing `'updated'` event fires unconditionally on every tool call — a dedicated event is cleaner than checking `milestone.status === 'complete'` in `onProgressUpdated`.
- `main/index.ts` — pass `showStoppedToast` and `showMilestoneCompleteToast` to `registerHandlers` alongside the existing `showBlockerToast`.
- `main/os/notifications.test.ts` — add `describe` blocks for the two new functions mirroring existing `showBlockerToast` tests.
- `main/ipc/handlers.test.ts` — add tests verifying Stopped triggers `showStoppedToastFn` and that `gsd_complete_milestone` triggers `showMilestoneCompleteToastFn`. Follow the existing injectable mock pattern.

### Build Order

1. `main/os/notifications.ts` — new functions (pure, no dependencies on other changes)
2. `main/session/progress-tracker.ts` — add `'milestone-complete'` event emission
3. `main/ipc/handlers.ts` — wire both new callbacks
4. `main/index.ts` — pass real implementations
5. Tests for all four files above

### Verification Approach

```
pnpm test -- --testPathPattern="notifications|handlers"
```
All 1184+ existing tests must still pass. New tests confirm:
- `showStoppedToast` fires on state-change `to: 'Stopped'` (transport-error or watchdog-timeout)
- `showStoppedToast` does NOT fire for other state transitions (Working, Idle, Waiting)
- `showMilestoneCompleteToast` fires when `gsd_complete_milestone` tool event is processed
- Both respect the existing debounce per-session
- Blocker toast still fires unchanged

## Common Pitfalls

- **Stopped fires on every transport-error and watchdog-timeout** — the debounce in `notifications.ts` already guards against spam for the same session within 3 s. Reuse it.
- **`onProgressUpdated` fires for every tool call** — do NOT detect milestone-complete by checking `progress.milestone?.status === 'complete'` inside `onProgressUpdated`. That fires on every subsequent tool event after completion. Use the dedicated `'milestone-complete'` event instead.
- **`milestone.title` is available in `_completeMilestone`** — `a.title` is passed as the milestone `oneLiner`/`title` arg to `gsd_complete_milestone`. Check progress-tracker.ts line 307 — the milestone object is already stored so `m.title` is available. Use `m.title` in the event payload rather than re-parsing.

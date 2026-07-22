---
id: T02
parent: S01
milestone: M008
key_files:
  - main/session/progress-tracker.ts
  - main/session/progress-tracker.test.ts
key_decisions:
  - milestone-complete fires inside _completeMilestone (before the generic 'updated' from handleToolUse) so handlers receive it as a distinct signal rather than inferring status from every 'updated' emission.
  - Payload is structuredClone(m) — callers hold an independent snapshot; no additional defensive copy needed at the call-site.
  - No debounce or deduplication at ProgressTracker level — the tracker is stateless w.r.t. whether it already fired; handlers (T03) own that policy.
duration: 
verification_result: passed
completed_at: 2026-07-22T19:56:11.901Z
blocker_discovered: false
---

# T02: ProgressTracker emits a typed 'milestone-complete' event (deep-copy payload) from _completeMilestone, guarded by milestoneId match; 6 new tests covering happy path, id mismatch, no-active-milestone, status, deep-copy isolation, and 'updated' co-emission all pass (55 total, 0 failures)

**ProgressTracker emits a typed 'milestone-complete' event (deep-copy payload) from _completeMilestone, guarded by milestoneId match; 6 new tests covering happy path, id mismatch, no-active-milestone, status, deep-copy isolation, and 'updated' co-emission all pass (55 total, 0 failures)**

## What Happened


Two targeted edits to `main/session/progress-tracker.ts`:

1. **Typed event overloads** – Extended the `declare interface ProgressTracker` block with two new overloads:
   - `on(event: 'milestone-complete', listener: (milestone: GsdMilestone) => void): this`
   - `emit(event: 'milestone-complete', milestone: GsdMilestone): boolean`
   This gives full TypeScript type-safety at every `tracker.on('milestone-complete', …)` call-site.

2. **Emission in `_completeMilestone`** – After setting `m.status = 'complete'` and clearing `currentSliceId`/`currentTaskId`, the method now calls `this.emit('milestone-complete', structuredClone(m))`. Using `structuredClone` ensures the listener receives an independent copy — callers may hold the reference without coupling to the tracker's internal state. The generic `'updated'` event continues to fire from `handleToolUse` immediately after, so downstream listeners that watch for any progress change are unaffected.

Six new tests were added to `main/session/progress-tracker.test.ts` inside a `"'milestone-complete' event"` describe block:
- fires when `gsd_complete_milestone` matches the active milestone
- emitted milestone has status `'complete'`
- does NOT fire when milestoneId does not match
- does NOT fire when no milestone is active (fresh tracker, no `gsd_plan_milestone`)
- emitted payload is an independent deep copy (mutating `captured.id` does not affect `tracker.snapshot()`)
- `'updated'` still fires in addition to `'milestone-complete'`

All 55 tests pass in 1.38s.


## Verification

Ran `pnpm vitest run progress-tracker`. 1 test file, 55 tests — all passed, 0 failures, 1.38s total.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run progress-tracker` | 0 | ✅ pass — 55 passed (55) | 8447ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `main/session/progress-tracker.ts`
- `main/session/progress-tracker.test.ts`

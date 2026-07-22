---
id: T01
parent: S01
milestone: M008
key_files:
  - main/os/notifications.ts
  - main/os/notifications.test.ts
key_decisions:
  - showStoppedToast has no debounce — a session stops at most once per lifecycle, so suppression would only hide legitimate signal.
  - showMilestoneCompleteToast uses 'milestone:{sessionName}' as the debounce Map key — keeps the per-session 3s window independent from the blocker-toast key for the same session, allowing both to fire simultaneously when they represent different events.
duration: 
verification_result: passed
completed_at: 2026-07-22T19:53:42.144Z
blocker_discovered: false
---

# T01: Added showStoppedToast (no debounce) and showMilestoneCompleteToast (per-session 3s debounce with 'milestone:' key) to notifications module with 18 new tests covering happy path, debounce, platform guard, and click handler

**Added showStoppedToast (no debounce) and showMilestoneCompleteToast (per-session 3s debounce with 'milestone:' key) to notifications module with 18 new tests covering happy path, debounce, platform guard, and click handler**

## What Happened


**What was built:**

`main/os/notifications.ts` — two new exported functions:

1. **`showStoppedToast(sessionName: string)`** — fires once when a session stops; no debounce guard (a session lifecycle only stops once). Follows the same Notification+click-handler pattern as `showBlockerToast`. Title: `'gsd-tau session stopped'`, body: `'{sessionName} has stopped'`.

2. **`showMilestoneCompleteToast(sessionName: string, milestoneTitle: string)`** — fires when a milestone completes. Uses a `'milestone:{sessionName}'` prefixed key in `lastToastTime` so its 3s debounce timer is completely independent of the blocker-toast timer for the same session. Title: `'Milestone complete'`, body: `'{sessionName}: {milestoneTitle}'`.

Both functions share the existing `Notification.isSupported()` platform guard and the same click handler pattern (`win.show()` + `app.focus({ steal: true })`).

`main/os/notifications.test.ts` — import updated to include both new exports. Two new `describe` blocks added (18 new tests total):

- `showStoppedToast`: correct title/body, click listener registered + `show()` called, session name rendered, two consecutive calls both fire (no debounce), `isSupported=false` skips toast, click handler covers win.show and no-window cases.
- `showMilestoneCompleteToast`: correct title/body, debounce suppresses second call within 3s, different sessions each get their own toast, debounce window expiry allows second call, 1ms-before-expiry still suppresses, independent debounce keys (blocker+milestone for same session both fire), `isSupported=false` skips toast but debounce timer still advances, click handler covers win.show and no-window cases.


## Verification

Ran `pnpm test -- notifications --reporter=verbose`. 1 test file, 32 tests (14 pre-existing + 18 new), all passed in 1.28s.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- notifications --reporter=verbose` | 0 | ✅ pass — 32/32 tests passed | 7147ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `main/os/notifications.ts`
- `main/os/notifications.test.ts`

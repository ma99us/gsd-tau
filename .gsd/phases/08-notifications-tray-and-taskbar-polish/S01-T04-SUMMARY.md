---
id: T04
parent: S01
milestone: M008
key_files:
  - main/index.ts
key_decisions:
  - showStoppedToast and showMilestoneCompleteToast are passed in positional slots 4 and 5 of registerHandlers, matching the parameter order from T03 (all three toast callbacks are adjacent, before registryStore).
duration: 
verification_result: passed
completed_at: 2026-07-22T20:06:18.633Z
blocker_discovered: false
---

# T04: Wired showStoppedToast and showMilestoneCompleteToast into registerHandlers call in main/index.ts, completing the production composition root

**Wired showStoppedToast and showMilestoneCompleteToast into registerHandlers call in main/index.ts, completing the production composition root**

## What Happened

main/index.ts was the only remaining gap: registerHandlers had three injectable toast slots from T03 but the composition root still passed only showBlockerToast, leaving the two new slots as no-ops in production.

Two changes were made:
1. Import line extended to `import { showBlockerToast, showStoppedToast, showMilestoneCompleteToast } from './os/notifications'`
2. The `registerHandlers(...)` call in `app.whenReady()` updated to pass `showStoppedToast` and `showMilestoneCompleteToast` in the new positional slots (args 4 and 5), between `showBlockerToast` and `registryStore`, matching the parameter order established in T03.

No test changes were needed — the injection is tested by handlers.test.ts (T03) and notifications.test.ts (T01). The full suite was run to confirm no regressions.

## Verification

pnpm test — all 42 test suites, 1218 tests passed in ~5.2s. No failures or skipped tests.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test` | 0 | ✅ pass — 42 suites, 1218 tests | 11154ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `main/index.ts`

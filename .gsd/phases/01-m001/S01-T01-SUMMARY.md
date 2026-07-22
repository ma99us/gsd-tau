---
id: T01
parent: S01
milestone: M001
key_files:
  - main/ipc/handlers.ts
  - main/session/progress-reconciler.ts
key_decisions:
  - Seeding call is absent; T02 will add it after progressTracker.on('updated') wiring. milestoneId must be discovered from {cwd}/.gsd/STATE.md 'Active Milestone' line since tracker has no milestone ID at open time.
duration: 
verification_result: passed
completed_at: 2026-07-22T17:55:39.237Z
blocker_discovered: false
---

# T01: Audit confirmed: reconcileProgress seeding call is absent from doOpenProject; only fires on execution_complete events

**Audit confirmed: reconcileProgress seeding call is absent from doOpenProject; only fires on execution_complete events**

## What Happened

Read main/ipc/handlers.ts. doOpenProject (line 363) creates progressTracker at line 371, wires it with progressTracker.on('updated', onProgressUpdated) at line 532. After that wiring, no reconcileProgress call appears before sessions.set(). The only reconcileProgress call inside doOpenProject is nested inside the execution_complete branch of the onEvent handler (lines 480-495), which only fires when pi sends an execution_complete event — not at session open/reattach time.\n\nread main/session/progress-reconciler.ts: signature is reconcileProgress(cwd: string, milestoneId: string): Promise<ReconcileResult> — milestoneId is required. Reads from {cwd}/.gsd/phases/{milestoneId}/{milestoneId}-ROADMAP.md.\n\nConclusion: seeding call is absent. T02 must add it, and must also handle the milestoneId discovery problem (progressTracker has no milestone ID at open time; propose reading {cwd}/.gsd/STATE.md Active Milestone line).

## Verification

Read main/ipc/handlers.ts lines 525-545: progressTracker.on('updated', onProgressUpdated) at line 532, followed immediately by handle.on event wiring and sessions.set(). No reconcileProgress call in that gap. reconcileProgress only appears at lines 485-495 inside the execution_complete branch. Seeding at open time is absent.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pwsh Select-String -Path main/ipc/handlers.ts -Pattern 'reconcileProgress|progressTracker.on'` | 0 | reconcileProgress only at lines 485 (execution_complete branch) and 868 (manual refresh handler). progressTracker.on('updated') at line 532 with no reconcileProgress in the same block. | 1200ms |

## Deviations

Path was wrong in the original plan (src/main/ipc/ instead of main/ipc/). Corrected by reopening and re-executing with the real path.

## Known Issues

None.

## Files Created/Modified

- `main/ipc/handlers.ts`
- `main/session/progress-reconciler.ts`

# S01 Replan

**Milestone:** M001
**Slice:** S01
**Blocker Task:** T01
**Created:** 2026-07-22T17:55:52.672Z

## Blocker Description

All task plans referenced src/main/ipc/handlers.ts — the file lives at main/ipc/handlers.ts. T01 was incorrectly blocked by this wrong path. T02 also needs an expanded spec: reconcileProgress(cwd, milestoneId) requires milestoneId but progressTracker.snapshot().milestone?.id is always undefined at open time; the fix must discover the active milestone from {cwd}/.gsd/STATE.md.

## What Changed

Corrected file paths (src/main/ipc/ → main/ipc/). Expanded T02 description to include the milestoneId discovery strategy (read STATE.md 'Active Milestone' line) since progressTracker has no milestone ID at open time. T03 unchanged structurally.

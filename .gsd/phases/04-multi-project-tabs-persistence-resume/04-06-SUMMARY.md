---
id: S06
parent: M004
milestone: M004
provides:
  - activeTabCwd persisted to registry.json on every tab switch
  - activeTabCwd restored to correct session on relaunch via CWD lookup
  - Playwright reboot-cycle test asserting exact project-c active tab
  - 51-test sessions-store unit suite fully green
requires:
  - slice: S05
    provides: Restore flow, missing-file banner, window bounds infrastructure; listMissingPaths and onSessionMissingPath IPC calls added to init()
affects:
  []
key_files:
  - renderer/state/sessions-store.test.ts
  - shared/types.ts
  - main/persistence/registry-store.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
  - main/index.ts
  - renderer/state/sessions-store.ts
  - test/reboot-cycle.spec.ts
key_decisions:
  - activeTabCwd (not activeTabId) is the cross-reboot persistence key — session IDs are ephemeral, CWD is stable
  - Lazy getWinId getter in registerHandlers — win is created after handlers are registered, a direct param would be undefined
  - openTab routes through setActiveTab — ensures the full saveWindowActiveTab chain fires even when a new tab becomes active via openTab rather than an explicit click
  - Synchronous in-memory mutation in updateWindowActiveTab — prevents stale CWD on quick tab-switch-then-quit
patterns_established:
  - Use CWD as cross-reboot session identity when session IDs are regenerated per launch
  - Lazy getter closures for window references when IPC handlers register before the window exists
observability_surfaces:
  - electron-log logs activeTabCwd on save (saveWindowActiveTab handler) and restore (onRestoreComplete in main/index.ts)
  - registry.json activeTabCwd field reflects the last-active project CWD after each tab switch
drill_down_paths:
  - .gsd/phases/04-multi-project-tabs-persistence-resume/S06-T01-SUMMARY.md
  - .gsd/phases/04-multi-project-tabs-persistence-resume/S06-T02-SUMMARY.md
  - .gsd/phases/04-multi-project-tabs-persistence-resume/S06-T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-21T16:20:49.627Z
blocker_discovered: false
---

# S06: Reboot Test Fix, activeTabId Restore, and UAT Completion

**Wired activeTabCwd persistence and restore pipeline end-to-end, fixed all 51 sessions-store unit tests, and tightened the Playwright reboot-cycle assertion to exact project-c match.**

## What Happened

Three tasks combined to close M004's remaining gaps:

**T01** patched `makeGsdMock()` in `renderer/state/sessions-store.test.ts` to add `listMissingPaths` and `onSessionMissingPath` stubs. S05's T10 had added real IPC calls inside `init()` but left the test mock stale, causing all 4 `init()`-calling tests to throw "gsd().listMissingPaths is not a function". After T01 the suite went from 47 → 51 passing, 0 failing.

**T02** wired the full activeTabCwd persistence and restore pipeline across 7 files. The core insight: `WindowRecord.activeTabId` is an ephemeral ID regenerated every launch; the stable cross-reboot key is the project CWD. Changes: added `activeTabCwd` to `WindowRecord` and `RestoreResult` (shared/types.ts); added `updateWindowActiveTab()` to registry-store with synchronous in-memory mutation (so a quick tab-switch-then-quit doesn't race); added `saveWindowActiveTab` IPC handler using a lazy `getWinId` getter (main registers handlers before the window object exists); exposed `saveWindowActiveTab` in preload; wired `onRestoreComplete` in main/index.ts to read `activeTabCwd` from the restore result and call `setActiveTab` via IPC; updated `sessions-store.ts` to call `saveWindowActiveTab` on `setActiveTab` and restore the active tab in `onRestoreComplete` by looking up session by CWD. An important routing fix: `openTab` now calls `setActiveTab` instead of setting `activeTabId` directly, so opening project-c as the last tab correctly persists its CWD through the `setActiveTab → saveWindowActiveTab` chain.

**T03** tightened the reboot-cycle Playwright spec's active-tab assertion from a loose `FIXTURE_NAMES.some()` check to `expect(activeLabel).toContain('project-c')`, exercising the exact guarantee T02 delivers.

## Verification

passed

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

openTab now routes through get().setActiveTab(id) instead of setting activeTabId directly. The plan specified only instrumenting setActiveTab, but the research flow is openTab → setActiveTab → saveWindowActiveTab; without this routing the Playwright reboot test would fail since project-c becomes active via openTab on the initial open, not via an explicit tab click.

## Known Limitations

5–6 pre-existing failing tests in main/session/session-manager.test.ts (restore() function tests) remain. These predate S06 and are not caused by any file modified in this slice. Multi-window (detached) activeTabCwd persistence is not addressed.

## Follow-ups

The pre-existing session-manager.test.ts failures should be addressed in a future slice or cleanup pass. Playwright reboot-cycle test should be run against the packaged app as part of M004 milestone validation.

## Files Created/Modified

- `renderer/state/sessions-store.test.ts` — Added listMissingPaths and onSessionMissingPath to makeGsdMock(); added setActiveTab and openTab test stubs for activeTabCwd wiring
- `shared/types.ts` — Added activeTabCwd field to WindowRecord and RestoreResult
- `main/persistence/registry-store.ts` — Added updateWindowActiveTab() with synchronous in-memory mutation
- `main/ipc/handlers.ts` — Added saveWindowActiveTab IPC handler with lazy getWinId getter
- `preload/preload.ts` — Exposed saveWindowActiveTab in window.gsd preload API
- `main/index.ts` — Wired onRestoreComplete to read activeTabCwd and call setActiveTab via IPC
- `renderer/state/sessions-store.ts` — setActiveTab calls saveWindowActiveTab; onRestoreComplete restores active tab by CWD lookup; openTab routes through setActiveTab
- `test/reboot-cycle.spec.ts` — Tightened active-tab assertion from loose FIXTURE_NAMES.some() to exact toContain('project-c')

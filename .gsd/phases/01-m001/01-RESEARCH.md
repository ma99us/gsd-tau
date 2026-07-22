# M001: Auto-run Panel — Research

**Date:** 2026-07-22
**Status:** Complete — implementation already fully shipped

## Summary

M001's implementation is **already complete** in the codebase. Every component, IPC channel, data model, and unit test described in the milestone context exists and passes. The milestone was effectively delivered as part of prior development work.

A full audit found:

- **`shared/types.ts`** — `GsdProgress`, `GsdMilestone`, `GsdSlice`, `GsdTask`, `GsdNodeStatus` types are defined; `GsdApi` includes `getProgress`, `onProgressUpdate`, `openRoadmap`; IPC channels `GET_PROGRESS`, `REFRESH_PROGRESS`, `OPEN_ROADMAP`, `PROGRESS_UPDATE` are all declared.
- **`main/session/progress-tracker.ts`** — Full `ProgressTracker` class: handles all 10 workflow tool events (`gsd_plan_milestone`, `gsd_plan_slice`, `gsd_plan_task`, `gsd_task_complete`, `gsd_slice_complete`, `gsd_complete_milestone`, `gsd_skip_slice`, `gsd_replan_slice`/alias, `gsd_reassess_roadmap`/alias), `handleCostUpdate`, `applyReconciliation`, `snapshot()`. Emits `'updated'` event.
- **`main/session/progress-reconciler.ts`** — `parseRoadmapCheckboxes` (pure, testable), `reconcileProgress` (filesystem read against `{cwd}/.gsd/phases/{milestoneId}/{milestoneId}-ROADMAP.md`). Never throws — returns `hasData: false` on any error.
- **`main/ipc/handlers.ts`** — `doOpenProject` instantiates `ProgressTracker`, wires `tool_execution_end` → `progressTracker.handleToolUse`, `cost_update` → `progressTracker.handleCostUpdate`, `progressTracker.on('updated', ...)` → `fanOut(PUSH.PROGRESS_UPDATE, ...)`. Handlers for `GET_PROGRESS`, `REFRESH_PROGRESS`, `OPEN_ROADMAP` all implemented including the milestone-directory prefix scan for the roadmap file.
- **`renderer/components/AutoRunPanel.tsx`** — Full render component with `MilestoneTree`, `SliceRow`, `TaskRow`, status icons (`statusIcon`), replan badge, footer with `formatCost` / `formatElapsed` / `computePanelFooter`. Pure exported helpers for testing.
- **`renderer/components/SessionView.tsx`** — `useEffect` subscribes to `getProgress` on mount and `onProgressUpdate` live; Ctrl+/ keyboard toggle; `handlePause` (`abort()`), `handleRefresh` (`getProgress`), `handleOpenRoadmap` (`openRoadmap`); `AutoRunPanel` rendered conditionally on `progress !== null && progress.milestone !== null && panelOpen`.
- **Test suite** — 42 test files, 1184 tests, all passing.

The only open question from the context doc — whether `client.bash()` `excludeFromContext` is needed — is moot: Path B is implemented via file system `reconcileProgress` (reads ROADMAP.md directly), not via `client.bash()`. This is a simpler and valid approach that avoids the context-pollution concern entirely.

## Recommendation

**No new implementation work is needed for M001's core scope.** The planning phase should reflect this. The slices should be scoped as validation/integration verification tasks rather than build tasks:

- **S01 — Verify & validate Path A+B unit tests** (already 1184 passing — confirm coverage of all tool events including replan/reassess edge cases)
- **S02 — Integration smoke test** (confirm ProgressTracker wiring in handlers produces live panel updates in a running Electron session; verify Pause/Refresh/OpenRoadmap buttons work end-to-end)
- **S03 — Session reattach seeding** (the context doc mentions seeding from `.gsd/STATE.md` on reattach — this may not yet be implemented; `reconcileProgress` handles the ROADMAP.md side but the "discover current milestone" seeder on session reattach needs verification)

**Check needed:** The context doc mentions seeding from `.gsd/STATE.md` on session reattach (Path B fires on first attach). Check whether `handlers.ts` fires a reconciliation on `openProject` or if this is the one gap.

## Implementation Landscape

### Key Files

- `main/session/progress-tracker.ts` — Complete. All workflow tool handlers, cost tracking, Path B apply.
- `main/session/progress-reconciler.ts` — Complete. Reads ROADMAP.md checkboxes; pure parse function is independently tested.
- `main/ipc/handlers.ts` — Complete. ProgressTracker instantiated per session in `doOpenProject`. `tool_execution_end` drives Path A. `updated` event fans out `PROGRESS_UPDATE`. Three IPC handlers fully implemented.
- `renderer/components/AutoRunPanel.tsx` — Complete. Props-driven, pure helpers exported for vitest.
- `renderer/components/SessionView.tsx` — Complete. Progress state, Ctrl+/ toggle, all callbacks wired.
- `shared/types.ts` — Complete. Full type surface including `GsdProgress`, `GsdApi` progress methods.
- `main/session/progress-tracker.test.ts` — Comprehensive test coverage exists.
- `renderer/components/AutoRunPanel.test.ts` — Test coverage exists.

### One Gap to Verify

**Session reattach seeding:** The milestone context requires that on reattach, Path B fires to reseed state. Check `handlers.ts` `doOpenProject` — does it fire `reconcileProgress` immediately after wiring the ProgressTracker? If not, this is the one remaining task.

### Build Order

1. Verify the reattach seeding gap (read the `doOpenProject` wiring after line ~532 in handlers.ts)
2. If gap exists: add a post-open `reconcileProgress` call in `doOpenProject` (small addition)
3. Run existing 1184-test suite to confirm no regression

### Verification Approach

```
pnpm test --run  # must show 1184 passing
```

Integration: launch gsd-tau, start `/gsd auto` on a test project, observe panel appears and updates. Press Pause, verify pi receives abort. Click Refresh, verify reconciliation call.

## Constraints

- Path B uses ROADMAP.md file reads (not `client.bash()`); `excludeFromContext` concern is moot.
- No direct `.gsd/gsd.db` reads — constraint respected; reconciler uses ROADMAP.md only.
- Windows-only target — no cross-platform issues.

## Common Pitfalls

- **`tool_execution_end` not `tool_use`** — Path A is wired to `tool_execution_end` events (pi 1.11+), not `tool_use`. This is correct per the RPC event surface but differs from the doc examples. Verify the event field names (`toolName`, `args`) match what pi actually emits.
- **Replan badge title** — `slice.replanNote` is populated from `whatChanged` field but the CONTEXT doc mentions hover tooltip; verify `title` attribute is correctly set on the badge span (it is, in AutoRunPanel.tsx).

## Sources

- Direct codebase inspection of `main/`, `renderer/`, `shared/`, `preload/` source trees
- `docs/50-auto-run-view.md` — design specification
- `.gsd/phases/01-m001/01-CONTEXT.md` — milestone context

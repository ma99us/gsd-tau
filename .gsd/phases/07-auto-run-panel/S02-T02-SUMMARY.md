---
id: T02
parent: S02
milestone: M007
key_files:
  - main/session/progress-tracker.ts
  - main/ipc/handlers.ts
  - shared/types.ts
  - preload/preload.ts
  - preload/preload.test.ts
  - main/ipc/handlers.test.ts
key_decisions:
  - applyReconciliation added to ProgressTracker (deviation from T01 file list) — required for Path B merge API; no alternative without exposing private _progress
  - Path B reconciliation fires as a void promise on execution_complete — errors are caught+warned, never propagate to onEvent
  - REFRESH_PROGRESS handler uses entry.cwd from SessionEntry (added field) rather than re-querying manager.list() — avoids a race with session close
  - handlers.test.ts toHaveBeenCalledTimes updated 23→25 to account for the 2 new ipcMain.handle calls
duration: 
verification_result: passed
completed_at: 2026-07-22T15:25:07.607Z
blocker_discovered: false
---

# T02: Wired ProgressTracker into handlers/IPC/preload: tool_use+cost_update forwarding, Path B ROADMAP.md reconciliation on execution_complete, PUSH.PROGRESS_UPDATE fan-out, GET_PROGRESS+REFRESH_PROGRESS handlers, and GsdApi.getProgress+onProgressUpdate in preload

**Wired ProgressTracker into handlers/IPC/preload: tool_use+cost_update forwarding, Path B ROADMAP.md reconciliation on execution_complete, PUSH.PROGRESS_UPDATE fan-out, GET_PROGRESS+REFRESH_PROGRESS handlers, and GsdApi.getProgress+onProgressUpdate in preload**

## What Happened


## What Happened

T02 is the integration task that atomically wires all S02 pieces together. Six files were changed:

### main/session/progress-tracker.ts
Added `applyReconciliation(sliceStatuses: Map<string, GsdNodeStatus>)` — the merge API needed by Path B reconciliation. Upgrades slices to 'complete' when ROADMAP.md shows `[x]`; never downgrades 'complete' or 'skipped'. Cascades newly-completed slice → all incomplete tasks → complete. Emits 'updated' only when at least one slice status changed.

### main/ipc/handlers.ts (12 targeted edits)
1. **Imports**: Added `ProgressTracker`, `reconcileProgress`, and `GsdProgress` to imports.
2. **IPC constant**: Added `GET_PROGRESS: 'getProgress'` and `REFRESH_PROGRESS: 'refreshProgress'`.
3. **PUSH constant**: Added `PROGRESS_UPDATE: 'session:progress-update'`.
4. **SessionEntry interface**: Added `progressTracker: ProgressTracker` and `cwd: string` fields.
5. **doOpenProject**: Instantiates `ProgressTracker` alongside `BlockerTracker`.
6. **onEvent — tool_use**: Casts `ev` and calls `progressTracker.handleToolUse(toolName, toolInput)` when `toolName` is present.
7. **onEvent — cost_update**: Calls `progressTracker.handleCostUpdate(totalCostUsd)` when `totalCostUsd` is a number.
8. **onEvent — execution_complete**: After capturing `statsFile`, extracts `milestoneId` from `progressTracker.snapshot().milestone?.id`. Logs a warning when no milestone; fires `reconcileProgress(cwd, milestoneId)` as a void promise on the happy path, calling `progressTracker.applyReconciliation(result.sliceStatuses)` when `result.hasData`.
9. **onProgressUpdated listener**: Registered before `handle.on('event', onEvent)`. Logs the milestone ID and fans out `PUSH.PROGRESS_UPDATE` with `{ sessionId, progress }`.
10. **sessions.set**: Added `progressTracker` and `cwd` to the stored entry; added `progressTracker.removeAllListeners()` to the cleanup closure.
11. **GET_PROGRESS handler**: Synchronous — returns `entry.progressTracker.snapshot()` or null.
12. **REFRESH_PROGRESS handler**: Async — runs `reconcileProgress(entry.cwd, milestoneId)` and merges result, then returns the refreshed snapshot.
13. **cleanup()**: Added `ipcMain.removeHandler(IPC.GET_PROGRESS)` and `ipcMain.removeHandler(IPC.REFRESH_PROGRESS)`.
14. **handlers.test.ts**: Updated `toHaveBeenCalledTimes(23)` → `(25)` (2 new handlers added).

### shared/types.ts
Added to `GsdApi`:
- `getProgress(sessionId: SessionId): Promise<GsdProgress | null>`
- `onProgressUpdate(sessionId: SessionId, cb: (progress: GsdProgress) => void): Unsubscribe`

### preload/preload.ts
- Added `GsdProgress` to the type import list.
- Added `GET_PROGRESS` and `REFRESH_PROGRESS` to the local `IPC` constant.
- Added `PROGRESS_UPDATE: 'session:progress-update'` to the local `PUSH` constant.
- Added `getProgress` (ipcRenderer.invoke) and `onProgressUpdate` (ipcRenderer.on with sessionId filter) to `createGsdApi()`, following the exact pattern of `onStateChange` and `onQuotaUpdate`.

### preload/preload.test.ts
Added 9 new tests covering `getProgress` (3 tests) and `onProgressUpdate` (6 tests): channel registration, snapshot passthrough, null-on-unknown, sessionId filtering, unsubscribe mechanics, and idempotency.

### Deviations
`progress-tracker.ts` was listed in T01 files but was also touched here to add `applyReconciliation` — required for the integration since T01 had no merge API. This is a minor, necessary deviation. `handlers.test.ts` also required updating the `toHaveBeenCalledTimes` count from 23 to 25.


## Verification

pnpm tsc --noEmit → clean (exit 0, 12s). pnpm vitest run → 41 test files, 1112 tests passed (exit 0, 24s). Slice verification criteria met: console.log lines in handlers.ts when Path B reconciliation fires and when progress is pushed; console.warn when reconciler finds no milestone ID. All three PUSH/IPC channel names match between handlers.ts and preload.ts. GsdApi interface satisfies TypeScript structural check.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 12053ms |
| 2 | `pnpm vitest run` | 0 | ✅ pass — 41 files, 1112 tests | 23885ms |

## Deviations

progress-tracker.ts touched to add applyReconciliation (T01 file list omitted it; required for the T02 merge). handlers.test.ts toHaveBeenCalledTimes count updated 23→25.

## Known Issues

None.

## Files Created/Modified

- `main/session/progress-tracker.ts`
- `main/ipc/handlers.ts`
- `shared/types.ts`
- `preload/preload.ts`
- `preload/preload.test.ts`
- `main/ipc/handlers.test.ts`

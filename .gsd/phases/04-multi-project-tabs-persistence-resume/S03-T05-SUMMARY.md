---
id: T05
parent: S03
milestone: M004
key_files:
  - main/ipc/handlers.ts
  - main/ipc/handlers.test.ts
  - main/index.ts
  - shared/types.ts
  - preload/preload.ts
key_decisions:
  - registerHandlers return type changed from `() => void` to `{ cleanup, handleOpenProject }` so second-instance handler can call openProject in-process without IPC round-trip
  - closeSession tears down handler-level state machine BEFORE delegating to SessionManager.close(), preventing fan-out events after tab close
  - parseOpenProjectArg exported from handlers.ts (not index.ts) so it co-locates with its test file
  - shared/types.ts GsdApi and preload.ts updated in T05 to unblock T06's listSessions() call
duration: 
verification_result: passed
completed_at: 2026-07-21T13:09:02.849Z
blocker_discovered: false
---

# T05: Single-instance lock + multi-session IPC (listSessions/closeSession/renameSession) wired; 82/82 tests pass, 0 tsc errors

**Single-instance lock + multi-session IPC (listSessions/closeSession/renameSession) wired; 82/82 tests pass, 0 tsc errors**

## What Happened

Implemented the single-instance Electron lock in `main/index.ts`: `app.requestSingleInstanceLock()` is called before `app.whenReady()`; if the lock is not obtained the process calls `app.quit()` immediately. When the lock is held, a `second-instance` listener parses the forwarded argv for `--open-project <path>` and calls `handleOpenProject` (a function returned by `registerHandlers`) to open the project in-process, then focuses the primary window.

In `main/ipc/handlers.ts`, three new IPC constants were added (`LIST_SESSIONS`, `CLOSE_SESSION`, `RENAME_SESSION`) and the openProject handler body was extracted into a local `doOpenProject(cwd)` function shared with the second-instance path. Three new IPC handlers were wired: `listSessions()` delegates to `manager.list()`; `closeSession(id)` tears down the handler-level state machine and listeners before delegating to `manager.close(id)`; `renameSession(id, name)` delegates to `manager.rename(id, name)`. The `cleanup` function now removes all 12 handlers. The return type changed from `() => void` to `{ cleanup, handleOpenProject }`.

The `parseOpenProjectArg(argv)` pure function was exported from `handlers.ts` for use in both `main/index.ts` and the test suite.

`shared/types.ts` (`GsdApi`) and `preload/preload.ts` were updated to expose the three new methods to the renderer, unblocking T06's `listSessions()` call. 10 tests covering the new handlers and 10 tests covering `parseOpenProjectArg` were added to `handlers.test.ts`, with the manager mock extended with `list` and `rename` stubs and the handler-count assertions updated to 12.

## Verification

pnpm test -- handlers.test: 82/82 passed (all new describe blocks: listSessions ×3, closeSession ×4, renameSession ×3, parseOpenProjectArg ×10). pnpm exec tsc --noEmit: 0 errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- handlers.test --reporter=verbose` | 0 | ✅ pass | 624ms |
| 2 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 2933ms |

## Deviations

shared/types.ts and preload/preload.ts were updated (not listed in T05 files) to expose listSessions/closeSession/renameSession to the renderer, since T06 depends on window.gsd.listSessions() being available.

## Known Issues

None.

## Files Created/Modified

- `main/ipc/handlers.ts`
- `main/ipc/handlers.test.ts`
- `main/index.ts`
- `shared/types.ts`
- `preload/preload.ts`

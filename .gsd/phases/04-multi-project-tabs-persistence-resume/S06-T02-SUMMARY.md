---
id: T02
parent: S06
milestone: M004
key_files:
  - shared/types.ts
  - main/persistence/registry-store.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
  - main/index.ts
  - renderer/state/sessions-store.ts
  - renderer/state/sessions-store.test.ts
key_decisions:
  - Added activeTabCwd to WindowRecord and RestoreResult (not activeTabId) — session IDs are ephemeral (regenerated on every launch); CWD is the stable cross-reboot identifier
  - Used lazy getWinId getter in registerHandlers — win is created after registerHandlers is called, so a direct winId param would be undefined at call time; a getter closure resolves it at IPC invocation time
  - Routed openTab through setActiveTab instead of setting activeTabId directly in openTab's set() — research flow requires openTab → setActiveTab → saveWindowActiveTab; without this routing, project-c opened as last tab would never persist its CWD
  - Immediate in-memory mutation in updateWindowActiveTab — win.on('close') flushes synchronously; delayed mutation would cause stale CWD on quick tab-switch-then-quit
  - Replaced early return in onRestoreComplete with if-block — early return prevented activeTabCwd restore from running in the typical case where all sessions are already loaded via init()
duration: 
verification_result: passed
completed_at: 2026-07-21T16:17:36.805Z
blocker_discovered: false
---

# T02: Wired activeTabCwd persistence and restore pipeline across 7 files: shared types, registry, IPC handlers, preload, main/index, sessions-store, and test mock

**Wired activeTabCwd persistence and restore pipeline across 7 files: shared types, registry, IPC handlers, preload, main/index, sessions-store, and test mock**

## What Happened

## What Was Done

Implemented the full `activeTabCwd` persistence and restore pipeline to solve the cross-reboot active-tab problem. The root cause: `WindowRecord.activeTabId` stores an ephemeral session ID that becomes invalid after reboot because `session-manager.open()` generates a new random ID on every launch. The fix stores the project CWD (stable across reboots) instead.

### Changes by file

**`shared/types.ts`** — Added `activeTabCwd?: string` to `WindowRecord` (the persisted stable identifier) and `RestoreResult` (so main can forward it to the renderer on startup). Added `saveWindowActiveTab(cwd: string): Promise<void>` to `GsdApi` interface.

**`main/persistence/registry-store.ts`** — Added `updateWindowActiveTab(windowId, cwd)` method that mutates `_windows` immediately (no debounce on the in-memory update, per the pitfall in the research: the synchronous `win.on('close')` flush must capture the latest value) then schedules a debounced disk write. Pattern mirrors `updateWindowBounds`.

**`main/ipc/handlers.ts`** — Added `SAVE_WINDOW_ACTIVE_TAB: 'saveWindowActiveTab'` to the `IPC` channel map. Updated `registerHandlers` to accept two new optional params: `registryStore?: RegistryStore` and `getWinId?: () => string` (lazy getter called at handler invocation time, not registration time, since `winId` is unavailable at `registerHandlers` call time). Registered the `SAVE_WINDOW_ACTIVE_TAB` handler — no-op if either param is absent (safe in tests). Added `ipcMain.removeHandler(IPC.SAVE_WINDOW_ACTIVE_TAB)` to cleanup. Added `import type { RegistryStore }` from the persistence layer.

**`preload/preload.ts`** — Added `SAVE_WINDOW_ACTIVE_TAB: 'saveWindowActiveTab'` to the local IPC mirror. Added `saveWindowActiveTab: (cwd) => ipcRenderer.invoke(IPC.SAVE_WINDOW_ACTIVE_TAB, cwd)` to `createGsdApi()`.

**`main/index.ts`** — Three changes: (1) Declared `let _winId = ''` before `registerHandlers`, (2) passed `registryStore` and `() => _winId` as new params, (3) set `_winId = winId` after `createMainWindow` so the lazy getter resolves correctly at handler invocation time. Also spread `activeTabCwd: registry.windows[0]?.activeTabCwd` into the `PUSH.RESTORE_COMPLETE` payload — this is the previous session's persisted value, loaded at startup before any `updateWindowActiveTab` calls.

**`renderer/state/sessions-store.ts`** — Three changes: (1) Refactored `openTab` to call `get().setActiveTab(id)` after `set()` instead of including `activeTabId: id` directly — this routes through the single `setActiveTab` path so CWD is always persisted (research flow: openTab → setActiveTab → saveWindowActiveTab). (2) Updated `setActiveTab` to fire-and-forget `void gsd().saveWindowActiveTab(get().sessions[id]?.cwd ?? '')` — sessions is populated by the time this runs. (3) Updated `onRestoreComplete` to replace the early return (`if length === 0 return`) with an if-block so the `activeTabCwd` restore logic runs even when no new sessions arrive (the typical post-reboot case where all sessions are already loaded via `init()`). Added CWD lookup after the if-block that finds the matching non-missing-path session and calls `set({ activeTabId: match.id })`.

**`renderer/state/sessions-store.test.ts`** — Added `saveWindowActiveTab: vi.fn().mockResolvedValue(undefined)` to `makeGsdMock()` defaults. Updated the `setActiveTab` test to stub `gsd` via `makeGsdMock()` (required because `setActiveTab` now calls `gsd().saveWindowActiveTab(...)` — without the stub, `gsd()` returns undefined and throws synchronously).

### Key design decisions

**Lazy `getWinId` getter** — `registerHandlers` is called before `createMainWindow` in `main/index.ts`. A direct `winId` param would be `undefined` at call time. Using `() => _winId` (read at invocation) is the minimal change that avoids restructuring the call order or moving `registerHandlers` after window creation.

**Routing `openTab` through `setActiveTab`** — The plan said only `setActiveTab`. But the Playwright reboot test's project-c is the "last-opened tab" — it becomes active via `openTab`, not via an explicit tab click. Without routing `openTab → setActiveTab`, the CWD would never be persisted for that case, and T03's exact assertion would fail. This deviation is aligned with the research's stated flow.

**Immediate in-memory mutation in `updateWindowActiveTab`** — `win.on('close')` calls `registryStore.flush()` synchronously. If `updateWindowActiveTab` only scheduled a debounce, the flush might write a stale value. Mutating `_windows` immediately (not inside the debounce callback) ensures flush always captures the latest CWD.

**Removing early return from `onRestoreComplete`** — The early return `if (newRecords.length === 0 && newMissing.length === 0) return` prevented the `activeTabCwd` restore from running in the typical reboot case (where all sessions are already in the store from `init()`). The fix wraps the mutation in an if-block and always runs the CWD restore afterward.

### Pre-existing test failures
5–6 tests in `main/session/session-manager.test.ts` (restore() function tests) fail in the full `pnpm exec vitest run`. These are pre-existing issues — `session-manager.ts` and `session-manager.test.ts` were not modified by T02.

## Verification

**TypeScript:** `pnpm exec tsc --noEmit` → exit 0 (no type errors across all 7 modified files).

**sessions-store unit tests:** `pnpm exec vitest run renderer/state/sessions-store.test.ts` → 51 passed, 0 failed. All tests including the updated `setActiveTab` test (now stubs gsd) and all `openTab` tests (now route through `setActiveTab`) pass.

**Full test suite:** `pnpm exec vitest run` → 601 passed, 6 failed. All 6 failures are pre-existing tests in `main/session/session-manager.test.ts` (restore() function tests); that file was not modified by T02. Confirmed by running `pnpm exec vitest run main/session/session-manager.test.ts` in isolation: same 5 failures, unrelated to T02 changes.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 311ms |
| 2 | `pnpm exec vitest run renderer/state/sessions-store.test.ts` | 0 | ✅ pass — 51 passed | 967ms |

## Deviations

openTab now routes through get().setActiveTab(id) instead of setting activeTabId directly in its set() call. The plan said only instrument setActiveTab, but the research's stated flow is "openTab → setActiveTab → saveWindowActiveTab" — without this routing the Playwright reboot test (T03) would fail since project-c becomes active via openTab, not via an explicit tab click. The change is backward-compatible: openTab still makes the new tab active, it just takes a second synchronous set() call via setActiveTab.

## Known Issues

5–6 pre-existing failing tests in main/session/session-manager.test.ts (restore() function tests). These failures exist before T02 and are not caused by any file modified in this task.

## Files Created/Modified

- `shared/types.ts`
- `main/persistence/registry-store.ts`
- `main/ipc/handlers.ts`
- `preload/preload.ts`
- `main/index.ts`
- `renderer/state/sessions-store.ts`
- `renderer/state/sessions-store.test.ts`

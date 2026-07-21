# M004/S06 — Research: Reboot Test Fix, activeTabId Restore, and UAT Completion

## Summary

S06 has three distinct deliverables: (1) fix 4 failing `sessions-store.test.ts` tests introduced by S05's `listMissingPaths` additions, (2) wire `activeTabId` restoration across reboot cycles, and (3) tighten the Playwright reboot-cycle assertion from "active tab is any of 3 names" to "active tab matches the last-active project."

The test failures are straightforward: `makeGsdMock()` in `renderer/state/sessions-store.test.ts` doesn't mock `listMissingPaths` or `onSessionMissingPath`, but `init()` now calls both. Adding defaults (`vi.fn().mockResolvedValue([])` and `vi.fn().mockReturnValue(() => {})`) will fix all 4 failures.

The `activeTabId` restore has a non-obvious complication: `session-manager.open()` generates a fresh random ID (`'s_' + randomBytes(9).toString('base64url')`) on every launch. This means the `activeTabId` stored in `WindowRecord` from the previous run references a stale ID that doesn't match any restored session. The fix is to store the **project CWD** as the stable identifier instead of the session ID. The cleanest approach: add `activeTabCwd?: string` to `WindowRecord`, persist it via a new `saveWindowActiveTab` IPC call fired from `setActiveTab`, and pass it back in `RestoreResult` so the renderer can find the matching session by cwd after restore.

## Recommendation

Three sequential tasks: T1 (test fix, ~15 min), T2 (activeTabId restore pipeline, ~60 min), T3 (Playwright tightening, ~15 min). T3 depends on T2.

Use `activeTabCwd` (not `activeTabId`) as the stable cross-reboot identifier since session IDs are ephemeral. Wire the persist call in `sessions-store.setActiveTab` as a fire-and-forget; the existing synchronous bounds flush on `win.on('close')` guarantees capture as long as the registry-store `updateWindowActiveTab` updates `_windows` immediately (no debounce).

## Implementation Landscape

### Key Files

- `renderer/state/sessions-store.test.ts` — `makeGsdMock()` missing `listMissingPaths` and `onSessionMissingPath`; all tests that call `init()` fail. Add both as defaults.
- `renderer/state/sessions-store.ts` — `setActiveTab` action: add fire-and-forget `void gsd().saveWindowActiveTab(sessions[id]?.cwd ?? '')`. In `onRestoreComplete` handler: after new sessions are added, if `result.activeTabCwd` is set, find the session whose `cwd` matches and call `set({ activeTabId: matchingId })`.
- `shared/types.ts` — Add `activeTabCwd?: string` to `WindowRecord` interface (alongside existing `activeTabId: string`). Add `activeTabCwd?: string` to `RestoreResult` interface. Add `saveWindowActiveTab(cwd: string): Promise<void>` to `GsdApi` interface.
- `main/ipc/handlers.ts` — Add `SAVE_WINDOW_ACTIVE_TAB: 'saveWindowActiveTab'` to the `IPC` channel map. Add `ipcMain.handle(IPC.SAVE_WINDOW_ACTIVE_TAB, (_event, cwd: string) => registryStore.updateWindowActiveTab(winId, cwd))`. Pass `registryStore` and `winId` via the existing injectable closure pattern.
- `main/persistence/registry-store.ts` — Add `updateWindowActiveTab(winId: string, cwd: string): void` that updates `_windows[i].activeTabCwd` and schedules a save. Pattern mirrors `updateWindowBounds`.
- `main/index.ts` — When building the payload for `PUSH.RESTORE_COMPLETE`, attach `activeTabCwd: registry.windows[0]?.activeTabCwd`. The `restoreResult` from `sessionManager.restore()` needs to be spread with this field before sending.
- `main/preload.ts` — Expose `saveWindowActiveTab(cwd: string): Promise<void>` on the contextBridge `gsd` object, calling `ipcRenderer.invoke(IPC.SAVE_WINDOW_ACTIVE_TAB, cwd)`.
- `test/reboot-cycle.spec.ts` — Change the active-tab assertion block: after restore, assert `[role="tab"][aria-selected="true"]` contains text `'project-c'` (the last-opened tab in the setup phase, which is stored as active before quit).

### Build Order

1. **T1: Fix sessions-store.test.ts** — independent, zero risk. Run `pnpm exec vitest run renderer/state/sessions-store.test.ts` to confirm 4 failures before and 0 after.
2. **T2: activeTabCwd restore pipeline** — touches 6 files in a chain: `shared/types.ts` → `main/persistence/registry-store.ts` → `main/ipc/handlers.ts` → `main/preload.ts` → `main/index.ts` → `renderer/state/sessions-store.ts`. Type-check with `pnpm exec tsc --noEmit` after each change to catch interface mismatches early.
3. **T3: Tighten Playwright assertion** — depends on T2 being merged; change the "one of 3 names" check to `toContainText('project-c')`.

### Verification Approach

- `pnpm exec vitest run renderer/state/sessions-store.test.ts` — 0 failures after T1.
- `pnpm exec tsc --noEmit` — 0 errors after T2.
- `pnpm exec vitest run` — all unit tests pass (41+ tests).
- Playwright reboot-cycle test: `pnpm exec playwright test test/reboot-cycle.spec.ts` — after T2+T3, all 5 cycles must pass with exact `project-c` active-tab assertion.

## Common Pitfalls

- **Stale IDs in `WindowRecord.activeTabId`** — the existing `activeTabId: string` field stores a session ID that is invalid after reboot because `open()` generates fresh IDs. Use `activeTabCwd` (CWD) as the stable identifier. Do not attempt to match restored sessions by their old ID.
- **`makeGsdMock` must be updated, not individual test overrides** — the 4 failing tests all go through `init()`. Adding `listMissingPaths` and `onSessionMissingPath` to the default mock object (not as per-test overrides) avoids future breakage when `init()` gains new IPC calls.
- **`saveWindowActiveTab` must update `_windows` immediately** — if it only schedules a debounced save, the synchronous `win.on('close')` flush may write stale `activeTabCwd`. `updateWindowActiveTab` must mutate `_windows` in-memory immediately; the flush handles the disk write.
- **`onRestoreComplete` fires once, possibly before all sessions are visible** — the handler already calls `listSessions()` to get the fresh list. Apply `activeTabCwd` matching only after that fresh list is applied to `sessions`, not before.
- **Playwright timing** — `saveWindowActiveTab` is IPC (async). Opening project-c triggers `openTab` → `setActiveTab` → `saveWindowActiveTab`. The test must wait for the tab to show as active (existing `aria-selected="true"` check) before calling `app.close()`, which is already the case.

## Open Risks

- If `handlers.ts` IPC registration requires `winId` at handler-registration time (not call time), confirm how `winId` is threaded into the handler closure — `main/index.ts` creates `win` before calling `registerHandlers()`, so `winId` is available.
- The reboot-cycle test currently has a 300 s per-test timeout. If the activeTabCwd IPC adds latency to app startup, the test should still pass well within that budget.

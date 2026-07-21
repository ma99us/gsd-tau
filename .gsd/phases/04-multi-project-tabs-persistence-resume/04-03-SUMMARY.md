---
id: S03
parent: M004
milestone: M004
provides:
  - Single-instance lock with --open-project forwarding
  - listSessions / closeSession / renameSession IPC handlers
  - Zustand sessions store with openTab/closeTab/setActiveTab/reorderTabs/renameTab actions and IPC sync
requires:
  - slice: S02
    provides: SessionManager.open/close, SessionRecord type, registry integration
affects:
  - S04
key_files:
  - main/index.ts
  - main/ipc/handlers.ts
  - main/ipc/handlers.test.ts
  - shared/types.ts
  - preload/preload.ts
  - renderer/state/sessions-store.ts
  - renderer/state/sessions-store.test.ts
key_decisions:
  - registerHandlers return type changed to { cleanup, handleOpenProject } so second-instance handler calls openProject in-process without an IPC round-trip
  - parseOpenProjectArg exported from handlers.ts (not index.ts) to co-locate with its tests
  - closeSession tears down handler-level state machine BEFORE delegating to SessionManager.close() to prevent fan-out events after tab close
  - Zustand _resetStoreStateForTest uses bare setState merge (no full-replace) to preserve actions during test resets
  - vi.fn() used without type args — inference from mockResolvedValue avoids arity mismatch in strict TS
patterns_established:
  - IPC handler modules return a structured object { cleanup, handleOpenProject } rather than a bare cleanup function, enabling in-process cross-subsystem calls
  - Zustand store exposes _resetStoreStateForTest for test isolation without wiping actions
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/phases/04-multi-project-tabs-persistence-resume/S03-T05-SUMMARY.md
  - .gsd/phases/04-multi-project-tabs-persistence-resume/S03-T06-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-21T14:19:28.076Z
blocker_discovered: false
---

# S03: Single-instance Lock, IPC Upgrade, Zustand Store

**Single-instance lock with arg forwarding, multi-session IPC handlers, and Zustand sessions store are wired and fully tested — 536/536 tests pass, 0 TSC errors.**

## What Happened

T05 implemented single-instance lock via `app.requestSingleInstanceLock()` in `main/index.ts`. The second-instance handler parses `--open-project <path>` from argv (via `parseOpenProjectArg` exported from `handlers.ts`) and calls `sessionManager.open()` in-process through the `handleOpenProject` function returned by `registerHandlers`. The return type of `registerHandlers` was changed from `() => void` to `{ cleanup, handleOpenProject }` to enable this in-process call without an IPC round-trip. New IPC handlers `listSessions`, `closeSession`, and `renameSession` were added alongside the existing `openProject`. `shared/types.ts` and `preload/preload.ts` were updated in T05 to expose these to the renderer. `handlers.test.ts` reached 82 passing tests covering all new describe blocks.

T06 created `renderer/state/sessions-store.ts` (Zustand). The store holds `sessions: Map<id, SessionState>`, `activeTabId: string | null`, and `tabOrder: string[]`. Actions: `openTab`, `closeTab`, `setActiveTab`, `reorderTabs`, `renameTab`. IPC sync subscribes to `session:state-change`, `session:ui-request-added/removed`, and `restore-complete`; on app ready it calls `listSessions()` and populates from the registry. Two bugs were encountered during gate review: the Zustand `_resetStoreStateForTest` helper was using the full-replace flag which wiped actions, and `vi.fn<>` type-arg arity mismatches caused TypeScript errors. Both were fixed (bare `setState` merge; no-arg `vi.fn()` inferring from `mockResolvedValue`). The full suite rose from 82 to 536 tests across 22 files, all passing.

## Verification

1. `pnpm test` → 536/536 tests pass across 22 test files (1.55s)
2. `pnpm exec tsc --noEmit` → exit 0, 0 errors
3. handlers.test.ts: 82/82 (listSessions ×3, closeSession ×4, renameSession ×3, parseOpenProjectArg ×10)
4. sessions-store.test.ts: 45/45 (all action and IPC sync cases)

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

shared/types.ts and preload/preload.ts were updated in T05 (not listed in original T05 files) because T06 depended on window.gsd.listSessions() being available. This was a forward dependency resolved early.

## Known Limitations

Tab bar rendering and actual second-instance Electron event firing are not yet present — these are S04 deliverables.

## Follow-ups

S04 should consume the Zustand sessions store directly to drive the tab bar UI; no additional wiring is needed beyond importing the store.

## Files Created/Modified

- `main/index.ts` — Single-instance lock via app.requestSingleInstanceLock(); second-instance handler parses --open-project and calls handleOpenProject
- `main/ipc/handlers.ts` — listSessions, closeSession, renameSession handlers added; registerHandlers return type changed to { cleanup, handleOpenProject }; parseOpenProjectArg exported
- `main/ipc/handlers.test.ts` — 82 tests covering all new IPC handlers and parseOpenProjectArg
- `shared/types.ts` — GsdApi extended with listSessions, closeSession, renameSession
- `preload/preload.ts` — New IPC methods exposed to renderer
- `renderer/state/sessions-store.ts` — Zustand store: sessions Map, activeTabId, tabOrder; all actions; IPC sync subscriptions
- `renderer/state/sessions-store.test.ts` — 45 tests covering all store actions and IPC sync with mocked ipcRenderer

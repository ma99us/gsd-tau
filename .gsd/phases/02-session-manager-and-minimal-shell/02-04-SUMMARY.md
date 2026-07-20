---
id: S04
parent: M002
milestone: M002
provides:
  - window.gsd IPC bridge (openProject, prompt, abort, getState, onEvent, onStateChange)
  - ipcMain handlers with session event fan-out to webContents
  - shared/types.ts surface for renderer to import safely
requires:
  []
affects:
  - S05
key_files:
  - main/ipc/handlers.ts
  - main/ipc/handlers.test.ts
  - preload/preload.ts
  - preload/preload.test.ts
  - shared/types.ts
key_decisions:
  - IPC channel constants duplicated in preload.ts (not imported from main/) to keep preload bundle free of main-process code
  - prompt() and abort() added to SessionManager as delegate methods — client stays private, IPC routing is clean
  - getAllWebContents injected as parameter to registerHandlers — no Electron process needed for unit tests
  - text_delta 60fps throttle lives in SessionHandle, not re-applied in handlers — single responsibility
  - vi.hoisted() used in preload tests to avoid TDZ with module-level vi.fn() mocks
  - SessionState added to shared/types.ts as Phase-1 type, distinct from future SessionUiState
patterns_established:
  - Inject getAllWebContents for testable IPC fan-out without Electron process
  - Export createGsdApi() from preload for isolated unit testing
  - vi.hoisted() pattern for mock functions that must exist before vi.mock() factory runs
observability_surfaces:
  - No runtime observability surface in this slice — IPC bridge is a pure plumbing layer; health is inferred from test green status and absence of unhandled rejections in main-process log (S06 adds formal smoke verification)
drill_down_paths:
  - .gsd/phases/02-session-manager-and-minimal-shell/S04-T07-SUMMARY.md
  - .gsd/phases/02-session-manager-and-minimal-shell/S04-T08-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-20T14:59:49.231Z
blocker_discovered: false
---

# S04: IPC Bridge and Preload

**Main-process IPC handlers and preload contextBridge implemented: renderer can call window.gsd.prompt/openProject/abort/getState and receive streamed session:event and session:state-change, backed by 54 passing Vitest tests (154 total).**

## What Happened

T07 wired up four ipcMain handlers (openProject, prompt, abort, getState) in main/ipc/handlers.ts, integrating with SessionManager and fanning events out to all focused webContents. text_delta fan-out is throttled to 60fps inside SessionHandle. SessionManager gained prompt() and abort() delegate methods to avoid leaking the RPC client through SessionHandle. getAllWebContents is injected as a parameter so unit tests need no Electron process. 23 Vitest tests cover all handler paths with mocked SessionManager and webContents.

T08 implemented preload/preload.ts using contextBridge.exposeInMainWorld to expose window.gsd with six methods: openProject, prompt, abort, getState, onEvent (returns unsubscribe fn), onStateChange (returns unsubscribe fn). IPC channel constants are duplicated in preload.ts rather than imported from main/ to keep the preload bundle free of main-process code. createGsdApi() is exported for testability. vi.hoisted() is used in the test file to avoid TDZ issues with module-level vi.fn() mocks. SessionState was added to shared/types.ts as the Phase-1 machine state type, distinct from the richer future SessionUiState. 31 new tests pass alongside the 23 from T07 (154 total across 7 files in 746ms).

## Verification

154/154 Vitest tests pass (pnpm test, 7 files, 746ms). All five primary files present and non-empty.

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

main/session/session-manager.ts was modified to add prompt() and abort() delegate methods — not in the original file list but architecturally required to keep the RPC client private within SessionManager.

## Known Limitations

contextIsolation / window.require / window.process isolation can only be fully verified in a live Electron window (DevTools). Unit tests verify the contextBridge call shape but cannot simulate Electron's sandbox.

## Follow-ups

S05 (Renderer Chat View) should add a DevTools smoke check confirming window.gsd.prompt('hello') returns a streamed response end-to-end once the renderer is wired up.

## Files Created/Modified

- `main/ipc/handlers.ts` — IPC handlers for openProject, prompt, abort, getState with event fan-out and 60fps throttle
- `main/ipc/handlers.test.ts` — 23 Vitest tests for all handler paths with mocked SessionManager and webContents
- `preload/preload.ts` — contextBridge bridge exposing window.gsd with 6 IPC-backed methods
- `preload/preload.test.ts` — 31 Vitest tests for API shape, isolation guards, and unsubscribe semantics
- `shared/types.ts` — Shared type definitions including SessionState, SessionEvent, and window.gsd surface
- `main/session/session-manager.ts` — Added prompt() and abort() delegate methods (deviation from original file list — required to keep client private)

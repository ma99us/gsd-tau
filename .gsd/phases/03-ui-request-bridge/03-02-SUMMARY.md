---
id: S02
parent: M003
milestone: M003
provides:
  - respondUI IPC handler with validation and BlockerTracker integration
  - session:ui-request-added and session:ui-request-removed IPC fan-out
  - Windows toast on blocker arrival with 3s debounce and click-to-focus
  - window.gsd.respondUI preload API
requires:
  - slice: S01
    provides: BlockerTracker and contract types
affects:
  - S03
key_files:
  - main/ipc/handlers.ts
  - main/ipc/handlers.test.ts
  - main/os/notifications.ts
  - main/os/notifications.test.ts
  - main/index.ts
  - preload/preload.ts
  - shared/types.ts
  - scripts/test-toast.ts
key_decisions:
  - validateUiResponse exported as pure function for direct unit testing independent of IPC machinery
  - showBlockerToastFn injectable as optional 3rd param to registerHandlers — follows GetAllWebContents pattern, zero test-churn for non-notification tests
  - SESSION_UI_REQUEST_REMOVED fan-out via tracker listener not explicitly in respondUI — single source of truth
  - basename(cwd) used as sessionName for human-friendly toast display
  - BrowserWindow.getAllWindows()[0] in click handler — simpler for v1 single-window assumption
patterns_established:
  - Injectable side-effect functions as optional registerHandlers parameters (ShowBlockerToastFn, GetAllWebContents) — enables unit testing without mocking Electron globals
  - BlockerTracker listener as fan-out source for IPC events — tracker owns state transitions, handlers only observe
observability_surfaces:
  - Electron Notification API fires toast — visible in Windows Action Center on failure to display
  - session:ui-request-added / session:ui-request-removed IPC events observable in DevTools event log
drill_down_paths:
  - .gsd/phases/03-ui-request-bridge/S02-T04-SUMMARY.md
  - .gsd/phases/03-ui-request-bridge/S02-T05-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-20T18:55:36.376Z
blocker_discovered: false
---

# S02: IPC Handler and Windows Notifications

**respondUI IPC handler with full validation and BlockerTracker integration, plus Windows toast notifications with 3s per-session debounce and click-to-focus — 75 new tests pass, 247 total pass**

## What Happened

S02 delivered two capabilities: the respondUI IPC handler (T04) and the Windows toast notification module (T05).

T04 added `respondUI(sessionId, requestId, response)` in `main/ipc/handlers.ts`. The handler validates response shape against the recorded request method (select requires string, confirm requires boolean, etc.) using an exported `validateUiResponse` pure function. On success it calls `client.sendUIResponse()`, removes the blocker from `BlockerTracker`, and fans out `session:ui-request-removed` to all webContents via the existing tracker listener. On validation failure it returns `{ ok: false, error }` — never throws to the renderer. Fan-out for `session:ui-request-added` was also wired here. 62 Vitest unit tests cover all branches including 20 direct `validateUiResponse` cases.

T05 added `main/os/notifications.ts` implementing `showBlockerToast(sessionName, method)`. It creates an Electron Notification with title "gsd-tau needs input" and per-session 3-second debounce. The click handler calls `app.focus()` + `BrowserWindow.getAllWindows()[0].show()`. AppUserModelID `io.opengsd.gsd-tau` is set on app-ready in `main/index.ts` for correct Windows toast attribution. `showBlockerToastFn` was added as an injectable 3rd parameter to `registerHandlers` following the existing `GetAllWebContents` pattern — tests that don't exercise notifications require no change. 13 new Vitest tests cover debounce, unsupported-platform skip, and click-to-focus. All 62 pre-existing handler tests remained green.

The only failing tests in the suite (15 in `client-factory.test.ts`) are a pre-existing issue predating S02: the vi.mock factory for `./resolve-pi` is missing the `resolveSystemNode` export.

## Verification

247 tests pass (15 pre-existing failures in client-factory.test.ts unrelated to S02). S02 suites: handlers.test.ts 62 PASS, notifications.test.ts 13 PASS.

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

handlers.ts was modified in T05 (not listed as primary file for T05) to add ShowBlockerToastFn injectable and basename(cwd) call — necessary to wire notifications into blocker fan-out. Follows established injectable pattern.

## Known Limitations

Visual toast appearance unverified in this slice (requires live Windows desktop). AppUserModelID attribution not verified via Get-StartApps (requires installed app). Pre-existing client-factory.test.ts failure (15 tests, missing resolveSystemNode mock) deferred.

## Follow-ups

Fix client-factory.test.ts mock to include resolveSystemNode export (pre-existing, not S02-introduced). S03 will wire the modal UI to the respondUI/ui-request-added events delivered here.

## Files Created/Modified

- `main/ipc/handlers.ts` — Added respondUI IPC handler, validateUiResponse, fan-out for ui-request-added/removed, ShowBlockerToastFn injectable
- `main/ipc/handlers.test.ts` — 62 tests covering all handler paths including 20 validateUiResponse and 16 respondUI cases
- `main/os/notifications.ts` — New: showBlockerToast with 3s per-session debounce, click-to-focus
- `main/os/notifications.test.ts` — New: 13 Vitest tests for notification module
- `main/index.ts` — AppUserModelID set on app-ready; showBlockerToast wired into registerHandlers call
- `preload/preload.ts` — respondUI exposed on window.gsd
- `shared/types.ts` — UiResponse and related types added
- `scripts/test-toast.ts` — New: manual smoke-test script for visual toast verification

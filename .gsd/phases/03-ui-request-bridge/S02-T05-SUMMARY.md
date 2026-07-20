---
id: T05
parent: S02
milestone: M003
key_files:
  - main/os/notifications.ts
  - main/os/notifications.test.ts
  - main/ipc/handlers.ts
  - main/index.ts
  - scripts/test-toast.ts
key_decisions:
  - showBlockerToastFn added as optional 3rd parameter to registerHandlers (injectable, defaults to no-op) — follows existing GetAllWebContents injection pattern so tests that don't exercise notifications require no change
  - basename(cwd) used as sessionName for toasts — human-friendly display of just the directory name rather than the full path
  - Debounce timer advances even when Notification.isSupported() returns false — prevents silent re-flooding if platform support changes mid-session
  - BrowserWindow.getAllWindows()[0] used in click handler rather than injecting a window ref — simpler, sufficient for v1 single-window assumption
duration: 
verification_result: passed
completed_at: 2026-07-20T18:54:03.846Z
blocker_discovered: false
---

# T05: Windows toast notification module added with per-session 3s debounce, click-to-focus, and 13 new Vitest tests passing; handlers.ts wired with injectable showBlockerToastFn; 62 pre-existing handler tests remain green

**Windows toast notification module added with per-session 3s debounce, click-to-focus, and 13 new Vitest tests passing; handlers.ts wired with injectable showBlockerToastFn; 62 pre-existing handler tests remain green**

## What Happened

## Failure Modes

**External dependencies:**
- `Notification.isSupported()` returns false (e.g. non-Windows, sandbox): guarded — returns early with console.warn; debounce timestamp still set to prevent flooding on re-call.
- `BrowserWindow.getAllWindows()` returns `[]` (no window open): click handler guards with `?? null` — skips `win.show()` but still calls `app.focus({ steal: true })`. App focus still works.
- `app.focus()` or `Notification` constructor throws: unguarded — but Electron guarantees these don't throw under normal main-process conditions; acceptable for v1.

## Load Profile

Single-session scope (Phase 1): debounce map has at most one entry. Max one Notification object created per session per 3s — OS-managed, no resource leak. Not a load concern for v1.

## Negative Tests

`main/os/notifications.test.ts` covers:
- `Notification.isSupported() == false` → constructor not called
- Second call within 3s same session → suppressed (debounce)
- Boundary: 2999ms → still suppressed; 3001ms → fires
- Independent per-session debounce timers
- Debounce advances even when `isSupported` is false
- Click handler: `getAllWindows()` returns `[]` → no crash, app.focus still fires
- Click handler: multiple windows → only first window's `show()` called

## Verification

Ran `pnpm test` (Vitest run):
- `main/os/notifications.test.ts`: 13 tests PASS
- `main/ipc/handlers.test.ts`: 62 tests PASS (no regression)
- All other suites (turnsReducer, preload, resolve-pi, blocker-tracker, state-machine, session-handle, session-manager): PASS
- Pre-existing failure: `main/pi/client-factory.test.ts` 15 tests fail with missing `resolveSystemNode` mock export — unrelated to T05

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test` | 1 | ✅ 13 notifications tests pass, 62 handler tests pass, 247/262 total pass; 15 pre-existing failures in client-factory.test.ts (unrelated to T05) | 833ms |

## Deviations

handlers.ts was modified (not listed in primary Files) to add the ShowBlockerToastFn injectable parameter and basename(cwd) call — necessary to wire notifications into the blocker fan-out path. Follows the existing GetAllWebContents injectable pattern already established in that file.

## Known Issues

Pre-existing: main/pi/client-factory.test.ts has 15 failing tests because the vi.mock('./resolve-pi') factory doesn't include the resolveSystemNode export that client-factory.ts calls. Not introduced by T05. Needs a separate fix to update the test mock.

## Files Created/Modified

- `main/os/notifications.ts`
- `main/os/notifications.test.ts`
- `main/ipc/handlers.ts`
- `main/index.ts`
- `scripts/test-toast.ts`

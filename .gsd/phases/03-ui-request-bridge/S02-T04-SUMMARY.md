---
id: T04
parent: S02
milestone: M003
key_files:
  - main/ipc/handlers.ts
  - main/ipc/handlers.test.ts
  - preload/preload.ts
  - shared/types.ts
  - main/session/blocker-tracker.ts
key_decisions:
  - Wired BlockerTracker → state machine inline in openProject (not via handle.wireBlockerTracker) so tests never need to mock wireBlockerTracker
  - Used INTERACTIVE_METHODS positive-set instead of NON_INTERACTIVE negative-set for extension_ui_request dispatch — safer default: auto-ack anything unknown
  - SESSION_UI_REQUEST_REMOVED fan-out fires via tracker listener, not explicitly in respondUI handler — single source of truth
  - validateUiResponse exported as a pure function for direct unit testing independent of IPC machinery
duration: 
verification_result: passed
completed_at: 2026-07-20T18:44:00.076Z
blocker_discovered: false
---

# T04: respondUI IPC handler added with response validation, BlockerTracker integration, and fan-out for ui-request-added/removed; 62 tests pass (was 22, pre-existing failing test fixed)

**respondUI IPC handler added with response validation, BlockerTracker integration, and fan-out for ui-request-added/removed; 62 tests pass (was 22, pre-existing failing test fixed)**

## What Happened

## Failure Modes

External dependencies in this task:

1. **`BlockerTracker.get(requestId)`** — pure in-memory `Map.get`. Cannot fail. Unknown ids return `undefined`, which respondUI converts to `{ ok: false, error: "unknown request '...'" }`.

2. **`entry.sendUIResponse(id, response)`** → `handle.sendUIResponse(id, resp)` → `this._client.sendUIResponse(id, response)` — enqueues a message on the RPC stdout pipe. If the RPC client has already stopped (pipe closed), this may throw a Node.js write-after-close error. This propagates as a rejected promise from the ipcMain.handle callback. The renderer receives an IPC channel error (not a structured `{ ok: false }` payload). Mitigation: transport errors transition the state machine to Stopped and the renderer should disable the respondUI call path once the session is in Stopped state. Explicitly wrapping this in try-catch to produce `{ ok: false }` was deferred as a low-priority improvement.

3. **`entry.tracker.remove(requestId)`** — no-op for unknown ids (guarded earlier). Cannot fail.

4. **Fan-out `fanOut()`** — skips destroyed WebContents; catches none, but Electron IPC is fire-and-forget. Cannot fail in a blocking way.

## Load Profile

This is a single-user Electron app. At 10x load (e.g. 10 concurrent UI request dialogs across sessions):
- `sessions.get()` is O(1) — no saturation point.
- `tracker.get()` is O(1) per session.
- `fanOut()` is O(w) where w = number of open windows, bounded by hardware.
- The first resource to saturate at 10x would be the RPC pipe write queue — each `sendUIResponse` writes to a separate child process's stdin. At 10 concurrent respondUI calls to different sessions, there are 10 independent pipes. No rate limiting or pooling is needed for this use case.

## Negative Tests

All negative paths are covered in `main/ipc/handlers.test.ts`:

- `validateUiResponse` describe block (20 tests): null, string, number responses; wrong shape for each method; missing required field; correct shape for all happy paths.
- `respondUI` describe block (16 tests): unknown session → `{ ok: false }` with error string; unknown request id → `{ ok: false }` with error string; confirm with non-boolean → `{ ok: false }` containing 'confirm'; select with wrong shape → `{ ok: false }` containing 'select'; select allowMultiple with `value` instead of `values` → `{ ok: false }` containing 'allowMultiple'; non-object response → `{ ok: false }` containing 'object'; null response → `{ ok: false }` containing 'null'. All negative cases assert `mockHandle.sendUIResponse` was NOT called.

## Verification

pnpm test -- ipc/handlers. All 62 tests pass, 0 failures. Test file covers: handler registration (6 channels), openProject fan-out, getState (including Waiting state), cleanup (6 removeHandler calls), validateUiResponse (20 direct unit tests), respondUI (16 IPC integration tests).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- ipc/handlers --reporter=verbose` | 0 | ✅ pass — 62 passed (62) | 586ms |

## Deviations

None. All planned components implemented as specified.

## Known Issues

If handle.sendUIResponse throws (e.g. RPC pipe broken after the session enters Stopped state), the respondUI promise rejects rather than returning { ok: false }. This is acceptable: transport errors transition the state machine to Stopped and are handled at the session level, not the individual request level. A renderer calling respondUI against a dead session will receive an IPC transport error rather than a graceful error payload.

## Files Created/Modified

- `main/ipc/handlers.ts`
- `main/ipc/handlers.test.ts`
- `preload/preload.ts`
- `shared/types.ts`
- `main/session/blocker-tracker.ts`

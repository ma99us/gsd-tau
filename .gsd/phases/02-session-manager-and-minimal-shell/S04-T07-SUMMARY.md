---
id: T07
parent: S04
milestone: M002
key_files:
  - main/ipc/handlers.ts
  - main/ipc/handlers.test.ts
  - main/session/session-manager.ts
key_decisions:
  - Added prompt() and abort() to SessionManager (not SessionHandle) — SessionManager is the IPC routing layer and already owns the client reference; this avoids leaking the client through the handle
  - getState returns state-machine state (Working/Idle/Stopped) derived from events, not client.getState() — no round-trip to pi required, consistent with the ADR-004 pattern
  - getAllWebContents injected as a parameter to registerHandlers — makes tests trivial without any Electron process
  - text_delta 60fps throttle lives in SessionHandle, not re-applied in handlers — single responsibility, handlers see already-throttled events on the event channel
duration: 
verification_result: passed
completed_at: 2026-07-20T14:49:47.277Z
blocker_discovered: false
---

# T07: IPC handlers registered with full event fan-out, state-machine integration, and 23 passing Vitest tests

**IPC handlers registered with full event fan-out, state-machine integration, and 23 passing Vitest tests**

## What Happened

## Failure Modes (Q5)

| Dependency | Failure path | Handling |
|---|---|---|
| `manager.open()` throws (ResolvePiError, ClientInitError) | openProject handler rejects | Promise rejection propagates to renderer via ipcMain.handle — renderer sees the error via `ipcRenderer.invoke` rejection |
| `manager.prompt()` throws (unknown session, client disconnect) | prompt handler rejects | Same — error propagates to renderer |
| `manager.abort()` throws (unknown session) | abort handler rejects | Same |
| `getState` for unknown sessionId | synchronous throw inside ipcMain.handle callback | ipcMain wraps it as a rejection; renderer sees error |
| webContents destroyed between fanOut call and send | `wc.isDestroyed()` check skips destroyed instances | No IPC error thrown |
| Transport error from pi process | `handle.on('transport-error', ...)` feeds machine → Stopped; fans out session:event with error payload | Renderer can react to state-change and error event |

## Load Profile (Q6)

`fanOut` is O(n) over active webContents, bounded by the number of open windows (typically 1–5). No unbounded accumulation. text_delta fan-out is already throttled to 60fps inside SessionHandle before reaching the handlers. The state machine is O(1) per event. No pooling, caching, or rate-limiting needed at this scale.

## Negative Tests (Q7)

| Scenario | Test |
|---|---|
| `manager.open()` throws | `propagates errors thrown by manager.open()` |
| `manager.prompt()` throws | `propagates errors from manager.prompt()` |
| `manager.abort()` throws | `propagates errors from manager.abort()` |
| `getState` for unknown sessionId | `throws with a descriptive message for an unknown sessionId` |
| Destroyed webContents skipped on fan-out | `sends to live webContents and skips destroyed ones` |
| Named handle channels other than 'event'/'transport-error' don't trigger fan-out | `does not fan out for named handle channels outside event/transport-error` |
| Event fan-out stops after cleanup | `stops event fan-out after cleanup` |
| transport-error fan-out stops after cleanup | `stops transport-error fan-out after cleanup` |
| Double cleanup is safe | `is safe to call cleanup multiple times without throwing` |

## Verification

pnpm test -- ipc/handlers: 23/23 passed. pnpm test (full suite): 122/122 passed across 6 test files.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- ipc/handlers` | 0 | ✅ pass — 23/23 tests | 2237ms |
| 2 | `pnpm test` | 0 | ✅ pass — 122/122 tests across 6 files | 2291ms |

## Deviations

main/session/session-manager.ts was modified to add prompt() and abort() delegate methods — not listed in the task's file list but required since the client is private. The addition is minimal (2 methods, ~14 lines) and architecturally correct.

## Known Issues

None.

## Files Created/Modified

- `main/ipc/handlers.ts`
- `main/ipc/handlers.test.ts`
- `main/session/session-manager.ts`

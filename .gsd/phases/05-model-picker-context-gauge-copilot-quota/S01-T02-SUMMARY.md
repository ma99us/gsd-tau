---
id: T02
parent: S01
milestone: M005
key_files:
  - main/ipc/handlers.ts
  - preload/preload.ts
key_decisions:
  - Handlers wrap getRpcState/getSessionStats in try/catch→null (not throw) so the renderer receives a safe null when the session is unknown or the RPC pipe is mid-shutdown, consistent with the existing getAvailableModels/setModel pattern where callers handle null gracefully.
  - session-handle.ts requires no changes — SessionManager calls client.getState()/getSessionStats() directly; the handle is not in this IPC call chain.
duration: 
verification_result: passed
completed_at: 2026-07-21T18:09:55.130Z
blocker_discovered: false
---

# T02: Wired GET_RPC_STATE and GET_SESSION_STATS IPC channels in handlers.ts and preload.ts with try/catch→null error handling

**Wired GET_RPC_STATE and GET_SESSION_STATS IPC channels in handlers.ts and preload.ts with try/catch→null error handling**

## What Happened


Added GET_RPC_STATE ('getRpcState') and GET_SESSION_STATS ('getSessionStats') to the IPC constant objects in both handlers.ts and preload.ts (mirrored constants, as per the project pattern — preload cannot import from main/).

**handlers.ts**:
- Added two constants to the IPC object (with JSDoc explaining the null-on-error contract)
- Added two `ipcMain.handle` registrations that call `manager.getRpcState(sessionId)` and `manager.getSessionStats(sessionId)` respectively. Both are wrapped in try/catch that catches and logs the error, returning `null` — consistent with the SessionManager throwing on unknown session and the renderer needing a safe fallback
- Added both channels to the `cleanup()` function (ipcMain.removeHandler)

**preload.ts**:
- Added `RpcSessionState` and `SessionStats` to the `import type` block from `../shared/types` (both were re-exported in T01)
- Added two constants to the local IPC object (mirrored from handlers.ts)
- Added `getRpcState` and `getSessionStats` invoke methods to the `createGsdApi()` return — both delegate to `ipcRenderer.invoke` with the matching channel constant and sessionId arg

`session-handle.ts` needed no changes — SessionManager calls `entry.client.getState()` and `entry.client.getSessionStats()` directly; the handle is not in this call chain.


## Verification

pnpm tsc --noEmit passed with exit 0 in ~308ms. No TypeScript errors in the modified files or any transitively affected files.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 3450ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `main/ipc/handlers.ts`
- `preload/preload.ts`

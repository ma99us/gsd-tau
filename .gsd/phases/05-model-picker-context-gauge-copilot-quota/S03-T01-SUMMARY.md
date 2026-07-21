---
id: T01
parent: S03
milestone: M005
key_files:
  - shared/types.ts
  - main/session/session-handle.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
key_decisions:
  - ThinkingLevel defined locally in shared/types.ts as a union literal — @opengsd/contracts uses it internally in rpc.d.ts but does NOT export it from its index, so a re-export would not work
  - SET_THINKING_LEVEL handler uses null-on-error pattern (not throw) per slice verification spec — renderer rolls back optimistic state on null return
  - Routing goes SessionEntry.setThinkingLevel → handle.setThinkingLevel → client.setThinkingLevel, avoiding session-manager.ts changes (not in task file list); consistent with sendUIResponse closure-capture pattern
duration: 
verification_result: passed
completed_at: 2026-07-21T19:08:28.581Z
blocker_discovered: false
---

# T01: Added ThinkingLevel type, RPC_THINKING_LEVELS constant, session-handle method, IPC handler (null-on-error), and preload binding for set_thinking_level

**Added ThinkingLevel type, RPC_THINKING_LEVELS constant, session-handle method, IPC handler (null-on-error), and preload binding for set_thinking_level**

## What Happened

Implemented the full backend plumbing for `setThinkingLevel` across four files following the existing `setModel` / `sendUIResponse` patterns.

**shared/types.ts** — defined `ThinkingLevel` as a local union type (`'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`) rather than re-exporting from `@opengsd/contracts` (which does not export it from its index). Added `RPC_THINKING_LEVELS` as a `const satisfies readonly ThinkingLevel[]` array for runtime use in the picker (T02) and keyboard cycling (T02). Added `setThinkingLevel(sessionId, level): Promise<void>` to `GsdApi`.

**main/session/session-handle.ts** — imported `ThinkingLevel` from `../../shared/types`, added `setThinkingLevel(level): Promise<void>` that delegates directly to `this._client.setThinkingLevel(level)`. Placed before `sendUIResponse` to group client-delegation methods together.

**main/ipc/handlers.ts** — added `SET_THINKING_LEVEL: 'setThinkingLevel'` to the `IPC` constant. Added `setThinkingLevel: (level: ThinkingLevel) => Promise<void>` to `SessionEntry` interface. In `doOpenProject`'s `sessions.set(id, {...})`, wired `setThinkingLevel: (level) => handle.setThinkingLevel(level)` using the same closure-capture pattern as `sendUIResponse` — this avoids modifying `session-manager.ts` (not in the task file list) and is consistent with how handle methods are delegated. Added the `SET_THINKING_LEVEL` IPC handler after `getSessionStats` using the null-on-error pattern (per slice verification spec): unknown session returns `null` + `console.warn`; RPC rejection returns `null` + `console.error`. Added `ipcMain.removeHandler(IPC.SET_THINKING_LEVEL)` to `cleanup()`.

**preload/preload.ts** — added `ThinkingLevel` to the type import from `../shared/types`, added `SET_THINKING_LEVEL: 'setThinkingLevel'` to the local mirrored `IPC` constant, added `setThinkingLevel: (sessionId, level) => ipcRenderer.invoke(IPC.SET_THINKING_LEVEL, sessionId, level)` to `createGsdApi()`.

The routing decision: rather than adding `setThinkingLevel` to `SessionManager` (not in the file list), the handler uses `SessionEntry.setThinkingLevel` which closes over the `SessionHandle`. This is identical to how `sendUIResponse` is routed and doesn't require touching `session-manager.ts`.

## Verification

pnpm tsc --noEmit passed with exit code 0 in 3.6 s (no type errors across all four modified files and their dependents).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 3637ms |

## Deviations

Routing goes through SessionEntry closure capture rather than SessionManager.setThinkingLevel, because session-manager.ts is not in the task file list. The SessionHandle method is in the list and the pattern is architecturally equivalent to the existing sendUIResponse delegation.

## Known Issues

None.

## Files Created/Modified

- `shared/types.ts`
- `main/session/session-handle.ts`
- `main/ipc/handlers.ts`
- `preload/preload.ts`

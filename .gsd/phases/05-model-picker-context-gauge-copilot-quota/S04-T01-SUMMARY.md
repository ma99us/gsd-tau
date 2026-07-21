---
id: T01
parent: S04
milestone: M005
key_files:
  - shared/types.ts
  - main/session/session-manager.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
  - main/ipc/handlers.test.ts
  - main/session/session-manager.test.ts
key_decisions:
  - compact() follows the null-on-error pattern (getRpcState/getSessionStats) in the IPC handler, propagates throws from the session-manager up through the handler's try/catch so the renderer gets null rather than an unhandled rejection
  - RpcClient.compact() signature confirmed: compact(customInstructions?: string): Promise<CompactionResult> — no sessionId param needed at the client level (each client is per-session)
duration: 
verification_result: passed
completed_at: 2026-07-21T19:43:13.984Z
blocker_discovered: false
---

# T01: Wired the compact IPC chain end-to-end: CompactionResult type, SessionManager.compact(), IPC.COMPACT handler, and preload bridge — all following the null-on-error pattern used by getSessionStats and setThinkingLevel.

**Wired the compact IPC chain end-to-end: CompactionResult type, SessionManager.compact(), IPC.COMPACT handler, and preload bridge — all following the null-on-error pattern used by getSessionStats and setThinkingLevel.**

## What Happened

Added the full compact() IPC stack across 6 files:

**shared/types.ts**: Added `CompactionResult` to the `@opengsd/contracts` import and re-export block. Added `compact(sessionId, customInstructions?)` to `GsdApi` with a `Promise<CompactionResult | null>` return (null on error, consistent with `getSessionStats`).

**main/session/session-manager.ts**: Added `compact(id, customInstructions?)` method after `getSessionStats`. Looks up the session entry, throws descriptively on unknown id, and delegates to `entry.client.compact(customInstructions)`.

**main/ipc/handlers.ts**: Added `COMPACT: 'compact'` to the `IPC` const with JSDoc. Registered the handler after `SET_THINKING_LEVEL` using the same try/catch→null pattern as `GET_RPC_STATE` and `GET_SESSION_STATS`. Added `ipcMain.removeHandler(IPC.COMPACT)` to the cleanup function. Channel count: 18 → 19.

**preload/preload.ts**: Added `CompactionResult` to the type imports (already existed in shared/types.ts). Added `COMPACT: 'compact'` to the local IPC constant mirror. Added `compact(sessionId, customInstructions?)` to `createGsdApi()` delegating to `ipcRenderer.invoke(IPC.COMPACT, sessionId, customInstructions)`.

**main/ipc/handlers.test.ts**: Updated handler registration count 18→19. Added `compact` mock to the manager object. Added the `compact` describe block with 4 tests: happy path, customInstructions forwarding, null-on-error with console.error spy, and null for unknown session. Updated cleanup count to 19 and added `IPC.COMPACT` assertion.

**main/session/session-manager.test.ts**: Added `compact` mock to `makeMockClient()`. Added `compact()` describe block with 4 tests: delegates to client.compact(), forwards customInstructions, throws for unknown session, and propagates client rejection.

## Verification

pnpm tsc --noEmit: exit 0, no type errors. pnpm test --reporter=verbose: 717 tests passed, 29 files, 0 failures.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 4505ms |
| 2 | `pnpm test --reporter=verbose` | 0 | ✅ pass — 717 tests, 29 files | 4211ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `shared/types.ts`
- `main/session/session-manager.ts`
- `main/ipc/handlers.ts`
- `preload/preload.ts`
- `main/ipc/handlers.test.ts`
- `main/session/session-manager.test.ts`

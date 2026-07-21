---
id: T01
parent: S01
milestone: M005
key_files:
  - shared/types.ts
  - main/session/session-manager.ts
key_decisions:
  - SessionManager methods throw on unknown session (consistent with getAvailableModels pattern); IPC handlers in T02 will add try/catch → null
  - Re-exported RpcCostUpdateEvent in addition to RpcSessionState and SessionStats so T03 has a typed handle to cumulativeCost (not the duck-typed event.cost the research doc incorrectly names)
duration: 
verification_result: passed
completed_at: 2026-07-21T18:07:59.360Z
blocker_discovered: false
---

# T01: Added RpcSessionState, SessionStats, RpcCostUpdateEvent re-exports and getRpcState/getSessionStats to GsdApi + SessionManager

**Added RpcSessionState, SessionStats, RpcCostUpdateEvent re-exports and getRpcState/getSessionStats to GsdApi + SessionManager**

## What Happened

Two files edited following the established pattern of `getAvailableModels`/`setModel`.

**shared/types.ts:**
- Extended the `import type` from `@opengsd/contracts` to include `RpcSessionState`, `SessionStats`, and `RpcCostUpdateEvent` (the cost_update typed event interface).
- Added all three to the re-export so downstream files import from `@shared/types` only, not directly from the package.
- Added `getRpcState(sessionId: SessionId): Promise<RpcSessionState | null>` and `getSessionStats(sessionId: SessionId): Promise<SessionStats | null>` to the `GsdApi` interface with JSDoc matching the research spec. Return type is `| null` (not the throwing variant) because the preload bridge will wrap in try/catch and return null on error — this is the canonical renderer-facing contract.

**main/session/session-manager.ts:**
- Added `getRpcState(id: SessionId): Promise<RpcSessionState>` — throws on unknown session (matches `getAvailableModels` pattern), delegates to `entry.client.getState()`.
- Added `getSessionStats(id: SessionId): Promise<SessionStats>` — same shape, delegates to `entry.client.getSessionStats()`.
- Both methods use inline `import('@opengsd/contracts')` for the return type rather than a top-level import, consistent with the existing `getAvailableModels` and `getCommands` patterns in this file.

**`RpcCostUpdateEvent` gotcha captured:** The research doc states the cost_update payload field is `event.cost`, but the actual contracts type has `cumulativeCost: number` (not `cost`). `SessionStats` has its own `cost` field which is different. Re-exporting `RpcCostUpdateEvent` from shared/types gives T03 a strongly-typed handle to `cumulativeCost` rather than relying on duck-typing with the wrong field name.

## Verification

Ran `pnpm tsc --noEmit` from project root. Exit code 0. Output contained only the expected pnpm settings WARN lines (pnpm.onlyBuiltDependencies field) — no TypeScript diagnostics.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 3605ms |

## Deviations

Re-exported RpcCostUpdateEvent in addition to the two types specified in the plan. This is additive (no breakage) and unblocks T03 from accessing the correctly-typed cumulativeCost field.

## Known Issues

Research doc states cost_update payload carries `event.cost`; the actual RpcCostUpdateEvent type has `cumulativeCost: number`. T03 must use `(event as RpcCostUpdateEvent).cumulativeCost` (or cast the duck-typed SdkAgentEvent), not `event.cost`, to read live cost correctly.

## Files Created/Modified

- `shared/types.ts`
- `main/session/session-manager.ts`

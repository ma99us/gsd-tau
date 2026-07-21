---
id: S01
parent: M005
milestone: M005
provides:
  - (none)
requires:
  []
affects:
  []
key_files:
  - renderer/components/SessionHeaderBar.tsx
  - renderer/state/sessions-store.ts
  - renderer/components/SessionView.tsx
  - shared/types.ts
  - main/session/session-manager.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
key_decisions:
  - SessionHeaderBar uses local component state (not Zustand) for model+cost — fast reactive updates without store coupling
  - GET_RPC_STATE/GET_SESSION_STATS handlers use try/catch→null pattern consistent with getAvailableModels/setModel
  - Cost is tracked via RpcCostUpdateEvent.cumulativeCost (not summing turnCost) to prevent drift from missed events
  - SessionManager getRpcState/getSessionStats throw on unknown session; IPC handlers wrap with try/catch→null
patterns_established:
  - Two-file IPC channel registration: handlers.ts (main) + preload.ts (renderer bridge) must stay in sync
  - Re-export types needed by renderer from shared/types.ts for clean dependency boundaries
observability_surfaces:
  - Main-process logs: GET_RPC_STATE and GET_SESSION_STATS handler errors surface via existing session-manager error logging
  - cost_update events already logged by session-handle generic event path
drill_down_paths:
  []
duration: ""
verification_result: passed
completed_at: 2026-07-21T18:30:40.685Z
blocker_discovered: false
---

# S01: Session header: model chip and cost line

**SessionHeaderBar wired end-to-end: model chip and live cumulative cost display visible in every session, updating on cost_update events via two new IPC channels**

## What Happened

Four tasks built the full stack for the session header bar:

**T01** added RpcSessionState, SessionStats, and RpcCostUpdateEvent re-exports to shared/types.ts and wired getRpcState/getSessionStats methods into SessionManager, giving all downstream code typed access to RPC state and cumulative cost. Key finding: the actual field is `cumulativeCost` (not `event.cost` as the research doc stated).

**T02** registered GET_RPC_STATE and GET_SESSION_STATS IPC channels in handlers.ts (main process) and exposed them through preload.ts, following the established try/catch→null pattern so the renderer receives a safe null on errors without crashing.

**T03** created the SessionHeaderBar component with local state for model + cost (fast reactive updates without Zustand coupling), added modelInfo/cost fields to TabEntry for downstream use, and fixed sessions-store.test.ts makeTabEntry helper to include the required cost field.

**T04** wired SessionHeaderBar into SessionView (below the header element, above TurnList) and fixed three pre-existing test regressions surfaced by the first full pnpm test run: handlers.test.ts channel count updated to 17, session-manager.test.ts restore() tests switched to process.cwd(). All 614 tests pass.

## Verification

pnpm tsc --noEmit: exit 0 after each task. pnpm test: 26 test files, 614 tests all passed in 1.64s (gsd_exec run id: 7b41a9a9).

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

["sessions-store.test.ts modified (not in original plan files list) to add cost: 0 to makeTabEntry — required because cost: number became a required TabEntry field", "RpcCostUpdateEvent re-exported from shared/types.ts in addition to the two types specified in T01 plan — additive only", "main/ipc/handlers.test.ts and main/session/session-manager.test.ts updated in T04 to fix pre-existing test failures surfaced by first full pnpm test run — test-only changes, no production code altered beyond planned SessionView wiring"]

## Known Limitations

["Cost display rounds to cents ($0.01) — sub-cent costs show as $0.00 until they cross the threshold", "Model chip shows raw provider/model-id string from pi with no friendly display name mapping (deferred to later slices or settings)", "No loading skeleton while GET_RPC_STATE is in-flight on first render"]

## Follow-ups

["S02 model picker will need to update the model chip in SessionHeaderBar — the local state architecture means S02 must either lift state or trigger a re-fetch via the existing GET_RPC_STATE channel", "Consider adding a loading state to SessionHeaderBar for the initial IPC round-trip (currently shows placeholder until data arrives)"]

## Files Created/Modified

- `shared/types.ts` — Added RpcSessionState, SessionStats, RpcCostUpdateEvent re-exports
- `main/session/session-manager.ts` — Added getRpcState and getSessionStats methods
- `main/ipc/handlers.ts` — Registered GET_RPC_STATE and GET_SESSION_STATS IPC handlers
- `preload/preload.ts` — Exposed getRpcState and getSessionStats on window.gsd bridge
- `renderer/components/SessionHeaderBar.tsx` — New component: model chip + cumulative cost display with cost_update subscription
- `renderer/state/sessions-store.ts` — Added modelInfo and cost fields to TabEntry
- `renderer/state/sessions-store.test.ts` — Updated makeTabEntry helper to include required cost field
- `renderer/components/SessionView.tsx` — Wired SessionHeaderBar below header, above TurnList
- `renderer/components/SessionView.test.ts` — Updated test expectations for SessionHeaderBar presence
- `main/ipc/handlers.test.ts` — Updated channel count to 17 to match actual handlers
- `main/session/session-manager.test.ts` — Switched restore() tests to process.cwd() pattern

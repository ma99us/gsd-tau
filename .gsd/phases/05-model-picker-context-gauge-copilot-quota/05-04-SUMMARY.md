---
id: S04
parent: M005
milestone: M005
provides:
  - ContextGauge component with live token fill, colour coding, popover breakdown, and Compact button
  - COMPACT IPC channel end-to-end (renderer → preload → handler → session-manager → RpcClient)
requires:
  []
affects:
  []
key_files:
  - shared/types.ts
  - main/session/session-manager.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
  - renderer/components/ContextGauge.tsx
  - renderer/components/ContextGauge.test.tsx
  - renderer/components/SessionHeaderBar.tsx
  - renderer/components/SessionHeaderBar.test.tsx
key_decisions:
  - compact() follows null-on-error IPC pattern
  - ModelInfo widened in SessionHeaderBar to carry contextWindow
  - Inline div popover used in place of @radix-ui/react-popover
  - RpcCostUpdateEvent.tokens total computed inline as sum of four fields
patterns_established:
  - Inline controlled-div popover pattern for Electron (no @radix-ui/react-popover dependency)
  - isCompacting guard to prevent duplicate in-flight IPC calls from UI components
observability_surfaces:
  - ContextGauge re-renders on every cost_update event — no silent gaps for gauge updates
drill_down_paths:
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S04-T01-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S04-T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-21T19:57:29.299Z
blocker_discovered: false
---

# S04: Context window gauge with compact button

**Live ContextGauge added to SessionHeaderBar with colour-coded fill bar, inline popover breakdown, Compact button, and full COMPACT IPC chain wired end-to-end.**

## What Happened

T01 wired the compact IPC chain: added CompactionResult type to shared/types.ts, SessionManager.compact() delegating to RpcClient.compact(), an IPC.COMPACT handler following the null-on-error pattern, and the preload bridge. Unit tests for the handler and session-manager method were added. tsc and 717 tests passed.

T02 created the ContextGauge React component with: colour-coded bar (green <60%, amber 60–85%, red ≥85%), a click-to-open inline popover showing input/output/cacheRead/cacheWrite/total breakdown, a Compact button that calls window.gsd.compact(sessionId) with an isCompacting guard to prevent duplicate in-flight calls, and a fallback "Context Nk tokens" display when contextWindow is unknown. SessionHeaderBar was widened to carry ModelInfo | null so contextWindow flows through without a separate state variable. @radix-ui/react-popover was absent from package.json so an inline controlled-div popover with click-outside detection was used instead — all spec requirements satisfied. 30 new tests added in ContextGauge.test.tsx; total 747 tests passing.

## Verification

pnpm tsc --noEmit: exit 0, no type errors. pnpm test: 30 test files, 747 tests passed, 0 failures.

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

@radix-ui/react-popover assumed by research doc but absent from package.json. Replaced with an inline controlled-div popover; all spec requirements (breakdown, Compact button, click-to-open, colour coding, fallback) are satisfied.

## Known Limitations

Popover is a simple inline div — no focus-trap or keyboard navigation. Sufficient for Electron desktop context.

## Follow-ups

None.

## Files Created/Modified

- `shared/types.ts` — Added CompactionResult type
- `main/session/session-manager.ts` — Added compact() method delegating to RpcClient.compact()
- `main/ipc/handlers.ts` — Added IPC.COMPACT handler with null-on-error pattern
- `preload/preload.ts` — Exposed compact(sessionId) in window.gsd preload bridge
- `main/ipc/handlers.test.ts` — Tests for COMPACT handler
- `main/session/session-manager.test.ts` — Tests for SessionManager.compact()
- `renderer/components/ContextGauge.tsx` — New component: colour-coded gauge, popover breakdown, Compact button
- `renderer/components/ContextGauge.test.tsx` — 30 unit tests for ContextGauge
- `renderer/components/SessionHeaderBar.tsx` — Widened model state to ModelInfo | null; integrated ContextGauge
- `renderer/components/SessionHeaderBar.test.tsx` — Updated tests for widened SessionHeaderBar

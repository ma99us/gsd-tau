---
id: S03
parent: M005
milestone: M005
provides:
  - ThinkingLevel type and RPC_THINKING_LEVELS constant (shared/types.ts)
  - SET_THINKING_LEVEL IPC channel + session-handle method + preload binding
  - ThinkingLevelChip component with optimistic-update/rollback and Ctrl+Shift+T cycling
  - SessionHeaderBar updated: [model chip] · [💡 thinking chip ▼] · [cost]
requires:
  - slice: S01
    provides: getRpcState IPC, SessionHeaderBar shell, ModelInfo.reasoning field
  - slice: S02
    provides: setModel optimistic-update + rollback pattern reused verbatim for setThinkingLevel
affects:
  []
key_files:
  - renderer/components/ThinkingLevelChip.tsx
  - renderer/components/SessionHeaderBar.tsx
  - shared/types.ts
  - main/session/session-handle.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
  - renderer/components/SessionHeaderBar.test.tsx
key_decisions:
  - ThinkingLevel defined locally in shared/types.ts — @opengsd/contracts does not export it from its index
  - SET_THINKING_LEVEL handler uses null-on-error (not throw); renderer rolls back optimistic state on null
  - ThinkingLevelChip owns the Ctrl+Shift+T listener so cycling logic is co-located with the rendering guard
  - isReasoningModel guard in both SessionHeaderBar (separator) and ThinkingLevelChip (early-return null) to prevent dangling separator
patterns_established:
  - Optimistic-update + rollback pattern for IPC-backed UI state (established in S02 for model, now applied to thinking level)
  - Component-owned keyboard shortcuts co-located with the component's rendering guard
observability_surfaces:
  - SET_THINKING_LEVEL handler errors surface via existing null-on-error try/catch pattern in main process logs
  - Renderer console.error on setThinkingLevel rejection (same rollback path as setModel)
drill_down_paths:
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S03-T01-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S03-T02-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S03-T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-21T19:34:45.119Z
blocker_discovered: false
---

# S03: Thinking level chip and picker

**ThinkingLevelChip wired end-to-end: IPC handler, session-handle method, preload binding, 7-level dropdown, optimistic-update + rollback, and Ctrl+Shift+T cycling — hidden on non-reasoning models.**

## What Happened

T01 extended the shared type layer (`ThinkingLevel` union + `RPC_THINKING_LEVELS` constant), added `setThinkingLevel` to `SessionHandle`, the `SET_THINKING_LEVEL` IPC handler (null-on-error pattern matching `setModel`), and the `window.gsd.setThinkingLevel` preload binding. T02 created `ThinkingLevelChip.tsx` — a chip that renders `💡 {level} ▼` only when `isReasoningModel`, opens a 7-item dropdown, performs optimistic updates with rollback on null return, and owns the `Ctrl+Shift+T` cycling listener — then wired it into `SessionHeaderBar` between the model chip and cost line. T03 fixed a missing `vi` import in `SessionHeaderBar.test.tsx` so `pnpm tsc --noEmit` stayed clean, and confirmed 709 tests across 29 files all pass.

## Verification

pnpm tsc --noEmit exit 0; pnpm test 709/709 passed across 29 files.

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

Routing goes through SessionEntry closure capture rather than SessionManager.setThinkingLevel, because session-manager.ts was not in the task file list. Architecturally equivalent to the existing sendUIResponse delegation pattern.

## Known Limitations

Live RPC round-trip to a real pi session not tested at unit level — covered by type-checking and the existing RPC client contract.

## Follow-ups

None.

## Files Created/Modified

- `shared/types.ts` — Added ThinkingLevel union type and RPC_THINKING_LEVELS constant
- `main/session/session-handle.ts` — Added setThinkingLevel method
- `main/ipc/handlers.ts` — Added SET_THINKING_LEVEL IPC handler (null-on-error)
- `preload/preload.ts` — Exposed window.gsd.setThinkingLevel binding
- `renderer/components/ThinkingLevelChip.tsx` — New component: 7-level dropdown, optimistic update, rollback, Ctrl+Shift+T cycling
- `renderer/components/SessionHeaderBar.tsx` — Wired ThinkingLevelChip between model chip and cost line
- `renderer/components/SessionHeaderBar.test.tsx` — Fixed missing vi import; extended tests for ThinkingLevelChip integration
- `main/session/session-handle.test.ts` — Tests for setThinkingLevel method
- `main/ipc/handlers.test.ts` — Tests for SET_THINKING_LEVEL handler
- `preload/preload.test.ts` — Tests for setThinkingLevel preload binding

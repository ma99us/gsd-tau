---
id: S05
parent: M002
milestone: M002
provides:
  - Renderer chat view: folder picker, streaming turn list, ToolCard, Composer — full chat turn visible in Electron window
requires:
  - slice: S04
    provides: IPC bridge and window.gsd API surface (prompt, onEvent, openProject)
affects:
  - S06
key_files:
  - renderer/App.tsx
  - renderer/hooks/useSession.ts
  - renderer/hooks/turnsReducer.ts
  - renderer/hooks/turnsReducer.test.ts
  - renderer/components/TurnList.tsx
  - renderer/components/Composer.tsx
  - renderer/components/ToolCard.tsx
  - renderer/components/ToolCard.test.ts
  - renderer/global.d.ts
key_decisions:
  - Extracted turnsReducer.ts as a pure reducer so all turn-state logic is testable in plain Node without React or Electron mocks
  - Handler-ref pattern in useSession avoids stale closures — IPC subscription created once per sessionId, handleEventRef updated each render
  - Implicit assistant-turn fallback for text_delta/tool_use events that arrive without a preceding agent_start, making the renderer robust to non-conforming pi sequences
  - Exported formatInputSummary and formatResult as named exports from ToolCard so 22 unit tests cover formatting without jsdom or @testing-library/react
  - Expand/collapse guarded by hasExpandableContent — avoids dead chevron on empty-input tool calls
patterns_established:
  - Pure reducer pattern for event-driven state (turnsReducer) — testable without React/Electron
  - Handler-ref pattern for stable IPC subscriptions with up-to-date closures
  - Exported pure helper functions from components for isolated unit testing without jsdom
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/phases/02-session-manager-and-minimal-shell/S05-T09-SUMMARY.md
  - .gsd/phases/02-session-manager-and-minimal-shell/S05-T10-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-20T15:19:29.632Z
blocker_discovered: false
---

# S05: Renderer Chat View

**Full chat UI delivered: folder picker, streaming turn list with assistant bubbles, ToolCard with expand/collapse and pending/result states, Composer with Enter-to-send — 170 tests passing.**

## What Happened

T09 implemented the complete renderer chat view: `App.tsx` shows a folder-picker text input + Open button on mount, stores cwd and sessionId in component state, and renders a turn list. Turn state is managed by a pure `turnsReducer.ts` extracted from `useSession.ts` — this separation made 30 new reducer unit tests possible without React or Electron mocks. The `useSession` hook subscribes to IPC events once per sessionId using a handler-ref pattern to avoid stale closures; it handles `text_delta`, `tool_use`, `tool_result`, `agent_start`, `session_stopped`, and `error` events. The `Composer` component sends on Enter and inserts a newline on Shift+Enter. An implicit assistant-turn fallback handles `text_delta`/`tool_use` events arriving without a preceding `agent_start`, making the renderer robust to non-conforming pi sequences. A `global.d.ts` declares `window.gsd: GsdApi` for TypeScript. T10 added `ToolCard.tsx` showing tool name, a 80-char input summary, and a collapsed result. Expand/collapse is gated on `hasExpandableContent` to avoid a dead chevron on empty-input calls. `resultText` is gated on both `!pending` and `result !== undefined` to suppress empty Result sections during streaming. `formatInputSummary` and `formatResult` are exported as named functions so 22 unit tests cover formatting logic in plain Node without jsdom or @testing-library/react. `TurnList.tsx` was updated to render `ToolCard` instances inline in the assistant section.

## Verification

pnpm test: 8 test files, 170 tests, all passed (exec 4b9cf3e7). tsc --noEmit: zero new errors from S05 (exec 52e67e8e).

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

Added renderer/global.d.ts (not in task file list) to declare window.gsd: GsdApi for TypeScript. Added renderer/hooks/turnsReducer.ts as a supporting module (extracted from useSession.ts for testability). Extended vitest.config.ts to include renderer/hooks test files.

## Known Limitations

Error surfacing when window.gsd.prompt rejects is swallowed in Phase 1 — session state transitions to Stopped (disabling Composer) but the error message is not shown to the user. Deferred to a later phase. Pre-existing TypeScript error in main/session/session-manager.test.ts (Mock type mismatch on ClientFactory) predates S05.

## Follow-ups

Error message surfacing for failed prompt() calls (currently swallowed). Native OS folder-picker dialog via IPC (currently text input). S06 shutdown verification and Playwright smoke suite.

## Files Created/Modified

- `renderer/App.tsx` — Root chat view: folder picker, turn list, session state wiring
- `renderer/hooks/useSession.ts` — IPC subscription hook using handler-ref pattern
- `renderer/hooks/turnsReducer.ts` — Pure reducer for all turn/event state transitions
- `renderer/hooks/turnsReducer.test.ts` — 30 unit tests covering all reducer actions and boundary cases
- `renderer/components/TurnList.tsx` — Turn list rendering user bubbles, streaming assistant text, and ToolCards
- `renderer/components/Composer.tsx` — Message composer with Enter-to-send and Shift+Enter newline
- `renderer/components/ToolCard.tsx` — Tool card with pending/result states, expand/collapse, named format helpers
- `renderer/components/ToolCard.test.ts` — 22 unit tests for formatInputSummary and formatResult
- `renderer/global.d.ts` — TypeScript ambient declaration for window.gsd: GsdApi

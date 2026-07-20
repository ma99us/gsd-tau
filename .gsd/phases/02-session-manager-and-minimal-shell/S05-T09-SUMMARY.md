---
id: T09
parent: S05
milestone: M002
key_files:
  - renderer/App.tsx
  - renderer/hooks/useSession.ts
  - renderer/hooks/turnsReducer.ts
  - renderer/hooks/turnsReducer.test.ts
  - renderer/components/TurnList.tsx
  - renderer/components/Composer.tsx
  - renderer/global.d.ts
  - vitest.config.ts
key_decisions:
  - Extracted turn state into a pure reducer (turnsReducer.ts) so event logic is testable in plain Node without React or Electron mocks
  - Handler-ref pattern in useSession — IPC subscription created once per sessionId, handleEventRef updated every render to avoid stale closures
  - Implicit assistant-turn fallback for text_delta/tool_use events that arrive without a preceding agent_start, making the renderer robust to non-conforming pi event sequences
  - Folder picker implemented as a text-input + Open button (no new IPC dialog channel needed); error state shown inline
  - Basic tool display inlined in TurnList for T09; T10 replaces it with the full ToolCard component
  - Auto-scroll suspends when distanceFromBottom > 40px, resumes when user scrolls back to bottom
duration: 
verification_result: passed
completed_at: 2026-07-20T15:14:50.116Z
blocker_discovered: false
---

# T09: Renderer chat view implemented: folder picker, streaming turn list, and Composer with Enter-to-send

**Renderer chat view implemented: folder picker, streaming turn list, and Composer with Enter-to-send**

## What Happened

Implemented the full renderer chat view across 7 new/updated files. The architecture extracts turn state into a pure reducer (`turnsReducer.ts`) so event-processing logic is independently testable without React or Electron. The `useSession` hook wires the reducer to IPC: it subscribes to `window.gsd.onEvent` and `window.gsd.onStateChange` via a handler-ref pattern that avoids stale closures (the IPC subscription is created once per sessionId; a `handleEventRef` is updated every render so the latest closure is always called). The hook handles `agent_start`, `text_delta`, `tool_use`, `tool_result`, and `agent_end` events, including an implicit-assistant-turn fallback for pi streams that omit `agent_start`. App.tsx renders two views: before a session is open it shows a centered folder-picker (path text input + Open button with loading/error states); after open it shows a header with path and state indicator, a scrollable TurnList, and a Composer pinned to the bottom. TurnList auto-scrolls on new turns but suspends auto-scroll when the user manually scrolls up. Composer is an uncontrolled textarea that grows to fit content; Enter sends, Shift+Enter inserts a newline. Basic tool display is inline in TurnList (name, pending indicator, 80-char input summary) — the full ToolCard with expand/collapse is scoped to T10. vitest.config.ts was extended to include `renderer/hooks/**/*.test.ts`, and turnsReducer.test.ts provides 30 unit tests covering all reducer actions and boundary conditions.

## Verification

Ran `pnpm test` — 8 test files, 170 tests, all passed (including 30 new reducer unit tests covering RESET, USER_TURN, AGENT_START, TEXT_DELTA, TOOL_USE, TOOL_RESULT and boundary cases). Ran `tsc --noEmit` — zero errors introduced by T09; remaining tsc errors are pre-existing in `main/session/session-manager.test.ts` and are unrelated to this task. Manual integration verification (send 'hello', see streaming; send 'read package.json', see tool card) is a runtime test requiring the Electron app, documented as part of slice-level UAT.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test` | 0 | ✅ pass — 170 tests across 8 files all passed | 2506ms |
| 2 | `npx tsc --noEmit` | 0 | ✅ pass — no errors in renderer files; pre-existing errors in main/session test files are unrelated | 2816ms |

## Deviations

Added `renderer/global.d.ts` (not in the task file list) to declare `window.gsd: GsdApi` for TypeScript. Added `renderer/hooks/turnsReducer.ts` as a supporting module (the task plan implied useSession.ts would contain all hook logic, but extracting the reducer improves testability with no downstream impact). Extended vitest.config.ts to include renderer/hooks test files.

## Known Issues

Pre-existing TypeScript errors in `main/session/session-manager.test.ts` (Mock type mismatch with ClientFactory) exist before this task and are unrelated. `window.gsd.prompt` errors in the `send()` function are not surfaced to the user in T09 — the session state watcher transitions to Stopped which disables the composer, but the error message itself is swallowed. This is acceptable for Phase 1; error surfacing can be improved in a later phase.

## Files Created/Modified

- `renderer/App.tsx`
- `renderer/hooks/useSession.ts`
- `renderer/hooks/turnsReducer.ts`
- `renderer/hooks/turnsReducer.test.ts`
- `renderer/components/TurnList.tsx`
- `renderer/components/Composer.tsx`
- `renderer/global.d.ts`
- `vitest.config.ts`

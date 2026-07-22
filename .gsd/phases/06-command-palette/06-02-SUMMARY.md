---
id: S02
parent: M006
milestone: M006
provides:
  - AppCommand interface and useAppCommands hook for consumption by S03 CommandPalette overlay
requires:
  []
affects:
  - S03
key_files:
  - renderer/hooks/useAppCommands.ts
  - renderer/hooks/useAppCommands.test.ts
key_decisions:
  - Exported buildAppCommands as a pure factory alongside the hook so tests call it directly without renderHook or jsdom
  - copy-last-turn accepts getLastTurnText?: () => string callback so the hook stays pure and testable
  - show-tray and toggle-auto-run-panel are console.warn stubs — wired in S04+
patterns_established:
  - Pure factory pattern (buildAppCommands) alongside the hook enables test-only import without jsdom/renderHook overhead
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/phases/06-command-palette/S02-T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-22T12:33:59.893Z
blocker_discovered: false
---

# S02: App command registry

**Delivered useAppCommands hook and buildAppCommands pure factory with 7 typed AppCommand entries and 34 passing vitest tests**

## What Happened

T01 delivered both the hook and its tests in a single task. `buildAppCommands` is a pure factory function that takes `sessionId` and an optional `getLastTurnText` callback, returning 7 typed `AppCommand` entries: new-session, open-project, close-tab, compact-context, copy-last-turn, show-tray, and toggle-auto-run-panel. The hook `useAppCommands` wraps the factory with `useMemo` for stable reference identity. close-tab and compact-context are no-ops when sessionId is null. new-session and open-project call `gsd().showFolderPicker()` then `gsd().openProject()`. copy-last-turn calls `navigator.clipboard.writeText` with the injected text callback. show-tray and toggle-auto-run-panel emit `console.warn` stubs to be wired in S04+. Tests call `buildAppCommands` directly — no jsdom or renderHook needed.

## Verification

Ran: pnpm vitest run renderer/hooks/useAppCommands.test.ts — 1 test file, 34 tests, all passed in 1.34s.

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

None.

## Known Limitations

show-tray and toggle-auto-run-panel are console.warn stubs; IPC wiring deferred to S04.

## Follow-ups

None.

## Files Created/Modified

- `renderer/hooks/useAppCommands.ts` — useAppCommands hook and buildAppCommands pure factory with 7 typed AppCommand entries
- `renderer/hooks/useAppCommands.test.ts` — 34 vitest unit tests covering all 7 commands, null sessionId, and stub behaviors

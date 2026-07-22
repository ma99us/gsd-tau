---
id: S05
parent: M006
milestone: M006
provides:
  - pi slash commands in CommandPalette with badge, description, fuzzy-match, and prompt dispatch
  - full M006 milestone feature-complete
requires:
  - slice: S04
    provides: CommandPalette overlay with keyboard shortcut wiring
affects:
  []
key_files:
  - renderer/hooks/usePiCommands.ts
  - renderer/hooks/usePiCommands.test.ts
  - renderer/hooks/useAppCommands.ts
  - renderer/hooks/useAppCommands.test.ts
  - renderer/components/CommandPalette.tsx
  - renderer/components/CommandPalette.test.ts
key_decisions:
  - badge and description are optional on AppCommand so filterAndSortCommands handles pi and app commands identically without branching
  - pi command IDs are namespaced as pi:{name} to avoid collision with built-in command IDs
  - RpcSlashCommand cast via unknown to avoid bundling @opengsd/contracts into renderer — consistent with import-type-only pattern
  - fetch() triggered on palette open (useEffect[open]) not on mount — avoids wasted IPC when palette is never opened
patterns_established:
  - Injectable-fetcher hook with TTL cache (usePiCommands follows useAvailableModels pattern) — reuse for any future RPC-backed hook needing caching
  - pi: namespace prefix for command IDs prevents collision between pi slash commands and built-in app commands in the merged palette
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/phases/06-command-palette/S05-T01-SUMMARY.md
  - .gsd/phases/06-command-palette/S05-T02-SUMMARY.md
  - .gsd/phases/06-command-palette/S05-T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-22T13:38:17.224Z
blocker_discovered: false
---

# S05: Pi slash commands in palette and regression check

**Pi slash commands fetched via get_commands RPC now appear in the command palette with source badges, fuzzy-match, and prompt dispatch — all 1026 unit tests green.**

## What Happened

T01 introduced `usePiCommands`, a hook mirroring the `useAvailableModels` pattern with a 60 s TTL cache and injectable fetcher. The hook is intentionally imperative (no mount-trigger) so the palette controls exactly when IPC is called. 14 unit tests cover cache hit/miss, error path, TTL expiry, and multi-item round-trips.

T02 extended the `AppCommand` interface with optional `badge?` and `description?` fields so pi commands flow through the existing `filterAndSortCommands` pipeline unchanged. `CommandPalette` triggers `usePiCommands.fetch()` via `useEffect([open])`, maps each `RpcSlashCommand` to an `AppCommand` with id `pi:{name}` (avoiding collision with built-in IDs), renders the badge and description in list items, and dispatches the selected command via `gsd().prompt('/{name}')`. 64 tests across `CommandPalette.test.ts` and `useAppCommands.test.ts` all pass.

T03 was the regression gate: `pnpm vitest run` exited 0 with 39 test files and 1026 tests passing in ~5 s, confirming no regressions from the wiring.

## Verification

pnpm vitest run — exit 0, 39 files passed, 1026 tests passed (confirmed in both T03 and the slice-level re-run). Individual task verifications: T01 — 14 tests; T02 — 64 tests across 2 files; T03 / slice re-run — full 1026.

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

T01 added one extra test ('caches multiple commands in the result list') beyond the useAvailableModels baseline. No functional deviations.

## Known Limitations

None. The slice is the final slice of M006; the milestone is now feature-complete.

## Follow-ups

None.

## Files Created/Modified

- `renderer/hooks/usePiCommands.ts` — New hook: fetches RpcSlashCommand[] via window.gsd.getCommands with 60 s TTL cache and injectable fetcher
- `renderer/hooks/usePiCommands.test.ts` — 14 unit tests covering cache hit/miss, error path, TTL expiry, null-sessionId no-op, and multi-item round-trips
- `renderer/hooks/useAppCommands.ts` — Added optional badge? and description? fields to AppCommand interface
- `renderer/hooks/useAppCommands.test.ts` — Updated tests for new AppCommand shape
- `renderer/components/CommandPalette.tsx` — Wired usePiCommands: fetch on open, merge pi commands with id pi:{name}, render badge/description, dispatch via gsd().prompt()
- `renderer/components/CommandPalette.test.ts` — Extended tests covering pi command rendering, badge display, and prompt dispatch

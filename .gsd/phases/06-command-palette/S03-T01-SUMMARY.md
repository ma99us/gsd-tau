---
id: T01
parent: S03
milestone: M006
key_files:
  - renderer/components/CommandPalette.tsx
  - renderer/components/CommandPalette.test.ts
key_decisions:
  - Used @radix-ui/react-dialog for focus trap + Escape instead of manual implementation — already installed and unused; clean fit for a singleton overlay.
  - filterAndSortCommands uses commands.indexOf(a) for stable empty-query tiebreaker (O(n²) but palette has ≤20 commands so immaterial).
  - Test file imports only the pure helper — avoids JSX evaluation in node env without needing vi.mock.
duration: 
verification_result: passed
completed_at: 2026-07-22T12:41:22.180Z
blocker_discovered: false
---

# T01: Implemented CommandPalette overlay component with Radix Dialog and exported filterAndSortCommands pure helper; 20 vitest node-env tests all green.

**Implemented CommandPalette overlay component with Radix Dialog and exported filterAndSortCommands pure helper; 20 vitest node-env tests all green.**

## What Happened

Created two files per the slice plan:

**renderer/components/CommandPalette.tsx** — the overlay component using `@radix-ui/react-dialog` for accessible focus trapping, Escape handling, and portal rendering. Exports:
- `filterAndSortCommands(query, commands, mruIds)` — pure helper (no React dependency) that: (a) for empty query sorts by MRU position with stable originalIndex tiebreaker for non-MRU commands; (b) for non-empty query fuzzy-scores each label, filters -Infinity, then sorts MRU-boosted (in-MRU floats above non-MRU regardless of score, lower MRU index = more recent = higher), then by fuzzyScore descending.
- `CommandPalette({ open, onClose, sessionId, getLastTurnText })` — composes `useAppCommands`, `useMRU('gsd-tau:mru-commands')`, and the pure helper. ArrowDown/Up wraps selection, Enter records MRU + fires execute() + resets + calls onClose, Escape is handled by Radix onOpenChange(false). selectedIndex resets on every query change. State resets naturally on reopen because Radix Dialog unmounts Dialog.Content when open=false.

**renderer/components/CommandPalette.test.ts** — plain `.ts` (not `.tsx`), imports only `filterAndSortCommands` from the component file and `buildAppCommands` from the hook. No JSX, no DOM. Covers 20 cases across three describe blocks: non-empty query (roadmap proof, non-match, MRU boost, MRU tie, score ordering, single-char, custom list), empty query (all-commands passthrough, original-order, partial/full MRU, no-loss invariant), and edge cases (empty commands array, unknown MRU ids, mutation guards, whitespace query).

The `commands.indexOf(a)` call inside the empty-query sort is O(n²) in theory but irrelevant for the ≤20 command palette.

## Verification

Ran `pnpm vitest run renderer/components/CommandPalette.test.ts` via gsd_exec (node runtime, pwsh). Result: 1 test file passed, 20 tests passed, 0 failures, duration 2.02s.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/components/CommandPalette.test.ts` | 0 | ✅ pass — 1 file, 20 tests | 2020ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/CommandPalette.tsx`
- `renderer/components/CommandPalette.test.ts`

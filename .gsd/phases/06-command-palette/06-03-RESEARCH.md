# S03: CommandPalette Overlay Component — Research

**Date:** 2026-07-22

## Summary

S03 builds the `CommandPalette` overlay component that composes the fuzzy scorer (S01), MRU hook (S01), and app command registry (S02) into a keyboard-navigable, focus-trapped overlay. All dependencies are already implemented and tested. The codebase has a clear, established pattern for this kind of work.

`@radix-ui/react-dialog` is installed but unused so far — it's the right primitive for this overlay: provides accessible focus trap, Escape handling, `aria-modal`, and portal rendering with no extra cost. The existing queue-based modals use raw divs because they're orchestrated through a queue system, but the palette is a standalone singleton overlay — a clean fit for Radix Dialog.

The test environment is `node` globally (`vitest.config.ts`). No jsdom, no `@testing-library/react`. All component tests in this codebase follow the **pure-helper extraction pattern**: export filtering/sorting logic as named pure functions, test those in node env. Rendering and keyboard interaction are **not** tested at the DOM level. The roadmap proof requirement ("type 'comp', Compact context floats to top, Enter fires execute(), palette closes") is satisfied by testing `filterAndSortCommands` as a pure function — no jsdom needed.

## Recommendation

Create two files:
1. `renderer/components/CommandPalette.tsx` — the overlay component using `@radix-ui/react-dialog`, composing S01/S02 hooks. Export `filterAndSortCommands` as a pure helper.
2. `renderer/components/CommandPalette.test.ts` — node-env vitest tests covering `filterAndSortCommands` (fuzzy filter, MRU ordering, empty query, exact roadmap assertion).

Use a single task: component + tests are tightly coupled and both small.

## Implementation Landscape

### Key Files

- `renderer/hooks/fuzzyMatch.ts` — exports `fuzzyScore(query, label): number`. Returns `-Infinity` for non-subsequences. Import and call directly.
- `renderer/hooks/useMRU.ts` — exports `useMRU(key?, maxLen?, storage?)` returning `{ ids, record, clear }`. `ids` is the ordered MRU list; `record(id)` prepends and persists.
- `renderer/hooks/useAppCommands.ts` — exports `AppCommand` interface and `useAppCommands(sessionId, getLastTurnText?)`. Each entry has `id`, `label`, `sessionId?`, `execute`.
- `renderer/components/ModelPickerDropdown.tsx` — reference for pure-helper extraction pattern + Radix DropdownMenu usage.
- `renderer/components/modals/ConfirmModal.tsx` — reference for manual focus-trap pattern (not needed here since Radix Dialog handles it).
- `vitest.config.ts` — `environment: 'node'` globally. No jsdom. Component tests must not import JSX or Radix directly.

### Component Design

```typescript
// Pure helper — export for node-env tests
export function filterAndSortCommands(
  query: string,
  commands: AppCommand[],
  mruIds: string[],
): AppCommand[]
// - If query empty: return commands sorted by MRU position (mruIds index), unmatched at end
// - If query non-empty: fuzzyScore each label, filter !== -Infinity, sort by:
//     1. MRU boost: mruIds.indexOf(id) < mruIds.indexOf(other) → higher
//     2. Then by fuzzyScore descending

// Component
export function CommandPalette({ open, onClose, sessionId, getLastTurnText? }: Props)
// - Uses @radix-ui/react-dialog (Dialog.Root, Dialog.Portal, Dialog.Overlay, Dialog.Content)
// - Internal state: query (string), selectedIndex (number)
// - Calls useAppCommands(sessionId, getLastTurnText)
// - Calls useMRU('gsd-tau:mru-commands') for { ids, record }
// - Derives filtered list = filterAndSortCommands(query, commands, ids)
// - ArrowUp/ArrowDown → adjust selectedIndex (clamped, wrapping)
// - Enter → record(selected.id), selected.execute(), onClose()
// - Escape → handled by Radix Dialog (onOpenChange(false))
// - Resets query + selectedIndex to 0 when open transitions true→true (onOpenChange)
```

### Build Order

Single task: implement `filterAndSortCommands` pure helper first (10 lines), verify it satisfies the roadmap proof in a test, then build the full component around it.

### Verification Approach

```
pnpm vitest run renderer/components/CommandPalette.test.ts
```

Tests must cover:
- `filterAndSortCommands('comp', appCommands, [])` → first result has `id === 'compact-context'`
- `filterAndSortCommands('', commands, ['compact-context', 'close-tab'])` → compact-context is index 0
- MRU boost: a recently-used command with lower fuzzy score still floats above a higher-scoring non-MRU command
- Empty query with no MRU → returns all commands (original order)
- Non-matching query returns empty array

## Constraints

- `vitest.config.ts` environment is `node` globally — `CommandPalette.test.ts` must be `.ts` (not `.tsx`) and must NOT import the component itself (which contains JSX). Import only the pure exported helper.
- `@radix-ui/react-dialog` is already installed — no new dependencies needed.
- The `vi.mock` pattern from `SessionHeaderBar.test.tsx` is available if needed (mock sub-components to prevent Radix from importing in node env), but for this slice the pure-helper extraction avoids any need for mocking.

## Common Pitfalls

- **Importing JSX in a node-env test** — If `CommandPalette.test.ts` imports the component directly, Radix Dialog's browser-only code will fail. Only import the pure-helper function. Follow the ConfirmModal/ModelPickerDropdown test pattern exactly.
- **MRU sort tiebreaker** — When query is empty and a command doesn't appear in `mruIds`, its sort position should be stable (don't put it at -1 which sorts before MRU entries). Use `mruIds.indexOf(id)` and treat -1 as `mruIds.length + originalIndex` for stable ordering.
- **selectedIndex reset** — Reset to 0 when `query` changes and when the palette opens (otherwise stale index after reopening).
- **Radix Dialog onOpenChange** — Radix calls `onOpenChange(false)` on Escape and overlay click. Wire this to `onClose` and reset internal state there (not in a separate `useEffect`).

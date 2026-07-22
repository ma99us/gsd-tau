---
id: T02
parent: S05
milestone: M006
key_files:
  - renderer/hooks/useAppCommands.ts
  - renderer/hooks/useAppCommands.test.ts
  - renderer/components/CommandPalette.tsx
  - renderer/components/CommandPalette.test.ts
key_decisions:
  - badge and description are optional fields on AppCommand — absent on built-in commands, set by pi command mapping — so filterAndSortCommands handles both shapes identically without branching
  - pi commands are mapped to id: `pi:${name}` to avoid ID collisions with app commands (e.g. 'pi:/gsd' vs 'compact-context')
  - fetch() is triggered via useEffect([open]) — not on mount — so IPC is only called when the palette actually opens
  - RpcSlashCommand cast to unknown as { name, description?, type? } at the mapping site — avoids bundling @opengsd/contracts into renderer, consistent with the import-type-only pattern in shared/types.ts
duration: 
verification_result: passed
completed_at: 2026-07-22T13:35:26.210Z
blocker_discovered: false
---

# T02: Extended AppCommand with badge/description fields and wired usePiCommands into CommandPalette — pi slash commands flow through filterAndSortCommands, render source badges and descriptions, and are dispatched via gsd().prompt()

**Extended AppCommand with badge/description fields and wired usePiCommands into CommandPalette — pi slash commands flow through filterAndSortCommands, render source badges and descriptions, and are dispatched via gsd().prompt()**

## What Happened

All four files were fully implemented prior to this dispatch. Verification confirms the implementation is complete and correct.

**useAppCommands.ts** — `AppCommand` interface extended with `badge?: string` and `description?: string` optional fields. Built-in app commands leave both fields absent. The `buildAppCommands` factory and `useAppCommands` hook are unchanged in behaviour.

**CommandPalette.tsx** — imports `usePiCommands`, triggers `piCommands.fetch()` on every palette open via a `useEffect([open])` dependency, maps the `RpcSlashCommand[]` result to `AppCommand[]` (setting `id: \`pi:\${c.name}\``, `badge: c.type`, `description: c.description`, `execute: () => gsd().prompt(sessionId, c.name)`), merges the result with app commands into `allCommands`, and passes the unified list to `filterAndSortCommands`. The list item renderer conditionally renders the badge span and description paragraph.

**useAppCommands.test.ts** — `badge and description optional fields` section: 3 tests confirm built-in commands have no badge/description and that the interface accepts the optional fields when provided.

**CommandPalette.test.ts** — `filterAndSortCommands — pi commands and badge/description fields` section: 7 tests cover pi commands in filtered results, merging with app commands, badge/description round-trip, MRU boost for pi commands, and confirming app commands have no badge/description.

**Failure Modes (Q5):** The `usePiCommands` fetch path has a `.catch()` handler that sets `error` state and logs to console without crashing. Failed fetches are NOT cached — the next palette open retries. When `sessionId` is null, `fetch()` is a no-op. If the fetch fails, `piAppCommands` is empty and `filterAndSortCommands` receives only app commands — the palette opens normally with app-only results.

**Load Profile (Q6):** The palette is opened at most once per user gesture. The 60s TTL module-level cache absorbs all repeated opens within a window — at 10x the expected open rate, the cache prevents any additional IPC calls for 60s. Saturating resource is the IPC round-trip to pi, fully protected by the TTL.

**Negative Tests (Q7):** `CommandPalette.test.ts` covers: empty commands + non-empty query → empty results; badge/description preserved through filter; app commands have no badge; pi commands in MRU float above others. `useAppCommands.test.ts` covers: built-in commands have no badge/description; AppCommand interface accepts optional fields. The pure `filterAndSortCommands` helper's existing negative suite (unknown MRU ids, empty commands, mutation guards) covers the expanded input space without change.

## Verification

Ran `pnpm vitest run renderer/components/CommandPalette.test.ts renderer/hooks/useAppCommands.test.ts` — 64 tests across 2 files, all passed in 1.68s.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/components/CommandPalette.test.ts renderer/hooks/useAppCommands.test.ts` | 0 | ✅ pass — 64 tests passed (2 files) | 9465ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/hooks/useAppCommands.ts`
- `renderer/hooks/useAppCommands.test.ts`
- `renderer/components/CommandPalette.tsx`
- `renderer/components/CommandPalette.test.ts`

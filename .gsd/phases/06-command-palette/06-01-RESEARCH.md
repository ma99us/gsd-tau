# S01: Fuzzy Match Engine and MRU Hook — Research

**Date:** 2026-07-22

## Summary

S01 is two small, pure utilities: a fuzzy scorer function and an MRU hook. The codebase pattern is well-established — see `renderer/hooks/useAvailableModels.ts`: pure testable functions exported at module level (injectable dependencies), a thin React hook on top, and a `*.test.ts` sibling in the same directory. Both artifacts for S01 follow this exact pattern.

No fuzzy match library is currently installed. For a command palette with ≤30 commands, a hand-rolled subsequence scorer (40–60 lines) is the right call — no new dependency, trivially testable against the roadmap's exact assertion (`fuzzy('cp', 'compact context') > fuzzy('cp', 'open project')`), and straightforward to explain to downstream slice authors. The scorer awards points for: contiguous match runs, word-boundary hits (start of word), and position bias (earlier match = higher score).

The MRU hook stores an ordered array of command IDs in `localStorage` under a fixed key. The injectable-storage pattern (pass a storage object, default to `window.localStorage`) makes it fully testable in `vitest` without a DOM.

## Recommendation

Hand-roll both utilities. Do not add fuse.js or similar. The command palette has a small, static command set — a full fuzzy search library adds dependency weight with no benefit. The scorer needs only to satisfy the roadmap assertion; a subsequence + word-boundary scorer does this in ~50 lines.

File placement follows the existing `renderer/hooks/` pattern. Tests must be `.test.ts` (not `.test.tsx`) per MEM033 and the vitest include glob `renderer/hooks/**/*.test.ts`.

## Implementation Landscape

### Key Files

- `renderer/hooks/fuzzyMatch.ts` — **new file**. Exports `fuzzyScore(query: string, target: string): number` (0 = no match, higher = better). Pure function, no imports. The planner should scope the full impl + tests here.
- `renderer/hooks/fuzzyMatch.test.ts` — **new file**. Unit tests: exact match, subsequence, word-boundary bonus, `fuzzy('cp', 'compact context') > fuzzy('cp', 'open project')`, empty query, no-match returns 0.
- `renderer/hooks/useMRU.ts` — **new file**. Exports `recordMRU(id: string, storage?: Storage): void` and `getMRU(storage?: Storage): string[]` (pure), plus `useMRU()` React hook returning `{ mru: string[], record: (id: string) => void }`.
- `renderer/hooks/useMRU.test.ts` — **new file**. Tests: round-trips through injectable storage mock, deduplication (recording existing ID moves it to front), max-length cap (≤20), empty storage returns `[]`.
- `renderer/hooks/useAvailableModels.ts` — **reference only**. Follow its injectable-dependency + module-level pure function + thin hook pattern exactly.
- `vitest.config.ts` — **read-only constraint**. Test globs include `renderer/hooks/**/*.test.ts`; no config changes needed.

### Build Order

1. **`fuzzyMatch.ts` + `fuzzyMatch.test.ts`** first — pure function, zero deps, immediately verifiable. Proves the roadmap assertion before anything else.
2. **`useMRU.ts` + `useMRU.test.ts`** second — depends on nothing, proves the localStorage round-trip.

Both files are independent; they can be built in parallel by an executor but sequential is fine given the small scope.

### Verification Approach

```
pnpm vitest run renderer/hooks/fuzzyMatch.test.ts
pnpm vitest run renderer/hooks/useMRU.test.ts
```

Roadmap assertion to encode as a test:
```ts
expect(fuzzyScore('cp', 'compact context')).toBeGreaterThan(fuzzyScore('cp', 'open project'))
```

MRU round-trip assertion:
```ts
const store = new MockStorage()
recordMRU('cmd-a', store)
recordMRU('cmd-b', store)
expect(getMRU(store)).toEqual(['cmd-b', 'cmd-a'])
```

## Constraints

- Test files **must be `.test.ts`** (not `.test.tsx`) — vitest glob is `renderer/hooks/**/*.test.ts`. Named `.test.tsx` would still match `renderer/components/**/*.test.{ts,tsx}` but not the hooks glob; keep `.test.ts` to be explicit (MEM033).
- `vitest.config.ts` `environment` is `'node'` — `window.localStorage` is not available in tests. The injectable-storage pattern is mandatory, not optional.
- No new npm dependencies. Hand-rolled scorer only.
- The `renderer/hooks/` directory already exists with `useAvailableModels.ts`, `turnsReducer.ts`, `useSession.ts` — new files drop in alongside these.

## Common Pitfalls

- **`window.localStorage` unavailable in vitest node env** — the hook must accept an injectable `Storage` param (default `window.localStorage`) so tests can pass a `Map`-backed mock. Failing to do this causes `ReferenceError: window is not defined`.
- **Duplicate MRU entries** — recording an already-present ID must move it to front, not append a second copy. Test this explicitly.
- **`fuzzyScore` returning 0 for non-subsequence instead of negative** — returning 0 for no-match is correct; callers filter `score > 0` to exclude non-matches.

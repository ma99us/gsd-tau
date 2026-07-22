---
id: S01
parent: M006
milestone: M006
provides:
  - fuzzyScore(query, label): number — subsequence fuzzy scorer with word-boundary bonuses
  - createMRUStore / useMRU — injectable-storage MRU with dedup and max-length cap
requires:
  []
affects:
  - S02
  - S03
key_files:
  - renderer/hooks/fuzzyMatch.ts
  - renderer/hooks/fuzzyMatch.test.ts
  - renderer/hooks/useMRU.ts
  - renderer/hooks/useMRU.test.ts
key_decisions:
  - Hand-rolled greedy scorer avoids DP overhead — sufficient for short palette queries
  - Returns -Infinity for non-subsequences so callers filter with a simple !== -Infinity check
  - Injectable StorageAdapter pattern decouples MRUStore from window.localStorage for pure node-env tests
  - liveStorage() guard wraps localStorage in try/catch — safe in SSR/node contexts
patterns_established:
  - Injectable storage adapter pattern (StorageAdapter interface + liveStorage guard) for any hook needing localStorage in vitest node env
observability_surfaces:
  - none
drill_down_paths:
  []
duration: ""
verification_result: passed
completed_at: 2026-07-22T12:25:19.074Z
blocker_discovered: false
---

# S01: Fuzzy match engine and MRU hook

**Hand-rolled fuzzyScore and injectable-storage useMRU hook, both with full vitest coverage (15 + 21 tests passing)**

## What Happened

T01 delivered a hand-rolled fuzzy scorer (`fuzzyMatch.ts`) using a two-pass greedy algorithm: first a subsequence check (returns -Infinity on no match), then word-boundary/consecutive bonuses. Returns a numeric score so callers can sort. The roadmap assertion is confirmed: fuzzyScore('cp','compact context')≈4.97 vs fuzzyScore('cp','open project')=-Infinity. 15 vitest tests cover scoring, ordering, edge cases, and the exact assertion.

T02 delivered a two-layer MRU system: a pure `createMRUStore` core with an injectable `StorageAdapter` interface, and a thin `useMRU` React wrapper that wires `window.localStorage` via a lazy guard. The injectable pattern makes the hook fully testable in vitest node env (no window). The store deduplicates entries on record, caps to a configurable max length, and persists serialized JSON. 21 vitest tests cover round-trip, deduplication, cap enforcement, and the localStorage adapter path.

## Verification

Ran `pnpm vitest run renderer/hooks/fuzzyMatch.test.ts` — 1 file, 15 tests, all passed (exit 0, ~1.37s).
Ran `pnpm vitest run renderer/hooks/useMRU.test.ts` — 1 file, 21 tests, all passed (exit 0, ~1.44s).
Roadmap assertion confirmed: fuzzyScore('cp','compact context') > fuzzyScore('cp','open project').

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

None. Both modules are pure utilities with no runtime dependencies.

## Follow-ups

None.

## Files Created/Modified

- `renderer/hooks/fuzzyMatch.ts` — Hand-rolled fuzzyScore: subsequence check + word-boundary/consecutive bonuses, returns -Infinity on no match
- `renderer/hooks/fuzzyMatch.test.ts` — 15 vitest tests covering scoring, ordering, and roadmap assertion
- `renderer/hooks/useMRU.ts` — createMRUStore core + useMRU React hook with injectable StorageAdapter and localStorage live adapter
- `renderer/hooks/useMRU.test.ts` — 21 vitest tests covering round-trip, dedup, cap, and localStorage adapter

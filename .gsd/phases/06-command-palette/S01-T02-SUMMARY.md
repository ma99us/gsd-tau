---
id: T02
parent: S01
milestone: M006
key_files:
  - renderer/hooks/useMRU.ts
  - renderer/hooks/useMRU.test.ts
key_decisions:
  - Injectable StorageAdapter pattern — decouples MRUStore from window.localStorage, enabling pure vitest node-env tests with a Map-backed adapter
  - Two-layer design: pure createMRUStore core + thin useMRU React wrapper — keeps unit tests framework-free and the hook minimal
  - liveStorage() guard wraps window.localStorage access in try/catch — safe in SSR / node contexts without a separate build flag
duration: 
verification_result: passed
completed_at: 2026-07-22T12:20:34.188Z
blocker_discovered: false
---

# T02: Implemented useMRU hook with injectable-storage MRUStore and 21 vitest tests all passing

**Implemented useMRU hook with injectable-storage MRUStore and 21 vitest tests all passing**

## What Happened


`renderer/hooks/useMRU.ts` implements two layers:

1. **`createMRUStore(key, maxLen, storage)`** — pure, React-free core. Takes an injected `StorageAdapter` (minimal `getItem`/`setItem` interface matching `localStorage`). `load()` parses JSON, guards against malformed data, and filters non-strings. `push(id)` deduplicates, prepends, caps at `maxLen`, and persists. `clear()` writes an empty array. Falls back to a no-op adapter when `window.localStorage` is unavailable (SSR/node env).

2. **`useMRU(key?, maxLen?, storage?)`** — thin React wrapper. Uses `useMemo` to create the store once, `useState` initialised from `store.load()`, and a `useCallback`-wrapped `record(id)` that calls `store.push` and updates state in one step.

`renderer/hooks/useMRU.test.ts` covers 21 cases across: exports, `load` (empty/null/seeded/key-isolation/corrupted JSON/non-array JSON/mixed-type arrays), `push` (prepend, dedup, move-to-front, idempotent re-push, persistence, synchronous return, maxLen cap, oldest-drop, custom maxLen-1), `clear` (empties list, push-after-clear), and key isolation across two stores sharing one adapter.

All tests run in vitest node environment — no `window.localStorage` access required.


## Verification


Ran `pnpm vitest run renderer/hooks/useMRU.test.ts` — 1 test file, 21 tests, all passed in ~1.4s (exit 0).


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/hooks/useMRU.test.ts` | 0 | ✅ pass — 21/21 tests passed | 8644ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/hooks/useMRU.ts`
- `renderer/hooks/useMRU.test.ts`

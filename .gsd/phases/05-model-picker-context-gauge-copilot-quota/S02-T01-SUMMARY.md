---
id: T01
parent: S02
milestone: M005
key_files:
  - renderer/hooks/useAvailableModels.ts
  - renderer/hooks/useAvailableModels.test.ts
key_decisions:
  - Separated cache logic (fetchAvailableModels, clearModelCache) from the React hook so vitest node environment can test it without DOM or React — mirrors the pattern established by turnsReducer.ts
  - Injectable fetcher + now parameters avoid timer mocking and keep TTL boundary tests deterministic
  - Failed fetches are not cached so the user can retry by reopening the dropdown
  - fetch() is caller-triggered (not useEffect on mount) to avoid hammering IPC on every render
duration: 
verification_result: passed
completed_at: 2026-07-21T18:45:38.561Z
blocker_discovered: false
---

# T01: Added useAvailableModels hook with module-level 60s TTL cache; 13 unit tests all pass

**Added useAvailableModels hook with module-level 60s TTL cache; 13 unit tests all pass**

## What Happened

Created two files:

**renderer/hooks/useAvailableModels.ts** — The hook separates its cache logic into exported pure functions (`fetchAvailableModels`, `clearModelCache`, `CACHE_TTL_MS`) so they are testable without React or IPC. The module-level `Map<string, CacheEntry>` cache is keyed by sessionId and shared across all hook instances. The React hook (`useAvailableModels`) is a thin wrapper that manages `models`, `loading`, and `error` state; it exposes a `fetch()` callback (not auto-fetching on mount) intended to be called when the dropdown opens. Failed fetches are not cached so the caller retries on the next open.

**renderer/hooks/useAvailableModels.test.ts** — 13 tests exercising `fetchAvailableModels` and `clearModelCache` directly in vitest's `node` environment. Covers: first-call fetcher invocation, cache hit within TTL, re-fetch after TTL expiry, per-session cache isolation, empty list, TTL boundary conditions (at TTL - 1 ms vs at exactly TTL), error propagation, non-caching of failed fetches, and post-clear re-fetch for single and multiple sessions.

Design choice: injectable `fetcher` + `now` parameters on `fetchAvailableModels` eliminate the need for timer mocking, keeping tests synchronous and deterministic. The `fetch()` hook method uses `window.gsd.getAvailableModels` as the production fetcher; errors are logged via `console.error` per the slice verification contract.

## Verification

Ran `pnpm vitest run renderer/hooks/useAvailableModels.test.ts` — 1 test file, 13 tests, all passed in 533ms total (8ms test execution).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/hooks/useAvailableModels.test.ts` | 0 | ✅ pass — 13/13 tests passed | 533ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/hooks/useAvailableModels.ts`
- `renderer/hooks/useAvailableModels.test.ts`

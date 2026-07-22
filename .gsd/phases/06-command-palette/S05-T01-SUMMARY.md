---
id: T01
parent: S05
milestone: M006
key_files:
  - renderer/hooks/usePiCommands.ts
  - renderer/hooks/usePiCommands.test.ts
key_decisions:
  - Followed the useAvailableModels pattern verbatim — same TTL, same injectable-fetcher signature, same cache-on-success-only rule — so T02 can slot usePiCommands into CommandPalette with minimal cognitive overhead.
  - fetch() is intentionally imperative (not triggered on mount) so the palette controls exactly when the IPC call happens, avoiding wasted requests when the palette is never opened.
duration: 
verification_result: passed
completed_at: 2026-07-22T13:15:30.392Z
blocker_discovered: false
---

# T01: Added usePiCommands hook with 60 s TTL cache, injectable fetcher, and 14 passing unit tests mirroring the useAvailableModels pattern

**Added usePiCommands hook with 60 s TTL cache, injectable fetcher, and 14 passing unit tests mirroring the useAvailableModels pattern**

## What Happened

## Failure Modes (Q5)

Single external dependency: `window.gsd.getCommands(sessionId)` (IPC bridge → pi RPC).

| Failure | Path | Handling |
|---|---|---|
| IPC timeout / session unknown | `getCommands` throws | `.catch()` sets `error` string, clears `loading`, preserves prior `commands`. Failed fetch NOT cached — next `fetch()` retries. |
| Malformed / empty response | Returns `[]` | Empty array stored normally; no crash. Test: "handles an empty command list". |
| `sessionId === null` | Caller passes null | `fetch()` is a no-op before calling IPC. |

## Load Profile (Q6)

`fetch()` is triggered only on user interaction (palette open). The 60 s TTL caps calls to ≤1 IPC round-trip per session-minute regardless of how many times the palette is re-opened. No background polling, no streaming — load dimension is negligible.

## Negative Tests (Q7)

| Test | Covers |
|---|---|
| `propagates fetcher errors to the caller` | IPC throws → error bubbles |
| `does NOT cache a failed fetch — next call retries the fetcher` | No stale error entry; retry works |
| `does not leak a failed session entry into subsequent different sessions` | Session isolation after error |
| `handles an empty command list without error` | Empty-array boundary |
| `re-fetches at exactly the TTL boundary (not-fresh)` | Off-by-one at TTL edge |
| `still returns cached data one millisecond before TTL expires` | TTL strictness (not ≤) |

All six cases asserted in `renderer/hooks/usePiCommands.test.ts`.

## Verification

Ran `pnpm vitest run renderer/hooks/usePiCommands.test.ts` via gsd_exec. Result: 1 test file, 14 tests, all passed in ~1.4 s (transform 81 ms, collect 126 ms, tests 17 ms).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/hooks/usePiCommands.test.ts` | 0 | ✅ pass — 14/14 tests passed | 8718ms |

## Deviations

Added one extra test ('caches multiple commands in the result list') beyond the useAvailableModels baseline to assert that a multi-item array round-trips through the cache correctly. No functional deviations from the task plan.

## Known Issues

None.

## Files Created/Modified

- `renderer/hooks/usePiCommands.ts`
- `renderer/hooks/usePiCommands.test.ts`

---
id: T02
parent: S03
milestone: M007
key_files:
  - renderer/components/AutoRunPanel.test.ts
key_decisions:
  - pinned optional nowMs parameter to a fixed epoch in tests to avoid Date.now() mocking — exploiting the T01 design decision that formatElapsed and computePanelFooter accept nowMs as an explicit argument
  - used 0.006 (not 0.005) for the formatCost round-up test to avoid floating-point representation ambiguity in toFixed
  - import type from @shared/types is fully erased by esbuild so no alias resolution is needed at runtime — Node vitest environment works without jsdom
duration: 
verification_result: passed
completed_at: 2026-07-22T15:40:10.411Z
blocker_discovered: false
---

# T02: Wrote 34 unit tests covering all four AutoRunPanel pure helpers (statusIcon, formatCost, formatElapsed, computePanelFooter) — all pass in Node vitest, no DOM required.

**Wrote 34 unit tests covering all four AutoRunPanel pure helpers (statusIcon, formatCost, formatElapsed, computePanelFooter) — all pass in Node vitest, no DOM required.**

## What Happened

Created `renderer/components/AutoRunPanel.test.ts` with 34 tests across four `describe` blocks, one per exported pure helper. The test approach mirrors the established `useMRU.test.ts` pattern: deterministic inputs with the optional `nowMs` parameter pinned to a fixed epoch so no time-mocking is needed.

**statusIcon (6 tests):** covers all four valid `GsdNodeStatus` values plus two negative/exhaustiveness-guard cases — an unknown string cast as `GsdNodeStatus` and an empty string — both confirmed to return `'?'` without throwing.

**formatCost (6 tests):** covers zero, whole-dollar, exact-2-decimal, truncation (1.234→$1.23), sub-cent rounding-down (0.001→$0.00), and rounding-up (0.006→$0.01). Avoided floating-point edge cases (e.g. 0.005) by using 0.006 where a deterministic round-up result was needed.

**formatElapsed (14 tests):** covers null, invalid ISO, empty string (all return `'—'`); future `startedAt` clamped to `'0s'`; boundary at 0s, 1s, 42s, 59s; boundaries at 60s (`'1m 0s'`) and 83s (`'1m 23s'`); boundary just before 1h (`'59m 59s'`); boundaries at exactly 1h (`'1h 0m'`), 3723s (`'1h 2m'`), 9000s (`'2h 30m'`); and a default-`nowMs` smoke test that just checks the result is a non-empty string.

**computePanelFooter (8 tests):** covers null milestone (with and without `nowMs`), live milestone with both labels delegated correctly (cost `$2.50`, elapsed `1m 30s`), null `autoStartedAt` propagation (`'—'`), non-zero cost accuracy, invalid `autoStartedAt` propagation (`'—'`), and default-`nowMs` smoke test.

No DOM, no jsdom, no mocks needed — the module's `import type` from `@shared/types` is erased at runtime by esbuild and the React JSX in the same file is transpiled without executing any component code during the pure-helper tests.

## Verification

Ran `pnpm vitest run renderer/components/AutoRunPanel.test.ts` via gsd_exec. Result: 1 test file passed, 34/34 tests passed, duration 1.28s (exit 0).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/components/AutoRunPanel.test.ts` | 0 | ✅ pass — 34/34 tests passed | 8217ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/AutoRunPanel.test.ts`

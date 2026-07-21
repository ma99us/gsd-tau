---
id: T05
parent: S05
milestone: M005
key_files:
  - main/services/quota-history.test.ts
  - main/services/quota-service.test.ts
key_decisions:
  - vi.mock factory for node:fs returns { default: methods, ...methods } to satisfy both ESM default-import (quota-history/quota-service use `import fs from 'node:fs'`) and named imports in the same test file
  - mockHistInst variable uses `mock` prefix so Vitest's hoisting transform allows it inside the vi.mock('./quota-history') factory closure
  - getAt tests use recent relative timestamps (hours ago) not fixed 2025 dates — entries are pruned after 90 days so fixed dates become stale as time passes
  - mkdirSync path assertion uses path.dirname(HISTORY_PATH) not DATA_DIR directly — on Windows path.join normalises forward-slash roots to backslash, making the string comparison cross-platform
duration: 
verification_result: passed
completed_at: 2026-07-21T20:44:36.559Z
blocker_discovered: false
---

# T05: Added 77 unit tests for QuotaHistory (load/append/getAt/getEntries) and QuotaService (poll loop, fetch paths, verdicts, projections, debounce, disconnect); 859/859 pass

**Added 77 unit tests for QuotaHistory (load/append/getAt/getEntries) and QuotaService (poll loop, fetch paths, verdicts, projections, debounce, disconnect); 859/859 pass**

## What Happened

Created two new test files: `main/services/quota-history.test.ts` (37 tests) and `main/services/quota-service.test.ts` (40 tests).

**quota-history.test.ts** mocks `node:fs` using `vi.mock('node:fs', ...)` with both `default` and named-export spread to handle ESM/CJS interop. Tests cover: `load()` fallback chain (main → .bak → []), pruning on load with conditional flush, malformed-entry filtering (missing fields, wrong types, non-array JSON, invalid JSON), `append()` atomic flush sequence (mkdirSync → writeFileSync(.tmp) → copyFileSync(.bak) → renameSync), error resilience (copyFileSync/writeFileSync failures don't throw), `getEntries()` insertion-order and reference stability, and `getAt()` boundary cases (empty, future-only, exact match, closest-at-or-before, after-all, first-timestamp-match).

**quota-service.test.ts** mocks `node:fs`, `./quota-history` (via a `mockHistInst` pattern with `mock`-prefixed variable for Vitest hoisting), and `global fetch` via `vi.stubGlobal`. Tests cover: `start()`/`stop()` lifecycle (history.load, watchFile, unwatchFile, interval timing with fake timers), `refreshNow()` unauthenticated (absent/malformed/invalid JSON), successful fetch (snapshot fields, percentRemaining, stale=false, fan-out, history.append, token not logged), `premium_interactions` absent, error handling (null with no cache, stale snapshot with prior cache, stale fan-out, non-2xx), all six verdict branches (safe/tight/runout/overage/unknown), projection (null <2 entries, null same-timestamp, burnPerDay from 2-day window, null on consumption decrease), `onAgentEnd()` debounce (always-fetches at _lastFetchAt=0, no-fetch within 5min, fetches after 5min), `disconnect()` (rmSync path, null snapshot, null fan-out, rmSync failure resilience), and `startDeviceCodeFlow()` throws without CLIENT_ID.

Two fixes were needed during verification: (1) `getAt` tests used `2025-06-01` dates which are >90 days old from today (2026-07-21) and got pruned — replaced with recent relative timestamps (30min/1h/2h/4h ago); (2) the `mkdirSync` assertion used `DATA_DIR` directly but on Windows `path.dirname(path.join('/app/data', '...'))` returns `\app\data` (backslashes) — fixed to use `path.dirname(HISTORY_PATH)` for OS-portable comparison.

## Verification

pnpm test — 859/859 passed (33 test files). Both new test files run cleanly. No TypeScript errors (pnpm tsc --noEmit passes as inherited from prior tasks).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test` | 0 | ✅ pass — 859/859 tests pass (33 test files) | 4386ms |

## Deviations

Fixed two test correctness issues discovered during verification: stale date timestamps in getAt tests (2025 dates pruned by 90-day window) and Windows path-separator mismatch in mkdirSync assertion. Both were test authoring errors, not plan deviations.

## Known Issues

None.

## Files Created/Modified

- `main/services/quota-history.test.ts`
- `main/services/quota-service.test.ts`

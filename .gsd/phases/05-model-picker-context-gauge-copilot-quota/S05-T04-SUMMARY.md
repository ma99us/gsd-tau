---
id: T04
parent: S05
milestone: M005
key_files:
  - renderer/components/QuotaWidget.tsx
  - renderer/components/QuotaWidget.test.ts
  - renderer/components/SessionHeaderBar.tsx
  - renderer/components/SessionHeaderBar.test.tsx
  - package.json
key_decisions:
  - Used Radix @radix-ui/react-popover (not a custom div popover) as the task plan specified — matches existing pattern for dropdown-menu/dialog usage; component is mocked in tests so no DOM requirement surfaces.
  - Bar fill = percentRemaining (78% remaining → bar 78% full), matching the spec demo 'Copilot ████████░░ 78% ✅'.
  - QuotaWidget has no sessionId prop — quota is account-wide; the service fans out to all renderers via IPC.
  - All four handler functions defined unconditionally at component top-level (not inside conditional branches) to satisfy React's hook/render rules.
  - handleDisconnect also calls setIsOpen(false) so the popover dismisses on disconnect without requiring a separate close action.
  - burnLast7d displayed as 7-day total (not divided by 7) since burnPerDay already provides the average; label reads 'Last 7 d' to be clear.
duration: 
verification_result: passed
completed_at: 2026-07-21T20:27:33.775Z
blocker_discovered: false
---

# T04: QuotaWidget component created with Radix Popover and wired into SessionHeaderBar; 782/782 tests pass

**QuotaWidget component created with Radix Popover and wired into SessionHeaderBar; 782/782 tests pass**

## What Happened

Installed `@radix-ui/react-popover@1.1.20` (the only missing dep). Created `renderer/components/QuotaWidget.tsx` — an account-wide singleton with two render paths: (1) unauthenticated (`snapshot === null || login === null`) shows a "Connect GitHub" button that calls `startQuotaAuth()` with `isConnecting` guard and `.finally()` clear; (2) authenticated shows a Radix `Popover.Root` whose trigger is a compact bar matching the "Copilot ████████░░ 78% ✅" spec. The popover content shows used / remaining (with verdict-coloured percentage) / reset date / stale-data warning, a Burn Rates section (conditional on `snapshot.projection !== null`) with Last 24h / Last 7d / Avg/day / Proj. at reset / Budget/day rows, and a footer with last-updated timestamp, ↻ Refresh button (guarded by `isRefreshing`), and Disconnect button. All four handler functions (`handleConnect`, `handleRefresh`, `handleDisconnect`) use `.catch()` with `console.error('[QuotaWidget] ...')` and `.finally()` to clear loading flags. `disconnectQuotaAuth()` also calls `setIsOpen(false)` so the popover doesn't stay open after disconnect. Four pure helper functions (`verdictIcon`, `formatPercent`, `formatResetDate`, `formatBurnRate`) are exported for isolated testing. Colour maps (`VERDICT_TEXT_CLASS`, `VERDICT_BAR_CLASS`) key on all five `QuotaVerdict` values with a `?? .unknown` fallback for unexpected runtime values. SessionHeaderBar.tsx gained one import (`QuotaWidget`) and one render element at the end of the bar (with a · separator). SessionHeaderBar.test.tsx gained a `vi.mock('./QuotaWidget', ...)` entry matching the three existing component mocks. Created `renderer/components/QuotaWidget.test.ts` with 30 pure-Node tests covering all 4 helpers: `verdictIcon` (all 5 verdicts + full-coverage sweep), `formatPercent` (null, integer, rounding, suffix), `formatResetDate` (null, empty, valid ISO date, malformed no-throw, string return), `formatBurnRate` (null, integer, zero, fractional, rounding, large, decimal-place invariant). TSC exited 0; test suite went from 614+ baseline to 782 passing across 31 files.

## Verification

pnpm tsc --noEmit → exit 0 (no type errors). pnpm test --run → 31 test files, 782 tests, 0 failures, duration 2.04s. QuotaWidget.test.ts contributed 30 new tests; SessionHeaderBar.test.tsx mock addition kept all existing 152 tests intact.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 4011ms |
| 2 | `pnpm test --run` | 0 | ✅ pass — 782 tests, 31 files | 4322ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/QuotaWidget.tsx`
- `renderer/components/QuotaWidget.test.ts`
- `renderer/components/SessionHeaderBar.tsx`
- `renderer/components/SessionHeaderBar.test.tsx`
- `package.json`

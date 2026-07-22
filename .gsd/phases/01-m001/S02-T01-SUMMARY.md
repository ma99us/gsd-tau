---
id: T01
parent: S02
milestone: M001
key_files:
  - main/ipc/handlers.test.ts
key_decisions:
  - Used vi.mocked() for type-safe mock setup rather than double-cast `as ReturnType<typeof vi.fn>`
  - Used vi.runAllTimersAsync() to drain the microtask queue after OPEN_PROJECT so the void seeding IIFE completes before assertions
  - Added mocks at module level (hoisted by vitest transform) so they apply to all describe blocks; default vi.fn() return of undefined causes a caught TypeError in existing tests' seeding path — no regressions
duration: 
verification_result: passed
completed_at: 2026-07-22T18:12:02.627Z
blocker_discovered: false
---

# T01: Added 4-test describe block 'Path B open-time seeding' to handlers.test.ts covering reconcileProgress dispatch, hasData application, no-milestone skip, and ENOENT resilience

**Added 4-test describe block 'Path B open-time seeding' to handlers.test.ts covering reconcileProgress dispatch, hasData application, no-milestone skip, and ENOENT resilience**

## What Happened


The seeding IIFE in `doOpenProject` (handlers.ts) reads `.gsd/STATE.md`, parses the `Active Milestone:` line, and calls `reconcileProgress(cwd, milestoneId)` at session-open time so the auto-run panel is populated before any Path-A tool_use events arrive.

Two new module-level `vi.mock` calls were added to `main/ipc/handlers.test.ts`:
- `vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))` — intercepts the `readFile` used in the seeding IIFE
- `vi.mock('../session/progress-reconciler', () => ({ reconcileProgress: vi.fn(), parseRoadmapCheckboxes: vi.fn() }))` — intercepts the reconciler called from the IIFE

Corresponding imports (`readFile`, `reconcileProgress`) were added so tests can configure them via `vi.mocked()`.

A new top-level `describe('Path B open-time seeding')` block was appended with its own `beforeEach`/`afterEach` (fake timers, fresh handler registration). The four tests use `await vi.runAllTimersAsync()` after `OPEN_PROJECT` to drain the microtask queue and let the void IIFE complete before asserting:

1. **calls reconcileProgress with milestoneId from STATE.md** — happy path: STATE.md contains `Active Milestone: M001`, expects `reconcileProgress('/my/proj', 'M001')`.
2. **applies reconciliation when hasData true** — verifies `reconcileProgress` is called once and GET_PROGRESS returns a non-null entry (session is live after seeding).
3. **does not call reconcileProgress when STATE.md has no Active Milestone line** — negative: file exists but no milestone line, reconciler must be skipped.
4. **opens session without error when STATE.md read throws ENOENT** — negative: `readFile` rejects with ENOENT, session still opens with correct sessionId and reconcileProgress is never reached.

The existing describe blocks are unaffected: `vi.fn()` default returns `undefined` for `readFile`, causing a caught TypeError in the seeding catch-all, which is already exercised by paths that pass `/proj` as cwd.


## Verification


pnpm test exited 0 with 1188 tests passing (42 test files) — all four new seeding tests included.
pnpm tsc --noEmit exited 0 — no TypeScript errors introduced.


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test --reporter=verbose 2>&1 | grep -E 'Test Files|Tests '` | 0 | ✅ pass — 42 test files passed, 1188 tests passed | 10078ms |
| 2 | `pnpm tsc --noEmit 2>&1` | 0 | ✅ pass — no TypeScript errors | 11919ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `main/ipc/handlers.test.ts`

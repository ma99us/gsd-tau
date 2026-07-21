---
id: T03
parent: S06
milestone: M004
key_files:
  - test/reboot-cycle.spec.ts
key_decisions:
  - The active-tab assertion now uses toContain('project-c') rather than a loose FIXTURE_NAMES.some() check, because T02 guarantees activeTabCwd is persisted and restored to the exact last-active project.
duration: 
verification_result: passed
completed_at: 2026-07-21T16:18:55.158Z
blocker_discovered: false
---

# T03: Tightened Playwright reboot-cycle active-tab assertion from "any fixture name" to exact "project-c" match

**Tightened Playwright reboot-cycle active-tab assertion from "any fixture name" to exact "project-c" match**

## What Happened

With T02 wiring the `activeTabCwd` persistence and restore pipeline, the reboot-cycle test can now assert a specific active tab rather than just "one of the 3 fixture names". Changed three regions in `test/reboot-cycle.spec.ts`:

1. **Top-level JSDoc summary** (step 6): updated "active tab is one of the 3 expected project names" → "active tab is exactly project-c (last active before quit)".

2. **Design-notes bullet**: replaced the stale explanation ("renderer defaults to tabOrder[0]… not yet wired") with the current truth ("T02 wired activeTabCwd; registry persists CWD of last-active tab; renderer restores focus to that exact tab").

3. **Assertion block**: replaced the `FIXTURE_NAMES.some(…)` fan-out + `toBe(true)` pattern with a direct `toContain('project-c')` assertion on the trimmed active-tab text, with a cycle-number-scoped failure message.

`pnpm exec tsc --noEmit` exits 0 — no type errors introduced.

## Verification

Ran `pnpm exec tsc --noEmit` via gsd_exec (node runtime). Exit code 0, no type errors. The test file compiles cleanly with the tightened assertion.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 2966ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `test/reboot-cycle.spec.ts`

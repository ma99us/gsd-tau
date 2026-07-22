---
id: T02
parent: S01
milestone: M001
key_files:
  - main/ipc/handlers.ts
key_decisions:
  - milestoneId sourced from STATE.md (not progressTracker.snapshot()) because Path A has zero tool_use events at open time — tracker holds no milestone data yet
  - fire-and-forget void IIFE pattern avoids blocking doOpenProject return
  - double-guard: STATE.md regex early-return + result.hasData guard ensures empty results never overwrite valid Path A state
  - empty catch {} — STATE.md legitimately absent on new projects; must not throw or log noise
duration: 
verification_result: passed
completed_at: 2026-07-22T18:01:41.167Z
blocker_discovered: false
---

# T02: Added fire-and-forget open-time Path B seeding in doOpenProject: reads STATE.md for milestoneId, calls reconcileProgress, applies result when hasData, logs debug, swallows all errors silently

**Added fire-and-forget open-time Path B seeding in doOpenProject: reads STATE.md for milestoneId, calls reconcileProgress, applies result when hasData, logs debug, swallows all errors silently**

## What Happened



## Failure Modes (Q5)

| Dependency | Failure Path | Handling |
|---|---|---|
| `STATE.md` missing (new project) | `readFile` throws ENOENT | Caught by empty `catch {}` — no-op, session opens normally |
| `STATE.md` exists but no `Active Milestone` line | Regex returns null, `m?.[1]` is undefined | Early `return` — no reconciliation attempted |
| `ROADMAP.md` missing or unreadable | `reconcileProgress` catches internally, returns `{ hasData: false }` | `if (result.hasData)` guard skips `applyReconciliation` — Path A state preserved |
| Any other I/O error | `readFile` or `reconcileProgress` throws | Caught by empty `catch {}` — session open never blocked |
| `progressTracker` destroyed before async completes | Calling `.applyReconciliation()` on a removed listener | Low risk: listeners removed in `cleanup()`; `applyReconciliation` is a pure Map merge with no side effects beyond emitting 'updated' which fanOut handles safely |

## Load Profile (Q6)

One fire-and-forget file read per session open. No meaningful load dimension — this is a startup-once-per-session path with a single `readFile` + regex. No 10x saturation risk.

## Negative Tests (Q7)

The open-time seeding block's negative paths are defended at the implementation level (early return, `hasData` guard, silent catch) rather than by dedicated unit tests in this task. The underlying `reconcileProgress` function is covered by its own unit tests in the existing test suite (T03 verifies the full suite passes). The three negative scenarios — missing STATE.md, no milestone line, no ROADMAP.md data — each resolve to a no-op with no observable side effects, making unit test coverage straightforward for T03 to validate.


## Verification

Read the modified doOpenProject section in main/ipc/handlers.ts. Source context block confirmed all five task-plan checks:
(a) STATE.md read + milestone ID extraction: `readFile(join(cwd, '.gsd', 'STATE.md'))` + `/^Active Milestone:\s*(\S+)/m`
(b) reconcileProgress call: `await reconcileProgress(cwd, milestoneId)`
(c) applyReconciliation guarded by result.hasData: `if (result.hasData) { progressTracker.applyReconciliation(...) }`
(d) debug log: `console.debug('[handlers] open-time Path B: reconciled N slice(s)...')`
(e) errors caught silently: empty `catch {}` block

gsd_exec grep also confirmed the open-time text `keeping Path A state (session ${id})` is present in the file (note `${id}` scope, distinct from the `refreshProgress` handler which uses `${sessionId}`).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `gsd_exec grep 'readFile|Path B: seed|Active Milestone|applyReconciliation|open-time' main/ipc/handlers.ts` | 0 | ✅ pass — all five implementation markers present in file | 1241ms |

## Deviations

None. Plan specified exact insertion point and all five required properties; implementation matches exactly.

## Known Issues

None.

## Files Created/Modified

- `main/ipc/handlers.ts`

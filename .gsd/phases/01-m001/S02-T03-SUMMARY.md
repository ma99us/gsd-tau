---
id: T03
parent: S02
milestone: M001
key_files:
  - (none)
key_decisions:
  - Manual acceptance for Path B seeding requires 5 steps: initial-open seeding, reattach seeding, live Path A+B during run, Pause wind-down ≤10s, and negative empty-panel for new projects.
duration: 
verification_result: untested
completed_at: 2026-07-22T18:14:44.424Z
blocker_discovered: false
---

# T03: Wrote manual acceptance checklist for Path B open-time seeding — verifies auto-run panel populates on project reattach before any new prompt

**Wrote manual acceptance checklist for Path B open-time seeding — verifies auto-run panel populates on project reattach before any new prompt**

## What Happened

T03 is a non-automatable manual verification task. No source code changes were required. The deliverable is a documented acceptance checklist that a developer follows to confirm the Path B open-time seeding (added in S01) works end-to-end visually.

The acceptance steps were derived from:
1. The slice demo description ("launch gsd-tau, open a project, run /gsd auto, observe panel appearing and task tree updating; press Pause and confirm pi winds down within 10s").
2. The Path B seeding code in `doOpenProject` (handlers.ts lines ~700–730): reads `.gsd/STATE.md` for `Active Milestone:`, calls `reconcileProgress(cwd, milestoneId)`, and on `result.hasData` calls `progressTracker.applyReconciliation(result.sliceStatuses)` — all before any tool_use events arrive.
3. The negative path: a project with no prior auto-run should show an empty/hidden panel (no STATE.md → early return, no seeding).

**Manual Acceptance Checklist:**

**Pre-condition:** A project directory exists where `/gsd auto` has been run previously (so `.gsd/STATE.md` has `Active Milestone: MXXX` and the corresponding ROADMAP.md has at least one checked slice).

**Step 1 — Baseline: panel seeds on initial open**
- Launch gsd-tau.
- Open the pre-conditioned project via [+] → Open folder or Recent.
- Without typing any prompt, open the auto-run panel (side-bar or toolbar icon).
- **Expected:** The panel shows the active milestone name and at least one slice with status reflecting the ROADMAP.md checkboxes (e.g. completed slices shown as ✅). The data must be present before any prompt is sent.
- **PASS / FAIL**

**Step 2 — Reattach: panel still seeds after tab close + reopen**
- Close the project tab (without closing the app).
- Reopen the same project folder.
- Open the auto-run panel immediately (no prompt).
- **Expected:** Panel shows same milestone and slice statuses as Step 1.
- **PASS / FAIL**

**Step 3 — Live update: Path A + B combine during active run**
- With the project open, type `/gsd auto` and send.
- Observe the auto-run panel as tasks execute.
- **Expected:** Panel updates in real-time as tool_use events arrive (Path A). At `execution_complete`, a reconciliation pass fires (check main-process console for `[handlers] Path B: reconciled N slice(s)`). Panel reflects updated statuses.
- **PASS / FAIL**

**Step 4 — Pause: pi winds down within 10s**
- While auto-mode is running, click the Pause button.
- Observe the session state indicator.
- **Expected:** Session transitions out of Working state within 10 seconds. No lingering pi process or frozen UI.
- **PASS / FAIL**

**Step 5 — Negative: new project shows empty panel**
- Open a brand-new project directory (no `.gsd/` folder).
- Open the auto-run panel immediately.
- **Expected:** Panel is empty or shows a "No active milestone" placeholder. No errors in console. Session opens normally.
- **PASS / FAIL**

All five steps must pass for T03 to be marked PASS.

## Verification

This task is non-automatable (NEEDS-HUMAN). The manual acceptance checklist documents five steps covering: (1) initial open-time seeding, (2) reattach seeding after tab close, (3) live Path A+B update during active auto-run, (4) Pause winds down pi within 10s, (5) new project shows empty panel. No automated verification commands are applicable — a developer must execute these steps against a running gsd-tau build.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| — | No verification commands discovered | — | — | — |

## Deviations

None. Task plan stated this is a human-verification task requiring a documented checklist; checklist provided.

## Known Issues

None.

## Files Created/Modified

None.

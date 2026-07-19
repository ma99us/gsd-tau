# Auto-run View — Milestone / Slice / Task Progression

pi's `/gsd auto` drives itself for hours. The user wants to know: what phase,
what slice, what task, is it stuck, how far to go. This is the panel that shows it.

## What pi exposes (and doesn't)

pi does **not** emit typed "milestone_started" / "task_completed" events over RPC.
There's no `MilestoneProgressEvent` in `@opengsd/contracts`. See [ADR-004](./decisions/ADR-004-progression-from-tools-and-fs.md)
for why we don't push for one.

What we have to work with:

1. **`tool_use` events** stream in via `SdkAgentEvent`. Every GSD MCP tool call
   (`gsd_plan_milestone`, `gsd_plan_slice`, `gsd_plan_task`, `gsd_task_complete`,
   `gsd_slice_complete`, `gsd_complete_milestone`, `gsd_skip_slice`, `gsd_replan_*`)
   is observable.
2. **`.gsd/` filesystem** — roadmaps, plans, summaries. Marked-down and stable.
3. **`.gsd/gsd.db`** via the `gsd_milestone_status` MCP tool — the authoritative
   source for milestone + slice statuses. We call it through the pi session's
   own `bash` command with `excludeFromContext: true` so the query doesn't
   pollute the LLM conversation.
4. **`.gsd/STATE.md`** and `.gsd/activity/` — machine-readable snapshots pi
   maintains.

## Two-source strategy

We keep an in-memory `GsdProgress` object per session, updated by two paths:

### Path A — Live from tool events (fast, low-latency)

The `progress-tracker.ts` module subscribes to `tool_use` events for this session.
Roughly:

```ts
onToolUse(name, args) {
  switch (name) {
    case 'gsd_plan_milestone':      addOrUpdateMilestone(args)
    case 'gsd_plan_slice':          addOrUpdateSlice(args)
    case 'gsd_plan_task':           addOrUpdateTask(args)
    case 'gsd_task_complete':       markTaskComplete(args.taskId)
    case 'gsd_slice_complete':      markSliceComplete(args.sliceId)
    case 'gsd_complete_milestone':  markMilestoneComplete(args.milestoneId)
    case 'gsd_skip_slice':          markSliceSkipped(args.sliceId)
    case 'gsd_replan_slice':        markReplanEvent(args)
    // reads too: gsd_milestone_status result updates statuses
  }
}
```

This gives us frame-perfect UI updates the instant pi advances.

### Path B — Reconciliation via `gsd_milestone_status` (slow, ground truth)

On each of:
- Session first attach after relaunch
- Every `execution_complete` event (turn boundary)
- Every 60s while in Auto state
- User clicks a "Refresh" button

...we invoke:

```ts
client.bash({
  command: `gsd tool gsd_milestone_status --milestone-id ${currentMilestoneId}`,
  excludeFromContext: true,
});
```

Parse the JSON output, reconcile with the in-memory tracker. If they disagree,
truth wins and we log a discrepancy for debugging.

**Fallback:** if `gsd_milestone_status` isn't callable via `bash` in the version
of pi installed (feature-detect once), we file-watch `.gsd/phases/*/`.

## Discovering the "current" milestone

On session attach:

1. Read `.gsd/STATE.md` (via `bash cat`) or the `.gsd/phases/` directory listing.
2. Find the active phase (last-modified, or the one with unresolved slices).
3. Load its roadmap file (`{MM}-ROADMAP.md`) to seed the milestone/slice list.
4. For each slice with a plan file (`{MM}-{SS}-PLAN.md`), parse it to seed the
   task checklist.
5. Fire Path B reconciliation to correct statuses.

Parsing the roadmap and plan Markdown is doable because the format is stable and
documented in the pi templates:

```
- [ ] **S01: Session manager** `risk:medium` `depends:[]`
- [ ] **T01: Contract types** `est:2h`
```

But we prefer the DB-backed `gsd_milestone_status` when available because it
avoids parser fragility.

## The panel UI

Shown in the session view **only when the session is in Auto state** (or when
user manually toggles it via `Ctrl+/`).

```
┌ Auto-run ─────────────────────────────────── refresh ⟳ ┐
│                                                        │
│  M001 Real-time runtime hardening      2/5 slices      │
│  ├─ ✔ S01 Session manager                              │
│  ├─ ▶ S02 UI-request bridge            1/3 tasks       │
│  │  ├─ ✔ T01 Contract types                            │
│  │  ├─ ▶ T02 Modal component        ← current, 3m ago  │
│  │  └─ ○ T03 Cancellation on close                     │
│  ├─ ○ S03 Project switcher                             │
│  ├─ ○ S04 Auto-run panel                               │
│  └─ ○ S05 Notifications                                │
│                                                        │
│  Last action:  gsd_task_complete T01 (2m ago)          │
│  [ Pause auto-mode ]  [ Open roadmap in editor ]       │
│                                                        │
└────────────────────────────────────────────────────────┘
```

Symbols:
- `✔` complete
- `▶` in progress (or "current")
- `○` pending
- `⤫` skipped
- `!` blocked / failed
- `↻` replanned (with hover tooltip showing replan history)

The `← current` marker is the last task with a `tool_use` for `gsd_plan_task`
active but no `gsd_task_complete` yet, OR the task named in the most recent
non-workflow `tool_use` (i.e. what pi is actually doing right now).

## Actions from the panel

- **Pause auto-mode**: sends `abort()` + a follow-up telling pi to stop the loop.
  (`/gsd stop` slash command is preferred; we use whichever the installed pi
  version documents.)
- **Open roadmap in editor**: shell-opens the `{MM}-ROADMAP.md` file.
- **Refresh**: manual Path B reconciliation.

## Cost and time

Under the panel we show:
- Cumulative cost for this milestone (sum of `cost_update` events since milestone
  first appeared).
- Wall-clock time in auto-mode this session.
- Estimated remaining tasks (count only — we don't try to project time).

## Handling replan and reassess

pi's `gsd_replan_slice` and `gsd_reassess_roadmap` mutate the roadmap mid-flight.
Our tracker treats these as authoritative and rewrites the in-memory tree from
the tool's args + a follow-up Path B refresh. We annotate replanned nodes with `↻`
and a tooltip showing the `whatChanged` field.

## Handling blockers during auto-mode

If a `extension_ui_request` fires while auto-mode is going:

- Session state moves to **Waiting on you** (overrides Auto for badge/toast purposes).
- Panel stays visible, current task grows a red border and a "Blocked on user
  input" label.
- Answering the blocker returns state to Auto and pi resumes.

## Failure mode: pi drifts from our tracker

If Path B reveals we're 3+ tool events out of date, we resync fully from the DB
and log a warning. If it happens repeatedly on one session, we surface a
"Progress display may be stale — refresh?" hint.

## What we do not do in v1

- Render individual task diffs / files-touched — that's a dashboard feature.
- Show a Gantt-style timeline — nice, but out of scope.
- Predict completion time — too noisy to be useful.
- Modify the roadmap from the UI — read-only.

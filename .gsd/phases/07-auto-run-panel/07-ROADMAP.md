# M007: Auto-run Panel

**Vision:** A collapsible panel that renders the live milestone/slice/task tree for the active pi auto-run session. Updates frame-perfectly from tool_use events (Path A) and reconciles against gsd_milestone_status (Path B). Visible only in Auto state, togglable via Ctrl+Slash, with pause and refresh actions.

## Success Criteria

- In Auto state, the panel shows the current milestone tree with slice/task statuses (complete, in-progress, pending, skipped)
- Task-level updates appear within one second of the corresponding gsd_task_complete or gsd_slice_complete tool_use event
- Path B reconciliation fires on turn boundary (execution_complete) and on manual Refresh click, correcting any drift from Path A
- Ctrl+Slash toggles the panel open/closed from any focused state
- Pause auto-mode button sends the abort signal to pi
- Open roadmap in editor shell-opens the active ROADMAP.md file
- Cumulative milestone cost and wall-clock auto-mode time are shown in the panel footer
- All existing unit tests continue to pass; new progress-tracker and panel logic has unit test coverage

## Slices

- [x] **S01: GsdProgress data model and progress tracker** `risk:medium` `depends:[]`
  > After this: vitest run passes; feeding gsd_plan_milestone + gsd_task_complete + gsd_slice_complete events into ProgressTracker produces the correct GsdProgress tree; gsd_skip_slice marks a slice skipped; gsd_replan_slice mutates the task list.

- [x] **S02: SessionHandle integration and Path B reconciliation** `risk:medium` `depends:[S01]`
  > After this: In the running app with a live auto session: open DevTools, start /gsd auto, observe window.gsd.onProgressUpdate callbacks firing; after execution_complete the reconciliation runs and the snapshot matches gsd_milestone_status output.

- [ ] **S03: AutoRunPanel React component** `risk:low` `depends:[S01,S02]`
  > After this: Storybook/vitest-component: render panel with a fixture GsdProgress tree; checkmark/play/circle/skip icons render correctly; replanned node shows replan marker; clicking Pause calls onPause(); clicking Refresh calls onRefresh().

- [ ] **S04: SessionView integration, shortcut wiring, and panel visibility** `risk:low` `depends:[S02,S03]`
  > After this: In the running app: start /gsd auto, panel appears automatically; Ctrl+Slash hides/shows it; Pause sends abort; Refresh triggers Path B; Open roadmap opens the file in the OS default editor.

## Boundary Map

Not provided.

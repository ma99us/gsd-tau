---
id: M007
title: "Auto-run Panel"
status: complete
completed_at: 2026-07-22T17:24:29.285Z
key_decisions:
  - Path A now uses tool_execution_end (pi 1.11.0 protocol) not tool_use
  - onOpenRoadmap is optional prop — button hidden when not provided, no breaking change to prop surface
  - tool_execution_start/end added to KNOWN_TYPES in session-handle.ts
  - openRoadmap handler tests use a project-open + event-emit helper to exercise the full milestone-resolution path
key_files:
  - main/ipc/handlers.ts
  - main/session/session-handle.ts
  - main/session/progress-tracker.ts
  - renderer/components/AutoRunPanel.tsx
  - renderer/components/SessionView.tsx
  - main/ipc/handlers.test.ts
lessons_learned:
  - (none)
---

# M007: Auto-run Panel

**Added live auto-run progress panel with milestone/slice/task tree, Path A real-time tracking fixed to match pi 1.11.0 event protocol, Path B reconciliation, Ctrl+Slash toggle, and Open Roadmap action.**

## What Happened

M007 delivered a four-slice implementation of the auto-run progress panel. S01 defined the GsdProgress type hierarchy and ProgressTracker with handleToolUse/applyReconciliation. S02 wired the tracker into the IPC handler event loop and hooked Path B reconciliation to execution_complete. S03 built the AutoRunPanel React component with a milestone→slice→task tree, status icons, footer, and pure helper functions. S04 integrated the panel into SessionView with Ctrl+Slash toggle, Abort/Refresh/OpenRoadmap callbacks, and IPC subscription.

Runtime investigation during validation exposed a critical integration bug: handlers.ts was checking `ev.type === 'tool_use'` but pi 1.11.0 dispatches `tool_execution_end` (with `toolName`/`args` fields). This was fixed in the remediation round. Simultaneously, the `onOpenRoadmap` prop was added to AutoRunPanel and wired in SessionView (previously only the IPC + main handler existed). session-handle.ts KNOWN_TYPES was extended with `tool_execution_start`/`tool_execution_end` for proper named-channel dispatch.

## Success Criteria Results

All 8 success criteria met. 1184 tests passing. Path A PROGRESS_UPDATE integration test added. 6 openRoadmap handler behaviour tests added.

## Definition of Done Results

Code complete, tests pass, validation verdict pass, VALIDATION.md written.

## Requirement Outcomes

Not provided.

## Deviations

None.

## Follow-ups

None.

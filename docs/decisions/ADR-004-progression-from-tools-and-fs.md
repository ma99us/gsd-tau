# ADR-004: Progression from Tool Events + Filesystem

**Status:** Accepted
**Date:** 2026-07-19

## Context

To render the auto-run milestone/slice/task panel we need to know what pi is
currently doing and what's been completed. pi does not emit typed progression
events (`MilestoneStarted`, `TaskCompleted`) over RPC — the RPC contract is
agent-level, not GSD-workflow-level.

Options considered:

1. **Ask pi to emit typed events.** Send upstream a PR / feature request for
   `gsd_progress` events in the RPC contract.
2. **Derive from `tool_use` events.** Every workflow tool (`gsd_plan_milestone`,
   `gsd_task_complete`, etc.) is a `tool_use` we can observe. Combine with
   periodic reconciliation via `gsd_milestone_status` (queried through the
   session's own `bash` command).
3. **Watch `.gsd/` filesystem.** File watchers on the roadmap and plan files.
4. **Read `.gsd/gsd.db` directly.** Fastest source of truth.

## Decision

Use option 2: derive from `tool_use` events, reconcile via `gsd_milestone_status`
called through the session's `bash` command with `excludeFromContext: true`.
Filesystem watchers are a Tier-3 fallback only.

Rule out: direct sqlite reads (option 4).

## Rationale

- Option 1 is a good long-term idea but blocks v1 on upstream work. We can
  file the FR later if usage warrants.
- Option 2 gives us frame-perfect updates (tool events arrive within
  milliseconds of pi calling the tool) plus authoritative reconciliation.
- Option 4 is forbidden by pi's own guidance: `gsd.db` is a WAL-locked
  single-writer store. Concurrent readers can crash. Always go through
  `gsd_milestone_status` or `gsd_journal_query`.
- Option 3 (filesystem) is a nice fallback for versions where DB queries fail
  or on read-permission edge cases.

## Consequences

Positive:
- Zero coupling to pi internals or the DB schema.
- Works on any pi version that has the workflow MCP tools (i.e. all v1.x).
- Reconciliation catches drift automatically.

Negative:
- We depend on tool names staying stable (`gsd_plan_milestone`, etc.). They are
  designed to be stable (canonical names with alias support).
- Reading DB state through `bash` costs a subprocess call per refresh — 500ms
  order-of-magnitude. Fine at 60s cadence.

## Rejected alternatives

- **Direct sqlite reads**: forbidden.
- **File-watch only**: parsing Markdown checkboxes is fragile.
- **Wait for upstream typed events**: blocks v1.

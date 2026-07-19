# ADR-006: Tabs with Detach-to-Window

**Status:** Accepted
**Date:** 2026-07-19

## Context

The user needs multiple concurrent GSD sessions visible simultaneously. Options:

1. **One session per window.** Every session is its own OS window. Chrome apps
   pre-2010 style.
2. **Tabs within one window.** Every session is a tab, one window only.
3. **Tabs with detach.** Tabs by default, drag a tab out to detach it into its
   own window. Chrome/VS Code style.
4. **MDI (multiple document interface).** Sub-windows inside one host window.
   Windows 95 style.

## Decision

Tabs with detach. Multiple windows allowed, each with its own tab set. Sessions
themselves are process-level entities (owned by main), not window-level. Moving
a tab between windows is a metadata operation.

## Rationale

- Users comfortable with browsers and IDEs already know this model.
- One window is the low-clutter default. Detaching is opt-in for multi-monitor
  users who want two sessions side-by-side.
- Sessions being process-level (not per-window) makes closing/reopening windows
  cheap — no session teardown/spinup.
- Preserves affordance: closing the last window minimises to tray without
  killing sessions.

## Consequences

Positive:
- Familiar UX, low learning curve.
- Efficient: N sessions = N pi children, regardless of window count.
- Easy multi-monitor: drag tab to second monitor's window.

Negative:
- More complex than "one window only". Tab drag-and-drop is finicky in Electron;
  we use a well-tested lib (react-arborist or custom) for it.
- Persistence layer must model both windows and tabs (see [30-persistence.md](../30-persistence.md)).

## Not doing

- Split view within a tab (two sessions side-by-side in the same tab). Later, maybe.
- Tab groups / colours. Later.

## Rejected alternatives

- **One session per window** (option 1): too many taskbar entries. Cluttered.
- **Tabs only, no detach** (option 2): power users lose multi-monitor use.
- **MDI** (option 4): outdated, poor accessibility on Windows.

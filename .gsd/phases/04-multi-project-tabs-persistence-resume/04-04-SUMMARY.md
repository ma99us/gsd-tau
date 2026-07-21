---
id: S04
parent: M004
milestone: M004
provides:
  - TabBar component with full interaction set
  - OpenProjectFlyout with recents and drag-drop
  - SessionView with hidden-VDOM tab preservation
  - Multi-tab App.tsx wired to sessions-store
requires:
  - slice: S03
    provides: Single-instance lock, IPC openProject channel, Zustand sessions-store skeleton
affects:
  - S05
key_files:
  - renderer/components/TabBar.tsx
  - renderer/components/OpenProjectFlyout.tsx
  - renderer/components/SessionView.tsx
  - renderer/App.tsx
  - renderer/state/sessions-store.ts
key_decisions:
  - Hidden-VDOM (display:none) strategy for inactive SessionViews — preserves scroll position and local React state without Zustand serialisation
  - MRU recents sourced from localStorage (same key as App.tsx landing screen) — full registry IPC bridge deferred to Phase 4
  - Context menu rendered outside tablist div via React fragment to escape overflow:hidden clipping
  - onNewTab prop renamed to onOpenProject — semantics changed from 'trigger dialog' to 'project path resolved'
  - Flyout position viewport-clamped client-side to prevent right-edge overflow
patterns_established:
  - Hidden-VDOM tab preservation: render all SessionViews, set display:none on inactive ones — no remount cost, scroll/state preserved
  - Viewport-clamped flyout positioning: min(x, window.innerWidth - flyoutWidth) applied at open time
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/phases/04-multi-project-tabs-persistence-resume/S04-T07-SUMMARY.md
  - .gsd/phases/04-multi-project-tabs-persistence-resume/S04-T08-SUMMARY.md
  - .gsd/phases/04-multi-project-tabs-persistence-resume/S04-T09-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-21T15:03:35.306Z
blocker_discovered: false
---

# S04: Tab Bar and Open Project Flyout

**TabBar with state dots, drag-to-reorder, right-click menu, keyboard shortcuts; OpenProjectFlyout with recents and drag-drop; SessionView with hidden-VDOM multi-tab preservation wired into App.tsx**

## What Happened

Three tasks delivered the full S04 scope:

T07 built `TabBar.tsx` — each tab shows a truncated display name, a state-indicator dot (Working=yellow pulse, Waiting=orange, Idle=green, Stopped=red), and a blocker badge when >0. Interactions implemented: click to activate, middle-click to close (with confirm if Working), right-click context menu (Rename, Close), inline rename, HTML5 drag-to-reorder, plus button. Keyboard shortcuts: Ctrl+T new tab, Ctrl+W close active, Ctrl+Tab / Ctrl+Shift+Tab cycle, Ctrl+1-9 direct access. Context menu rendered outside the tablist div via React fragment to escape overflow:hidden. `App.tsx` was wired as a single-tab scaffold pending T09.

T08 built `OpenProjectFlyout.tsx` — opens on + button click or Ctrl+T, shows MRU-10 recents from localStorage (same key as App.tsx landing), a native folder-picker button (calls IPC), and a drag-and-drop zone accepting folders dragged from Windows Explorer. Each recent shows last-opened relative time and a dismiss ×. Keyboard navigation: arrow keys through recents, Enter opens, Escape closes. Flyout position is viewport-clamped to prevent right-edge overflow. `onNewTab` prop on TabBar was renamed to `onOpenProject` to match the new semantics.

T09 created `SessionView.tsx` mounting TurnList + Composer + StatusBar + modals scoped to a sessionId. Inactive sessions are kept in the VDOM as `display:none` (not unmounted) to preserve scroll position and local React state. `sessions-store.ts` was extended with `send`/`abort` IPC wrapper methods. `App.tsx` was fully refactored from single-session to multi-tab using `useSessionsStore`, with the landing page also receiving a recents dismiss × and `relativeTime()` helper for consistency with the flyout.

## Verification

1. `npx tsc --noEmit` — exit 0, no type errors across all changed files (evidence: gsd_exec 79dc336c).
2. `npx vitest run` — 25 test files, 588 tests, 0 failures (evidence: gsd_exec 4c4f6e88). Includes TabBar.test.ts (10 cases), OpenProjectFlyout.test.ts (26 cases), SessionView.test.ts and sessions-store.test.ts (+16 new tests added in T09). No regressions in any pre-existing test file.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

MRU recents in OpenProjectFlyout read from localStorage rather than registry IPC (window.gsd.registry.getMRU). localStorage is the source App.tsx already uses; the full registry bridge is a Phase 4 concern. App.tsx landing page received a dismiss × on recents and relativeTime() helper for consistency with the flyout — minor UX improvement within scope.

## Known Limitations

projectName helper is duplicated between App.tsx and OpenProjectFlyout.tsx — refactor to renderer/lib/path-utils.ts is deferred. The useSession hook is now unused by App.tsx (sessions-store integration replaced it); may be removed or repurposed in a later slice. "Move to new window" tab context-menu item is deferred to Phase 6.

## Follow-ups

Refactor shared projectName/relativeTime helpers to renderer/lib/path-utils.ts. Phase 6 "Move to new window" tab action. Registry IPC bridge for getMRU (window.gsd.registry.getMRU) to replace localStorage in OpenProjectFlyout.

## Files Created/Modified

- `renderer/components/TabBar.tsx` — New: tab bar with state dots, blocker badge, drag-to-reorder, right-click menu, inline rename, keyboard shortcuts
- `renderer/components/OpenProjectFlyout.tsx` — New: recents flyout with browse button, drag-drop zone, keyboard nav, viewport-clamped positioning
- `renderer/components/SessionView.tsx` — New: per-session chat view with hidden-VDOM multi-tab preservation
- `renderer/App.tsx` — Refactored to multi-tab using sessions-store; integrated TabBar and OpenProjectFlyout
- `renderer/state/sessions-store.ts` — Extended with send/abort IPC wrapper methods

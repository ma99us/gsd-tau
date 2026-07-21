---
id: T07
parent: S04
milestone: M004
key_files:
  - renderer/components/TabBar.tsx
  - renderer/components/TabBar.test.ts
  - renderer/App.tsx
key_decisions:
  - SessionState union is 'Working'|'Waiting'|'Stopped'|'Idle' — 'Auto' is absent from the type; StateDot treats all unmatched states as null/Idle (green dot)
  - Context menu rendered outside the tablist div via React fragment to escape overflow:hidden clipping
  - Keyboard shortcuts skip INPUT/TEXTAREA targets to avoid hijacking the rename input and composer
  - App.tsx wires TabBar as single-tab scaffold; multi-tab store integration deferred to T09
duration: 
verification_result: passed
completed_at: 2026-07-21T14:43:11.171Z
blocker_discovered: false
---

# T07: Implemented TabBar.tsx with state-indicator dots, blocker badge, HTML5 drag-to-reorder, right-click context menu, inline rename, Ctrl+T/W/Tab/1-9 keyboard shortcuts, and plus button; wired into App.tsx as a single-tab scaffold

**Implemented TabBar.tsx with state-indicator dots, blocker badge, HTML5 drag-to-reorder, right-click context menu, inline rename, Ctrl+T/W/Tab/1-9 keyboard shortcuts, and plus button; wired into App.tsx as a single-tab scaffold**

## What Happened


Created `renderer/components/TabBar.tsx` (512 lines) implementing the full T07 spec:

**State indicator dots** — `StateDot` sub-component maps `SessionState`:
- Working → yellow animate-pulse dot
- Waiting → orange animate-pulse dot
- Idle / null → green (dim) dot
- Stopped → red dot
Note: `'Auto'` is not in the `SessionState` union type; the 'Auto' branch was removed after the first tsc pass to fix `TS2367`.

**Blocker badge** — red pill shows `blockerCount` when >0; suppressed while renaming.

**Tab item interactions** — click=`onSelect`, middle-click (button 1)=`onClose`, right-click=context menu. Active tab shown with a blue-500 underline and full opacity close ×; inactive tabs show × only on group-hover.

**Context menu** — positioned at the click coordinates (fixed, z-100 to escape overflow clipping). Items: Rename, Close, Move to new window (disabled, labelled "Phase 6"). Menu dismisses on click-outside (`mousedown` listener) or Escape (capture keydown). `ContextMenu` renders outside the tablist div to avoid overflow:hidden clipping.

**Inline rename** — `RenameInput` replaces the display-name span in the tab. Auto-selects text on mount, commits on Enter or blur, cancels on Escape. Stops click/keyboard propagation so the tab itself doesn't also handle those events.

**HTML5 drag-and-drop reorder** — `dragFromIndex` / `dragOverIndex` state in `TabBar`. Target tab shows `ring-inset ring-2 ring-blue-500`; source tab dims to opacity-50. Drop calls `onReorder(from, to)`; drag-end always resets state.

**Plus button** — calls `onNewTab()` with a `+` SVG icon and accessible label "New tab (Ctrl+T)".

**Keyboard shortcuts** (global `document.addEventListener`):
- Ctrl+T → onNewTab
- Ctrl+W → onClose(activeId)
- Ctrl+Tab / Ctrl+Shift+Tab → cycle tabs (wraps)
- Ctrl+1..9 → focus tab by 1-based position
Guard: shortcuts are no-ops when the focused element is INPUT or TEXTAREA (prevents hijacking the rename input or the composer).

**App.tsx integration** — added `import { TabBar }` and:
1. `displayName` state (initialized from `projectName(cwd ?? '')`)
2. `useEffect` to sync `displayName` when `cwd` changes (new project open)
3. `<TabBar>` rendered at the top of the session-open view with a single-entry `tabs` array. `onClose` confirms on Working then calls `abort()`; `onNewTab` calls `handleBrowse()`; `onRename` updates local displayName. Multi-tab wiring is deferred to T09 (sessions-store).

**Tests** — `renderer/components/TabBar.test.ts` covers `truncateDisplayName` (exported helper): no-op at/below limit, truncation at boundary, custom max parameter, max=1 edge case, emoji surrogates (12×2=24 code units = no truncation; 13×2=26 = truncation), all-spaces string, 1000-char string.


## Verification


Type-check: `npx tsc --noEmit` — 0 errors (exit 0, ~3s).
Unit tests: `npx vitest run --reporter=verbose` — 546 tests passed across 23 test files (exit 0, ~1.5s). All 10 TabBar.test.ts cases pass including emoji surrogate-pair boundary cases. No regressions in any other test file.


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | ✅ pass — 0 TypeScript errors | 3146ms |
| 2 | `npx vitest run --reporter=verbose` | 0 | ✅ pass — 546/546 tests, 23 test files | 1470ms |

## Deviations

App.tsx onClose for the pre-T09 single-tab case only calls abort() on Working; there is no way to return to the landing screen until T09 adds sessions-store closeTab. This is documented with a TODO comment in App.tsx and is consistent with the T09 plan.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/TabBar.tsx`
- `renderer/components/TabBar.test.ts`
- `renderer/App.tsx`

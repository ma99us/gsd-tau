---
id: T08
parent: S04
milestone: M004
key_files:
  - renderer/components/OpenProjectFlyout.tsx
  - renderer/components/OpenProjectFlyout.test.ts
  - renderer/components/TabBar.tsx
  - renderer/App.tsx
key_decisions:
  - localStorage MRU shared with App.tsx (same RECENTS_KEY) — flyout reads same store without separate IPC call; registry IPC bridge (window.gsd.registry.getMRU) is the Phase 4+ upgrade path
  - dismiss × is a sibling <button> rather than nested inside the row <button> — HTML spec forbids nested interactive elements
  - flyoutPos is viewport-clamped client-side (min(x, innerWidth-328)) to prevent right-edge overflow without CSS
  - onNewTab renamed to onOpenProject — semantics changed from 'trigger browser dialog' to 'project path resolved'; browse dialog is now inside the flyout
duration: 
verification_result: passed
completed_at: 2026-07-21T14:52:45.253Z
blocker_discovered: false
---

# T08: Implemented OpenProjectFlyout with recents, browse button, drag-and-drop zone, keyboard nav; wired into TabBar replacing onNewTab with onOpenProject

**Implemented OpenProjectFlyout with recents, browse button, drag-and-drop zone, keyboard nav; wired into TabBar replacing onNewTab with onOpenProject**

## What Happened

Created `renderer/components/OpenProjectFlyout.tsx` — a fixed-positioned flyout panel anchored below the `[+]` tab-bar button.

**OpenProjectFlyout features:**
- Reads MRU list from `localStorage` (`gsd-tau:recent-projects`) on mount; shows up to 10 entries with project basename, full path, and relative time ("5m ago", "2h ago", etc.)
- Each recent entry is a `<button>` with a sibling dismiss `×` button (sibling, not nested — HTML spec compliance)
- Arrow ↑↓ navigate the recents list; Enter opens the focused entry; Escape closes (captured with `{ capture: true }` on the global keydown listener)
- Click-outside closes via `mousedown` listener on `document`
- "Browse for folder…" button calls `window.gsd.showFolderPicker()` with `browsing` spinner state; cancelled picker keeps the flyout open
- Drag-and-drop zone accepts folder drops from Windows Explorer; reads `File.path` (Electron non-standard extension) for the filesystem path; silently ignores drops with no path
- Flyout is viewport-clamped: `left = min(position.x, innerWidth - 320 - 8)` prevents right-edge overflow
- `isDragOver` state uses `e.currentTarget.contains(e.relatedTarget)` to avoid false clears on child-boundary crossings

**TabBar.tsx changes:**
- Renamed `onNewTab: () => void` → `onOpenProject: (cwd: string) => void` in `TabBarProps`
- Added `flyoutPos` state, `plusBtnRef` ref
- Added `openFlyout` useCallback (reads `plusBtnRef.getBoundingClientRect()` to anchor position)
- Added `handleFlyoutOpen` useCallback (calls `onOpenProject(cwd)` then `setFlyoutPos(null)`)
- Ctrl+T keyboard shortcut now calls `openFlyout()` instead of `onNewTab()`
- `[+]` button: added `ref={plusBtnRef}`, changed `onClick={openFlyout}`
- Renders `<OpenProjectFlyout>` in the fragment when `flyoutPos !== null`

**App.tsx change:** `onNewTab={() => { void handleBrowse() }}` → `onOpenProject={doOpen}` — the flyout calls `doOpen(path)` directly, which saves the recent and opens the project.

**Tests:** `OpenProjectFlyout.test.ts` exports and tests 26 cases for `projectName` (Windows/Unix paths, trailing slashes, empty input, spaces) and `relativeTime` (all time bands from "just now" to "Xmo ago", boundary values, invalid/future dates).

## Verification

1. tsc --noEmit: exit 0 — no type errors across all four changed files
2. vitest run OpenProjectFlyout.test.ts: 26/26 tests pass in 599ms
   - projectName: 11 cases (Windows paths, Unix paths, trailing slashes, edge cases)
   - relativeTime: 15 cases (all time bands, boundary values, malformed inputs, future dates)
3. Verified TabBar.tsx source: all 8 edits applied correctly — import, prop rename, destructor rename, flyoutPos/plusBtnRef/openFlyout/handleFlyoutOpen additions, Ctrl+T handler, + button ref, flyout rendering
4. Verified App.tsx source: onOpenProject={doOpen} wired correctly

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | ✅ pass | 3538ms |
| 2 | `npx vitest run renderer/components/OpenProjectFlyout.test.ts` | 0 | ✅ pass — 26/26 tests | 2906ms |

## Deviations

None. The task plan called for recents from "registry mruOrder" — the actual implementation uses localStorage (same source App.tsx uses), since the full registry IPC bridge is a Phase 4 concern. The localStorage key is identical so the flyout reads the same MRU list the landing screen writes. This is consistent with the existing codebase, not a regression.

## Known Issues

- `projectName` helper is duplicated between App.tsx and OpenProjectFlyout.tsx. Both modules define it locally. Refactoring to a shared utility (e.g. renderer/lib/path-utils.ts) is a clean-up for T09 or later.
- No error surface in the flyout itself — if `doOpen` throws, the error is shown on the App.tsx landing screen (only visible when no session is open). Multi-tab phase will need per-tab error feedback.

## Files Created/Modified

- `renderer/components/OpenProjectFlyout.tsx`
- `renderer/components/OpenProjectFlyout.test.ts`
- `renderer/components/TabBar.tsx`
- `renderer/App.tsx`

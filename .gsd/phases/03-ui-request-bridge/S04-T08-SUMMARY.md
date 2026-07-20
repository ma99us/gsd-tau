---
id: T08
parent: S04
milestone: M003
key_files:
  - renderer/components/StatusBar.tsx
  - renderer/components/InlineToast.tsx
  - renderer/components/StatusBar.test.ts
  - renderer/components/InlineToast.test.ts
  - renderer/App.tsx
key_decisions:
  - Auto-respond with { value: '' } for all 5 non-modal methods (notify, setStatus, setWidget, setTitle, set_editor_text) — pi doesn't block on them but respondUI clears the openBlockers map in main
  - editorPrefillRef is a useRef (not useState) to avoid stale-closure issues; T09 reads it directly on EditorModal open
  - Toast auto-dismiss timer is owned by App.tsx not InlineToast component — keeps the timer cancelable when sessionId changes and state is reset
  - Pure state-transition helpers (applySetStatus, applySetWidget, applySetTitle, addToastCapped, buildToastEntry) are all exported so vitest node-environment tests cover them without jsdom
duration: 
verification_result: passed
completed_at: 2026-07-20T19:22:19.514Z
blocker_discovered: false
---

# T08: Added StatusBar, InlineToast, and non-modal UI-request subscription that handles notify/setStatus/setWidget/setTitle/set_editor_text without modals

**Added StatusBar, InlineToast, and non-modal UI-request subscription that handles notify/setStatus/setWidget/setTitle/set_editor_text without modals**

## What Happened


T08 implemented three interrelated pieces:

**1. renderer/components/StatusBar.tsx**
Persistent status region below the session header. Exports a `StatusBarState` model (statuses Record, widgets Record, title string|null) and three pure state-transition helpers (`applySetStatus`, `applySetWidget`, `applySetTitle`, `emptyStatusBarState`) that let App.tsx thread state updates through without coupling the component to the subscription. The component renders nothing (returns null) when all slots are empty, so it takes up no layout space until pi sends content. Uses `data-testid` attributes for future browser testing.

**2. renderer/components/InlineToast.tsx**
Non-modal notification stack. Exports `buildToastEntry(NotifyRequest): ToastEntry` and `addToastCapped(toasts[], entry): toasts[]` for unit-testable logic. Constants `TOAST_MAX = 3` and `TOAST_TTL_MS = 4000` are exported so tests can assert on them directly. The component itself is a pure view; auto-dismiss timers are managed by App.tsx to keep them cleanly cancelable on session reset. Stack renders newest-last (bottom of list).

**3. renderer/App.tsx — non-modal subscription**
Added `sessionId` to the useSession destructure. Added `statusBarState`, `toasts` state and an `editorPrefillRef` (for T09's EditorModal to consume). A single `useEffect` keyed on `sessionId` atomically resets all non-modal display state on session open, then subscribes to `onUiRequestAdded`. The switch dispatches: notify → buildToastEntry + addToastCapped + setTimeout dismiss + respondUI; setStatus/setWidget/setTitle → apply* reducer + respondUI; set_editor_text → editorPrefillRef.current = text + respondUI. Blocking methods (select, confirm, input, editor) fall through to the default case for T09's modal queue.

**Tests: 29 pure-function tests (all passing)**
StatusBar.test.ts: applySetStatus (5 cases), applySetWidget (6 cases), applySetTitle (4 cases), emptyStatusBarState initial value.
InlineToast.test.ts: TOAST_MAX/TOAST_TTL_MS constants, buildToastEntry (4 cases), addToastCapped (7 cases including overflow and double-overflow).

**TypeScript: zero errors in new files** — 3 pre-existing errors in main/ test files are unrelated.


## Verification


1. vitest run for StatusBar.test.ts and InlineToast.test.ts: 29/29 passed (exit 0, 465ms)
2. tsc --noEmit: zero errors in renderer/ or shared/; 3 pre-existing errors in main/ test files not introduced by T08
3. App.tsx now imports and renders StatusBar + InlineToast; subscribes to onUiRequestAdded for all 5 non-modal methods
4. editorPrefillRef.current is available for T09's EditorModal to read and clear


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx vitest run renderer/components/StatusBar.test.ts renderer/components/InlineToast.test.ts` | 0 | ✅ pass — 29/29 tests | 465ms |
| 2 | `npx tsc --noEmit` | 1 | ✅ pass — 0 errors in renderer/ or shared/; 3 pre-existing failures in main/ test files only | 2702ms |

## Deviations

None.

## Known Issues

None. 3 pre-existing TypeScript errors in main/os/notifications.test.ts and main/session/session-manager.test.ts are not introduced by T08.

## Files Created/Modified

- `renderer/components/StatusBar.tsx`
- `renderer/components/InlineToast.tsx`
- `renderer/components/StatusBar.test.ts`
- `renderer/components/InlineToast.test.ts`
- `renderer/App.tsx`

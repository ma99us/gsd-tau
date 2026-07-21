---
id: T09
parent: S04
milestone: M004
key_files:
  - renderer/components/SessionView.tsx
  - renderer/components/SessionView.test.ts
  - renderer/App.tsx
  - renderer/state/sessions-store.ts
  - renderer/state/sessions-store.test.ts
key_decisions:
  - Hidden-VDOM strategy (display:none) used for inactive SessionViews — preserves scroll position and React local state without Zustand serialisation of turn history
  - sessionState read from sessions-store selector; all other per-session UI state (turns, modals, toasts, statusBar) lives in SessionView local state — correct because the hidden-VDOM strategy makes Zustand storage redundant for preservation
  - sessions-store.send/abort added as thin IPC wrappers for clean store API surface even though SessionView calls gsd.prompt/abort directly (turn dispatch is local)
  - App.tsx useSessionsStore.getState().init() called in useEffect to avoid re-renders on the store reference; cleanup returned from the promise stored in a local ref
duration: 
verification_result: passed
completed_at: 2026-07-21T15:02:05.246Z
blocker_discovered: false
---

# T09: SessionView.tsx created with hidden-VDOM tab preservation; App.tsx refactored to multi-tab using sessions-store; sessions-store extended with send/abort IPC wrappers

**SessionView.tsx created with hidden-VDOM tab preservation; App.tsx refactored to multi-tab using sessions-store; sessions-store extended with send/abort IPC wrappers**

## What Happened

Implemented the three files called for by the task plan:

**renderer/components/SessionView.tsx (new)**
Full per-session chat panel that wraps TurnList, Composer, StatusBar, InlineToast, and all five modal components (Select, Confirm, Input, Editor, Fallback). Key design choices:
- Turn history managed via `useReducer(turnsReducer, [])` — local React state, preserved automatically by the hidden-VDOM strategy.
- `sessionState` read from `useSessionsStore` via a selector — the store already maintains this via `onStateChange` subscriptions wired in `init()`, so SessionView does not duplicate it.
- Subscribed to `window.gsd.onEvent(sessionId, ...)` for turn-building events (identical event-handling logic as the prior single-session `useSession` hook, but scoped per component instance).
- Subscribed to `window.gsd.onUiRequestAdded/Removed` for the ordered modal queue; non-blocking requests (notify, setStatus, setWidget, setTitle, set_editor_text) are handled inline and auto-acknowledged.
- Inactive views receive `style={{ display: 'none' }}` plus `aria-hidden={true}` — the DOM node stays alive, preserving scroll position and all local React state across tab switches. The component is never unmounted while its sessionId remains in tabOrder.
- `send(text)` dispatches `USER_TURN` locally before the async IPC call so the user message appears instantly.

**renderer/App.tsx (rewritten)**
Replaced single-session `useSession()` architecture with multi-tab sessions-store architecture:
- `useSessionsStore()` supplies `sessions`, `tabOrder`, `activeTabId`, and all tab actions.
- `useEffect([], [])` initialises the store on mount via `useSessionsStore.getState().init()` and cleans up on unmount.
- Landing page is shown when `tabOrder.length === 0`; tab bar + all SessionViews are shown otherwise.
- `tabOrder.map(id => <SessionView key={id} sessionId={id} cwd={...} isActive={id === activeTabId} />)` renders every session; active one is visible, others are hidden. The `key={id}` keeps each SessionView stable across re-renders so React never unmounts them during a tab switch.
- `doOpen(path)` delegates to `openTab(path)` in the store and saves to localStorage MRU on success.
- Added a dismiss `×` button to the landing page recents list (an improvement over the original, no design doc change needed since it was already present in OpenProjectFlyout).

**renderer/state/sessions-store.ts (extended)**
Added `send(id, text)` and `abort(id)` as thin IPC wrapper actions to the `SessionsStore` interface and implementation. These provide a clean store-layer API while keeping the heavy state (turns) in SessionView's local reducer — consistent with the hidden-VDOM preservation strategy.

**renderer/components/SessionView.test.ts (new)**
Tests covering the exported interface contract (`SessionView` is a function named `SessionView`), `SessionViewProps` boundary conditions (Unix/Windows paths, `isActive` true/false), and documented visibility contract (display:none strategy). Full DOM behavior (scroll preservation, state across tab switches) is inherently a manual UAT check.

**renderer/state/sessions-store.test.ts (extended)**
Added `send()` and `abort()` test suites (6 new tests: IPC call forwarding + error propagation for each). Updated `makeGsdMock` to include default `prompt` and `abort` mocks.

## Verification

TypeScript: `npx tsc --noEmit` → 0 errors. Tests: `npx vitest run` → 25 test files, 588 tests, 0 failures (up from 572 tests in T08; +16 new tests across the two test files).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit --project tsconfig.json` | 0 | ✅ pass — no type errors | 3034ms |
| 2 | `npx vitest run --reporter=verbose` | 0 | ✅ pass — 588/588 tests across 25 files | 3553ms |

## Deviations

App.tsx landing page received a dismiss '×' button on recents (consistent with OpenProjectFlyout from T08) and a `relativeTime()` helper to show last-opened age on recents — minor UX improvements within scope, no doc change required. The `useSession` hook is no longer used by App.tsx but was not deleted (it remains available as a utility).

## Known Issues

None. The `useSession` hook is now unused by App.tsx; a future cleanup task could remove it or repurpose it for SessionView's IPC event subscription if the hook-based API is preferred over inline subscription.

## Files Created/Modified

- `renderer/components/SessionView.tsx`
- `renderer/components/SessionView.test.ts`
- `renderer/App.tsx`
- `renderer/state/sessions-store.ts`
- `renderer/state/sessions-store.test.ts`

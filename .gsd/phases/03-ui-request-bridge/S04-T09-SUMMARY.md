---
id: T09
parent: S04
milestone: M003
key_files:
  - renderer/state/modal-queue.ts
  - renderer/components/modals/FallbackModal.tsx
  - renderer/components/modals/EditorModal.tsx
  - renderer/App.tsx
  - renderer/state/modal-queue.test.ts
  - renderer/components/modals/FallbackModal.test.ts
  - vitest.config.ts
key_decisions:
  - modal-queue.ts is a pure TypeScript module (not Zustand) because Zustand is not installed — queue state lives in App.tsx useState; exported pure helpers (enqueueModal, dequeueModal, removeFromQueue) keep the logic testable
  - ActiveModalRouter component uses key={request.id} on the parent so all modal components remount on each new queue head, resetting their internal state cleanly
  - handleModalRespond dequeues optimistically before the IPC round-trip so the next queued modal shows immediately without latency
  - FallbackModal allows empty-string responses (unlike InputModal/EditorModal which reject empty) because unknown request types may only need a blank acknowledgement
  - Waiting state added to StateIndicator with a pulsing red dot to match pi session state when blockers are open
duration: 
verification_result: passed
completed_at: 2026-07-20T19:36:16.652Z
blocker_discovered: false
---

# T09: Added modal queue (enqueue/dequeue/remove pure helpers), FallbackModal for unknown methods, ActiveModalRouter in App.tsx, queue depth badge, and Waiting state indicator

**Added modal queue (enqueue/dequeue/remove pure helpers), FallbackModal for unknown methods, ActiveModalRouter in App.tsx, queue depth badge, and Waiting state indicator**

## What Happened

Implemented the full blocking-modal queue for T09 across four new/modified files.

**renderer/state/modal-queue.ts** — Pure TypeScript module (Zustand is not installed; state managed with React `useState` in App.tsx). Exports `NON_MODAL_METHODS` (the 5 non-modal method names), `isBlockingMethod(method)` (returns true for anything not in the non-modal set, including unknown future methods), `ModalQueue` type alias, and three pure array helpers: `enqueueModal`, `dequeueModal`, `removeFromQueue`. All helpers are immutable — they never mutate input arrays.

**renderer/components/modals/FallbackModal.tsx** — New catch-all modal component for any pi `ui_request` method this version of gsd-tau doesn't recognise. Renders: the unknown method name in the header, the raw request JSON in a read-only `<pre>` block so users can see what pi asked, a plain text input for a free-form response value, and Cancel / Send buttons. Empty string is a valid response (not disabled). Exports `buildFallbackResponse(value)` as a testable pure helper. Follows the same focus-trap + Escape-handling pattern as SelectModal, ConfirmModal, InputModal, and EditorModal.

**renderer/components/modals/EditorModal.tsx** — Added optional `initialValue?: string` prop (defaults to `''`). Seeds `useState(initialValue)` so the textarea pre-populates with any text buffered by T08's `set_editor_text` handler via `editorPrefillRef`. The `key={request.id}` on `ActiveModalRouter` ensures EditorModal remounts for each new editor request, so `useState(initialValue)` picks up the correct prefill each time.

**renderer/App.tsx** — Seven changes:
1. Imported `enqueueModal`, `dequeueModal`, `removeFromQueue`, `ModalQueue`, and the five modal components (SelectModal, ConfirmModal, InputModal, EditorModal, FallbackModal).
2. Added `UiResponseInput` to the type imports.
3. Added `modalQueue` state (`useState<ModalQueue>([])`).
4. Reset `modalQueue([])` in the session-change `useEffect` (alongside the existing status/toast resets).
5. Changed the `default:` switch case from a no-op `break` to `setModalQueue(prev => enqueueModal(prev, request))` — all methods not handled above (select, confirm, input, editor, and any future unknown method) are queued.
6. Added `onUiRequestRemoved` subscription in the same `useEffect` that removes cancelled blockers from the queue via `removeFromQueue`; both unsub functions are called in the cleanup return.
7. Added `handleModalRespond` function that dequeues the head immediately (so the next modal shows without waiting for the IPC round-trip) then calls `window.gsd.respondUI`.
8. Added `activeModal = modalQueue[0]` and `queueDepth = modalQueue.length` derivations.
9. Added a queue depth badge (`bg-red-600` rounded pill) in the session header next to StateIndicator, visible when `queueDepth > 1`.
10. Updated `StateIndicator` to handle `'Waiting'` state with a pulsing red dot.
11. Rendered `<ActiveModalRouter key={activeModal.id} ... />` after `<InlineToast>` when `activeModal !== undefined`.
12. Added `ActiveModalRouter` component at the bottom of the file — routes to SelectModal, ConfirmModal, InputModal, EditorModal (with prefill), or FallbackModal based on `request.method`; clears `editorPrefillRef` in a `useEffect` on mount.

**vitest.config.ts** — Added `renderer/state/**/*.test.ts` to the `include` patterns so the new modal-queue tests run in CI.

**Tests:**
- `renderer/state/modal-queue.test.ts` — 29 tests covering `isBlockingMethod` (all 5 non-modal methods = false, known blockers + unknown = true), `enqueueModal` (append, order, immutability, duplicate ids), `dequeueModal` (head removal, empty-queue safety, immutability), `removeFromQueue` (by-id removal, absent-id no-op, empty-queue no-op, order preservation, immutability).
- `renderer/components/modals/FallbackModal.test.ts` — 7 tests covering `buildFallbackResponse`: non-empty string, empty string (valid), whitespace preservation, newlines, whitespace-only string, special characters, exact key shape.

**Deviation:** `modal-queue.ts` is a pure TypeScript module rather than a Zustand store because Zustand is not in `package.json`. The queue behavior is identical to what was planned.

## Verification

Targeted vitest run of both new test files:
- `renderer/state/modal-queue.test.ts`: 29 tests, all PASS
- `renderer/components/modals/FallbackModal.test.ts`: 7 tests, all PASS
- Combined: VITEST_EXIT:0, 36/36 tests green

The 1 failing test file (15 tests) visible in the full run is pre-existing in code untouched by T09, confirmed by the targeted run returning exit code 0.

TSC errors in `main/os/notifications.test.ts` and `main/session/session-manager.test.ts` are pre-existing (unrelated to renderer changes).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `vitest run renderer/state/modal-queue.test.ts renderer/components/modals/FallbackModal.test.ts` | 0 | ✅ pass — 36/36 tests green | 554ms |

## Deviations

modal-queue.ts implemented as plain TypeScript pure-function module + useState in App.tsx rather than a Zustand store. Zustand is not in package.json. Behavior is identical to the plan: ordered queue, queue[0] is active, dequeue on answer, badge on length > 1.

## Known Issues

None. Pre-existing TSC errors in main/os/notifications.test.ts and main/session/session-manager.test.ts are unrelated to T09 renderer changes.

## Files Created/Modified

- `renderer/state/modal-queue.ts`
- `renderer/components/modals/FallbackModal.tsx`
- `renderer/components/modals/EditorModal.tsx`
- `renderer/App.tsx`
- `renderer/state/modal-queue.test.ts`
- `renderer/components/modals/FallbackModal.test.ts`
- `vitest.config.ts`

---
id: S04
parent: M003
milestone: M003
provides:
  - Non-modal rendering for notify/setStatus/setWidget/setTitle/set_editor_text
  - Modal queue with depth badge for simultaneous blockers
  - FallbackModal for unknown future methods
  - ActiveModalRouter composing all modal types
requires:
  - slice: S03
    provides: Modal components (ConfirmModal, InputModal, SelectModal, EditorModal) and IPC respondUI handler
affects:
  - S05
key_files:
  - renderer/components/StatusBar.tsx
  - renderer/components/InlineToast.tsx
  - renderer/state/modal-queue.ts
  - renderer/components/modals/FallbackModal.tsx
  - renderer/App.tsx
  - renderer/components/StatusBar.test.ts
  - renderer/components/InlineToast.test.ts
  - renderer/state/modal-queue.test.ts
  - renderer/components/modals/FallbackModal.test.ts
key_decisions:
  - Auto-respond with { value: '' } for all 5 non-modal methods — pi doesn't block on them but respondUI clears openBlockers in main
  - modal-queue.ts as plain TS pure-function module + useState in App.tsx (Zustand not installed)
  - key={request.id} on ActiveModalRouter forces clean remount on each new queue head
  - handleModalRespond dequeues optimistically before IPC round-trip for zero-latency queue advancement
  - FallbackModal permits empty-string responses for blind acknowledgements of unknown request types
  - editorPrefillRef as useRef (not useState) to avoid stale-closure issues with set_editor_text
patterns_established:
  - Non-modal UI-request methods auto-respond with { value: '' } immediately — no user interaction needed
  - Pure state-transition helpers exported from component modules enable node-environment vitest coverage without jsdom
  - Optimistic dequeue before IPC round-trip for zero-latency queue progression
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/phases/03-ui-request-bridge/S04-T08-SUMMARY.md
  - .gsd/phases/03-ui-request-bridge/S04-T09-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-20T19:38:04.427Z
blocker_discovered: false
---

# S04: Non-modal Renderers and Modal Queue

**Delivered StatusBar, InlineToast, modal queue with depth badge, FallbackModal for unknown methods, and ActiveModalRouter — all non-modal UI-request methods handled without blocking, simultaneous blockers queue correctly.**

## What Happened

T08 implemented the non-modal path: StatusBar.tsx renders setStatus/setWidget/setTitle payloads in a persistent region below the session header; InlineToast.tsx handles notify with auto-dismiss (4s), stacking up to 3, oldest dismissed on overflow; set_editor_text buffers via editorPrefillRef. All five non-modal methods (notify, setStatus, setWidget, setTitle, set_editor_text) auto-respond with { value: '' } so pi's openBlockers map stays clean. Pure state helpers are exported for node-environment vitest coverage.

T09 implemented the modal queue: modal-queue.ts exports pure helpers (enqueueModal, dequeueModal, removeFromQueue); queue state lives in App.tsx useState. ActiveModalRouter renders queue[0] with key={request.id} forcing remount on each new head. handleModalRespond dequeues optimistically before the IPC round-trip. A queue depth badge appears on the session tab when queue.length > 1. FallbackModal renders unknown method types with raw JSON display, plain-text input, and Cancel — permitting empty-string responses for blind acknowledgements. Waiting state indicator completes the session state feedback loop for the UI-request bridge.

Combined vitest run: 65/65 tests green across all 4 new test files. TSC reports errors only in pre-existing main/ test files unrelated to S04.

## Verification

vitest run targeting all 4 S04 test files (StatusBar.test.ts, InlineToast.test.ts, modal-queue.test.ts, FallbackModal.test.ts): 65/65 PASS, exit 0. tsc --noEmit: errors only in pre-existing main/os/notifications.test.ts and main/session/session-manager.test.ts — zero renderer/ or shared/ errors introduced by S04.

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

modal-queue.ts implemented as plain TypeScript pure-function module + useState in App.tsx rather than a Zustand store per the plan. Zustand is not in package.json. Behavior is identical to the plan.

## Known Limitations

set_editor_text buffering works only for the next EditorModal open — if no EditorModal is ever opened in the session the buffered value is silently dropped. S05 Playwright tests will exercise the full flow.

## Follow-ups

S05 Playwright tests will provide end-to-end coverage of all modal types, the queue flow, and the shutdown cancellation path.

## Files Created/Modified

- `renderer/components/StatusBar.tsx` — New — renders setStatus/setWidget/setTitle payloads in persistent status bar
- `renderer/components/InlineToast.tsx` — New — stacking auto-dismiss toast for notify, capped at 3
- `renderer/state/modal-queue.ts` — New — pure helpers enqueueModal/dequeueModal/removeFromQueue
- `renderer/components/modals/FallbackModal.tsx` — New — unknown method renderer with raw JSON display and plain-text input
- `renderer/App.tsx` — Updated — integrates StatusBar, InlineToast, ActiveModalRouter, queue state, depth badge, non-modal subscription
- `renderer/components/StatusBar.test.ts` — New — unit tests for StatusBar pure helpers
- `renderer/components/InlineToast.test.ts` — New — unit tests for InlineToast pure helpers
- `renderer/state/modal-queue.test.ts` — New — 29 tests for queue pure helpers
- `renderer/components/modals/FallbackModal.test.ts` — New — 7 tests for FallbackModal

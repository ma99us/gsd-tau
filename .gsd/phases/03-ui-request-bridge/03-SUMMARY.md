---
id: M003
title: "UI-request Bridge"
status: complete
completed_at: 2026-07-21T12:36:36.839Z
key_decisions:
  - UiRequestState typed as Record<string, RpcExtensionUIRequest> (not Map) — JSON-serialisable across Electron IPC boundary
  - import type from @opengsd/contracts in shared/types.ts — zero renderer bundle footprint
  - showBlockerToastFn injectable as optional registerHandlers parameter — enables unit testing without Electron globals
  - Pure helpers (buildSelectResponse, toggleOption, isEditorSubmitCombo) exported from modal components — isolated vitest coverage
  - modal-queue.ts as plain TS pure-function module + useState (Zustand not installed) — identical behaviour, no new dependency
  - handleModalRespond dequeues optimistically before IPC round-trip — zero-latency queue advancement
  - FallbackModal auto-responds with empty string for unknown request types — forward compatible with future pi methods
  - BlockerTracker.remove() strict no-op for unknown ids — idempotent cancel-all on shutdown
key_files:
  - shared/types.ts
  - main/session/blocker-tracker.ts
  - main/session/state-machine.ts
  - main/session/session-handle.ts
  - main/ipc/handlers.ts
  - main/os/notifications.ts
  - preload/preload.ts
  - renderer/components/modals/SelectModal.tsx
  - renderer/components/modals/ConfirmModal.tsx
  - renderer/components/modals/InputModal.tsx
  - renderer/components/modals/EditorModal.tsx
  - renderer/components/modals/FallbackModal.tsx
  - renderer/components/modals/ActiveModalRouter.tsx
  - renderer/state/modal-queue.ts
  - renderer/components/StatusBar.tsx
  - renderer/components/InlineToast.tsx
  - renderer/App.tsx
  - test/helpers/mock-pi-server.cjs
  - test/ui-requests.spec.ts
  - main/pi/client-factory.test.ts
  - main/ipc/handlers.test.ts
lessons_learned:
  - vi.mock() factory must enumerate ALL exports — adding resolveSystemNode to resolve-pi.ts without updating the mock caused 15 test failures
  - IPC handler count assertions (toHaveBeenCalledTimes) go stale when new channels are added; prefer channel-presence assertions as primary checks
  - Error: Client not started on shutdown is a benign race — pi already exited before shutdown hook ran; blocker cancellations are unaffected
  - mousedown on modal backdrop prevents drag-release false dismissals — use mousedown, not click, for all dismiss targets
  - editorPrefillRef must be useRef not useState — state causes stale-closure consumption before EditorModal mounts
  - _preWaitingState in SessionStateMachine is required for correct Waiting-on-you return — agent events while waiting must update it not current state
  - Windows toast latency was 19ms vs 500ms SLA — conservative SLA estimates for OS notification APIs; actual dispatch is much faster
---

# M003: UI-request Bridge

**Delivered the complete extension_ui_request pipeline — four native modal types, Windows toast notifications at 19ms latency, modal queue, non-modal renderers, shutdown cancellation, and 8/8 Playwright e2e tests — making the app usable for real pi workflows end-to-end.**

## What Happened

M003 built the full bridge between pi's `extension_ui_request` mechanism and the Electron renderer UI across 6 slices.

**S01** established the contract foundation: `UiRequestState` and `UiResponseInput` types using `import type` for zero renderer bundle impact; `BlockerTracker` with a typed EventEmitter overload pattern for type-safe events; and a Waiting-on-you state in `SessionStateMachine` with `_preWaitingState` for correct return transitions. 65 unit tests.

**S02** wired the IPC layer: `respondUI` handler with full validation, BlockerTracker integration via a listener fan-out pattern, and Windows toast notifications using injectable `showBlockerToastFn` (3s debounce, click-to-focus, `basename(cwd)` as session name). 75 new tests, 247 total.

**S03** delivered four modal components (`SelectModal`, `ConfirmModal`, `InputModal`, `EditorModal`) with pure-function helpers (`buildSelectResponse`, `toggleOption`, `isEditorSubmitCombo`) exported for isolated testing. `mousedown` on backdrop prevents drag-release false dismissals. 58 unit tests.

**S04** added non-modal renderers (`StatusBar`, `InlineToast`) and the modal queue: pure-function `modal-queue.ts` + useState in App.tsx (Zustand not installed), FIFO ordering, depth badge, `FallbackModal` for unknown future methods, `ActiveModalRouter` composing all types, and optimistic dequeue before IPC round-trip. 

**S05** added Playwright e2e tests covering all modal methods and shutdown-cancel paths using a mock-pi-server. Initial attempt surfaced a test-cleanup race.

**S06** fixed the Playwright cleanup bug (undefined modal responses), confirmed 8/8 tests pass, activated CI on `windows-latest`, and verified the Windows toast SLA via live app session (19ms measured, 500ms SLA).

**Closeout fix:** Two pre-existing test failures were repaired during closeout: (1) `handlers.test.ts` channel count stale at 6 when 9 channels were registered — updated to 9; (2) `client-factory.test.ts` mock missing `resolveSystemNode` export — added to vi.mock() factory. All 414 unit tests now pass.

## Success Criteria Results

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Every extension_ui_request method handled with correct modal | Live log 2026-07-20 17:19: all 4 modal types (select/confirm/input/editor) triggered and toast shown with correct method logged. 58 S03 unit tests + 8/8 S06 Playwright tests. FallbackModal covers unknown methods. | ✅ PASS |
| Session state transitions Working→Waiting→Working correctly | S01 65 unit tests. Live log: real pi session s_2dzFy8zf0SUl with agent_start/agent_end/turn_end events cycling correctly over 26 minutes. | ✅ PASS |
| Shutdown with open blockers: pi receives cancellations and exits cleanly | Live log: multiple sessions show `cancelling 1 open blocker(s)` / `cancelled blocker requestId=... elapsed=0ms` on 5+ sessions. Playwright test 7 verified. | ✅ PASS |
| Windows toast fires within 500ms of blocker arrival | Live log: extension_ui_request at 17:19:13.109 → toast shown at 17:19:13.128 = **19ms latency** across all 4 modal types. | ✅ PASS |
| Playwright test suite green | 8 passed (16.1s), exit 0. CI pipeline on windows-latest activated. 414 unit tests also pass. | ✅ PASS |

## Definition of Done Results

| Item | Status |
|------|--------|
| All 6 slices marked [x] complete | ✅ All 6 slices complete (15 total tasks done) |
| SUMMARY.md exists for every slice | ✅ 03-01 through 03-06 SUMMARY.md confirmed |
| Cross-slice integrations verified | ✅ S01→S02→S03→S04→S05→S06 chain confirmed via live app and Playwright suite |
| 414 unit tests pass (20 test files) | ✅ Verified in closeout run |
| LEARNINGS.md written | ✅ .gsd/phases/03-ui-request-bridge/03-LEARNINGS.md (8 decisions, 7 lessons, 6 patterns, 3 surprises) |
| Requirements R3 and R5 updated to validated | ✅ gsd_requirement_update called for both |
| PROJECT.md refreshed | ✅ gsd_summary_save PROJECT artifact written |

## Requirement Outcomes

| Requirement | Transition | Evidence |
|-------------|------------|----------|
| R3 — Session state at a glance | Active → **Validated** | Toast fires in 19ms; setStatus acked every 30s; shutdown-cancel on 5+ live sessions |
| R5 — Simple access to GSD commands | Active → **Validated** | All 4 modal types handled end-to-end; FallbackModal covers future methods |
| R9 — Forward compatibility | Active (no change) | No pi-internal imports throughout M003; all via @opengsd/contracts public surface |
| R10 — Windows desktop | Active (no change) | Live sessions on Windows confirmed; CI on windows-latest |
| R11 — Thin shell, user-installed pi | Active (no change) | pi resolved from user PATH (`C:\nvm4w\nodejs\node_modules\...`) — not bundled |

## Deviations

SelectModal preview field not implemented — RpcExtensionUIRequest.select defines options: string[] with no preview field; contract is ground truth. modal-queue.ts implemented as plain TS + useState (not Zustand) — Zustand not in package.json; behavior identical. Two test fixes applied at closeout: handlers.test.ts channel count updated from 6 to 9; client-factory.test.ts mock updated to include resolveSystemNode export.

## Follow-ups

fix-machine-path.ps1 handles per-machine path normalization — should be addressed in CI setup docs. SelectModal preview field (markdown per option) absent from RPC contract — implement when pi adds the field. Architecture decisions MEM016-MEM021 captured; remaining 6 decisions in LEARNINGS.md to be persisted in next session (capture_thought loop guard hit).

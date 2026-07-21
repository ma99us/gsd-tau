---
phase: M003
phase_name: UI-request Bridge
project: gsd-tau
generated: 2026-07-21T09:35:00Z
counts:
  decisions: 8
  lessons: 7
  patterns: 6
  surprises: 3
missing_artifacts: none
---

# M003 LEARNINGS: UI-request Bridge

### Decisions

- **Use `import type` from @opengsd/contracts in shared/types.ts**: Chose `import type` over a runtime import to ensure zero bundle footprint in the renderer process. The types are erased at compile time and never included in the renderer bundle.
  Source: 03-01-SUMMARY.md/Key decisions

- **UiRequestState typed as Record<string, RpcExtensionUIRequest> (not Map)**: Chose plain Record over Map to ensure JSON-serialisability across the Electron IPC boundary. Map instances cannot be serialised by Electron's contextBridge serialisation layer.
  Source: 03-01-SUMMARY.md/Key decisions

- **BlockerTracker.remove() is a strict no-op for unknown ids**: Chose idempotent remove to make cancel-all on shutdown safe — calling remove() on already-resolved or never-added ids does not throw or corrupt state.
  Source: 03-01-SUMMARY.md/Key decisions

- **`validateUiResponse` exported as a pure function**: Chose exportable pure function over inline handler logic to enable isolated unit testing independent of the IPC machinery and Electron globals.
  Source: 03-02-SUMMARY.md/Key decisions

- **`showBlockerToastFn` injectable as optional 3rd param to `registerHandlers`**: Chose the injectable side-effect pattern (same pattern as `getAllWebContents`) to enable unit testing without mocking Electron globals. Zero test-churn for non-notification tests.
  Source: 03-02-SUMMARY.md/Key decisions

- **Pure helpers (buildSelectResponse, toggleOption, isEditorSubmitCombo) exported from modal components**: Chose pure-function extraction over testing through React/DOM to enable fast Vitest coverage without jsdom setup overhead. Enables isolated unit testing of response-building logic.
  Source: 03-03-SUMMARY.md/Key decisions

- **`modal-queue.ts` as plain TS pure-function module + useState in App.tsx**: Chose plain TypeScript module over Zustand (not installed) because behavior is identical and avoids adding a dependency. Pure-function helpers in node environment are cheaper to test than a Zustand store.
  Source: 03-04-SUMMARY.md/Key decisions

- **`handleModalRespond` dequeues optimistically before IPC round-trip**: Chose optimistic dequeue (update UI immediately, then call IPC) for zero-latency queue advancement. If the IPC call fails, the error is surfaced separately — the queue moves forward regardless.
  Source: 03-04-SUMMARY.md/Key decisions

### Lessons

- **Test mock must include all exported symbols from a mocked module**: `client-factory.test.ts` mocked `resolve-pi` as `{ resolvePiBinary }` only. When `resolveSystemNode` was added to `resolve-pi.ts`, the mock was never updated, causing 15 test failures. Fix: always enumerate all exports in vi.mock() factory, or use `vi.importActual` as a spread base.
  Source: 03-02-SUMMARY.md/Known limitations; discovered during M003 closeout

- **Handler registration test counts must be updated when new IPC channels are added**: `handlers.test.ts` hardcoded `toHaveBeenCalledTimes(6)`. When 3 new channels (GET_COMMANDS, GET_AVAILABLE_MODELS, SET_MODEL) were added, the test count was not updated, causing a false failure. Fix: also assert the specific new channel names, not just the count.
  Source: 03-VALIDATION.md/Freshness note; discovered during M003 closeout

- **pi `extension_ui_request` non-interactive methods (setStatus, setWidget, notify) must be auto-acked, not left pending**: If non-interactive methods are left open in BlockerTracker, the open-blocker count grows without bound and shutdown cancellation sends spurious cancellations to pi for requests that were never blockers.
  Source: 03-04-SUMMARY.md/Key decisions

- **`mousedown` on backdrop prevents drag-release false dismissals**: Using `mousedown` instead of `click` for modal backdrop dismiss prevents the case where a user starts a drag inside the modal, releases outside, and accidentally closes it. Use `mousedown` for all modal dismiss targets.
  Source: 03-03-SUMMARY.md/Key decisions/Patterns

- **`editorPrefillRef` as `useRef` (not `useState`) to avoid stale-closure issues**: When `set_editor_text` arrives before an EditorModal is open, the prefill value must be stored in a ref, not state. State triggers re-render cycles that can cause the prefill to be consumed before the modal mounts; refs are read at mount time.
  Source: 03-04-SUMMARY.md/Key decisions

- **`_preWaitingState` required in SessionStateMachine for correct Waiting-on-you return**: When `agent_start`/`agent_end` events arrive while the machine is in Waiting-on-you, they must update `_preWaitingState` (not the current state) so the transition back from Waiting-on-you lands in the correct state (idle vs. working).
  Source: 03-01-SUMMARY.md/Key decisions

- **`Error: Client not started` is a benign race on shutdown**: When pi exits before the Electron shutdown hook calls `client.shutdown()`, the RpcClient emits this error. It does not affect blocker cancellation correctness — cancellations are already sent before client.shutdown() is called. Log and ignore.
  Source: 03-VALIDATION.md/Verdict Rationale; 03-02-SUMMARY.md/Known limitations

### Patterns

- **Injectable side-effect functions as optional `registerHandlers` parameters**: Pass side-effect dependencies (toast functions, getAllWebContents, etc.) as optional typed parameters to registration functions rather than importing Electron singletons directly. This enables full unit testing without a live Electron process and follows the existing GetAllWebContents injectable pattern.
  Source: 03-02-SUMMARY.md/Patterns established

- **Typed EventEmitter overload pattern for type-safe events**: Declare an interface with method overloads for `on()` and `emit()` on a class that extends EventEmitter. This provides compile-time type checking for event names and payloads without runtime overhead.
  Source: 03-01-SUMMARY.md/Patterns established

- **wireBlockerTracker cleanup-closure pattern for lifetime management**: Return a cleanup closure from wire functions (wireBlockerTracker, etc.) rather than requiring callers to manage event listener cleanup manually. Callers invoke the closure on close() to detach all listeners atomically.
  Source: 03-01-SUMMARY.md/Patterns established

- **Optimistic dequeue before IPC round-trip for zero-latency queue progression**: In the modal response handler, dequeue the current item from the queue state before awaiting the IPC call. The UI advances immediately; errors from the IPC call are surfaced separately. Prevents queue appearing stuck during network/IPC latency.
  Source: 03-04-SUMMARY.md/Patterns established

- **Pure exported helper pattern for React component logic**: Extract response-building, toggle, and keyboard-shortcut logic from React components as exported pure functions. Test the pure functions with Vitest in a node environment; test only rendering/event binding in jsdom. Speeds up test suites significantly.
  Source: 03-03-SUMMARY.md/Patterns established

- **Non-modal UI-request methods auto-respond with `{ value: '' }` immediately**: Methods that do not require user input (setStatus, setWidget, notify, setTitle, set_editor_text) should be auto-responded in the IPC handler before any rendering. Do not add them to the BlockerTracker — they are not blockers.
  Source: 03-04-SUMMARY.md/Patterns established

### Surprises

- **SelectModal preview field absent from RPC contract**: The phase plan mentioned supporting a preview field alongside each select option (markdown), but `RpcExtensionUIRequest.select` defines `options: string[]` with no preview field. The contract is ground truth — the feature was not implemented. A future pi version may add the field.
  Source: 03-03-SUMMARY.md/Deviations

- **Zustand not installed**: The S04 plan assumed Zustand would be available for the modal queue store. At implementation time Zustand was not in package.json. The plan was adapted to use a pure-function module + useState, which is functionally identical and avoids the dependency.
  Source: 03-04-SUMMARY.md/Deviations

- **Windows toast fires in 19ms (25× faster than 500ms SLA)**: The toast notification SLA was set at 500ms based on conservative estimates for Windows notification dispatch latency. In practice the toast fires in 19ms measured end-to-end from `extension_ui_request` arrival to `toast shown` log. The SLA is met with enormous margin.
  Source: 03-VALIDATION.md/Success Criteria Checklist

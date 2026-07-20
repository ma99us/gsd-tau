---
phase: "M002"
phase_name: "Session Manager and Minimal Shell"
project: "gsd-tau"
generated: "2026-07-20T18:00:00.000Z"
counts:
  decisions: 6
  lessons: 5
  patterns: 7
  surprises: 4
missing_artifacts: []
---

# M002 Learnings

## Decisions

- **electron-vite as scaffold tool** — Chose electron-vite over bare Vite or CRA because it provides pre-configured main/preload/renderer build targets with Electron-aware defaults, avoiding manual rollupOptions wiring for multi-entry builds.
  Source: 02-01-SUMMARY.md/Key decisions

- **crypto.randomBytes for session IDs instead of nanoid** — Used stdlib `crypto.randomBytes(9).toString('base64url')` rather than nanoid. nanoid is a transitive dep but not in package.json; crypto has equivalent entropy with no extra dependency.
  Source: 02-03-SUMMARY.md/Key decisions

- **IPC channel constants duplicated in preload.ts** — Channel name strings are duplicated in preload.ts rather than imported from main/ to keep the preload bundle free of main-process code and avoid Electron sandbox violations.
  Source: 02-04-SUMMARY.md/Key decisions

- **text_delta throttle lives in SessionHandle only** — 60fps throttle applied in SessionHandle, not re-applied in IPC handlers, following single-responsibility. IPC handlers forward events as-is.
  Source: 02-04-SUMMARY.md/Key decisions

- **ClientInitError carries readonly piPath** — ClientInitError exposes piPath so the session manager can surface the binary path in error UI without reparsing the error message string. start() failures propagate as raw OS errors to distinguish process-spawn vs protocol failures.
  Source: 02-02-SUMMARY.md/Key decisions

- **Stopped state is terminal in Phase 1** — SessionStateMachine Stopped is a terminal state; agent_start is a no-op from Stopped. A new process/handle is required to restart. Deferred restart UI to Phase 2.
  Source: 02-03-SUMMARY.md/Key decisions

## Lessons

- **pnpm v11 blocks build scripts silently** — `pnpm.onlyBuiltDependencies` in package.json is silently ignored by pnpm v11 (warning only). Must use `pnpm install --ignore-scripts` then `node node_modules/electron/install.js` manually. See MEM004.
  Source: 02-01-SUMMARY.md/Deviations

- **resolvePiBinary must return the JS loader path, not the .cmd wrapper** — RpcClient.start() spawns `process.execPath` with cliPath as a .js argument. Passing gsd.cmd causes an ENOENT or wrong-interpreter error. Derive JS path from the .cmd file's sibling directory. See MEM005.
  Source: 02-02-SUMMARY.md/Follow-ups

- **pi emits agent_start AND turn_start for the same turn** — Both events fire per turn. Treating all as turn-open signals creates duplicate "Thinking…" placeholders. Guard: only dispatch on first event when `currentAssistantId.current === null`. See MEM008.
  Source: 02-05-SUMMARY.md (S05 fixes)

- **message_update text is nested, not top-level** — `event.text` is undefined; actual delta is at `event.assistantMessageEvent.delta`. Only `text_delta` sub-events carry content; `text_start` duplicates the first token and must be skipped. See MEM007.
  Source: 02-05-SUMMARY.md (S05 fixes)

- **extension_ui_request setStatus must be acked confirmed, not cancelled** — Auto-cancelling with `{ cancelled: true }` signals pi that the shell doesn't support extension UI, causing empty message loops. Non-interactive methods (setStatus, setWidget) should be acked `{ confirmed: true }`. See MEM009.
  Source: 02-05-SUMMARY.md (S05 fixes)

## Patterns

- **createClient() factory pattern** — Resolve binary → create RpcClient → start() → init() → validate protocol → return handle or throw typed ClientInitError. Separates resolution, connection, and protocol validation phases cleanly.
  Source: 02-02-SUMMARY.md/Patterns established

- **Leading-edge throttle with trailing flush for high-frequency streaming events** — First text_delta emitted immediately (leading edge), burst collapses to latest buffered value, generator end drains remaining pending delta. Prevents UI jank without losing content.
  Source: 02-02-SUMMARY.md/Patterns established

- **Synchronous _stopped flag before first await in stop()** — Setting `_stopped = true` synchronously before any `await` in stop() guards async pump error handlers without race conditions. Fire-and-forget stop() is then safe.
  Source: 02-02-SUMMARY.md/Patterns established

- **State machine emits state-changed events — consumers subscribe, not poll** — SessionStateMachine emits `state-changed` on every transition. Consumers subscribe rather than polling, enabling decoupled state propagation to IPC/UI layers.
  Source: 02-03-SUMMARY.md/Patterns established

- **Inject getAllWebContents for testable IPC fan-out** — Pass `getAllWebContents` as a parameter to `registerHandlers()` rather than importing from Electron directly. Enables unit tests without a live Electron process.
  Source: 02-04-SUMMARY.md/Patterns established

- **vi.hoisted() for mock functions that must exist before vi.mock() factory runs** — Module-level `vi.fn()` declarations have TDZ issues with vi.mock(). Use `vi.hoisted()` to hoist mock instances so the factory can reference them safely.
  Source: 02-04-SUMMARY.md/Patterns established

- **localStorage injection to bypass native OS dialog in Playwright** — Inject Recents data into localStorage before app launch to pre-populate the recent-projects list, allowing Playwright to click a recent item instead of triggering an unautomatable native OS folder-picker dialog.
  Source: 02-06-SUMMARY.md/S06 Playwright update

## Surprises

- **Playwright smoke test blocked by native OS folder-picker dialog** — Initial smoke test design assumed programmatic folder selection. The native OS dialog cannot be automated by Playwright. Required a design change: inject Recents via localStorage so the test clicks a recent project instead.
  Source: 02-06-SUMMARY.md/S06 replan

- **Three pi event-pipeline bugs discovered late during manual testing** — MEM007 (text nesting), MEM008 (duplicate turn guards), MEM009 (extension_ui_request ack) were only discovered during S05/S06 end-to-end manual testing, not during unit tests. Unit tests with mocked clients cannot catch protocol-shape mismatches.
  Source: 02-VALIDATION.md/Cross-Slice Integration

- **pnpm v11 silently ignores onlyBuiltDependencies field** — Expected the standard package.json pnpm field to work; pnpm v11 migrated the config location and emits only a warning, not an error, when the old field is present.
  Source: 02-01-SUMMARY.md/Deviations

- **electron-vite requires explicit rollupOptions.input to fix Vite internal error on build** — The default renderer config produced a Vite internal error on `pnpm build`. Required adding `rollupOptions.input` pointing to index.html to resolve.
  Source: 02-01-SUMMARY.md/Key decisions

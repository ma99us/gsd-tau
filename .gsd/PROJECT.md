# gsd-tau — Project State

**Updated:** 2026-07-21

## What This Is

Thin Electron desktop shell over headless `@opengsd/gsd-pi` sessions. Chat-first UI that spawns `gsd --mode rpc` per project, communicates via `@opengsd/rpc-client`, and renders a native Windows desktop experience. pi is user-installed on PATH — not bundled.

**AppUserModelID:** `io.opengsd.gsd-tau`  
**pi min version:** 1.11.0  
**Config dir:** `%APPDATA%\gsd-tau\`

## Milestone Status

| Milestone | Title | Status |
|-----------|-------|--------|
| M002 | Session Manager | ✅ Complete |
| M003 | UI-request Bridge | ✅ Complete |
| M004 | Project and Session Switcher | 🔲 Planned |

## M002 — Session Manager (Complete)

Delivered the full main-process session management foundation: `SessionManager`, `SessionHandle`, `RpcEventPump`, `ClientFactory`, binary resolution, and the IPC bridge with preload API. 65+ unit tests. Real pi sessions run end-to-end with correct agent_start/agent_end/turn_end event cycling.

Key architecture: `SessionManager` lives in the main process. Renderer never spawns children or touches `.gsd/`. All access via IPC. `resolvePiBinary()` returns the JS loader path (not .cmd wrapper) for Windows compatibility.

## M003 — UI-request Bridge (Complete)

Delivered the complete `extension_ui_request` handling pipeline:

- **S01** — Contract types (`UiRequestState`, `UiResponseInput`), `BlockerTracker` with typed EventEmitter events, Waiting-on-you state in `SessionStateMachine`
- **S02** — `respondUI` IPC handler with validation and BlockerTracker integration, Windows toast notifications (19ms latency, 3s debounce, click-to-focus)
- **S03** — Four modal components: `SelectModal`, `ConfirmModal`, `InputModal`, `EditorModal` — 58 unit tests with pure-function helpers
- **S04** — Non-modal renderers (`StatusBar`, `InlineToast`), modal queue with FIFO ordering and depth badge, `FallbackModal`, `ActiveModalRouter`
- **S05/S06** — Playwright e2e test suite (8/8 pass), mock-pi-server infrastructure, CI pipeline on `windows-latest`

**Verified outcomes:** All 4 modal types handle correctly. Session state transitions Working→Waiting→Working confirmed. Shutdown with open blockers cancels cleanly. Windows toast fires in 19ms. 414 unit tests pass.

## Key Architecture

- **Main process:** `SessionManager`, `SessionHandle`, `BlockerTracker`, `RpcEventPump`, `ClientFactory`, IPC handlers
- **Renderer:** React + Tailwind + Radix; `ActiveModalRouter`, modal queue via pure TS + useState, `StatusBar`, `InlineToast`
- **Preload:** `window.gsd.*` API surface; `respondUI`, `prompt`, `abort`, `getState`, `openProject`, `showFolderPicker`
- **Test infra:** Vitest (unit), Playwright (e2e), mock-pi-server (CJS, port 0 binding)
- **CI:** GitHub Actions `windows-latest`, pnpm 11, Electron builder

## Active Requirements

| ID | Description | Status |
|----|-------------|--------|
| R1 | Chat pane with streaming | Active |
| R2 | Tool-use progress panel | Active |
| R3 | Session state at a glance (Waiting-on-you, toast) | **Validated** (M003) |
| R4 | Multi-project / multi-tab | Active |
| R5 | Simple access to GSD commands via modals | **Validated** (M003) |
| R6 | Auto-run view | Active |
| R7 | Model and context picker | Active |
| R8 | Session export | Active |
| R9 | Forward compatibility | Active |
| R10 | Windows desktop | Active |
| R11 | Thin shell, user-installed pi | Active |

## Known Issues / Follow-ups

- `fix-machine-path.ps1` script handles per-machine path normalization for CI
- `set_editor_text` prefill works only if EditorModal is opened in the same session — silently dropped if never opened
- SelectModal preview field (markdown per option) not implemented — absent from RPC contract (`options: string[]`)
- Architecture decisions captured in `capture_thought` (MEM016–MEM021) and `.gsd/phases/03-ui-request-bridge/03-LEARNINGS.md`

## Next: M004 — Project and Session Switcher

Phase 3 targets the project/session switcher UI: `[+]` flyout, project recents, tab management, session restore on relaunch. See `docs/plan/PHASE-3-project-and-session-switcher.md` and `.gsd/phases/04-.../04-CONTEXT.md` for execution context.

## Milestone Sequence

- [ ] M001:  — Planned.
- [x] M002: Session Manager and Minimal Shell — A running Electron app that spawns a pi child for one project, streams every RPC event to a chat pane, and shuts down cleanly.
- [ ] M003: UI-request Bridge — Every pi question reaches the user as a native modal.
- [ ] M004: Multi-project Tabs, Persistence, Resume — A real multi-project desktop shell that survives reboots.

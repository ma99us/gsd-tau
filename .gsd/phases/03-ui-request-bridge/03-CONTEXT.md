# M003 Context — Phase 2: UI-request Bridge

## Goal

Handle every `extension_ui_request` pi emits with a native modal. Sessions can never hang. Windows toast on blocker arrival. Build on M002.

## Source Documents

- `docs/plan/PHASE-2-ui-request-bridge.md` — authoritative task reference
- `docs/20-pi-integration.md` — RpcExtensionUIRequest / RpcExtensionUIResponse shapes
- `docs/40-ui-design.md` — modal component specs and non-modal renderer specs

## Key Decisions

- **BlockerTracker** lives in main process per session; renderer syncs via IPC events `session:ui-request-added` / `session:ui-request-removed`
- **State machine** extended: `Waiting on you` state triggered by `blocker-added`; cleared by `blocker-removed AND blockerCount==0`
- **Modal types**: select (single + multi), confirm, input (secure mask), editor (Ctrl+Enter submit), fallback (raw JSON for unknown methods)
- **Non-modal renderers**: notify (auto-dismiss toast 4s, stack 3), setStatus/setWidget/setTitle (persistent status bar), set_editor_text (pre-fill active editor modal)
- **Modal queue**: simultaneous blockers queue; badge shows depth; FIFO order
- **Fallback modal**: any unknown method → raw JSON display + free-text response field
- **Toast debounce**: max one Windows toast per session per 3s to avoid spam
- **AppUserModelID**: `io.opengsd.gsd-tau` — set at app-ready (required for toast attribution on Windows)
- **Shutdown cancellation**: before `client.shutdown()`, send `cancelled: true` for every open blocker; 2s timeout per session
- **mock-pi helper**: `test/helpers/mock-pi.ts` — local stdio mock emitting each request type for Playwright tests
- **respondUI validation**: validates response shape server-side before forwarding; returns error payload to renderer (never throws)

## Depends On

M002 — all IPC, SessionHandle, SessionManager, and preload infrastructure from Phase 1.

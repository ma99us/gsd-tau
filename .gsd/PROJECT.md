# gsd-tau — Project State

## What This Is

gsd-tau is a Windows Electron desktop shell over headless `@opengsd/gsd-pi` sessions. It spawns `gsd --mode rpc` per project, communicates via `@opengsd/rpc-client`, and renders a chat-first UI. Multiple concurrent sessions across tabs and windows, survives reboots.

- **Config dir:** `%APPDATA%\gsd-tau\`
- **AppUserModelID:** `io.opengsd.gsd-tau`
- **pi min version:** 1.11.0

## Current State (post-M002)

**M002 — Session Manager and Minimal Shell — complete.**

A running Electron app that spawns a pi child for one project, streams every RPC event to a chat pane, and shuts down cleanly. The core loop is proven end-to-end.

### What Works

- `pnpm dev` boots to an Electron window with a full chat UI
- User can pick a folder (via Recents or new project), send a message, and see a streamed assistant response with live token delivery
- Tool cards render for read/write/bash events with expand/collapse and pending/result states
- Window close terminates the pi child within 3s — confirmed across 10 consecutive Playwright smoke runs with zero leaked processes
- Playwright smoke test: 10/10 consecutive passes
- Zero unhandled promise rejections in main-process log

### Architecture Established

- **Main process:** `SessionManager` → `SessionHandle` → `RpcClient` chain
- **IPC bridge:** `window.gsd.*` (openProject, prompt, abort, getState, onEvent, onStateChange) via contextBridge
- **Renderer:** React + Zustand + `useSession` hook consuming the IPC bridge
- **Event pipeline:** agent_start → message_update (text_delta throttled at 60fps) → turn_end
- **Shutdown:** graceful 3s timeout with process kill fallback

### Key Files

- `src/main/pi/resolve-pi.ts` — pi binary resolver
- `src/main/pi/client-factory.ts` — createClient() factory
- `src/main/session/session-handle.ts` — RPC event pump with throttled text_delta
- `src/main/session/session-manager.ts` — SessionManager (open/prompt/abort/close)
- `src/main/session/state-machine.ts` — 3-state machine with 30s watchdog
- `src/main/ipc/handlers.ts` — IPC handler registration with getAllWebContents injection
- `src/preload/preload.ts` — contextBridge window.gsd API surface
- `src/renderer/hooks/useSession.ts` — renderer hook for session state + events
- `src/renderer/components/ToolCard.tsx` — tool event card
- `src/renderer/components/TurnList.tsx` — conversation turn list
- `e2e/smoke.spec.ts` — Playwright smoke suite (10-run gate)

### Known Limitations / Deferred

- Single session at a time (Phase 1 constraint; multi-session in M004)
- Stopped state is terminal — no restart without new SessionHandle (restart UI deferred to Phase 2)
- prompt() rejection not surfaced as UI toast (UX deferral to Phase 2)
- `extension_ui_request` interactive methods (ask/confirm) left pending (Phase 2)
- pnpm v11 requires `--ignore-scripts` + manual Electron binary install

## Next: M003 — UI Request Bridge and Chat Polish (Phase 2)

Handles `extension_ui_request` interactive methods (ask/confirm), adds session restart UI, and polishes the chat experience (error toasts, loading states, scroll behavior).

## Tech Stack

Electron + Vite (electron-vite) + React + TypeScript + Zustand + Radix UI + Tailwind CSS + Vitest + Playwright

## Milestone Sequence

- [ ] M001:  — Planned.
- [ ] M002: Session Manager and Minimal Shell — A running Electron app that spawns a pi child for one project, streams every RPC event to a chat pane, and shuts down cleanly.
- [ ] M003: UI-request Bridge — Every pi question reaches the user as a native modal.
- [ ] M004: Multi-project Tabs, Persistence, Resume — A real multi-project desktop shell that survives reboots.

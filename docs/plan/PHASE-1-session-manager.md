# Phase 1 — Session Manager and One-Project Prototype

**Goal:** Prove the core loop works. Spawn a pi child from an Electron main
process, prompt it, stream every event to a renderer, render a minimal chat pane,
shut down cleanly. Hardcoded project path. No tabs, no modals, no persistence.

**Requirements advanced:** R1 (partial — one session, no tabs), R11 (pi
resolution on PATH).

**Non-goals for this phase:** tabs, multiple projects, `extension_ui_request`
modals, model picker, notifications, tray, persistence, auto-mode UI.

## Deliverables

1. Electron app that boots to a single window.
2. `main/pi/resolve-pi.ts` — locates `gsd` on PATH; hard-fails with an error
   message if missing (guided setup comes in Phase 11).
3. `main/pi/client-factory.ts` — creates and starts an `RpcClient` for a given cwd.
4. `main/session/session-handle.ts` — wraps one `RpcClient`: init, subscribe,
   event pump, state machine (minimal: Working / Idle / Stopped only).
5. `main/session/session-manager.ts` — the `Map<SessionId, SessionHandle>`.
   Phase-1 restriction: max one session at a time. Same public API as later
   phases will use, just not exercised.
6. `main/ipc/handlers.ts` — `openProject`, `prompt`, `abort`, `getState`.
7. `preload/preload.ts` — exposes `window.gsd` with those four methods and
   event listeners for `session:event` and `session:state-change`.
8. `renderer/App.tsx` — one hardcoded chat pane. Text input + Send. Turn list.
   Assistant text streaming. Tool cards (collapsed).
9. Cross-cutting: strict TypeScript, ESLint, prettier, Vitest, minimal Playwright test.

## Tasks

- [ ] **T01: Project bootstrap** — Vite + Electron + React + TypeScript scaffolding.
  Verify `pnpm dev` shows an empty window.
- [ ] **T02: pi resolver** — `resolvePiBinary()` returns a path or throws. Test
  covers: PATH hit, env var override, not-found error.
- [ ] **T03: RpcClient factory** — `createClient({ cwd })` returns a started,
  init'd client. Verify against a real `gsd` install on the dev machine.
- [ ] **T04: SessionHandle event pump** — `for await (const ev of client.events())`
  running in an unawaited async task, feeding an `EventEmitter`. Handles
  `agent_start`, `agent_end`, `message`, `text_delta`, `tool_use`, `tool_result`.
  Every other event is logged and forwarded.
- [ ] **T05: Minimal state machine** — Working on `agent_start`, Idle on
  `agent_end` (unless blocker pending — but no blockers in this phase so it's
  always Idle after agent_end), Stopped on transport close or watchdog.
- [ ] **T06: SessionManager** — `open(cwd)`, `get(id)`, `close(id)`. Enforces
  the one-session limit for Phase 1.
- [ ] **T07: IPC handlers** — `openProject`, `prompt`, `abort`, `getState`,
  event fan-out via `webContents.send`.
- [ ] **T08: Preload bridge** — contextBridge exposes `window.gsd` API. Types
  live in `shared/types.ts`.
- [ ] **T09: Renderer chat view** — turn list, streaming assistant messages,
  collapsed tool cards, composer with Enter/Shift+Enter. No fancy styling.
- [ ] **T10: Hardcoded project selector** — on startup, show a folder picker
  once; remember for the session lifetime (in-memory only). No registry yet.
- [ ] **T11: Clean shutdown** — on window close: `client.shutdown()` with
  timeout; force `stop()` if it doesn't respond in 3s.
- [ ] **T12: Smoke test** — Playwright script: launch app, pick a fixture repo,
  send "list files here", assert an assistant message is rendered, close cleanly.

## Verification

### Manual
1. `pnpm dev` boots the app.
2. Pick any git repo with `.gsd/` present (or an empty repo — pi will still
   start).
3. Type "hello" → send → see assistant response stream.
4. Type "read package.json" → see the `read` tool card appear, then the result.
5. Close the window → confirm the pi child process exits within 3s (`Task
   Manager` verification on Windows).

### Automated
- Vitest: state machine transitions, pi resolver, IPC handlers with mocked SDK.
- Playwright smoke test as T12 (uses a fixture repo checked into
  `test/fixtures/`).

### Success criteria
- Chat pane renders correctly against real pi.
- No process leaks after 10 open/close cycles.
- No unhandled promise rejections in the main-process log.
- Every event type observed in a real session is either rendered or logged;
  none crash the app.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `gsd` not on PATH on dev machine | Doc: run `npm i -g @opengsd/gsd-pi` first. Phase 11 handles user-facing case. |
| Event pump backpressures on heavy `text_delta` streams | Throttle to 60fps at main-process boundary before IPC send. |
| pi child hangs on shutdown | Watchdog: `stop()` (force-kill) after 3s of no `shutdown` ack. |
| RPC init fails against user's pi version | Log the `protocolVersion`; show a plain error card in the renderer. Full incompatible-version UX in Phase 11. |

## Time estimate

~1 week of focused work. The pi integration and event pump are the hard parts
(~3 days); the rest is scaffolding and a plain React chat view.

## Exit criteria

Phase closes when the smoke test passes reliably 10 times in a row and a manual
walkthrough completes without touching a terminal. Then we start Phase 2.

# Phase 2 — UI-request Bridge

**Goal:** Handle every kind of `extension_ui_request` pi can raise. Render a
matching modal in the renderer, route the user's answer back to pi. Never leave
pi hanging. Fire a basic Windows toast when a blocker appears so a background
tab is discoverable.

**Requirements advanced:** R3 (Waiting-on-you state and toast), R5 (partial —
modals as the first surface for pi's questions).

**Non-goals for this phase:** multi-tab (still one session), tray icon,
persistence, model picker, auto-mode UI.

## Why this phase matters

Without a working UI-request bridge, any pi workflow that asks a question
(most non-trivial ones) hangs forever. This is what makes the shell actually
usable for real work.

## Deliverables

1. `shared/types.ts` extension: `UiRequestState`, `UiResponseInput`,
   corresponding to `RpcExtensionUIRequest` / `RpcExtensionUIResponse`.
2. `main/session/blocker-tracker.ts` — per-session `Map<requestId, request>`.
   State machine now considers "any open blocker" → **Waiting on you**.
3. `main/ipc/handlers.ts` addition: `respondUI(sessionId, requestId, response)`.
4. `main/os/notifications.ts` — Windows toast on blocker appearance. Requires
   `AppUserModelID` set in `main/index.ts` at startup.
5. `renderer/components/ui-request-modal.tsx` — one component per method:
   `select` (single + multi), `confirm`, `input` (with `secure` mask), `editor`.
6. `renderer/components/status-widgets.tsx` — non-modal renderers for `notify`,
   `setStatus`, `setWidget`, `setTitle`, `set_editor_text`.
7. Shutdown handling: on window close / app quit, send
   `{ cancelled: true }` for every open request per session, wait for pi
   acknowledgement, then `shutdown`.
8. Toast lifecycle: click on toast → focus the app window. (Multi-window
   handling comes in Phase 9; for now: focus the single window.)

## Tasks

- [ ] **T01: Contract types** — import `RpcExtensionUIRequest` /
  `RpcExtensionUIResponse` from `@opengsd/contracts` (types only in shared),
  re-export in `shared/types.ts` for renderer consumption.
- [ ] **T02: BlockerTracker** — records incoming requests, removes on response,
  emits `session:ui-request-added` / `session:ui-request-removed`. State
  machine subscribes.
- [ ] **T03: State machine update** — add **Waiting on you**. Transitions:
  - `blocker added` → Waiting
  - `blocker removed` AND agent still Working → Working
  - `blocker removed` AND agent Idle → Idle
- [ ] **T04: IPC handler `respondUI`** — validates the response shape against
  the recorded request method, calls `client.sendUIResponse`, removes from
  tracker.
- [ ] **T05: `notifications.ts`** — thin wrapper around Electron `Notification`.
  Sets `AppUserModelID` at app startup. Debounces per-session (max 1 toast per
  session per 3s) to avoid spam during rapid-fire blockers.
- [ ] **T06: Modal component: `select`** — single-select radio + Confirm; if
  `allowMultiple`, checkboxes.
- [ ] **T07: Modal component: `confirm`** — Yes/No.
- [ ] **T08: Modal component: `input`** — single-line text; if `secure`, mask
  input and never log the value.
- [ ] **T09: Modal component: `editor`** — multi-line textarea with monospace
  font, Ctrl+Enter to submit.
- [ ] **T10: Non-modal renderers** — `notify` = tab-local toast (auto-dismiss
  after 4s); `setStatus`/`setWidget`/`setTitle`/`set_editor_text` update
  designated header/status regions.
- [ ] **T11: Modal queue** — per-tab queue when multiple requests are open
  simultaneously; show top-of-queue as active modal, badge shows queue depth.
- [ ] **T12: Shutdown cancellation** — on `beforeUnload` / app quit, cancel all
  open blockers before shutdown.
- [ ] **T13: Fallback modal** — for any unknown `method` in a future pi version,
  render a generic "pi asks:" modal showing the raw request JSON with a plain
  text response box and a Cancel button.
- [ ] **T14: Playwright test** — mock pi that emits each request method, verify
  each modal renders, verify response flows back, verify shutdown-with-open-blocker
  sends cancellations.

## Verification

### Manual
1. Trigger a `select` blocker: run `/gsd` in a fresh repo, pi prompts for
   milestone type via `select`. Choose an option → pi proceeds.
2. Trigger a `confirm`: any destructive-action confirmation from a skill.
3. Trigger a `input`: use an extension that asks for a project name.
4. Trigger `secure: true`: any auth-related input prompt.
5. Trigger `notify` (informational): pi's `notify` calls from workflows.
6. Trigger `setStatus`/`setWidget`: skills that publish status while working.
7. Close the app while a `confirm` modal is open → verify pi doesn't hang
   (check pi's own logs).

### Automated
- Vitest: BlockerTracker transitions, response validation, shutdown cancellation
  logic (with mocked SDK).
- Playwright: end-to-end for each method (T14).

### Success criteria
- Every known `method` renders a correct modal.
- Response reaches pi (verified via pi log or subsequent `agent_end`).
- Session state transitions correctly: Working → Waiting → Working.
- Toast appears within 500ms of blocker arrival on a background window.
- Shutdown with open blockers doesn't leak pi processes; pi logs show clean cancellation.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `notify` message shapes differ across pi versions and we mis-render | Fallback modal (T13) handles anything we don't know. |
| Multiple blockers arrive in a tight burst → modal thrashing | Modal queue (T11) — one at a time. |
| User dismisses a `secure: true` input with a screenshot open | We mask the input; document that we don't scrub RAM or clipboard. |
| Windows toast API not initialised → silent notifications | `AppUserModelID` set at startup; smoke test verifies a real toast fires on a real Windows box. |
| Response shape mismatch → pi rejects | T04 validates shape against the recorded request method before send. |

## Time estimate

~4-5 days. The modal components are straightforward; the tricky parts are the
BlockerTracker semantics and shutdown cancellation timing.

## Exit criteria

- All modal methods demoable against real pi workflows.
- Playwright test covers happy path + shutdown-cancel path.
- Zero pi-child leaks after 20 open-close cycles that include unanswered blockers.
- Ready to start Phase 3 (multi-project tabs and persistence).

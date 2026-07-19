# Vision and Requirements

## Vision

A Windows desktop app that hosts many GSD (pi) coding sessions in parallel — one per
project — and surfaces attention only when needed. Sessions run continuously, survive
reboots, and progress autonomously via pi's auto-mode. The user glances at the app
to see which sessions are stuck, which need input, and how far each has progressed.
They open a session tab only when they want to interact.

The mental model is: **many long-running background workers, a lightweight foreground UI.**

## Requirements (must-haves)

### R1 — Multi-session, tabbed
Multiple concurrent GSD sessions in one app. Each session is bound to one project
directory. Tabs inside a window, plus the ability to detach a tab into a new window.
See [ADR-006](./decisions/ADR-006-tabs-with-detach.md).

### R2 — Full persistence across reboots
Every session survives app quit, machine reboot, and pi child crashes. On relaunch:
- All previously open tabs restore.
- Each tab reconnects to its pi session file (`.gsd/sessions/…`) and resumes the same conversation.
- If auto-mode was running when we shut down, we prompt to resume it.

See [30-persistence.md](./30-persistence.md).

### R3 — Session state at a glance
Every session shows one of five clear visual states in the tab bar and system tray:
- **Working** — agent is actively producing output (streaming or tool call in flight)
- **Waiting on you** — `extension_ui_request` pending, session blocked
- **Idle** — turn complete, awaiting a prompt
- **Stopped / crashed** — pi child exited, needs restart
- **Auto-running** — in auto-mode, driving itself

State transitions produce OS-level notifications (Windows toast) and taskbar/tray
badges for **Waiting on you** and **Stopped**. See [40-ui-design.md](./40-ui-design.md).

### R4 — Auto-run with clean progression UI
When a session is in `/gsd auto`, show the current milestone → slice → task tree
with checkboxes, current position, and estimated remaining work. Live progression
comes from `tool_use` events (`gsd_plan_*`, `gsd_task_complete`, `gsd_slice_complete`)
plus periodic reads of `.gsd/gsd.db` via `gsd_milestone_status`. See
[50-auto-run-view.md](./50-auto-run-view.md).

### R5 — Simple access to GSD commands
A command palette (Ctrl+Shift+P) that lists pi's slash commands (`/gsd`, `/gsd auto`,
`/login`, `/compact`, etc.) sourced live from the `get_commands` RPC. Selecting a
command sends the appropriate `prompt` or `bash` call. See [40-ui-design.md](./40-ui-design.md#command-palette).

### R6 — Model swap
A model picker in the session header showing the current provider + model. Populated
via `get_available_models`. Swap via `set_model` — takes effect on the next turn.
See [60-model-and-context.md](./60-model-and-context.md).

### R7 — Currently selected model + context window utilization
The session header always shows:
- `provider/model-id` (e.g. `anthropic/claude-sonnet-4-5`)
- A utilization gauge: `tokens_total / model.contextWindow`, colour-coded
  (green < 60%, amber 60-85%, red > 85%). Live-updated from `cost_update` events
  and `get_session_stats`.

### R8 — GitHub Copilot login
Support pi's browser-based Copilot login. The wrapper delegates: it triggers pi's
`/login` flow, watches for the URL blocker event, opens the URL in the system
browser, and reflects login state back in the UI. See [70-auth-github-copilot.md](./70-auth-github-copilot.md)
and [ADR-003](./decisions/ADR-003-delegate-auth-to-pi.md).

### R9 — Forward-compatible with newer pi versions
The wrapper must keep working when pi is updated. We depend only on:
- The stable RPC v2 contract (`RpcCommand`, `RpcResponse`, `SdkAgentEvent`).
- Feature-detection via the `init` handshake's `capabilities` field.
- The public `.gsd/` layout (roadmaps, plans, summaries — well documented).

We avoid: private CLI flags, TUI scraping, internal pi module imports, direct
sqlite reads. See [80-forward-compatibility.md](./80-forward-compatibility.md)
and [ADR-005](./decisions/ADR-005-forward-compatibility-strategy.md).

### R10 — Windows desktop for v1
Windows 10/11 is the only supported target for v1. macOS/Linux come later. Uses
Windows toast notifications, taskbar overlay icons, jump lists, and system tray.
See [90-tech-stack.md](./90-tech-stack.md).

### R11 — Thin shell, user-installed pi
The app does not bundle the `gsd` CLI or a Node runtime. On first launch we detect
`gsd` on `PATH`; if missing, we guide the user through installing pi. Sessions,
`.gsd/` folders, and auth (including Copilot tokens) are shared with any TUI use
of pi on the same machine. See [ADR-007](./decisions/ADR-007-no-bundled-pi.md).

## Non-requirements (explicit)

- **Not a replacement for pi's TUI.** Power users will still use the TUI directly
  for one-off work. The desktop shell targets long-running multi-project workflows.
- **Not a code editor.** File editing happens in the user's IDE. We show diffs and
  tool outputs, not an editor pane.
- **No cloud sync in v1.** Sessions live on the local disk (where pi puts them).
- **No custom prompt engineering / agent tuning.** The shell surfaces pi as-is.

## Success signals for v1

- Can open 5 project tabs, kick off `/gsd auto` on 3 of them, close the app, reboot,
  and see all 5 tabs restore with auto-mode still going on the same 3.
- When one of those 3 sessions raises a `select` blocker, a Windows toast appears
  within 1 second and the tab shows a red badge.
- Answering the blocker via the app resumes the session without ever opening a terminal.
- The user can pick GitHub Copilot as a provider entirely through the GUI.

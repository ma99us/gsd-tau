# gsd-tau — Design Documentation

> A Windows desktop shell over headless GSD (pi) sessions.

A native-feeling desktop app that wraps `@opengsd/gsd-pi` so you can drive multiple
concurrent GSD coding sessions across projects without the pi TUI. Sessions are
long-lived, survive reboots, and surface **when the agent needs you** so you can
run many in parallel and only pay attention when it matters.

## Reading order

For someone new to the project, read in this order:

1. **[00-vision-and-requirements.md](./00-vision-and-requirements.md)** — what we're building and the hard requirements it must satisfy.
2. **[10-architecture.md](./10-architecture.md)** — process model, module boundaries, IPC topology.
3. **[20-pi-integration.md](./20-pi-integration.md)** — how we talk to pi via the RPC client, event stream, command surface.
4. **[30-persistence.md](./30-persistence.md)** — what survives reboots, what pi already stores, what we own.
5. **[40-ui-design.md](./40-ui-design.md)** — window/tab model, session states, notifications, tray integration.
6. **[50-auto-run-view.md](./50-auto-run-view.md)** — milestone/slice/task progression view for `/gsd auto`.
7. **[60-model-and-context.md](./60-model-and-context.md)** — model picker, context-window utilization gauge.
8. **[70-auth-github-copilot.md](./70-auth-github-copilot.md)** — Copilot browser login flow.
9. **[80-forward-compatibility.md](./80-forward-compatibility.md)** — how the shell stays working as pi evolves.
10. **[90-tech-stack.md](./90-tech-stack.md)** — framework, packaging, Windows specifics.

## Decisions

Locked-in architectural decisions live in [`decisions/`](./decisions/) as ADRs:

- [ADR-001](./decisions/ADR-001-use-rpc-client.md) — Drive pi via `@opengsd/rpc-client`, not by scraping the TUI.
- [ADR-002](./decisions/ADR-002-electron-over-tauri.md) — Use Electron over Tauri for v1.
- [ADR-003](./decisions/ADR-003-delegate-auth-to-pi.md) — Delegate Copilot auth to pi's built-in `/login`.
- [ADR-004](./decisions/ADR-004-progression-from-tools-and-fs.md) — Derive GSD progression from `tool_use` events + `.gsd/` filesystem, not from typed RPC events.
- [ADR-005](./decisions/ADR-005-forward-compatibility-strategy.md) — Depend only on the stable RPC contract; feature-detect via `init` capabilities.
- [ADR-006](./decisions/ADR-006-tabs-with-detach.md) — Tabs inside one window, with detach-to-new-window.
- [ADR-007](./decisions/ADR-007-no-bundled-pi.md) — Do not bundle the `gsd` binary; require the user to install pi separately.

## Plan

Work is sequenced in [`plan/`](./plan/):

- [ROADMAP.md](./plan/ROADMAP.md) — the whole build in phase order.
- [PHASE-1-session-manager.md](./plan/PHASE-1-session-manager.md) — headless SessionManager + one-project prototype.
- [PHASE-2-ui-request-bridge.md](./plan/PHASE-2-ui-request-bridge.md) — modal bridge for pi's `extension_ui_request` blockers.
- [PHASE-3-project-and-session-switcher.md](./plan/PHASE-3-project-and-session-switcher.md) — multi-project tabs, session list, resume.

Later phases (auto-run view, model picker, Copilot login, notifications, tray) are
sketched in ROADMAP.md and get their own docs when we get there.

## Glossary

- **pi** — `@opengsd/gsd-pi`, the coding agent engine we wrap. Ships as an npm package with a `gsd` CLI.
- **RPC** — pi's JSON stdio protocol (v2), consumed via `@opengsd/rpc-client`.
- **Session** — one running pi child process, bound to one project directory (`cwd`) and one conversation history.
- **Project** — a directory on disk (usually a git repo) with a `.gsd/` folder pi manages.
- **Blocker** — an `extension_ui_request` event where pi is waiting for the user to answer a question. The session is stopped until we respond.
- **Auto-mode** — pi's autonomous milestone/slice/task loop (`/gsd auto`), where the agent drives itself for hours.

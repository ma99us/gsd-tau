# AGENTS.md

Instructions for AI coding agents working on **gsd-tau** — a Windows Electron
desktop shell over headless [`@opengsd/gsd-pi`](https://www.npmjs.com/package/@opengsd/gsd-pi)
sessions. Read the sections that match your task; skip the rest.

## What this project is

Thin Electron app that spawns `gsd --mode rpc` per project, talks to it via
`@opengsd/rpc-client`, and renders a chat-first UI. pi is user-installed on
PATH — we do **not** bundle it. Multiple concurrent sessions across tabs and
windows, survives reboots.

**Config dir:** `%APPDATA%\gsd-tau\`. **AppUserModelID:** `io.opengsd.gsd-tau`.
**pi min version:** 1.11.0.

**Repo status:** design-only. No source code yet. Phase 1 is the first coding
work — see [docs/plan/PHASE-1-session-manager.md](./docs/plan/PHASE-1-session-manager.md).
Before adding any code, confirm which phase it belongs to.

## Core rules (always apply)

- **Shell: PowerShell 7+ (`pwsh`), not WSL/bash.** Windows-native. Invoke via
  `pwsh -NoProfile -Command "..."`. Write scripts as `.ps1`. GitHub Actions
  jobs on Windows runners use `shell: pwsh`.
- **Never touch `.gsd/gsd.db` directly.** WAL-locked single-writer. Use
  `gsd_milestone_status` via `client.bash({ excludeFromContext: true })`.
- **Never spawn `gsd` without `--mode rpc`.** No TUI scraping.
- **Never import from pi's private modules** (`packages/pi-*/dist/*`). Public
  surface only: `@opengsd/rpc-client`, `@opengsd/contracts` (types).
- **Never reimplement Copilot auth.** Delegate to pi's `/login`. Never touch
  `%USERPROFILE%\.gsd\auth.json`.
- **SessionManager lives in main process.** Renderer never spawns children or
  touches `.gsd/`. All access via IPC.
- **Read before edit or write.** `read` before `edit`, verify path before `write`.
- **pi lives at** `C:/nvm4w/nodejs/node_modules/@opengsd/gsd-pi/`. Use forward
  slashes for the `read` tool; use the same path with backslashes in `pwsh`.

## Where things live

```
docs/
├── README.md                    ← reading order + non-requirements
├── 00-vision-and-requirements.md
├── 10-architecture.md
├── 20-pi-integration.md
├── 30-persistence.md
├── 40-ui-design.md
├── 50-auto-run-view.md
├── 60-model-and-context.md
├── 70-auth-github-copilot.md
├── 80-forward-compatibility.md
├── 90-tech-stack.md
├── decisions/ADR-001..007-*.md
└── plan/
    ├── ROADMAP.md               ← 13 phases sequenced
    ├── PHASE-1-session-manager.md
    ├── PHASE-2-ui-request-bridge.md
    └── PHASE-3-project-and-session-switcher.md
```

Source code layout is defined in [docs/10-architecture.md](./docs/10-architecture.md)
under the module map — read that once before creating new files.

---

## If you are… (conditional reading)

### …starting fresh and need the whole picture
Read in order: [docs/README.md](./docs/README.md) →
[00-vision-and-requirements.md](./docs/00-vision-and-requirements.md) →
[10-architecture.md](./docs/10-architecture.md) →
[plan/ROADMAP.md](./docs/plan/ROADMAP.md).
That's ~30 min and covers 80% of decisions.

### …picking a phase to work on
[docs/plan/ROADMAP.md](./docs/plan/ROADMAP.md) lists all 13 phases with
dependencies. Phases 1-3 have full plans; later phases are sketched in the
roadmap and get their own doc when work starts. Do not skip ahead — phase
dependencies are real.

### …spawning or driving pi
[docs/20-pi-integration.md](./docs/20-pi-integration.md) — RPC command surface,
event pump patterns, `--mode rpc` transport, version pinning, capabilities
probing. Especially the "what we skip" section: MCP mode, `terminal_input`,
daemon package, pi extensions API.

### …handling `extension_ui_request` (blockers)
[docs/40-ui-design.md](./docs/40-ui-design.md) for the flow,
[docs/plan/PHASE-2-ui-request-bridge.md](./docs/plan/PHASE-2-ui-request-bridge.md)
for the implementation plan. Shutdown MUST cancel every open blocker or pi hangs.

### …working on session state, tabs, or windows
[docs/10-architecture.md](./docs/10-architecture.md) for the process model,
[docs/40-ui-design.md](./docs/40-ui-design.md) for window/tab semantics,
[ADR-006](./docs/decisions/ADR-006-tabs-with-detach.md) for why tabs+detach.
Sessions are process-level, windows are views — closing a window ≠ closing sessions.

### …working on persistence, restore, or the registry
[docs/30-persistence.md](./docs/30-persistence.md) — schema, atomic writes,
relaunch flow, `wasAutoRunning` heuristic, cleanup policy. Read the rule about
not duplicating anything pi already persists before adding fields.

### …building the milestone/slice/task progress panel
[docs/50-auto-run-view.md](./docs/50-auto-run-view.md) and
[ADR-004](./docs/decisions/ADR-004-progression-from-tools-and-fs.md).
Path A (live from `tool_use` events) + Path B (`gsd_milestone_status`
reconciliation). No direct DB reads.

### …building the model picker or context gauge
[docs/60-model-and-context.md](./docs/60-model-and-context.md). Values come
from `get_state`, `get_available_models`, `get_session_stats`, and live
`cost_update` events. Never guess a context window — fall through to a raw
token count if `ModelInfo.contextWindow` is missing.

### …touching GitHub Copilot or provider login
[docs/70-auth-github-copilot.md](./docs/70-auth-github-copilot.md) and
[ADR-003](./docs/decisions/ADR-003-delegate-auth-to-pi.md). We render a
specialised modal when we detect the device-code shape in a `notify` request.
That is the entire extent of our auth code.

### …deciding what to depend on from pi
[docs/80-forward-compatibility.md](./docs/80-forward-compatibility.md) and
[ADR-005](./docs/decisions/ADR-005-forward-compatibility-strategy.md).
Three-tier feature detection (`init.capabilities` → `get_commands` → graceful
error). Explicit list of non-dependencies. Read before adding any new pi call.

### …picking libraries, Windows integrations, or packaging
[docs/90-tech-stack.md](./docs/90-tech-stack.md). Electron + Vite + React +
Zustand + Radix + Tailwind. electron-builder for NSIS installer. Don't add
native modules without a very strong reason.

### …locating the `gsd` binary on the user's machine
[docs/90-tech-stack.md](./docs/90-tech-stack.md) — see the resolution ladder
section. If not found, block startup with a guided setup screen (Phase 11).

### …wondering why we made choice X
Check [docs/decisions/](./docs/decisions/):
- [ADR-001](./docs/decisions/ADR-001-use-rpc-client.md) — RPC client SDK, not TUI scrape / MCP / `--print`
- [ADR-002](./docs/decisions/ADR-002-electron-over-tauri.md) — Electron over Tauri
- [ADR-003](./docs/decisions/ADR-003-delegate-auth-to-pi.md) — delegate Copilot auth
- [ADR-004](./docs/decisions/ADR-004-progression-from-tools-and-fs.md) — progression from tool events
- [ADR-005](./docs/decisions/ADR-005-forward-compatibility-strategy.md) — feature-detect everything
- [ADR-006](./docs/decisions/ADR-006-tabs-with-detach.md) — tabs with detach-to-window
- [ADR-007](./docs/decisions/ADR-007-no-bundled-pi.md) — user installs pi separately

If your change would contradict an ADR, don't just do it — flag for discussion.

### …explicitly out of scope for v1
[docs/00-vision-and-requirements.md](./docs/00-vision-and-requirements.md)
lists non-requirements at the bottom. Highlights:
macOS/Linux, pi extension bundling, MCP mode, embedded terminal (pty),
dashboard panes with roadmap/decisions/requirements viewers, cross-project
search, multi-account provider UI. Push back if asked to add these before
v1 ships.

## Verification expectations

Every phase doc has a "Verification" section with manual + automated criteria.
Phase gate: all listed manual scenarios pass and Playwright smoke suite is
green. Don't mark work complete without running the verification.

## When to update this file

Add a new "If you are…" section when a new subsystem gets a design doc.
Keep total under 200 lines — this is a router, not documentation.

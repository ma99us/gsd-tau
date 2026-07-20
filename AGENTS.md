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

**Repo status:** planning complete. Phases 1–3 are fully pre-planned as GSD
milestones M002–M004 with tasks. Start coding with `gsd auto` targeting M002
(Phase 1 — Session Manager). No source code exists yet.

See `.gsd/phases/02-.../02-CONTEXT.md` for M002 execution context. All
decisions are captured there — do not re-derive from scratch.

## Core rules (always apply)

- **Shell: PowerShell 7+ (`pwsh`), not WSL/bash.** Windows-native. Invoke via
  `pwsh -NoProfile -Command "..."`. Write scripts as `.ps1`. GitHub Actions
  jobs on Windows runners use `shell: pwsh`.
- **Never touch `.gsd/gsd.db` directly.** WAL-locked single-writer. Use
  `gsd_milestone_status` (GSD tool). Do NOT query via sqlite3 or node.
- **Shell ops: prefer `pwsh -NoProfile -Command "..."`.** `bash` and `bg_shell`
  tools work but PowerShell is the project standard. For scripts that need
  node APIs alongside shell calls, use `gsd_exec runtime:node` +
  `execSync('pwsh ...', { encoding: 'utf8', cwd, timeout })`. pwsh 7.6.3 confirmed.
- **Never spawn `gsd` without `--mode rpc`.** No TUI scraping.
- **Never import from pi's private modules** (`packages/pi-*/dist/*`). Public
  surface only: `@opengsd/rpc-client`, `@opengsd/contracts` (types).
- **Never reimplement Copilot auth.** Delegate to pi's `/login`. Never touch
  `%USERPROFILE%\.gsd\auth.json`.
- **SessionManager lives in main process.** Renderer never spawns children or
  touches `.gsd/`. All access via IPC.
- **Read before edit or write.** `read` before `edit`, verify path before `write`.
- **pi lives at** `C:/nvm4w/nodejs/node_modules/@opengsd/gsd-pi/`. Forward
  slashes for the `read` tool; backslashes for pwsh. RPC contract:
  `C:/nvm4w/nodejs/node_modules/@opengsd/gsd-pi/packages/contracts/dist/rpc.d.ts`
  — read with the `read` tool; never bundle or import it in source code.
- **GSD milestone IDs:** M001 (unused stub), **M002** = Phase 1, **M003** = Phase 2,
  **M004** = Phase 3. Check `gsd_milestone_status` before starting a milestone.

## Where things live

```
docs/
├── README.md                    ← reading order + non-requirements
├── 00-vision-and-requirements.md
├── 05-onboarding.md             ← first-run, [+] flyout, session lifecycle
├── 10-architecture.md
├── 11-error-handling.md         ← error taxonomy, recovery paths, UI treatment
├── 12-logging.md                ← electron-log, rotation, structured format
├── 13-security.md               ← Electron baseline, IPC hardening, threat model
├── 15-ipc-bridge.md             ← window.gsd.* preload API surface
├── 20-pi-integration.md
├── 30-persistence.md
├── 40-ui-design.md              ← session header, git status bar, tray
├── 41-design-system.md          ← token layer, theming, cva(), components
├── 42-settings.md               ← settings schema, global+per-project overrides
├── 45-chat-experience.md        ← message anatomy, slash commands, 85% nudge
├── 46-session-export.md         ← Markdown/JSON export, UI entry points
├── 50-auto-run-view.md
├── 60-model-and-context.md      ← model picker, thinking level, context selector
├── 65-copilot-quota.md
├── 70-auth-github-copilot.md
├── 80-forward-compatibility.md
├── 90-tech-stack.md
├── 91-auto-update.md            ← electron-updater, channels, install prompt
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

### …writing any IPC channel or preload method
[docs/15-ipc-bridge.md](./docs/15-ipc-bridge.md) — the full `window.gsd.*`
namespaced API surface. Add new channels here first, then implement.

### …building settings storage or UI
[docs/42-settings.md](./docs/42-settings.md) — schema, global + per-project
overrides, effective merge, runtime propagation, settings screen layout.

### …building the chat pane, composer, or slash commands
[docs/45-chat-experience.md](./docs/45-chat-experience.md) — message anatomy,
tool cards, streaming, scroll behaviour, slash commands, context-full 85% nudge.

### …building the thinking level or context window controls
[docs/60-model-and-context.md](./docs/60-model-and-context.md) — thinking level
chip and context window tier selector live in the session header. Only show
controls when `ModelInfo` confirms the model supports them.

### …adding logging to any subsystem
[docs/12-logging.md](./docs/12-logging.md) — canonical context names, what is
never logged (message content, credentials), renderer log IPC bridge.

### …touching error states or recovery flows
[docs/11-error-handling.md](./docs/11-error-handling.md) — error taxonomy,
UI treatment per error class, recovery path for pi crashes (manual retry only).

### …touching first-run, project open, or session restore
[docs/05-onboarding.md](./docs/05-onboarding.md) — first-run empty state,
`[+]` flyout (Open/Browse/Create/Recents), new-project creation dialog (§4.8),
session close and restore lifecycle, keyboard shortcuts.

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

### …building the Copilot quota widget or quota service
[docs/65-copilot-quota.md](./docs/65-copilot-quota.md) — full design: API
endpoint, auth token source, polling cadence, rolling history schema,
projection logic, header widget + popover layout, failure modes, and phase
placement. Quota is account-wide (not per session). The service is always-on;
it lives in main process and fans out to all open renderers via IPC.

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

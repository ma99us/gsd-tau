# Roadmap

Phases are sequenced by dependency and risk. Each phase produces a runnable app;
we don't ship dark code. Requirement IDs link back to
[00-vision-and-requirements.md](../00-vision-and-requirements.md).

## Phase 1 — Session Manager & one-project prototype

**Doc:** [PHASE-1-session-manager.md](./PHASE-1-session-manager.md)
**Requirements advanced:** R1 (partial), R11
**Goal:** Prove we can spawn a pi child, prompt it, stream events, and shut down
cleanly. Minimal Electron shell with one hardcoded project. Chat pane renders
messages and tool cards. No modals yet, no persistence yet, no tabs.

Demo: launch the app, chat with pi against a fixed test repo, close cleanly.

## Phase 2 — UI-request bridge

**Doc:** [PHASE-2-ui-request-bridge.md](./PHASE-2-ui-request-bridge.md)
**Requirements advanced:** R3 (Waiting-on-you state), R5 (partial)
**Goal:** Handle every `extension_ui_request` method with a matching modal.
Ensure shutdown-with-open-blocker sends cancellations. Add basic Windows toast
notification for blockers.

Demo: run a pi flow known to raise a blocker (e.g. `/gsd` on a fresh repo, which
prompts for setup); answer via GUI; verify pi continues.

## Phase 3 — Multi-project tabs, persistence, resume

**Doc:** [PHASE-3-project-and-session-switcher.md](./PHASE-3-project-and-session-switcher.md)
**Requirements advanced:** R1, R2, R5 (Open Project flyout)
**Goal:** Tab bar. Open Project flyout with recents + file picker. Registry file.
Restore tabs + sessions on relaunch via `switch_session`. Single-instance lock.

Demo: open three projects in three tabs, quit, relaunch, all three restore with
conversation history intact.

---

## Later phases (sketches — get their own docs when we start them)

### Phase 4 — Model picker + context gauge
**Requirements:** R6, R7. See [60-model-and-context.md](../60-model-and-context.md).

Header component with live model + gauge + cost. Model picker dropdown. Set/cycle
model + thinking level.

### Phase 5 — Command palette
**Requirements:** R5 (full). See [40-ui-design.md](../40-ui-design.md#command-palette).

`Ctrl+Shift+P` palette merging app commands and pi slash commands. `/` in
composer opens the palette scoped to slash commands.

### Phase 6 — Auto-run panel
**Requirements:** R4. See [50-auto-run-view.md](../50-auto-run-view.md).

Progress tracker (Path A live from tool events + Path B reconciliation via
`gsd_milestone_status`). Panel UI with milestone/slice/task tree.

### Phase 7 — Notifications, tray, taskbar polish
**Requirements:** R3 (full). See [40-ui-design.md](../40-ui-design.md#notifications-and-tray).

Windows toasts, tray icon with aggregate badge, taskbar overlay icons per window,
"Close last window → minimise to tray" behaviour.

### Phase 8 — GitHub Copilot login + provider onboarding
**Requirements:** R8. See [70-auth-github-copilot.md](../70-auth-github-copilot.md).

First-run provider-choice screen. Special Copilot login modal with device code
+ URL detection. "Sign out" menu.

### Phase 9 — Detach-to-window + multi-window management
**Requirements:** R1 (full). See [ADR-006](../decisions/ADR-006-tabs-with-detach.md).

Drag tab out of tab bar → new window. Move-to-window right-click menu. Window
bounds persisted per window.

### Phase 10 — Auto-resume prompt + auto-mode tracking
**Requirements:** R2 (full), R4 (persistence side).

Persist `wasAutoRunning`. Restore banner "Auto-mode was running. Resume?".

### Phase 11 — Version detection UI + guided pi install
**Requirements:** R9, R11 (full). See [80-forward-compatibility.md](../80-forward-compatibility.md).

First-run guided setup when `gsd` not on PATH. Incompatible-version screen.
Session settings pane showing pi version.

### Phase 12 — Packaging, signing, auto-updater
**Requirements:** R10.

electron-builder NSIS installer. Auto-updater via GitHub Releases. Signed builds.

### Phase 13 (stretch) — Dashboard panes
Deferred: optional Roadmap / Decisions / Requirements panes per session tab.

## Phase gate criteria

Each phase closes when:

1. All requirements listed above are demonstrable in the running app.
2. A short SUMMARY.md is written to `docs/plan/summaries/PHASE-N.md`.
3. Manual test scenarios in the phase doc pass.
4. Automated smoke tests in CI still pass.

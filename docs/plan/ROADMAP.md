# Roadmap

Phases are sequenced by dependency and risk. Each phase produces a runnable app;
we don't ship dark code. Requirement IDs link back to
[00-vision-and-requirements.md](../00-vision-and-requirements.md).

## Phase 1 — Session Manager & one-project prototype ✅

**Doc:** [PHASE-1-session-manager.md](./PHASE-1-session-manager.md)
**Milestone:** M002 (complete 2026-07-20)
**Requirements advanced:** R1 (partial), R11
**Goal:** Prove we can spawn a pi child, prompt it, stream events, and shut down
cleanly. Minimal Electron shell with one hardcoded project. Chat pane renders
messages and tool cards. No modals yet, no persistence yet, no tabs.

Demo: launch the app, chat with pi against a fixed test repo, close cleanly.

## Phase 2 — UI-request bridge ✅

**Doc:** [PHASE-2-ui-request-bridge.md](./PHASE-2-ui-request-bridge.md)
**Milestone:** M003 (complete 2026-07-21)
**Requirements advanced:** R3 (Waiting-on-you state), R5 (partial)
**Goal:** Handle every `extension_ui_request` method with a matching modal.
Ensure shutdown-with-open-blocker sends cancellations. Add basic Windows toast
notification for blockers.

Demo: run a pi flow known to raise a blocker (e.g. `/gsd` on a fresh repo, which
prompts for setup); answer via GUI; verify pi continues.

## Phase 3 — Multi-project tabs, persistence, resume ✅

**Doc:** [PHASE-3-project-and-session-switcher.md](./PHASE-3-project-and-session-switcher.md)
**Milestone:** M004 (complete 2026-07-21)
**Requirements advanced:** R1, R2, R5 (Open Project flyout)
**Goal:** Tab bar. Open Project flyout with recents + file picker. Registry file.
Restore tabs + sessions on relaunch via `switch_session`. Single-instance lock.

Demo: open three projects in three tabs, quit, relaunch, all three restore with
conversation history intact.

## Phase 4 — Model picker, context gauge, Copilot quota widget ✅

**Milestone:** M005 (complete 2026-07-21)
**Requirements:** R6, R7. See [60-model-and-context.md](../60-model-and-context.md),
[65-copilot-quota.md](../65-copilot-quota.md).

Header component with live model + gauge + cost. Model picker dropdown. Set/cycle
model + thinking level. Always-on quota service: polls `copilot_internal/user`
every 15 min, maintains rolling history in `%APPDATA%\gsd-tau\quota-history.json`,
computes burn-rate projections. Compact header widget + click-to-expand popover.
Calendar-day projections only.

**What was built:** `SessionHeaderBar`, `ModelPickerDropdown`, `ThinkingLevelChip`,
`ContextGauge`, `QuotaWidget`. `QuotaService` and `QuotaHistory` main-process
services. Full IPC surface for model/thinking/stats/quota. 859 unit tests green.

---

## Later phases (sketches — get their own docs when we start them)

### Phase 5 — Command palette ✅
**Requirements:** R5 (full). Milestone: M006 (planned).
See [40-ui-design.md](../40-ui-design.md#command-palette).

`Ctrl+Shift+P` global overlay merging static app commands with pi slash commands
(fetched via `get_commands` RPC, `RpcSlashCommand` type with `name`, `description`,
`source: "extension"|"prompt"|"skill"`, optional `location` and `path`).
Fuzzy match, MRU-boosted, arrow-key nav. Selecting a pi command sends it as a
`prompt()` starting with `/`; app commands execute their bound action.

Note: `Composer.tsx` already has a `/` slash-picker (slash commands + `/model`
routing). Phase 5 builds the **global** `Ctrl+Shift+P` palette as a separate
overlay component; the composer picker may share its filtered list logic but is
not replaced.

Keyboard shortcuts wired in this phase: `Ctrl+Shift+P` (palette), `Ctrl+.`
(model picker — links to existing `ModelPickerDropdown`), `Ctrl+K` (focus
composer), `Ctrl+/` (toggle auto-run panel — stubbed since panel comes in Phase 6).

**What was built:** `CommandPalette` (renderer/components/CommandPalette.tsx),
`useAppCommands`/`usePiCommands`/`useMRU`/`fuzzyMatch` hooks. Wired into `App.tsx`
with all four keyboard shortcuts above.

### Phase 6 — Auto-run panel ✅
**Requirements:** R4. See [50-auto-run-view.md](../50-auto-run-view.md).

Progress tracker (Path A live from tool events + Path B reconciliation via
`gsd_milestone_status`). Panel UI with milestone/slice/task tree.

**What was built:** `ProgressTracker` + `reconcileProgress` (main/session/),
`AutoRunPanel` component wired into `SessionView.tsx`, shown whenever a
milestone is active. Pause/Refresh/Open-Roadmap actions wired to IPC.

### Phase 7 — Notifications, tray, taskbar polish ✅

**Requirements:** R3 (full). See [40-ui-design.md](../40-ui-design.md#notifications-and-tray).

Windows toasts, tray icon with aggregate badge, taskbar overlay icons per window,
"Close last window → minimise to tray" behaviour.

**What was built:** `TrayManager` (main/os/tray.ts) instantiated and kept in
sync via a session-state-change callback threaded through `registerHandlers`;
`showBlockerToast`/`showStoppedToast`/`showMilestoneCompleteToast` (main/os/notifications.ts)
already wired into the event pipeline. Per-window taskbar overlay icon (red
"waiting" / amber "stopped") via `BrowserWindow.setOverlayIcon`. The window
`close` handler now minimises to tray instead of quitting; only `before-quit`
(tray "Quit", app-wide quit) tears sessions down and exits.

### Phase 8 — GitHub Copilot login + provider onboarding (partial)
**Requirements:** R8. See [70-auth-github-copilot.md](../70-auth-github-copilot.md).

First-run provider-choice screen. Special Copilot login modal with device code
+ URL detection. "Sign out" menu.

**What was built:** `CopilotLoginModal` (renderer/components/modals/) + the
`parseDeviceCodeNotify`/`classifyLoginStatus` heuristics (renderer/hooks/detectDeviceCode.ts)
wired into `SessionView.tsx`'s `notify` handler — detects pi's device-code
shape, shows the code/URL/Open-browser overlay, tracks pending → success/failure
via follow-up notifies. Added `window.gsd.openExternal()` IPC bridge
(`shell.openExternal`) for the "Open browser" button.
**Not yet built:** first-run provider-choice screen (only matters once a
session can have zero configured providers — no such onboarding flow exists
yet) and the "Sign out" menu item (`/logout github-copilot`).

### Phase 9 — Detach-to-window + multi-window management
**Requirements:** R1 (full). See [ADR-006](../decisions/ADR-006-tabs-with-detach.md).

Drag tab out of tab bar → new window. Move-to-window right-click menu. Window
bounds persisted per window.

### Phase 10 — Auto-resume prompt + auto-mode tracking ✅
**Requirements:** R2 (full), R4 (persistence side).

Persist `wasAutoRunning`. Restore banner "Auto-mode was running. Resume?".

**What was built:** `wasAutoRunning` persisted per session in the registry
(`main/session/session-manager.ts`), carried over on `restore()`, and set by
the existing `agent_start`/`agent_end` handling in `registerHandlers`.
`SessionManager.clearWasAutoRunning()` + the `dismissAutoResume` IPC/preload
bridge clear it once the user acts. `AutoResumeBanner` (renderer/components/)
wired into `SessionView.tsx` — shown whenever `wasAutoRunning` is true for the
tab and not yet locally dismissed; "Resume auto" sends `/gsd auto` as a
`prompt()` and clears the flag, "Dismiss" only clears the flag.


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

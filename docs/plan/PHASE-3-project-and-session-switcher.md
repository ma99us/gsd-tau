# Phase 3 — Multi-project Tabs, Persistence, Resume

**Goal:** Turn the app from "one session prototype" into "a real desktop shell
you can leave open across reboots." Tab bar with multiple concurrent sessions.
Open Project flyout with recents + folder picker + drag-drop. Registry file at
`%APPDATA%\gsd-tau\registry.json`. On relaunch, restore tabs and reattach
sessions via `switch_session`.

**Requirements advanced:** R1 (full), R2 (partial — reboot survival; auto-mode
resume prompt comes in Phase 10), R5 (Open Project affordance).

**Non-goals for this phase:** detach-to-window (Phase 9), tray icon (Phase 7),
auto-mode UI (Phase 6), model picker (Phase 4).

## Deliverables

1. `main/persistence/registry-store.ts` — atomic JSON reader/writer with `.bak`
   fallback and debounced writes.
2. `main/session/session-manager.ts` upgrade: remove Phase-1 one-session limit;
   support N concurrent `RpcClient`s.
3. `main/pi/client-factory.ts` upgrade: `createClient({ cwd, sessionFile? })`;
   after `init`, if `sessionFile` provided, call `switch_session`.
4. `main/os/single-instance.ts` — `app.requestSingleInstanceLock`; second
   instance forwards its `--open-project` arg (if any) to the first.
5. `main/ipc/handlers.ts` additions: `listSessions`, `openProject`,
   `closeSession(sessionId, {forget?: boolean})`, `renameSession`.
6. `renderer/components/tab-bar.tsx` — tabs with left-click switch, middle-click
   close, right-click context menu, `[+]` opens Open Project flyout.
7. `renderer/components/open-project-flyout.tsx` — Recent projects list +
   Browse for folder + drop zone.
8. `renderer/state/session-store.ts` — Zustand store: sessions, active tab,
   subscribed events.
9. Restore-on-launch flow (per [30-persistence.md](../30-persistence.md#the-relaunch-flow)).
10. Missing-session-file handling: banner with Locate/Remove options.

## Tasks

- [ ] **T01: RegistryStore** — `load()`, `save()`, `.bak` rotation, atomic
  write via temp+rename. Schema version 1. Unit tests: corruption recovery,
  version mismatch, concurrent write coalescing.
- [ ] **T02: Registry schema types** — `SessionRecord`, `WindowRecord`,
  `RegistryV1` in `shared/types.ts`.
- [ ] **T03: SessionManager multi-session** — remove one-at-a-time restriction,
  add `open({ cwd, sessionFile? })` overload, `close({ forget })`, `list()`.
  Each session gets a stable internal id (`s_<random>`).
- [ ] **T04: Registry integration in SessionManager** — every `open`, `close`,
  `rename`, and state change schedules a debounced (500ms) registry write.
- [ ] **T05: `switch_session` on resume** — after `init` succeeds with a
  restored session, call `client.switch_session({ sessionPath })`. Handle
  failure by marking session Stopped with a "Session file missing" banner.
- [ ] **T06: Single-instance lock** — main process acquires lock; on collision,
  parse `argv` for `--open-project <path>` and forward via `second-instance`
  event; secondary instance exits 0.
- [ ] **T07: IPC handlers upgrade** — implement `listSessions`, `openProject`,
  `closeSession`, `renameSession`, plus fan-out of `sessions:registry` snapshot
  events.
- [ ] **T08: Zustand store** — `useSessionStore` with sessions map, active tab
  id, per-session event feed subscription. Selectors for the tab-bar and
  session-view components.
- [ ] **T09: Tab bar component** — renders sessions from store; states from
  `SessionUiState`; left/middle/right click behaviour; keyboard shortcuts
  (`Ctrl+Tab`, `Ctrl+W`, `Ctrl+T`, `Ctrl+1..9`); reorderable via drag within
  the bar (no cross-window drag yet — that's Phase 9).
- [ ] **T10: Open Project flyout** — Recents (from registry, MRU order, up to
  10), Browse for folder (Electron `dialog.showOpenDialog`), file drop zone on
  the whole window with visual feedback.
- [ ] **T11: Session view mounting** — the SessionView component takes a
  sessionId prop; unmounts cleanly on tab switch, remounts on tab focus. Chat
  state per-session lives in the Zustand store, not in component state.
- [ ] **T12: Restore-on-launch flow** — implement the sequence in
  [30-persistence.md#the-relaunch-flow](../30-persistence.md#the-relaunch-flow).
  Each restored tab shows "Restoring…" until its session hits Idle or Stopped.
- [ ] **T13: Missing-session-file banner** — tab shows a persistent banner with
  "Locate file" (opens folder picker to relink) and "Remove from list" buttons.
- [ ] **T14: Window bounds persistence** — save `{x, y, width, height}` on
  window close; restore on next launch.
- [ ] **T15: Playwright test** — open 3 projects, quit app, relaunch, verify
  all 3 tabs restore and each shows some prior conversation content.

## Verification

### Manual
1. Open project A → send a message → wait for response.
2. Open project B (new tab) → send different message.
3. Open project C (new tab).
4. Reorder tabs by drag.
5. Rename tab A via right-click → "New name" appears in tab.
6. Middle-click tab B → confirms closes (with "keep files?" — for Phase 3
   we just close and forget; more nuance in later phases).
7. Quit the app entirely (File → Quit).
8. Task Manager: verify all `gsd` child processes exited.
9. Relaunch app → verify A and C tabs restore with the correct names.
10. Click tab A → chat history renders (via `get_messages` on session attach).
11. Send a new prompt in A → agent responds normally.
12. Manually delete C's session file from `~/.gsd/sessions/` → relaunch →
    verify C's tab shows the missing-file banner.
13. Launch a second app instance with `gsd-tau.exe D:/some/other/repo` while
    the first is running → verify the first opens a new tab for that repo and
    the second exits.

### Automated
- Vitest: RegistryStore (atomicity, corruption recovery, migration paths),
  SessionManager multi-session lifecycle, Zustand selectors.
- Playwright T15 covers the full restore path.

### Success criteria
- 5 concurrent sessions run for 30 minutes without crashes or state divergence.
- Reboot cycle preserves tab set, active tab, and window bounds.
- No pi-child leaks after any of: normal quit, `Cmd+Q`, taskbar close, window
  X close (with multiple tabs open).
- Registry file never > 100 KB in realistic use.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `switch_session` on a restored client fails / has caveats we haven't hit | Fallback: spawn with `--continue` or `--resume <path>` CLI flag; test both paths in T05 and prefer whichever succeeds. |
| Registry corruption on unclean shutdown | `.bak` fallback + atomic write. Tests explicitly kill mid-write. |
| Race between session state changes and registry writes | All registry updates go through a single debounced writer in main process; no concurrent writers. |
| Tab drag & drop feels janky in Electron | Use a battle-tested drag lib (dnd-kit); scope drag to intra-window only in Phase 3. |
| User opens the same project in two tabs | On `openProject(cwd)`, if a session for that cwd already exists, focus it instead of spawning a duplicate. Add a "Duplicate as new session" option in the tab menu for the rare case they want two. |

## Time estimate

~1 week. Persistence + restore is finicky; the tab UI is standard.

## Exit criteria

- 5-tab reboot test passes reliably.
- Zero pi-child leaks across 30 open/quit/relaunch cycles.
- Manual walkthrough passes end-to-end.
- Ready for Phase 4 (model picker + context gauge) or Phase 6 (auto-run panel)
  — those two can be done in parallel by different work streams.

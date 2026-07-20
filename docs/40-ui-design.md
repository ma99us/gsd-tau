# UI Design

Chat-first for v1. The whole surface is: a tab bar, a session view with a chat pane
and header, modals for pi's UI-requests, a command palette, and the system tray.
Dashboard-style artifact panes come later ([00-vision R11 phasing](./00-vision-and-requirements.md)).

## Window and tab model

- **One main window** launched on app start. Contains a tab bar and one session
  view at a time.
- **Multiple windows** allowed. `File → New Window` or `Ctrl+Shift+N`. Each has
  its own tab set. Sessions themselves are shared across windows — a session
  can only be *displayed* in one tab at a time (moving it from window A to B
  transfers, doesn't clone).
- **Detach tab to new window**: drag the tab out of the tab bar (Chrome-style)
  or right-click → "Move to new window".
- **Close last window ≠ quit.** Closing the last window minimises the app to the
  system tray. Sessions keep running. Quit is `File → Quit` or tray menu → Quit.

See [ADR-006](./decisions/ADR-006-tabs-with-detach.md).

## Session states

Every session is always in exactly one of five UI states. This is a derived value
in the main process, computed by the state machine in `session/state-machine.ts`:

| State | Trigger | Tab badge | Toast? |
|---|---|---|---|
| **Working** | `agent_start` received, no blocker pending | Blue dot, subtle spin | No |
| **Waiting on you** | Any `extension_ui_request` pending | Red dot, tab pulses | **Yes** |
| **Idle** | `agent_end` received, no blocker, no auto-mode | None | No |
| **Auto** | Auto-mode heuristic (see [30-persistence.md](./30-persistence.md#wasautoruning--how-we-detect-it)) currently active | Green dot, small progress bar | Only on milestone complete |
| **Stopped** | pi child exited, RPC transport dead, or 30s watchdog timeout on `get_state` | Grey dot with `⚠` | **Yes** |

Transitions are logged (dev builds) so we can debug flaky state derivation.

## Tab bar

```
┌──────────────────────────────────────────────────────────────┐
│ [●] gsd-tau     [○] website-rewrite  [●!] api-refactor  [+]  │
└──────────────────────────────────────────────────────────────┘
   Auto/green     Idle/none            Waiting/red       New
```

- Left-click switches tabs. Middle-click closes. Drag to reorder or detach.
- Right-click menu: Rename, Close, Close and forget, Duplicate session, Fork
  from current turn, Move to new window, Reveal project in Explorer.
- The `[+]` button opens the **Open Project** flyout:
  - **Recent projects** (from registry, MRU order, max 10)
  - **Browse for folder…** (native folder picker)
  - **Drop a folder anywhere on the window** also works

## Session view — layout

```
┌──────────────────────────────────────────────────────────────┐
│  gsd-tau                     anthropic/claude-sonnet-4-5 ▼   │
│  D:/Projects/gsd-tau         Context ██████░░░░ 62%  $0.42   │
│  ⎇ main  ·  3 modified  ·  ↑2 unpushed                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [Auto-run panel — only shown in Auto state]                 │
│  M001 Real-time runtime hardening                            │
│    ✔ S01 Session manager                                     │
│    ▶ S02 UI-request bridge                                   │
│      ✔ T01 Contract types                                    │
│      ▶ T02 Modal component  ← current                        │
│      ○ T03 Cancellation on close                             │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [Chat pane — turns, messages, tool cards]                   │
│                                                              │
│  User: Add a settings screen                                 │
│  Agent: I'll start by reading the existing preferences…      │
│         [read: src/settings.ts]                              │
│         [write: src/screens/settings.tsx]                    │
│         Done — see the diff above.                           │
│                                                              │
│  User: ▏                                             [Send]  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Header

Three rows, always visible:

```
Row 1 │  gsd-tau (display name)      [model picker ▼]  [Context ██░ 62%]  [$0.42]  [⋮]
Row 2 │  D:/Projects/gsd-tau  ← project path, click to reveal in Explorer
Row 3 │  ⎇ main  ·  3 modified  ·  ↑2 unpushed         ← git status bar
```

**Row 1 — session identity + controls**
- Left: display name (user-editable via tab right-click → Rename).
- Right: model picker, context gauge, cost, overflow menu (⋮).

**Row 2 — project path**
- Full absolute path. Truncated from the left with `…` if too long for the
  available width (keeps the deepest directory components visible).
- Click → reveals the folder in Windows Explorer.
- If the directory no longer exists on disk: shown in `--color-status-error`
  with a `⚠` prefix.

**Row 3 — git status bar**
- Compact single line: `⎇ <branch>  ·  <dirty summary>  ·  <ahead/behind>`.
- Clicking anywhere on row 3 opens the git status popover (see below).
- Row 3 is hidden when git is not available in the project directory (graceful
  degradation — no error, just absent).
- Polling: refreshed on session focus, on `agent_end` events (the agent likely
  changed files), and every 60 s while the session tab is active. `git status
  --porcelain` + `git log @{u}.. --oneline` are the underlying commands, run
  via `window.gsd.shell.gitStatus(cwd)`.

#### Git status bar states

| State | Display |
|---|---|
| Clean, no remote | `⎇ main` |
| Clean, up to date with remote | `⎇ main  ·  ✓ up to date` |
| Dirty (changes) | `⎇ main  ·  2 modified  ·  1 untracked` |
| Ahead of remote | `⎇ main  ·  ↑3 unpushed` |
| Behind remote | `⎇ main  ·  ↓1 to pull` |
| Ahead + dirty | `⎇ feature/chat  ·  5 modified  ·  ↑2 unpushed` |
| Detached HEAD | `⎇ abc1234 (detached)` |
| Not a git repo | row hidden |
| git not on PATH | row hidden |

Dirty count = staged + unstaged modified/deleted files combined.
Untracked files are shown separately when present.

#### Git status popover

Clicking row 3 opens a popover anchored below the header:

```
┌─────────────────────────────────────────────────────────┐
│  ⎇  main  ·  origin/main                      [Refresh] │
│  ─────────────────────────────────────────────────────  │
│  Staged                                                 │
│    M  src/renderer/ui/ThemeProvider.tsx                 │
│  ─────────────────────────────────────────────────────  │
│  Modified (not staged)                                  │
│    M  docs/40-ui-design.md                              │
│    M  tailwind.config.ts                                │
│  ─────────────────────────────────────────────────────  │
│  Untracked                                              │
│    ?  docs/43-git-status.md                             │
│  ─────────────────────────────────────────────────────  │
│  Unpushed commits (2)                                   │
│    abc1234  Add ThinkingIndicator animation             │
│    def5678  Add dark token overrides                    │
└─────────────────────────────────────────────────────────┘
```

- File paths are clickable → reveal in Explorer.
- Sections are omitted entirely when empty (no "Staged" section if nothing
  is staged).
- Unpushed commits show short hash + first line of the commit message.
- [Refresh] re-runs the git status commands immediately.
- Popover closes on click-outside or `Escape`.
- No git actions (commit, push, stage) — display only. git operations are
  left to the user's preferred git tool or the agent via the composer.

**Overflow menu (⋮):** Compact context, New session, Fork, Export, Session
settings, Close.

### Chat pane

> Full chat experience spec lives in [45-chat-experience.md](./45-chat-experience.md).
> This section is a summary; the other doc is authoritative.

- Turns rendered top-to-bottom, newest at the bottom, auto-scroll enabled by
  default (disabled when the user scrolls up manually — standard chat pattern).
- Streamed assistant text renders incrementally as `text_delta` arrives.
- Tool calls render as collapsed cards:
  ```
  ┌ read src/settings.ts ─────────────────── 4 KB ▾ ┐
  │ (expand to see the arguments and output)         │
  └─────────────────────────────────────────────────┘
  ```
  Expanded: shows arguments (JSON), then output (raw or rendered). GSD workflow
  tools (`gsd_*`) get special renderers where useful (e.g. `gsd_plan_milestone`
  shows a mini roadmap card).
- User's own messages render right-aligned, no card.
- **Composer**: multiline input, Enter=send, Shift+Enter=newline, `/` opens the
  command palette scoped to slash commands, `@` opens a file picker inserting
  a repo-relative path.
- **Steer / follow-up affordance**: while agent is streaming, the composer
  changes its Send button to `Follow-up ▾` with a dropdown offering Steer.

## The UI-request bridge

`extension_ui_request` events are pi's mid-turn questions. This is the single
most important interaction in the app — without it, the shell is useless because
the agent can't finish anything that needs a decision.

### Flow

1. Main process receives `extension_ui_request`, records `{ id, sessionId, request }`
   in an in-memory `openBlockers` map keyed by request id.
2. State machine transitions session to **Waiting on you**.
3. Main fires `session:ui-request` IPC to all subscribed renderer windows.
4. Main triggers a Windows toast: "gsd-tau: {session name} needs your input".
   Toast body: the request title (truncated). Click on toast focuses the tab.
5. In the tab, a modal appears matching the request method:
   | method | UI |
   |---|---|
   | `select` (single) | Radio list with a Confirm button |
   | `select` (`allowMultiple`) | Checkbox list with a Confirm button |
   | `confirm` | Modal with Yes/No |
   | `input` | Single-line text input (masked if `secure`) |
   | `editor` | Multi-line editor with a submit button |
   | `notify` | Non-blocking toast in the tab |
   | `setStatus` / `setWidget` / `setTitle` / `set_editor_text` | Non-modal, updates the session header/status area |
6. User answers → renderer calls `window.gsd.respondUI(sessionId, id, response)`
   → main calls `client.sendUIResponse(id, response)`.
7. Main removes the entry from `openBlockers`. If the map for that session is now
   empty and no other blocker signal is set, state moves back to **Working**.

### Modal lifecycle and shutdown

- If the user closes a tab that has open blockers: respond `{ cancelled: true }`
  for each open request, wait for pi to acknowledge, then `shutdown`.
- On app quit: same, for every session.
- Timeouts on `extension_ui_request` are honoured by pi, not by us. We just show
  the modal until pi cancels it or the user answers.
- Modals stack per session (rare but possible). We render them as a queue in the
  tab, one at a time, top-of-queue is the active modal.

## Command palette

- Trigger: `Ctrl+Shift+P` globally, or `/` in the composer.
- Two sources merged:
  - **App commands** (static): New session, Compact, Fork, Open project,
    Close tab, Show tray, Toggle auto-run panel, Copy last turn, etc.
  - **pi slash commands** (dynamic): fetched via `get_commands` on session open,
    cached until session close. Rendered with source badge (`extension`, `prompt`, `skill`).
- Selecting a pi slash command sends it as a `prompt(msg)` starting with `/`.
  pi resolves the slash command on its side.
- Fuzzy match, MRU boosted, arrow-key nav.

## Notifications and tray

**Policy** (from decision #11): minimal.

Windows toast on:
- **Waiting on you** blocker appears → toast, tab badge, taskbar overlay icon.
- **Stopped** transition (pi crashed / watchdog fired) → toast, red badge.
- **Milestone complete** (via `tool_use` for `gsd_complete_milestone`) → toast,
  no badge (it's a happy event).

Everything else is silent. Tab badges + tray count carry the rest.

### System tray

Always-on-top icon while the app is running (even with all windows closed).

Tray icon states:
- Default (grey): no attention needed.
- Blue: at least one session is Working or Auto.
- Red with number: at least one session Waiting-on-you or Stopped. Number = count.

Left-click tray icon: show/hide the last-active window. Right-click:
- List of sessions with per-session state indicator, click to focus that tab.
- "New window"
- "Open project…"
- Separator
- "Preferences"
- "Quit gsd-tau"

Windows-specific: taskbar overlay icon on each window's taskbar entry mirrors
that window's max-severity session state.

## Keyboard shortcuts (v1 baseline)

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab (opens Open Project flyout) |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | Reopen last closed tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next/prev tab |
| `Ctrl+1`…`Ctrl+9` | Focus tab N |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+K` | Focus composer |
| `Ctrl+.` | Model picker |
| `Ctrl+/` | Toggle auto-run panel |
| `Esc` | Abort current turn (with confirm modal if streaming) |
| `Ctrl+Shift+N` | New window |
| `Ctrl+Q` | Quit (with confirm if any session Working/Auto) |

## Empty and error states

- **Startup with no registry**: welcome screen with "Open your first project"
  CTA and a link to setup docs.
- **Startup, pi not on PATH**: full-screen guided setup: "gsd-tau needs the
  `gsd` CLI. [Install with npm] [Locate manually] [Documentation]". Nothing
  else is functional until this is resolved.
- **Session's pi child failed to start**: tab shows the stderr tail and a
  "Retry" button.
- **Session file missing on restore**: banner in the tab, "Locate file" and
  "Remove from list" buttons.

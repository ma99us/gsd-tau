# Onboarding, Project Open, and Session Lifecycle

This document specifies the first-run flow, every method for opening a project
directory, session restoration on relaunch, and the full session close/forget
lifecycle.

Cross-references [30-persistence.md](./30-persistence.md) for the registry
schema and relaunch flow, [42-settings.md](./42-settings.md) for the pi
Integration settings, [40-ui-design.md](./40-ui-design.md) for tab/window
model, and [11-error-handling.md](./11-error-handling.md) for failure modes.

---

## 1. Launch sequence

Same sequence on every launch — first run differs only in what the registry
contains.

```
App starts
  │
  ├─ Load registry (create empty registry if not found → first run)
  │
  ├─ Detect pi binary
  │    ├─ Not found  → Setup screen (§2)   [blocks everything]
  │    └─ Too old    → Version screen (§3) [blocks everything]
  │
  ├─ Restore window/tab layout from registry
  │    └─ No tabs in registry → Empty state (§5)
  │
  └─ Lazily reconnect sessions (§6)
```

---

## 2. Setup screen — pi not found

Shown full-screen, nothing else accessible.

```
┌─────────────────────────────────────────────────────────────┐
│                       gsd-tau                               │
│                                                             │
│      gsd-tau needs the gsd CLI to work.                     │
│      We couldn't find it on your system.                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Option 1 — Install via npm (recommended)            │   │
│  │                                                      │   │
│  │  npm install -g @opengsd/gsd-pi             [Copy ⎘] │   │
│  │                                                      │   │
│  │  Then click Retry below.                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Option 2 — Locate manually                          │   │
│  │  [Browse for gsd binary…]                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  [Documentation ↗]                    [Retry detection]    │
└─────────────────────────────────────────────────────────────┘
```

- **Retry detection** re-runs the full binary resolution ladder from
  [90-tech-stack.md](./90-tech-stack.md). On success the setup screen
  dismisses and the normal launch sequence continues.
- **Browse for binary** opens a native file picker (`.cmd`, `.exe`). The
  chosen path is saved to `settings.piBinaryPath`. Detection re-runs immediately.
- **Documentation** opens `https://opengsd.net/install` in the system browser.

---

## 3. Version too old screen

```
┌─────────────────────────────────────────────────────────────┐
│                       gsd-tau                               │
│                                                             │
│      Your gsd version is too old.                           │
│                                                             │
│      Required:   ≥ 1.11.0                                   │
│      Found:      1.9.3                                      │
│      Location:   C:\nvm4w\nodejs\gsd.cmd                    │
│                                                             │
│  [Update gsd ↗]              [Locate different version]    │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Opening a project — all entry points

A **project** is any folder on disk. It does not need a `.gsd/` directory — pi
creates one on first use. gsd-tau opens a project by creating a new session tab
whose `cwd` is the chosen folder.

### 4.1 Tab bar `[+]` flyout (primary)

Clicking `[+]` opens a flyout panel anchored below the tab bar:

```
┌──────────────────────────────────────────────────────┐
│  Open project                                   ✕   │
│  ┌────────────────────────────────────────────────┐  │
│  │  Type or paste a path…                      ↵  │  │
│  └────────────────────────────────────────────────┘  │
│  [Browse folder…]            [Create new project…]   │
│  ────────────────────────────────────────────────    │
│  Recent                                              │
│  📁 gsd-tau      D:/Projects/gsd-tau     2h ago  ↗  │
│  📁 website      D:/Projects/website     1d ago  ↗  │
│  📁 api          D:/Projects/api-server  3d ago  ↗  │
│  📁 blog         D:/Projects/blog        5d ago  ↗  │
│  ────────────────────────────────────────────────    │
│  [Manage recent projects…]                           │
└──────────────────────────────────────────────────────┘
```

**Path input:** Accepts an absolute path typed or pasted. Autocompletes against
the filesystem (directory names only) as the user types. Enter or clicking `↵`
opens the path if it is a valid directory; shows inline error "Path not found"
or "Not a directory" if not.

**Browse folder…:** Opens the native Windows folder picker. The chosen path
immediately opens a new session tab.

**Create new project…:** Opens the new-project dialog (§4.8).

**Recent list:** Up to 10 entries, MRU order. Each row shows the project
display name, full path (truncated with ellipsis in the middle), and time since
last opened. `↗` opens the project; clicking the row body does the same.

**Keyboard:** The flyout is keyboard-navigable — `↑/↓` to move through the
list, `Enter` to open, `Escape` to close. Focus goes to the path input on open.

**Flyout closes** after a project is selected. If the same project is already
open in a tab in any window, that tab is focused instead of opening a duplicate.

### 4.2 Drag-and-drop

Dragging a folder from Windows Explorer onto any gsd-tau window opens that
folder as a new session. A drop target overlay is shown when a drag enters the
window:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│             Drop folder to open as a new session            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The overlay covers the full window content area. On drop, the overlay fades and
the new tab opens.

Only folder drops are accepted. File drops are ignored (overlay does not appear
for file drags).

### 4.3 Command palette

`Ctrl+Shift+P` → type "Open project" or "Open folder" → invokes the same
action as clicking `[+]` → Browse folder picker opens directly.

### 4.4 System tray

Right-click tray icon → "Open project…" → opens the native folder picker.
Useful when all windows are closed but the app is still running.

### 4.5 Windows Jump List

The Windows taskbar right-click menu (Jump List) includes:
- **Recent projects** — up to 5 MRU entries. Clicking one opens that project
  directly (focuses the existing tab if already open, otherwise creates a new
  one in the last-active window).
- **Open project…** — opens the native folder picker.

Jump List is populated via `app.setJumpList()` and refreshed on every MRU
change.

### 4.6 CLI / deep link (future-proofing)

`gsd-tau://open?path=D%3A%2FProjects%2Fmy-project` opens the app and creates
a session for the given path. The deep link handler is registered via
`app.setAsDefaultProtocolClient('gsd-tau')`. Not user-visible in v1 but
prevents needing a breaking change later.

### 4.8 Create new project dialog

Opened via **[Create new project…]** in the `[+]` flyout.

```
┌────────────────────────────────────────────────────┐
│  Create new project                          ✕   │
│                                                 │
│  Project name                                   │
│  ┌───────────────────────────────────────────┐  │
│  │  my-project                            │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Create in                                      │
│  ┌─────────────────────────────────────┐  [Browse…]  │
│  │  D:/Projects                         │            │
│  └─────────────────────────────────────┘            │
│                                                 │
│  Will create:  D:/Projects/my-project           │
│                                                 │
│                        [Cancel]  [Create & open] │
└────────────────────────────────────────────────────┘
```

**Project name:** Free-text input. Validated on change — allowed characters
are alphanumeric, hyphens, underscores, and dots. Spaces are auto-converted to
hyphens. The name becomes the leaf directory name and the session display name.

**Create in:** The parent directory. Defaults to the last-used parent (persisted
in the registry as `settings.lastNewProjectDir`; falls back to the user's home
directory on first use). **[Browse…]** opens the native folder picker to change
it.

**Will create:** Live preview of the full path — `{parent}/{name}`. Updates as
the user types. Shown in `--color-text-secondary`. If the directory already
exists, the preview changes to a warning: `⚠ D:/Projects/my-project already
exists` and **[Create & open]** is disabled.

**[Create & open]:**
1. Main process creates the directory (`fs.mkdirSync(fullPath, { recursive: true })`).
2. Opens a new session tab with `cwd = fullPath` — identical to opening any
   existing project.
3. pi spawns with that cwd; it creates `.gsd/` on the first interaction as
   it would for any project. No extra init step needed.
4. Dialog closes. The new tab is focused.

On filesystem error (permissions, disk full): inline error below the path
preview: `⚠ Could not create directory — {error.message}`. Button stays
disabled.

**No git init.** Git initialisation is intentionally out of scope — not all
projects use git, and users who want git can run `git init` themselves or ask
the agent to do it via the composer once the session is open.

Before opening any project, the main process checks whether a session with the
same `cwd` already exists in any open tab across all windows. If it does:
- Focus that tab's window and bring the tab to front.
- Show a brief toast: "gsd-tau is already open for this project."
- Do **not** open a second session for the same directory.

If the user explicitly wants a second independent session for the same project
(rare — for forking experiments), they can use tab right-click → "Duplicate
session" to fork from the existing session's current turn.

---

## 5. Empty state — no tabs open

Shown when no tabs exist (first run, or all tabs closed without quitting).

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              Open a project to get started                  │
│                                                             │
│                   [Open folder…]                            │
│                                                             │
│         ──────────────────────────────────────              │
│         Recent projects                                     │
│                                                             │
│         📁  gsd-tau       D:/Projects/gsd-tau               │
│         📁  website       D:/Projects/website               │
│         📁  api           D:/Projects/api-server            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **Open folder…** opens the native folder picker.
- Clicking a recent project row opens that project.
- If there are no recent projects (true first run), the Recent section is
  omitted and only the Open folder button is shown.
- The `[+]` tab bar button is also visible and does the same thing.

---

## 6. Session restoration on relaunch

### 6.1 What is restored

The registry stores the last tab layout (window positions, tab order, active
tab) and one entry per session (project path, pi session file path, display
name, last known state). On relaunch:

- Windows are recreated at their saved bounds.
- Tabs are recreated with their display names.
- **Pi processes are NOT auto-started.** Sessions reconnect lazily when the tab
  is first focused.

### 6.2 Lazy reconnection

When a restored tab is focused for the first time after launch, the chat pane
shows a reconnecting state:

```
┌─────────────────────────────────────────────────────────────┐
│  [●] gsd-tau                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│             ● ● ●   Reconnecting…                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Main process then:
1. Spawns a new pi child (`--continue` flag, same `cwd`).
2. Runs `init()` and `subscribe(['*'])`.
3. Calls `switch_session({ sessionPath })` to load the prior conversation.
4. Calls `get_history()` to hydrate the chat view.
5. If `wasAutoRunning` was true in the registry, shows a resume banner (§6.4).
6. On success: `ThinkingIndicator` fades, chat history renders, session → **Idle**.

If a tab is never focused after launch, pi is never spawned for it — a user
who opens the app to check another project doesn't pay the cost of reconnecting
all sessions.

### 6.3 Missing session file

If `registry.session.piSessionFile` no longer exists on disk when reconnection
runs (the user deleted it, or it was on a drive that's not mounted):

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠  Session file not found                                  │
│  The previous conversation for this project cannot be       │
│  restored.                                                  │
│                                                             │
│  D:/Projects/gsd-tau                                        │
│                                                             │
│  [Start fresh session]    [Remove from list]                │
└─────────────────────────────────────────────────────────────┘
```

- **Start fresh session** creates a new pi session (no `--continue`) and
  replaces the registry entry with the new session file path.
- **Remove from list** closes the tab and removes the registry entry.

### 6.4 Auto-mode resume prompt

If the registry entry has `wasAutoRunning: true`:

```
┌─────────────────────────────────────────────────────────────┐
│  ↺  Auto-mode was running when gsd-tau last closed.         │
│  Resume from where it left off?                             │
│                                  [Resume auto]  [Dismiss]  │
└─────────────────────────────────────────────────────────────┘
```

This banner appears in the chat pane after history loads. "Resume auto" sends
`/gsd auto` as a `prompt()`. "Dismiss" clears the banner and sets
`wasAutoRunning: false` in the registry. The user can always resume manually
by typing `/gsd auto` in the composer.

---

## 7. Closing a session — all paths

### 7.1 Close tab (keep session)

**Trigger:** Middle-click a tab, `Ctrl+W`, or tab right-click → "Close tab".

What happens:
- Tab is removed from the tab bar.
- The tab's window+tab entry is removed from the registry layout.
- **The session entry remains in the registry.** The session will appear in
  the Recent list and be restored next launch if it was in the tab layout.
- Pi child is shut down gracefully: `client.shutdown({ graceful: true })`. Any
  open UI-request blockers are cancelled before shutdown (see
  [40-ui-design.md §Modal lifecycle](./40-ui-design.md)).
- If this was the last tab in the window, the window is not closed — it shows
  the empty state (§5) so the user can open another project without needing a
  new window.

### 7.2 Close and forget

**Trigger:** Tab right-click → "Close and forget".

Same as §7.1, plus:
- The session entry is **removed from the registry** entirely.
- The project disappears from the Recent list.
- Pi's session file and `.gsd/` data are untouched — we never delete pi state.

Shown with a confirmation if the session is currently **Working** or **Auto**:
"Stop the agent and forget this session? This cannot be undone."

### 7.3 Close window

**Trigger:** Window close button (`✕`), `Ctrl+F4`, or "Close" from the window
title bar system menu.

- The window disappears.
- All tabs in the window are closed (§7.1 for each tab) — sessions are shut
  down gracefully.
- The tab layout for that window is removed from the registry.
- **The sessions themselves remain in the registry** (same as §7.1 — just the
  layout entry is gone).
- If it was the last window: the app does NOT quit. It continues running in
  the system tray (see [40-ui-design.md §Notifications and tray](./40-ui-design.md)).

### 7.4 Quit app

**Trigger:** `Ctrl+Q`, `File → Quit`, or system tray → "Quit gsd-tau".

- If any session is **Working** or **Auto**: confirmation dialog:
  "N sessions are still running. Quit and stop them?"
- On confirm: gracefully shut down all pi children (with a 5 s timeout per
  session before force-kill).
- Registry is flushed synchronously before exit.
- App exits.

### 7.5 Session state during shutdown

All shutdown paths cancel open UI-request blockers before sending `shutdown()`:

```
For each open blocker in session:
  respondUI(sessionId, blockerId, { cancelled: true })
Await pi acknowledgement (or timeout 2s)
client.shutdown({ graceful: true })
Await RPC shutdown or timeout 5s
Force-kill child process if timeout
```

---

## 8. Session visibility vs. session existence

The distinction between "closing a tab" and "forgetting a session" is
important and must be communicated clearly in the UI:

| Action | Tab | Registry | Pi session file | Pi process |
|---|---|---|---|---|
| Close tab | Removed | Kept | Untouched | Shut down |
| Close and forget | Removed | Removed | Untouched | Shut down |
| Close window | All tabs removed | Layout removed, sessions kept | Untouched | Shut down |
| Quit app | All tabs removed | Flushed to disk | Untouched | Shut down |

A session in the registry with no open tab is **dormant** — it's available in
the Recent list and can be reopened at any time via `[+]` or Recent projects.
Opening a dormant session creates a new tab and triggers the lazy reconnection
flow (§6.2).

---

## 9. Re-entering a closed session

A session that was closed (but not forgotten) can be reopened:

- Via the `[+]` flyout Recent list — if the same project path is in the recent
  list, clicking it reconnects the existing session (same pi session file).
- Via `File → Recent projects` menu — same behaviour.
- Via the Jump List — same behaviour.

When the same project path is opened and a dormant session entry exists in the
registry for that path, the dormant session is resumed (`--continue`) rather
than creating a brand-new session. This preserves full conversation history.

If the user wants a genuinely fresh session for a project that already has a
dormant session, they can use tab right-click → "New session for this project"
which creates a new pi session (no `--continue`) without touching the old one.

---

## 10. First run — true first launch

On first run (no registry file):

1. Empty registry created in memory.
2. Pi binary detection runs.
   - Not found → Setup screen (§2).
   - Found and valid → proceed.
3. No tabs in registry → empty state (§5) is shown immediately.
4. User opens a folder → first session tab is created → pi spawns → chat is ready.

No wizard, no tour, no model picker. The chat starter suggestions
([45-chat-experience.md §12](./45-chat-experience.md)) inside the new session
give new users enough affordance to get started.

---

## 11. Keyboard shortcuts for session / project management

| Shortcut | Action |
|---|---|
| `Ctrl+T` | Open `[+]` flyout |
| `Ctrl+W` | Close current tab (keep session) |
| `Ctrl+Shift+T` | Reopen last closed tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` … `Ctrl+9` | Focus tab N |
| `Ctrl+Shift+N` | New window |
| `Ctrl+Q` | Quit (with confirmation if sessions running) |

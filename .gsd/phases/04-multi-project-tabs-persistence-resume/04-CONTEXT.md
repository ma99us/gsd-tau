# M004 Context — Phase 3: Multi-project Tabs, Persistence, Resume

## Goal

Full tab bar, registry persistence, and session restore on relaunch. Multiple pi sessions running concurrently. Build on M002 + M003.

## Source Documents

- `docs/plan/PHASE-3-project-and-session-switcher.md` — authoritative task reference
- `docs/30-persistence.md` — RegistryV1 schema and atomic write strategy
- `docs/40-ui-design.md` — tab bar, Open Project flyout, SessionView layout

## Key Decisions

### Persistence
- **Registry path**: `%APPDATA%\gsd-tau\registry.json` (atomic write: tmp → rename, .bak kept)
- **Debounce**: 500ms write debounce on every state-changing event
- **Mid-write kill recovery**: load() tries .bak if main file is corrupt; returns `getDefault()` if both fail
- **RegistryV1 schema**: `{ version: 1, sessions: SessionRecord[], windows: WindowRecord[], mruOrder: string[] }`
- **SessionRecord**: `{ id, cwd, displayName, sessionFile?, lastOpenedAt, wasAutoRunning }`
- **WindowRecord**: `{ id, tabIds, activeTabId, bounds: {x,y,width,height} }`

### Session management
- **N concurrent sessions**: Phase-1 single-session restriction lifted in S02
- **switch_session on restore**: if `SessionRecord.sessionFile` present, call `client.switch_session(sessionFile)`; otherwise fresh start
- **wasAutoRunning flag**: only sessions in Working/Idle state at quit are restored on relaunch

### UI
- **Tab state indicator**: Working=yellow pulse, Waiting=orange, Idle=green, Stopped=red
- **Tab interactions**: click, middle-click (close with confirm if Working), right-click context menu, drag to reorder (HTML5 DnD)
- **Keyboard**: Ctrl+T new tab, Ctrl+W close active, Ctrl+Tab / Ctrl+Shift+Tab cycle
- **SessionView**: hidden (display:none) not unmounted — preserves scroll position and Zustand state per session
- **MRU recents**: 10 items in `mruOrder`, shown in Open Project flyout
- **Drop zone**: flyout accepts folder drag from Windows Explorer

### Single-instance
- **app.requestSingleInstanceLock()** — second instance parses `--open-project <path>` and forwards to first; then exits
- **AppUserModelID**: already set in M003; window focused on second-instance event

### Window bounds
- **Save on move/resize** (1s debounce) into WindowRecord.bounds
- **Off-screen clamp**: on restore, clamp to nearest display workArea via `screen.getAllDisplays()`

### Missing-session-file
- **On restore failure** (cwd gone): emit `session:missing-path`; SessionView shows MissingSessionBanner
- **Locate**: opens folder picker, reassigns cwd, retries open()
- **Remove**: deletes SessionRecord from registry, closes tab

### Test fixtures
- `test/fixtures/project-a/`, `project-b/`, `project-c/` — minimal `package.json` each

## Depends On

M002 (core pi integration, IPC, preload) + M003 (modal queue, blocker lifecycle, shutdown cancellation).

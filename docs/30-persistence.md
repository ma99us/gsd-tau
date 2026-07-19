# Persistence

## What must survive

| Thing | Survives | Owned by |
|---|---|---|
| Conversation history (messages, tool calls, tool results) | Reboots, app quit, pi crashes | **pi** — writes to `%USERPROFILE%\.gsd\sessions\<sessionId>.jsonl` |
| Per-project `.gsd/` state (roadmap, plans, summaries, decisions, requirements, gsd.db) | Everything | **pi** — writes to the project's `.gsd/` folder |
| Auth tokens (Anthropic, OpenAI, Copilot, etc.) | Reboots | **pi** — writes to `%USERPROFILE%\.gsd\auth.json` (encrypted where the OS supports it) |
| Which sessions to restore + which project each maps to | Reboots | **gsd-tau** — our registry |
| Tab layout: which tabs in which windows, active tab, tab order | Reboots | **gsd-tau** |
| Per-session UI prefs (auto-scroll, collapsed tool cards, etc.) | Reboots | **gsd-tau** |
| Whether auto-mode was running (so we can prompt to resume) | Reboots | **gsd-tau** (derived from last known state) |
| Ring buffer of recent events for late-attaching renderers | App runtime only | **gsd-tau** (in-memory) |

**Rule of thumb:** if pi persists it, we don't duplicate it. Our registry stores
*pointers* to pi state, not copies.

## Our registry file

Location: `%APPDATA%\gsd-tau\registry.json`.

Schema (illustrative — subject to migration):

```jsonc
{
  "version": 1,
  "sessions": [
    {
      "id": "s_ab12cd",                  // our internal id
      "piSessionId": "01H9...",          // returned by pi init
      "piSessionFile": "C:/Users/Mike/.gsd/sessions/2026-01-15/01H9....jsonl",
      "projectCwd": "D:/Projects/gsd-tau",
      "displayName": "gsd-tau",          // user-editable, defaults to basename
      "createdAt": "2026-01-15T14:22:00Z",
      "lastSeenAt": "2026-07-19T09:11:00Z",
      "lastKnownState": "auto",          // Working|Waiting|Idle|Stopped|Auto
      "lastKnownProvider": "anthropic",
      "lastKnownModel": "claude-sonnet-4-5",
      "wasAutoRunning": true,            // consulted on relaunch (see below)
      "uiPrefs": {
        "collapseSummaryTools": false,
        "autoScroll": true
      }
    }
  ],
  "windows": [
    {
      "id": "w_1",
      "bounds": { "x": 100, "y": 100, "width": 1440, "height": 900 },
      "activeTabId": "t_2",
      "tabs": [
        { "id": "t_1", "sessionId": "s_ab12cd" },
        { "id": "t_2", "sessionId": "s_ef34gh" }
      ]
    }
  ],
  "settings": {
    "openLastSessionsOnStartup": true,
    "piBinaryPath": null                 // null = auto-detect from PATH
  }
}
```

We use a plain JSON file (not sqlite) because the data is tiny (<100 sessions
realistic ceiling), single-writer (main process), and atomic writes are trivial
via write-to-temp-then-rename.

**Writes:** debounced 500ms. Any registry mutation schedules a flush.
**Atomicity:** write to `registry.json.tmp`, `fs.rename` over `registry.json`.
**Backups:** we keep `registry.json.bak` from the previous successful write.
**Corruption recovery:** if `registry.json` fails to parse, we fall back to `.bak`,
then to empty — never crash.

## The relaunch flow

```
app.whenReady()
  └─ acquire single-instance lock                        (see os/single-instance.ts)
  └─ load registry.json (or .bak)
  └─ for each window in registry:
       ├─ create BrowserWindow at saved bounds
       └─ for each tab in window:
            ├─ create a lazy tab (no pi child yet)
            └─ show tab in "Restoring…" placeholder state
  └─ for each session in registry (parallel):
       ├─ resolve pi binary
       ├─ spawn RpcClient
       ├─ await init()
       ├─ if session.piSessionFile still exists on disk:
       │     switch_session({ sessionPath: piSessionFile })
       │  else:
       │     mark session Stopped, show "Session file missing" banner
       ├─ subscribe(['*'])
       ├─ get_state() → hydrate model/thinking/etc
       ├─ get_messages() → hydrate chat view
       └─ if session.wasAutoRunning:
             transition to "PromptToResumeAuto" state
             render banner: "Auto-mode was running. Resume?"
```

Restoring a tab **never** auto-starts a prompt. Nothing calls `prompt()` on
restore. Auto-mode resume is user-triggered, always. See R2 + auto-resume ADR.

## `wasAutoRunning` — how we detect it

There's no persistent "in auto-mode" flag in pi. We derive it from the last
observed state before the app quit:

- Main process observes every `tool_use` event.
- When we see the auto-mode kickoff (either the `autonomous` prompt template running,
  or a `gsd_task_complete` immediately followed by another agent turn without user
  input), we set `session.wasAutoRunning = true` in the registry.
- When we see the auto-mode termination (user `abort`, pi's own auto-mode stop,
  or an `execution_complete` with no queued follow-up), we set it to `false`.
- On graceful `shutdown`, we snapshot whatever the current value is.
- On non-graceful exit (main crash), the last debounced write wins — we may
  false-positive prompt to resume when there was nothing to resume. That's
  acceptable; user can dismiss.

## What we deliberately don't persist

- **Full event stream.** pi's session file is the source of truth. We only cache
  in-memory (ring buffer) for late-attaching windows.
- **Cost/token totals.** Recomputed from `get_session_stats` on attach.
- **Copies of `.gsd/` artifacts.** We link out or re-render from disk on demand.
- **Copies of pi's auth.** We show login state derived from `get_available_models`
  and pi's own reporting.

## Migration policy

The registry file has a top-level `version` number. On load:

- If `registry.version === CURRENT_VERSION` → use directly.
- If lower → run in-place migration functions in sequence (`migrate.v1_to_v2(...)`).
- If higher (user rolled back gsd-tau) → refuse to load, show "This registry
  was written by a newer version" screen. Don't silently downgrade.

Migrations are pure JS functions committed alongside the schema change.

## Cleanup

- **Explicitly closed session**: user right-clicks tab → "Close and forget".
  Removes from registry. Does *not* delete pi's session file (that's pi's).
- **Missing session file on relaunch**: keep the registry entry, mark Stopped,
  offer "Remove from list" or "Locate file".
- **Deleted project folder**: same as missing session file, plus a warning about
  the missing `.gsd/`.

We never touch pi's `~/.gsd/sessions/` files or `.gsd/gsd.db` files. Cleanup of
pi state is the user's job via pi's own tools.

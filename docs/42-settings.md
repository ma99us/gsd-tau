# App Configuration and Settings

This document defines the settings schema, storage format, UI screen layout,
and runtime propagation for all user-configurable preferences in gsd-tau.

Cross-references [15-ipc-bridge.md §4](./15-ipc-bridge.md) for the
`window.gsd.settings` API, [30-persistence.md](./30-persistence.md) for the
registry file format, and [41-design-system.md](./41-design-system.md) for
the token layer (theme selection).

---

## 1. Settings model

Settings are split into two levels that merge at runtime:

- **Global settings** — app-wide defaults stored in `registry.json` under
  `settings`. Apply to all sessions unless overridden.
- **Per-project overrides** — a `settings` block on each project entry in the
  registry. Only a subset of keys are overridable per-project (see §3). When
  active, project overrides win over global defaults.

Effective settings for a session = `{ ...globalSettings, ...projectSettings }`.

This merge happens in main process. The renderer always receives the effective
merged value via `window.gsd.settings.get()` — it never performs the merge
itself.

---

## 2. Global settings schema

```ts
interface AppSettings {
  // ── Appearance ────────────────────────────────────────
  theme: 'light' | 'dark' | 'system';
  // Default: 'system'

  // ── pi Integration ────────────────────────────────────
  piBinaryPath: string | null;
  // Default: null (auto-detect via PATH / well-known locations)
  // When set, this path is used exclusively — PATH lookup skipped.

  // ── Model defaults ────────────────────────────────────
  // These are the defaults when creating a new session.
  // The user can change per-session after creation via the model picker.
  defaultProvider: string | null;
  // Default: null (uses pi's own default)
  defaultModel: string | null;
  // Default: null (uses pi's own default)
  defaultThinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | null;
  // Default: null (uses pi's own default)

  // ── Notifications ─────────────────────────────────────
  notifications: {
    sound: boolean;         // Default: false
    toastOnWaiting: boolean;// Default: true — toast when agent needs input
    toastOnStopped: boolean;// Default: true — toast when session crashes
    toastOnComplete: boolean;// Default: true — toast on milestone complete
  };

  // ── Chat behaviour ────────────────────────────────────
  chat: {
    autoCollapseTools: boolean;   // Default: true — tool cards start collapsed
    autoCollapseLong: boolean;    // Default: true — turns ≥ 8 lines start collapsed
    showThinkingBlocks: boolean;  // Default: true — show reasoning blocks
    showCostStrip: boolean;       // Default: true — per-turn cost/time strip
    showFollowUpSuggestions: boolean; // Default: true — chips after each turn
    fontSize: 'small' | 'medium' | 'large'; // Default: 'medium' (13/14/15px)
    fontFamily: 'system' | 'inter' | 'jetbrains-mono';
    // Default: 'system' — uses OS UI font; 'inter' bundles Inter; mono is for nerds
  };

  // ── Editor / code blocks ──────────────────────────────
  codeBlock: {
    theme: 'auto' | 'github' | 'github-dark' | 'dracula' | 'one-dark';
    // Default: 'auto' — light/dark follows app theme
    wordWrap: boolean;      // Default: false
    lineNumbers: boolean;   // Default: true
  };

  // ── Startup ───────────────────────────────────────────
  startup: {
    restoreLastSession: boolean;  // Default: true
    checkForUpdates: boolean;     // Default: true
    minimiseToTray: boolean;      // Default: false — start minimised to tray
  };

  // ── Auto-update ───────────────────────────────────────
  updates: {
    channel: 'stable' | 'beta'; // Default: 'stable'
    autoDownload: boolean;      // Default: true — download silently, prompt to install
  };

  // ── Advanced ──────────────────────────────────────────
  advanced: {
    logLevel: 'error' | 'warn' | 'info' | 'debug'; // Default: 'info'
    hardwareAcceleration: boolean; // Default: true
    // When false, disables GPU acceleration (workaround for some GPU driver issues)
  };
}
```

---

## 3. Per-project override keys

Not all settings make sense per-project. Only the following keys are included
in the per-project `settings` block. Attempting to set other keys at project
level is silently ignored.

| Key | Reason overridable |
|---|---|
| `defaultProvider` | Different projects may use different providers |
| `defaultModel` | A large codebase may default to a smarter/slower model |
| `defaultThinkingLevel` | Some projects warrant deeper reasoning by default |
| `chat.fontSize` | Reading preference may differ per project type |
| `codeBlock.theme` | Personal preference per workspace |

Per-project overrides are stored in the registry under each project entry:

```jsonc
// %APPDATA%\gsd-tau\registry.json (excerpt)
{
  "settings": {
    "theme": "system",
    "defaultModel": null,
    ...
  },
  "projects": [
    {
      "cwd": "D:/Projects/gsd-tau",
      "displayName": "gsd-tau",
      "settings": {
        "defaultModel": "claude-opus-4-5",
        "defaultProvider": "anthropic"
      }
    }
  ]
}
```

---

## 4. Settings screen UI

Accessed via: `File → Preferences`, `Ctrl+,`, or from the session header `⋮`
menu → "Settings".

Opens as a modal dialog (not a separate window). Two-column layout: category
nav on the left, content on the right. Tabs navigate with arrow keys.

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙  Preferences                                         ✕  │
├──────────────────┬──────────────────────────────────────────┤
│  Appearance      │  Appearance                              │
│  pi Integration  │  ───────────────────────────────────     │
│  Model defaults  │  Theme                                   │
│  Notifications   │  ○ Light   ◉ System   ○ Dark            │
│  Chat            │                                          │
│  Code blocks     │  Chat font size                          │
│  Startup         │  ○ Small   ◉ Medium   ○ Large           │
│  Advanced        │                                          │
│  [Project: …]    │  Chat font family                        │
│                  │  ◉ System font                           │
│                  │  ○ Inter                                  │
│                  │  ○ JetBrains Mono                        │
│                  │                                          │
│                  │  Code block syntax theme                 │
│                  │  [Auto (follows app theme) ▾]            │
└──────────────────┴──────────────────────────────────────────┘
                                       [Restore defaults] [Done]
```

### Category: pi Integration

```
  pi binary path
  ┌──────────────────────────────────────────┐ [Browse…]
  │  (auto-detect)                           │
  └──────────────────────────────────────────┘
  Detected at: C:\nvm4w\nodejs\gsd.cmd   v1.14.2  ✓
  [Verify now]
```

Path field is empty = auto-detect. Filled = explicit override.
"Verify now" re-runs detection and shows the result inline.

### Category: Model defaults

```
  Default provider
  [Anthropic ▾]   (empty = pi decides)

  Default model
  [claude-sonnet-4-5 ▾]   (empty = pi decides)

  Default thinking level
  [Off ▾]   (empty = pi decides)

  ─────────────────────────────
  Project overrides            ← only shown when a project tab is active
  ─────────────────────────────
  Overrides for: gsd-tau

  Default model
  [claude-opus-4-5 ▾]         ← set; overrides global above
  [Clear override]
```

### Project overrides tab

A special entry "[Project: gsd-tau]" appears at the bottom of the category nav
when a project session is active. It shows only the overridable subset of
settings, with a "Clear override" affordance for each set key and a banner
clarifying scope: "These settings apply only to gsd-tau."

---

## 5. Defaults and validation

All settings have defaults defined in:
```
src/main/settings/defaults.ts
```

On startup, the registry file is loaded and merged with defaults for any missing
keys. This means adding a new setting in a future version doesn't break existing
installs — the default is silently applied.

Validation runs on every `settings:set` IPC call. Invalid values return a
`GsdIpcError` with `code: 'SETTINGS_INVALID'` and a message describing the
constraint. The UI disables the Done button until all fields are valid.

---

## 6. Live propagation

Settings changes propagate immediately without requiring a restart, except where
noted:

| Setting | Effect of change |
|---|---|
| `theme` | CSS cascade updates within 16 ms via `ThemeProvider` |
| `chat.*` | Chat pane re-renders on next message; existing messages reflow |
| `codeBlock.*` | Code blocks re-render on expand; collapsed cards unaffected |
| `notifications.*` | Next event applies the new preference |
| `piBinaryPath` | Takes effect on next session creation |
| `defaultModel` / `defaultProvider` | Takes effect on next session creation |
| `advanced.logLevel` | Applies immediately to the main-process logger |
| `advanced.hardwareAcceleration` | **Requires restart.** Banner shown: "Restart gsd-tau to apply this change." |
| `startup.*` | Takes effect on next launch |
| `updates.channel` | Takes effect on next update check |

The main-process settings handler broadcasts `settings:changed` to all renderer
windows after each write, carrying the changed key-value pair. `ThemeProvider`
and other subscribers react via their `onChange` subscriptions.

---

## 7. Import / export

In **Advanced** settings, two actions:

- **Export settings** — writes `gsd-tau-settings.json` to a user-chosen path.
  Contains global settings only (no project registry, no session data, no secrets).
- **Import settings** — validates a previously exported JSON file against the
  schema and merges it into current settings. Shows a diff preview before
  applying.

This enables sharing a settings baseline across machines or restoring after
reinstall.

---

## 8. Reset

- **[Restore defaults]** button at the bottom of the preferences modal resets
  all global settings to their defaults. Requires confirmation: "Reset all
  preferences to defaults? This cannot be undone."
- Individual keys can be reset by right-clicking the control or via the
  per-project "Clear override" affordance.

---

## 9. Storage

Settings are stored inside `registry.json` alongside the project list. See
[30-persistence.md](./30-persistence.md) for the atomic write strategy (write
to `.tmp`, `fsync`, rename). Settings are not stored separately — they are a
top-level key in the same registry file so reads and writes are always atomic.

The settings key is versioned for forward-compatibility:

```jsonc
{
  "settingsVersion": 1,
  "settings": { ... },
  "projects": [ ... ]
}
```

When `settingsVersion` is lower than the current schema version, a migration
runs on startup. Migrations are additive only (add new keys with defaults,
rename old keys). Migrations never delete keys — unrecognised keys are
preserved as-is so downgrading doesn't lose data.

---

## 10. Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open preferences | `Ctrl+,` |
| Close preferences | `Escape` or `Done` button |
| Navigate categories | `↑` / `↓` in the category list |
| Jump to pi Integration | `Ctrl+,` then `P` |

---

## 11. File locations

| File | Purpose |
|---|---|
| `src/main/settings/defaults.ts` | Default values for every key |
| `src/main/settings/schema.ts` | Zod schema for validation |
| `src/main/settings/migrate.ts` | Version migration functions |
| `src/main/settings/store.ts` | Read/write/merge logic; broadcasts changes |
| `src/main/ipc/settings.ts` | IPC handler registration |
| `src/renderer/features/settings/` | Settings modal screen and category panels |
| `src/renderer/features/settings/ProjectOverrides.tsx` | Per-project overrides panel |

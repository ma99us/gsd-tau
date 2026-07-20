# Auto-Update

This document specifies the update detection, download, and install flow for
gsd-tau's Windows installer. gsd-tau is distributed as an NSIS installer built
by `electron-builder`.

Cross-references [42-settings.md §2](./42-settings.md) for the update channel
and auto-download settings, and [05-onboarding.md](./05-onboarding.md) for
the first-run context.

---

## 1. Update mechanism

gsd-tau uses **`electron-updater`** (bundled with `electron-builder`). It
checks a published update feed, downloads deltas in the background, and prompts
the user to install. No browser or external tool is needed.

Update feed is hosted as a static file at a URL configured in
`electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: open-gsd
  repo: gsd-tau
```

`electron-updater` reads `latest.yml` (stable) or `latest-beta.yml` (beta)
from the GitHub releases feed.

---

## 2. Update channels

| Channel | Feed file | Who gets it |
|---|---|---|
| `stable` | `latest.yml` | Default — all users |
| `beta` | `latest-beta.yml` | Users who opt in via Settings → Updates |

Channel is set in `settings.updates.channel`. Default: `stable`.

---

## 3. Check schedule

- **On startup**: check runs 30 s after `app.whenReady()` — delayed so it
  doesn't compete with session restoration.
- **Every 4 hours**: background timer while the app is running.
- **Manual**: Settings → Updates → [Check now].

Checks are suppressed when `settings.startup.checkForUpdates` is `false`.

---

## 4. Update flow

```
Check for update
  │
  ├─ No update available → silent (nothing shown)
  │
  └─ Update available
       │
       ├─ settings.updates.autoDownload = true
       │    └─ Download silently in background
       │         └─ Download complete → show install prompt (§5)
       │
       └─ settings.updates.autoDownload = false
            └─ Show "Update available" notification (§6)
                 └─ User clicks → download starts → install prompt (§5)
```

---

## 5. Install prompt (download complete)

A non-blocking notification banner appears at the bottom of the main window:

```
┌─────────────────────────────────────────────────────────────┐
│  🎉  gsd-tau 1.4.0 is ready to install.      [Install now]  │
│       Release notes ↗                         [Later]       │
└─────────────────────────────────────────────────────────────┘
```

- Banner persists across tab switches until dismissed or acted on.
- **[Install now]**: calls `autoUpdater.quitAndInstall()`. Any sessions with
  active turns show a confirmation first:
  "N sessions are still running. Install now and stop them?"
- **[Later]**: dismisses for the current session. The update installs
  automatically on the next quit.
- **Release notes ↗**: opens the GitHub release page in the system browser.
- Banner is styled with `--color-status-success` tint, not a modal — does not
  block work.

---

## 6. Update available notification (auto-download off)

When `autoDownload` is false, a smaller banner is shown on update detection:

```
┌─────────────────────────────────────────────────────────────┐
│  ↑  gsd-tau 1.4.0 is available.   [Download]   [Later]     │
└─────────────────────────────────────────────────────────────┘
```

**[Download]** starts the download; banner transitions to a progress bar:

```
│  ↓  Downloading 1.4.0…  ████████░░  72%               │
```

On completion, transitions to the install prompt (§5).

---

## 7. Download progress

While downloading, the system tray icon shows a subtle badge. No modal or
blocking UI. The download runs in the main process via `electron-updater`;
the renderer is notified via IPC events:

| Event | IPC channel | Payload |
|---|---|---|
| Update available | `update:available` | `{ version, releaseNotes }` |
| Download progress | `update:progress` | `{ percent, bytesPerSecond, total }` |
| Download complete | `update:downloaded` | `{ version }` |
| Error | `update:error` | `{ message }` |

---

## 8. Error handling

| Error | UI response |
|---|---|
| No network / feed unreachable | Silent — next scheduled check will retry |
| Download failed | Toast: "Update download failed — will retry later." |
| Signature verification failed | Toast with error; update blocked; log `ERROR update:signature-failed` |
| User is on unsupported Windows version | Silent — electron-updater handles this |

---

## 9. Settings screen entry

Settings → Startup:
```
  [ ] Check for updates automatically   (default: on)

  Update channel
  ◉ Stable   ○ Beta

  [ ] Download updates automatically    (default: on)

  Current version: 1.3.2
  [Check now]
```

"Check now" triggers an immediate check and shows inline feedback:
- "Checking…" while in progress
- "You're up to date." if no update
- "Version 1.4.0 is available." with a download link if found

---

## 10. What we do not manage

- **pi (gsd CLI) updates** — pi is user-installed. We detect the current
  version and surface an "Update available" hint in Settings → pi Integration
  if the user's version is older than the recommended version, but we never
  auto-update pi. That is the user's responsibility.
- **Rollback** — NSIS handles uninstall; we don't provide an in-app rollback.

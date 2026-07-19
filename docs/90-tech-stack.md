# Tech Stack and Packaging

Windows-only v1. Thin shell over user-installed pi. React renderer, Electron main.

## Runtime

| Layer | Choice | Version | Rationale |
|---|---|---|---|
| Desktop framework | **Electron** | latest stable major | `@opengsd/rpc-client` is Node-native, needs to spawn Node children. Electron's main-process Node runtime hosts the SDK directly. Tauri would require sidecar Node processes or WASM. See [ADR-002](./decisions/ADR-002-electron-over-tauri.md). |
| Main-process language | TypeScript | 5.x | |
| Renderer framework | **React 18** | | Bland, stable, tons of Electron integration examples. Not doing anything React-specific — could swap later. |
| Bundler | **Vite** | | Fast HMR for renderer, `vite-plugin-electron` for main-process bundling too. |
| State (renderer) | **Zustand** | | Small, no boilerplate, one store slice per session. |
| UI primitives | **Radix UI** + Tailwind CSS | | Accessible primitives, quick styling, dark mode ready. |
| Testing | Vitest + Playwright | | Playwright drives the full app in end-to-end tests. |
| Packaging | **electron-builder** | | Signed NSIS installer for Windows. |

## What we install as dependencies

```jsonc
{
  "dependencies": {
    "@opengsd/rpc-client": "^1.11.0",      // pinned to our minimum pi
    "@opengsd/contracts": "^1.11.0",       // types only, imported via type-only imports
    "electron": "^latest",
    "react": "^18",
    "zustand": "^4",
    "@radix-ui/react-dialog": "…",
    "@radix-ui/react-dropdown-menu": "…",
    "tailwindcss": "^3"
  },
  "devDependencies": {
    "vite": "…",
    "electron-builder": "…",
    "vitest": "…",
    "@playwright/test": "…"
  }
}
```

We do **not** depend on the pi engine as a runtime dep. It's the user's install.

## Windows integration

| Feature | Electron API | Notes |
|---|---|---|
| Single-instance | `app.requestSingleInstanceLock()` | Second launch forwards CLI args (`--open-project <path>`) to the first via `second-instance` event. |
| System tray | `Tray` | Always present while app is running. |
| Toast notifications | `new Notification({...})` | Windows native toasts via Electron. Requires an AppUserModelID (set via `app.setAppUserModelId`). |
| Taskbar overlay icons | `BrowserWindow.setOverlayIcon` | Small badge on the taskbar icon for waiting/stopped states. |
| Jump lists (recent projects) | `app.setJumpList` | "Recent projects" and "New window" entries in the taskbar right-click menu. |
| Deep links | `app.setAsDefaultProtocolClient('gsd-tau')` | `gsd-tau://open?path=...` future-proofing. |
| File-drop onto windows | HTML5 drag-drop + a small preload bridge | Drop a folder to open a project. |
| Auto-updater | `electron-updater` | GitHub Releases feed. |

## AppUserModelID

We set `app.setAppUserModelId('io.opengsd.gsd-tau')` on startup. Required for
Windows to correctly associate toasts and taskbar entries. Format: reverse-DNS.

## Resolving the `gsd` binary

Order:

1. `settings.piBinaryPath` from registry if set.
2. `process.env.GSD_TAU_PI_PATH` if set (advanced users).
3. `which gsd` / `where gsd` result.
4. Well-known npm-global paths:
   - `%APPDATA%\npm\gsd.cmd`
   - `%USERPROFILE%\AppData\Roaming\npm\gsd.cmd`
   - `%ProgramFiles%\nodejs\gsd.cmd`
   - `C:\nvm4w\nodejs\gsd.cmd` and other nvm-for-windows patterns
5. If none found: block startup with the guided setup screen.

Detection runs on every launch. The result is cached in-memory only — if the
user changes pi installs while the app runs, we notice on next startup.

## Directory layout on disk

| Purpose | Path |
|---|---|
| App config / registry | `%APPDATA%\gsd-tau\registry.json` (+ `.bak`) |
| App logs | `%APPDATA%\gsd-tau\logs\gsd-tau.log` (rolling, 7 days) |
| Crash dumps | `%APPDATA%\gsd-tau\crashes\` |
| Renderer local storage | Electron default per-session in `%APPDATA%\gsd-tau\Local Storage\` |

pi's data (sessions, auth, `.gsd/` folders) is in `%USERPROFILE%\.gsd\` and each
project's `.gsd\`, exactly where pi puts it. We never move or duplicate it.

## Installer

`electron-builder` produces:
- `gsd-tau-Setup-x.y.z.exe` — signed NSIS installer, per-user install by default.
- `gsd-tau-x.y.z-portable.exe` — optional portable build for advanced users.
- Auto-update via GitHub Releases (published `.exe` + `latest.yml`).

Post-install script: sets `AppUserModelID`, does not touch pi at all.

## Signing

For public release: EV code-signing cert. Until then, users see SmartScreen
warnings — documented in README.

## What we skip in v1

- macOS / Linux support (design keeps most code portable, but no CI/testing on
  those platforms).
- Portable-mode nuances (roaming registry, XDG dirs).
- Sandboxing beyond Electron defaults (contextIsolation on, nodeIntegration off,
  sandbox on for renderers).
- Native modules — we should not need any; if we do, they get pre-built for
  Windows only.

## Build commands (target)

```
pnpm install
pnpm dev          # electron + vite HMR
pnpm build        # bundle
pnpm dist         # electron-builder installer
pnpm test         # vitest unit
pnpm test:e2e     # playwright end-to-end (spawns fake pi mock or real pi)
```

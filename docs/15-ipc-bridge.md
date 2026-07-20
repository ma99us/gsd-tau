# IPC Bridge — `window.gsd` Preload API

This document defines the complete surface of `window.gsd` — the contextBridge
API exposed by the Electron preload script to the renderer. Every renderer
feature that needs to talk to main process, spawn sessions, read settings, or
respond to events goes through this surface exclusively. No renderer code imports
Electron directly or has access to Node.js APIs.

Cross-references [10-architecture.md](./10-architecture.md) for the process
model and [90-tech-stack.md](./90-tech-stack.md) for the security constraints
(`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).

---

## 1. Design principles

- **Namespaced by domain.** Methods are grouped as `window.gsd.<domain>.<verb>()`.
  Each namespace maps to one cohesive area of main-process responsibility.
- **All methods return Promises.** No synchronous IPC. Timeouts on all invocations.
- **Events use typed callback registration**, not raw EventEmitter. Each `on*`
  returns an unsubscribe function for clean teardown.
- **Minimal surface.** The preload only routes — no business logic. Logic lives
  in main-process handlers or renderer hooks.
- **No raw Electron APIs exposed.** No `ipcRenderer`, no `remote`, no `shell`
  directly — only the typed methods listed here.

---

## 2. Preload implementation skeleton

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload);
}

function on(channel: string, handler: (...args: unknown[]) => void): () => void {
  const wrapped = (_: Electron.IpcRendererEvent, ...args: unknown[]) =>
    handler(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

contextBridge.exposeInMainWorld('gsd', {
  session:  sessionBridge(invoke, on),
  settings: settingsBridge(invoke, on),
  theme:    themeBridge(invoke, on),
  shell:    shellBridge(invoke),
  app:      appBridge(invoke, on),
  registry: registryBridge(invoke),
  update:   updateBridge(invoke, on),
});
```

The bridge is split into domain files under `src/preload/bridges/` to keep the
preload file readable. Each bridge function takes `invoke` and `on` as params
so the preload file remains the only place Electron is imported.

---

## 3. Namespace: `window.gsd.session`

Manages the lifecycle of pi RPC sessions. All methods scoped by `sessionId`.

```ts
interface SessionBridge {
  // Lifecycle
  create(opts: CreateSessionOpts): Promise<SessionInfo>;
  resume(opts: ResumeSessionOpts): Promise<SessionInfo>;
  close(sessionId: string, opts?: { graceful?: boolean }): Promise<void>;
  getState(sessionId: string): Promise<SessionState>;
  list(): Promise<SessionInfo[]>;

  // Turn control
  prompt(sessionId: string, msg: string, images?: ImageAttachment[]): Promise<{ runId: string }>;
  steer(sessionId: string, msg: string): Promise<void>;
  followUp(sessionId: string, msg: string): Promise<void>;
  abort(sessionId: string): Promise<void>;

  // History
  getHistory(sessionId: string): Promise<HistoryEntry[]>;

  // UI-request responses
  respondUI(sessionId: string, requestId: string, response: UIResponse): Promise<void>;

  // Fork
  fork(sessionId: string, entryId: string): Promise<SessionInfo>;

  // Event subscription — returns unsubscribe fn
  onEvent(sessionId: string, handler: (event: RpcEvent) => void): () => void;
  onStateChange(sessionId: string, handler: (state: SessionState) => void): () => void;
}

interface CreateSessionOpts {
  cwd: string;           // project directory (absolute path)
  provider?: string;
  model?: string;
  displayName?: string;
}

interface ResumeSessionOpts {
  cwd: string;
  sessionFile: string;   // path to pi's session JSON
  displayName?: string;
}

interface SessionInfo {
  sessionId: string;
  cwd: string;
  displayName: string;
  sessionFile: string;
  state: SessionState;
  createdAt: number;
}

type SessionState = 'working' | 'waiting' | 'idle' | 'auto' | 'stopped';
```

**IPC channels used** (internal, not part of the public surface):

| Invoke channel | Direction |
|---|---|
| `session:create` | renderer → main |
| `session:resume` | renderer → main |
| `session:close` | renderer → main |
| `session:get-state` | renderer → main |
| `session:list` | renderer → main |
| `session:prompt` | renderer → main |
| `session:steer` | renderer → main |
| `session:follow-up` | renderer → main |
| `session:abort` | renderer → main |
| `session:get-history` | renderer → main |
| `session:respond-ui` | renderer → main |
| `session:fork` | renderer → main |

| Event channel | Direction |
|---|---|
| `session:event:{sessionId}` | main → renderer |
| `session:state-change:{sessionId}` | main → renderer |

---

## 4. Namespace: `window.gsd.settings`

Read/write app-wide and per-session settings. See [42-settings.md](./42-settings.md)
for the full settings schema.

```ts
interface SettingsBridge {
  get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]>;
  getAll(): Promise<AppSettings>;
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;
  reset(key: keyof AppSettings): Promise<void>;
  resetAll(): Promise<void>;
  onChange(handler: (changed: Partial<AppSettings>) => void): () => void;
}
```

`onChange` fires whenever any key changes — renderers use this to react to
settings updated from another window.

---

## 5. Namespace: `window.gsd.theme`

Separated from settings because theme changes require immediate CSS cascade
updates and OS-level detection, making them a distinct concern.

```ts
interface ThemeBridge {
  get(): Promise<'light' | 'dark' | 'system'>;
  set(theme: 'light' | 'dark' | 'system'): Promise<void>;
  // Resolved effective theme (never 'system' — always 'light' or 'dark')
  getResolved(): Promise<'light' | 'dark'>;
  // Fires when user setting or OS preference changes
  onChange(handler: (setting: 'light' | 'dark' | 'system') => void): () => void;
  onResolvedChange(handler: (resolved: 'light' | 'dark') => void): () => void;
}
```

---

## 6. Namespace: `window.gsd.shell`

Safe wrappers around OS shell operations. Only actions listed here are permitted.
No arbitrary shell execution from the renderer.

```ts
interface ShellBridge {
  // Open a path in Windows Explorer (select the file/folder)
  revealInExplorer(absolutePath: string): Promise<void>;
  // Open a URL in the system browser — allowlisted schemes: https, http
  openExternal(url: string): Promise<void>;
  // Open a folder picker dialog — returns chosen path or null
  pickFolder(): Promise<string | null>;
  // Open a file open dialog
  pickFile(opts?: { filters?: FileFilter[]; title?: string }): Promise<string | null>;
  // Open a save-file dialog
  pickSaveFile(opts?: { defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>;
  // Run git diff in a project dir — returns the diff text
  gitDiff(cwd: string, args?: string[]): Promise<string>;
  // Full git status for the header bar and popover
  gitStatus(cwd: string): Promise<GitStatus | null>; // null = not a git repo
  // Check if a binary exists on PATH (used for pi detection preview)
  which(binary: string): Promise<string | null>;
}
```

`openExternal` validates the URL scheme before calling `shell.openExternal` in
main. Non-http/https URLs are rejected with an error.

```ts
interface GitStatus {
  branch: string;           // current branch name, or short SHA if detached
  detached: boolean;
  trackingBranch: string | null;   // e.g. 'origin/main', null if no upstream
  staged:    GitFile[];     // files in the index
  modified:  GitFile[];     // tracked files with unstaged changes
  untracked: GitFile[];     // untracked files
  ahead:  number;           // commits ahead of tracking branch
  behind: number;           // commits behind tracking branch
  unpushedCommits: UnpushedCommit[];
}

interface GitFile {
  status: 'M' | 'A' | 'D' | 'R' | '?';
  path: string;
}

interface UnpushedCommit {
  shortHash: string;
  subject: string;          // first line of commit message
}
```

Implemented in main via two shell calls:
- `git status --porcelain=v1 -u` — parses file status
- `git log @{u}.. --oneline` — unpushed commits (skipped when no upstream)

---

## 7. Namespace: `window.gsd.app`

Application-level controls and metadata.

```ts
interface AppBridge {
  getVersion(): Promise<string>;
  getPlatform(): Promise<'win32'>;          // always win32 in v1
  getAppDataPath(): Promise<string>;        // %APPDATA%\gsd-tau
  // Window management
  minimise(): Promise<void>;
  maximise(): Promise<void>;
  close(): Promise<void>;               // closes current window (may hide to tray)
  quit(): Promise<void>;                // full app quit with confirmation
  // Clipboard
  writeClipboard(text: string): Promise<void>;
  readClipboard(): Promise<string>;
  // Notifications
  showNotification(opts: NotificationOpts): Promise<void>;
  // Log access
  getLogPath(): Promise<string>;
  openLogFile(): Promise<void>;
  // Events
  onBeforeQuit(handler: () => void): () => void;
}

interface NotificationOpts {
  title: string;
  body?: string;
  silent?: boolean;
}
```

---

## 8. Namespace: `window.gsd.registry`

The project registry — the list of known projects and open sessions. Distinct
from settings (which is app config) and from the pi session store (which pi owns).
Full schema in [30-persistence.md](./30-persistence.md).

```ts
interface RegistryBridge {
  getProjects(): Promise<ProjectEntry[]>;
  addProject(cwd: string, displayName?: string): Promise<ProjectEntry>;
  removeProject(cwd: string): Promise<void>;
  updateProject(cwd: string, updates: Partial<ProjectEntry>): Promise<void>;
  // Most-recently-used list for the "Open recent" flyout
  getMRU(): Promise<ProjectEntry[]>;
  touchMRU(cwd: string): Promise<void>;
  // Session-to-tab mapping (what was open last time)
  getOpenTabs(): Promise<TabEntry[]>;
  setOpenTabs(tabs: TabEntry[]): Promise<void>;
  // Change events
  onChange(handler: (registry: RegistrySnapshot) => void): () => void;
}

interface ProjectEntry {
  cwd: string;
  displayName: string;
  lastOpenedAt: number;
  lastSessionFile?: string;
}

interface TabEntry {
  sessionId: string;
  windowId: number;
  tabIndex: number;
}
```

---

## 9. Namespace: `window.gsd.update`

Auto-update status and control. Full UX in [91-auto-update.md](./91-auto-update.md).

```ts
interface UpdateBridge {
  getStatus(): Promise<UpdateStatus>;
  checkNow(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<void>;
  installAndRestart(): Promise<void>;
  onStatusChange(handler: (status: UpdateStatus) => void): () => void;
}

type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; releaseNotes?: string }
  | { phase: 'downloading'; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };
```

---

## 10. Type declarations file

All types are declared in `src/preload/types.d.ts` and re-exported from
`src/renderer/lib/gsd.ts` so renderer code imports from one canonical location:

```ts
// src/renderer/lib/gsd.ts
export type {
  SessionBridge, SessionInfo, SessionState, RpcEvent,
  SettingsBridge, AppSettings,
  ThemeBridge,
  ShellBridge,
  AppBridge,
  RegistryBridge, ProjectEntry, TabEntry,
  UpdateBridge, UpdateStatus,
} from '../../preload/types';

// Convenience typed accessor
export const gsd = window.gsd;
```

Renderer code always imports from `@/lib/gsd`, never references `window.gsd`
directly. This keeps the global access point in one place and makes mocking in
tests trivial.

---

## 11. IPC channel naming convention

All channels follow `{namespace}:{verb}` in kebab-case:

```
session:create
session:prompt
session:event:abc123        ← sessionId suffix on event channels
settings:get
settings:set
theme:get
theme:set
shell:reveal-in-explorer
shell:open-external
app:get-version
app:write-clipboard
registry:get-projects
update:get-status
```

Suffixed channels (like `session:event:{sessionId}`) are used for event
broadcasts targeted at a specific session's subscribers.

---

## 12. Security constraints

| Constraint | Enforcement |
|---|---|
| No Node.js in renderer | `nodeIntegration: false`, `sandbox: true` |
| No raw IPC access | `contextIsolation: true` — `ipcRenderer` never exposed |
| No arbitrary shell execution | `shell.openExternal` only; URL scheme validated in main |
| No arbitrary file read/write | Only via `session.*` and `shell.pick*` dialogs |
| No `remote` module | Disabled globally — use IPC invoke |
| URL navigation lockdown | `will-navigate` handler in main rejects non-app URLs |
| `openExternal` allowlist | Schemes: `https`, `http` only. Everything else rejected. |

Main-process IPC handlers validate all inputs before acting. Invalid payloads
return a structured error response rather than throwing.

---

## 13. Error shape

All `invoke` rejections return a structured error so renderer code can handle
them without string-matching:

```ts
interface GsdIpcError {
  code: string;           // e.g. 'SESSION_NOT_FOUND', 'PI_NOT_RUNNING'
  message: string;        // human-readable
  sessionId?: string;
  retryable: boolean;
}
```

---

## 14. File locations

| File | Purpose |
|---|---|
| `src/preload/index.ts` | Entry point — assembles and exposes the bridge |
| `src/preload/bridges/session.ts` | Session namespace impl |
| `src/preload/bridges/settings.ts` | Settings namespace impl |
| `src/preload/bridges/theme.ts` | Theme namespace impl |
| `src/preload/bridges/shell.ts` | Shell namespace impl |
| `src/preload/bridges/app.ts` | App namespace impl |
| `src/preload/bridges/registry.ts` | Registry namespace impl |
| `src/preload/bridges/update.ts` | Update namespace impl |
| `src/preload/types.d.ts` | All shared TypeScript interfaces |
| `src/renderer/lib/gsd.ts` | Renderer-side typed re-export |
| `src/main/ipc/` | Main-process handler registration (one file per namespace) |

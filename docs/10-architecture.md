# Architecture

## Process model

```
┌───────────────────────────────────────────────────────────────┐
│  Electron main process (Node)                                 │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ SessionManager                                          │  │
│  │  Map<SessionId, SessionHandle>                          │  │
│  │   - spawn RpcClient per project                         │  │
│  │   - fan out events to subscribed renderers              │  │
│  │   - route commands from renderers to the right session  │  │
│  │   - persist session registry (see 30-persistence.md)    │  │
│  │   - own OS-level notifications & tray badges            │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌───────────┐   ┌───────────┐   ┌───────────┐                │
│  │ RpcClient │   │ RpcClient │   │ RpcClient │  ...           │
│  │ (proj A)  │   │ (proj B)  │   │ (proj C)  │                │
│  └─────┬─────┘   └─────┬─────┘   └─────┬─────┘                │
└────────┼───────────────┼───────────────┼──────────────────────┘
         │ stdio JSON    │               │
    ┌────▼─────┐    ┌────▼─────┐    ┌────▼─────┐
    │ gsd      │    │ gsd      │    │ gsd      │
    │ --mode   │    │ --mode   │    │ --mode   │
    │ rpc (A)  │    │ rpc (B)  │    │ rpc (C)  │
    └──────────┘    └──────────┘    └──────────┘

┌───────────────────────────────────────────────────────────────┐
│  Renderer processes (Chromium) — one per BrowserWindow        │
│                                                               │
│  Window 1                          Window 2 (detached tab)    │
│  ┌─────────────────────────┐       ┌──────────────────────┐   │
│  │ TabBar [A][B*][C][+]    │       │ TabBar [D]           │   │
│  │ ┌─────────────────────┐ │       │ ┌──────────────────┐ │   │
│  │ │ SessionView (B)     │ │       │ │ SessionView (D)  │ │   │
│  │ │  chat + auto-view + │ │       │ │                  │ │   │
│  │ │  modals + model UI  │ │       │ │                  │ │   │
│  │ └─────────────────────┘ │       │ └──────────────────┘ │   │
│  └─────────────────────────┘       └──────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

## Boundaries

| Layer | Runtime | Owns |
|---|---|---|
| Main process | Node in Electron | Session lifecycle, pi child processes, RPC transport, OS integration (tray, notifications, taskbar), persistence store, single-instance lock |
| Renderer | Chromium | UI only. React/Svelte views, tab management within a window, chat rendering, modals. Stateless-ish — main is the source of truth. |
| pi child | Node (spawned) | The actual agent — model calls, tool execution, `.gsd/` writes, session file writes. We don't touch its internals. |

Renderers never spawn pi children and never touch the filesystem for GSD state.
All state flows main ↔ renderer over IPC. This keeps windows/tabs interchangeable
and makes crash recovery trivial (renderers can die freely).

## IPC contract (renderer ↔ main)

We use Electron's `ipcMain.handle` / `ipcRenderer.invoke` for request/response and
`webContents.send` / `ipcRenderer.on` for main-initiated events.

**Renderer → main (request/response, awaitable):**
```ts
window.gsd.listSessions(): Promise<SessionSummary[]>
window.gsd.openProject(cwd: string): Promise<SessionId>          // create-or-attach
window.gsd.attachToTab(sessionId, windowId, tabId): Promise<void>
window.gsd.prompt(sessionId, msg): Promise<{ runId }>
window.gsd.steer(sessionId, msg): Promise<void>
window.gsd.abort(sessionId): Promise<void>
window.gsd.respondUI(sessionId, requestId, response): Promise<void>
window.gsd.setModel(sessionId, provider, modelId): Promise<void>
window.gsd.getAvailableModels(sessionId): Promise<ModelInfo[]>
window.gsd.getSessionStats(sessionId): Promise<SessionStats>
window.gsd.getCommands(sessionId): Promise<RpcSlashCommand[]>
window.gsd.closeSession(sessionId, opts): Promise<void>
```

**Main → renderer (fan-out events):**
```ts
'session:event'          { sessionId, event: SdkAgentEvent }
'session:state-change'   { sessionId, state: SessionUiState }   // Working|Waiting|Idle|Stopped|Auto
'session:ui-request'     { sessionId, request: RpcExtensionUIRequest }
'session:cost-update'    { sessionId, event: RpcCostUpdateEvent }
'session:progress'       { sessionId, progress: GsdProgress }   // milestone/slice/task, see 50-*
'sessions:registry'      { sessions: SessionSummary[] }         // debounced snapshots
```

Each renderer subscribes to events only for the sessions its tabs display, keyed by
sessionId. The main process filters before sending.

## Module map (proposed source layout)

```
app/
  main/                           # Electron main-process code
    index.ts                       # app.whenReady, single-instance lock, window mgmt
    session/
      session-manager.ts           # the map + lifecycle
      session-handle.ts            # one RpcClient + event pump + derived state
      state-machine.ts             # SdkAgentEvent → SessionUiState transitions
      progress-tracker.ts          # tool_use events → GsdProgress (see 50-*)
    ipc/
      handlers.ts                  # ipcMain.handle registrations
      fanout.ts                    # per-window/session subscription filter
    persistence/
      registry-store.ts            # our JSON registry (see 30-*)
    os/
      tray.ts                      # system tray + jump list
      notifications.ts             # Windows toast API
      single-instance.ts
    pi/
      resolve-pi.ts                # locate the `gsd` binary + version detect
      client-factory.ts            # builds RpcClient with our defaults
  renderer/                       # React app
    windows/
      main-window.tsx
    components/
      tab-bar.tsx
      session-view.tsx
      auto-run-view.tsx
      chat-view.tsx
      model-picker.tsx
      context-gauge.tsx
      command-palette.tsx
      ui-request-modal.tsx
    state/
      session-store.ts             # Zustand slice per session
      ipc-bridge.ts
  preload/
    preload.ts                     # exposes `window.gsd` API via contextBridge
  shared/
    types.ts                       # SessionUiState, SessionSummary, GsdProgress
```

## Concurrency and backpressure

- Each `RpcClient` has its own stdio pipes. Event streams are consumed by a single
  async generator per session (`for await (const ev of client.events())`). No
  cross-session blocking.
- Events are pushed to renderers via `webContents.send`. Electron's IPC does not
  drop messages, so we throttle noisy streams (`text_delta` in particular) to
  ~60fps at the main-process boundary. Everything else passes through.
- The main process keeps a bounded ring buffer of the last N events per session
  (default N=1000, configurable) so a renderer window that opens late can catch up
  without replaying from disk.

## Failure modes and recovery

| Failure | Behaviour |
|---|---|
| pi child crashes | Session moves to **Stopped**. Renderer sees badge. User can hit "Restart session" — we relaunch pi with `switch_session <sessionFile>` to resume the same conversation. |
| pi hangs (unresponsive to `get_state`) | Watchdog after 30s: mark **Stopped**, offer restart. |
| Renderer crashes | Main process keeps the session running. New window/tab reattaches. |
| Main process crashes | OS terminates pi children. On next launch, registry replays and offers to resume auto-mode sessions. |
| Two app instances launched | Second instance forwards its `--open-project <path>` to the first via single-instance lock and exits. |

## Why one main-process SessionManager (not one per window)

Sessions outlive windows. A user closes the last window → app minimises to tray →
sessions keep running. Windows are views. This is why all pi children live in main.

## What the renderer must never do

- Spawn `gsd` or any child process.
- Read/write `.gsd/gsd.db`, `.gsd/sessions/`, or any pi-managed file.
- Import `@opengsd/rpc-client` or `@opengsd/contracts` runtime code (types-only imports OK via preload).
- Call Node APIs (`fs`, `child_process`). Context isolation is on; only `window.gsd` is exposed.

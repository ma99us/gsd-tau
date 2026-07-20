# Error Handling and Recovery

This document defines the error taxonomy, recovery paths, and UI treatment for
every failure mode in gsd-tau. The goal: every error is named, has an owner
(main or renderer), has a defined recovery path, and either surfaces to the
user at the right level of detail or is handled silently.

Cross-references [40-ui-design.md](./40-ui-design.md) for session state
transitions, [15-ipc-bridge.md](./15-ipc-bridge.md) for the IPC error shape,
and [12-logging.md](./12-logging.md) for the logging strategy.

---

## 1. Error taxonomy

Errors are grouped into five classes by source and recoverability:

| Class | Source | Recoverable? | User visible? |
|---|---|---|---|
| **Session** | pi child process or RPC layer | Usually | Always |
| **IPC** | Renderer ↔ main communication | Sometimes | Conditionally |
| **Registry / persistence** | File I/O on registry.json | Rarely | Always |
| **Shell / OS** | git, file system, external processes | Usually | Conditionally |
| **App** | Unhandled exceptions in main or renderer | Rarely | Always |

---

## 2. Session errors

### 2.1 pi child failed to start

**Cause:** Binary not found, wrong Node version, permission denied, or pi
startup crash before the RPC handshake completes.

**Detection:** `RpcClient.start()` rejects, or no `init` response within 10 s.

**UI:**
```
┌─────────────────────────────────────────────────────────────┐
│ ⚠  Could not start pi                                       │
│                                                             │
│  gsd exited before responding.                              │
│  Exit code: 1                                               │
│                                                             │
│  Last output:                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Error: Cannot find module '@opengsd/contracts'       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  [Open logs]  [Check pi version]  [Retry]  [Close tab]     │
└─────────────────────────────────────────────────────────────┘
```

- Stderr tail (last 20 lines) shown in a scrollable code block.
- "Check pi version" opens the pi Integration section of Settings.
- "Retry" re-runs `client.start()` with the same options.
- Log entry: `ERROR session:start-failed cwd={} exitCode={} stderr={}`.

### 2.2 pi child crashed mid-session

**Cause:** OOM, unhandled exception in pi, OS signal, watchdog timeout.

**Detection:** `child.on('exit')` fires unexpectedly, or `get_state` heartbeat
fails to respond within 30 s.

**UI:** Session state → **Stopped**. Tab badge: grey `⚠`.

Chat pane banner:
```
⚠  Session stopped — pi exited unexpectedly
[Retry]  [Close tab]
```

Composer is disabled. Existing chat history remains visible.

**Retry:** Respawns pi with `--continue` (same cwd + session file). On success:
- State → **Idle**.
- System event pill in chat: "↺ Session restarted after crash".
- In-flight turn (if any) is lost — pi doesn't replay it. A second system
  pill appears if the session was mid-turn: "⚠ Active turn was lost — pi did
  not complete it. You may need to re-submit."

**Log entry:** `ERROR session:crashed sessionId={} exitCode={} signal={} wasActive={}`

### 2.3 RPC command timeout

**Cause:** pi is running but not responding to a specific command within the
timeout window (default: 30 s for `prompt`, 5 s for all others).

**Detection:** `RpcClient.invoke()` rejects with a timeout error.

**UI treatment by command:**

| Command | Timeout | UI response |
|---|---|---|
| `prompt` | 30 s | Show "⚠ No response from pi" banner; offer Retry / Abort |
| `steer` / `follow_up` | 5 s | Silent retry once; then show inline warning |
| `get_state` | 5 s | Three consecutive failures → treat as crash (§2.2) |
| `shutdown` | 10 s | Force-kill pi child; log warning |
| Other commands | 5 s | Log + return error to caller |

### 2.4 RPC protocol error

**Cause:** pi returned a malformed response, unknown error code, or the
session file was corrupted.

**Detection:** `RpcClient` emits a protocol error event.

**UI:** Session state → **Stopped** with the same banner as §2.2.
Additional detail in the banner: "Protocol error — the session file may be
corrupted. You may need to start a new session."

**Log entry:** `ERROR session:protocol-error sessionId={} detail={}`

### 2.5 pi version mismatch

**Cause:** User's installed pi version is older than the minimum required
(`1.11.0`).

**Detection:** `init` response returns a version below the minimum, or
`init` fails because a required capability is missing.

**UI:** Session cannot open. Error screen (not a banner):
```
⚠  pi version too old
gsd-tau requires pi ≥ 1.11.0.
Your version: 1.9.3 at C:\nvm4w\nodejs\gsd.cmd

[Update pi]  [Learn more]  [Close tab]
```
"Update pi" opens `https://opengsd.net` in the system browser.

---

## 3. IPC errors

### 3.1 IPC invoke rejection

Every `window.gsd.*` call can reject with a `GsdIpcError` (defined in
[15-ipc-bridge.md §13](./15-ipc-bridge.md)):

```ts
interface GsdIpcError {
  code: string;
  message: string;
  sessionId?: string;
  retryable: boolean;
}
```

Renderer code must handle rejections for every IPC call. Unhandled IPC
rejections are caught by the global error boundary (§5.2) and shown as a
toast rather than crashing the renderer.

**Standard error codes:**

| Code | Meaning | Retryable |
|---|---|---|
| `SESSION_NOT_FOUND` | sessionId no longer exists | No |
| `PI_NOT_RUNNING` | pi child is not alive | Yes |
| `SETTINGS_INVALID` | Validation failed on a settings write | No |
| `SHELL_DENIED` | openExternal URL blocked | No |
| `REGISTRY_WRITE_FAILED` | Disk write to registry.json failed | Yes |
| `IPC_TIMEOUT` | Main process did not respond in time | Yes |
| `UNKNOWN` | Unexpected main-process exception | Maybe |

### 3.2 IPC channel not available

**Cause:** Renderer called `window.gsd` before the preload was ready, or a
required bridge namespace is missing.

**Prevention:** The `src/renderer/lib/gsd.ts` module checks `window.gsd`
exists on import and throws a startup error if not. This should never happen
in production but protects against preload mis-configuration in development.

---

## 4. Registry / persistence errors

### 4.1 Registry file corrupt or unreadable

**Cause:** Disk error, crash during write, manual tampering.

**Detection:** `JSON.parse` fails on `registry.json` at startup.

**Recovery:**
1. Log the error and the bad content.
2. Attempt to load `registry.json.bak` (the previous-write backup).
3. If the backup loads successfully: use it, show a one-time toast: "Registry
   was restored from backup — some recent changes may be lost."
4. If the backup also fails: start with an empty registry (no projects, default
   settings). Toast: "Registry could not be read — starting fresh. Your project
   directories are untouched."

**Log entry:** `ERROR registry:parse-failed path={} error={} backedUpLoaded={}`

### 4.2 Registry write failure

**Cause:** Disk full, permissions error, antivirus lock.

**Detection:** The atomic write (tmp → rename) throws.

**UI:** Toast (non-blocking):
```
⚠ Could not save preferences — check disk space.   [Dismiss]
```

The in-memory state is still updated; the next successful write will persist it.

**Log entry:** `ERROR registry:write-failed path={} error={}`

---

## 5. Application errors

### 5.1 Main process unhandled rejection

**Handling:**
```ts
process.on('unhandledRejection', (reason, promise) => {
  log.error('main:unhandled-rejection', { reason, promise });
  // Do not crash. Log and continue.
});
process.on('uncaughtException', (err) => {
  log.error('main:uncaught-exception', { err });
  // Attempt graceful shutdown of all sessions before exit.
  sessionManager.shutdownAll({ graceful: false }).finally(() => process.exit(1));
});
```

`uncaughtException` is fatal — the main process exits after flushing sessions.
`unhandledRejection` is logged but not fatal (Node 15+ would crash; we
suppress this intentionally to avoid cascading from a single bad IPC handler).

### 5.2 Renderer error boundary

The top-level React tree is wrapped in an error boundary that catches render
errors:

```tsx
// src/renderer/ErrorBoundary.tsx
class AppErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    log.error('renderer:render-error', { error, componentStack: info.componentStack });
  }
  render() {
    if (this.state.hasError) {
      return <CrashScreen error={this.state.error} onReset={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}
```

**CrashScreen** shows:
```
⚠  Something went wrong
gsd-tau encountered an unexpected error.

[error.message]

[Copy error details]  [Open logs]  [Reload window]
```

"Reload window" calls `window.location.reload()` — the renderer restarts while
the main process and all pi sessions remain alive.

### 5.3 Per-session render errors

Session-level errors (bad event shape, render crash for one chat message) are
caught by a session-scoped error boundary, not the app-level one. The failing
turn renders as:

```
⚠  Could not render this message   [Copy raw JSON]
```

The session continues; no other messages are affected.

---

## 6. Shell / OS errors

### 6.1 git not available

**Cause:** git not on PATH.

**Detection:** `shell.gitDiff()` rejects with `code: 'GIT_NOT_FOUND'`.

**UI treatment:** Features that depend on git degrade gracefully:
- "What changed" diff card (§3.6 of [45-chat-experience.md](./45-chat-experience.md)): omitted silently.
- Code block Diff action: button hidden.
- No error shown to user — these are enhancements, not core features.

### 6.2 Reveal in Explorer failure

**Detection:** `shell.openPath()` or the equivalent returns an error.

**UI:** Toast: "Could not open Explorer — path may no longer exist."

### 6.3 openExternal blocked

**Cause:** URL scheme not in allowlist (anything other than `http`/`https`).

**UI:** Toast: "Cannot open this link — scheme not allowed."
This is a security boundary, not a user error. Logged at `WARN` level with the
attempted URL for review.

---

## 7. Error surfaces summary

| Surface | Used for |
|---|---|
| Full-screen error page | Pi not found at startup, pi version too old |
| Tab crash banner | Pi crashed, RPC timeout, protocol error |
| Toast (non-blocking) | Registry write failed, reveal in Explorer failed, settings save failed |
| Inline chat message | Per-turn render error, in-flight turn lost after restart |
| Settings UI inline | Pi binary verification failure, invalid settings field |
| System notification | Session stopped (mirrors tab badge, for background tabs) |
| Silent (log only) | git not found, transient IPC warnings, non-fatal unhandledRejections |

---

## 8. Logging policy for errors

All errors are logged with structured fields. See [12-logging.md](./12-logging.md)
for the logger API and rotation policy. Error log entries always include:

- `level` — `error` or `warn`
- `context` — namespaced string (e.g. `session:crashed`)
- `sessionId` — when applicable
- `error.message` and `error.stack`
- Redacted values: never log message content, file content, API keys, or
  auth tokens even in error context.

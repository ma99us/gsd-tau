# Logging

This document specifies the logging strategy for both the main process and
renderer, the log file location and rotation policy, and the structured log
format.

Cross-references [11-error-handling.md §8](./11-error-handling.md) for the
error-specific logging policy and [42-settings.md §2](./42-settings.md) for
the `advanced.logLevel` setting.

---

## 1. Logger library

**`electron-log`** — zero-dependency, supports file transport with rotation,
works across main and renderer processes, level-gated. Configured at app
startup in `src/main/logger.ts`.

---

## 2. Log levels

| Level | When to use |
|---|---|
| `error` | Unrecoverable errors, crashes, pi process failures, IPC rejections |
| `warn` | Degraded behaviour, retried operations, unexpected-but-handled states |
| `info` | Session lifecycle (start, stop, restore), settings changes, updates |
| `debug` | IPC call traces, state machine transitions, event payloads |
| `verbose` | High-frequency events (token streaming, scroll position) — disabled in production |

Default level: `info`. Changed via `settings.advanced.logLevel`. Takes effect
immediately (no restart needed).

---

## 3. Log file location

```
%APPDATA%\gsd-tau\logs\
  main.log          ← main process
  renderer.log      ← renderer process (all windows)
```

Accessible from: Settings → Advanced → [Open log folder].

---

## 4. Rotation policy

`electron-log` is configured with:

```ts
log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB per file
log.transports.file.archiveLog = (oldPath) => {
  // rename to main.old.log / renderer.old.log — one backup kept
};
```

- When `main.log` exceeds 10 MB, it is rotated to `main.old.log`.
- Only one archive is kept. Older archives are deleted.
- Total max disk use: ~20 MB for main + ~20 MB for renderer = ~40 MB.

---

## 5. Log format

Structured JSON, one object per line:

```jsonc
{
  "ts": "2026-07-20T11:42:03.412Z",
  "level": "info",
  "context": "session:start",
  "sessionId": "s_ab12cd",
  "cwd": "D:/Projects/gsd-tau",
  "model": "anthropic/claude-sonnet-4-5"
}
```

Fields always present: `ts`, `level`, `context`.
Additional fields are context-specific (see §6).

Human-readable format is used in the console (dev mode only):
```
[11:42:03] INFO  session:start  s_ab12cd  D:/Projects/gsd-tau
```

---

## 6. Canonical context names

| Context | Level | Key extra fields |
|---|---|---|
| `session:start` | info | `sessionId`, `cwd`, `model` |
| `session:stop` | info | `sessionId`, `reason` |
| `session:crashed` | error | `sessionId`, `exitCode`, `signal`, `wasActive` |
| `session:start-failed` | error | `cwd`, `exitCode`, `stderrTail` |
| `session:restore` | info | `sessionId`, `cwd`, `wasAutoRunning` |
| `session:protocol-error` | error | `sessionId`, `detail` |
| `ipc:invoke` | debug | `channel`, `sessionId`, `durationMs` |
| `ipc:error` | warn | `channel`, `code`, `sessionId` |
| `registry:write` | debug | `path` |
| `registry:write-failed` | error | `path`, `error` |
| `registry:parse-failed` | error | `path`, `backedUpLoaded` |
| `update:available` | info | `version`, `channel` |
| `update:downloaded` | info | `version` |
| `update:error` | error | `message` |
| `update:signature-failed` | error | `message` |
| `theme:change` | debug | `from`, `to` |
| `model:change` | info | `sessionId`, `from`, `to` |
| `thinking:change` | debug | `sessionId`, `from`, `to` |
| `main:unhandled-rejection` | error | `reason` |
| `main:uncaught-exception` | error | `err` |
| `renderer:render-error` | error | `error`, `componentStack` |

New contexts must follow the `subsystem:event` naming convention and be added
to this table when introduced.

---

## 7. What is never logged

- **Message content** — user prompts, agent responses, tool outputs.
- **File content** — arguments to `read`, `write`, etc.
- **Auth tokens, API keys, credentials** — from any source.
- **Personal paths beyond what is needed** — `cwd` is logged; file contents
  are not.

The rule: log *that* something happened and *whether* it succeeded; never log
*what* was in the data.

---

## 8. Renderer logging

The renderer sends structured log entries to main via IPC channel
`log:entry`, which main's logger appends to `renderer.log`. This keeps all
I/O in the main process and avoids any filesystem access from the renderer.

```ts
// src/renderer/lib/log.ts
export const log = {
  info:  (context: string, data?: object) => window.gsd.app.log('info',  context, data),
  warn:  (context: string, data?: object) => window.gsd.app.log('warn',  context, data),
  error: (context: string, data?: object) => window.gsd.app.log('error', context, data),
  debug: (context: string, data?: object) => window.gsd.app.log('debug', context, data),
};
```

Renderer logs are prefixed with `[renderer]` in `renderer.log` for easy grep.

---

## 9. Dev mode extras

In development (`NODE_ENV === 'development'`):
- `verbose` level is enabled.
- Logs are also written to stdout in the human-readable format.
- IPC call traces (`ipc:invoke`) are emitted at `debug` level for every call.
- State machine transitions are logged at `debug` level with before/after state.

In production, none of the above apply and `verbose` is permanently suppressed
regardless of `settings.advanced.logLevel`.

---

## 10. File locations

| File | Purpose |
|---|---|
| `src/main/logger.ts` | `electron-log` configuration, rotation, format |
| `src/main/ipc/log.ts` | IPC handler that receives renderer log entries |
| `src/renderer/lib/log.ts` | Renderer-side log helper (thin IPC wrapper) |

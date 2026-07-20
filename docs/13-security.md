# Security

This document specifies the security boundaries for gsd-tau: what the renderer
is allowed to do, how IPC is hardened, what the preload exposes, and the threat
model for a local Electron app that shells out to a trusted child process.

Cross-references [15-ipc-bridge.md](./15-ipc-bridge.md) for the full IPC
surface, [20-pi-integration.md](./20-pi-integration.md) for the pi child
process model, and [70-auth-github-copilot.md](./70-auth-github-copilot.md)
for credential handling.

---

## 1. Threat model

gsd-tau is a **local desktop app**. It does not run on a server and does not
accept inbound network connections. The relevant threat surface is:

| Threat | Vector | Mitigation |
|---|---|---|
| Malicious web content via `<webview>` or `loadURL` | Renderer loading untrusted URLs | No `<webview>` tags; no `loadURL` for external content |
| Prompt injection via agent output | Agent returns crafted content that triggers IPC | Renderer never `eval`s agent output; IPC only via preload bridge |
| Credential exfiltration | Main process logs or IPC returns auth data | Credentials never cross IPC; never logged |
| Registry file tampering | User manually edits registry.json | Schema validated on load; migrations are additive |
| Arbitrary shell execution | Renderer triggers shell commands | Shell bridge whitelist; no arbitrary command execution |
| RCE via pi | Malicious pi binary | Pi is user-installed on PATH; trust matches npm global package |
| Node integration in renderer | Direct Node.js access from page JS | `nodeIntegration: false` on all `BrowserWindow` instances |

This is not a hardened public-facing service. The user is the operator, pi is
a trusted subprocess, and the primary security goal is **containment** — the
renderer cannot break out of its sandbox or access OS resources directly.

---

## 2. Electron security baseline

All `BrowserWindow` instances are created with:

```ts
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,          // renderer has no Node.js access
    contextIsolation: true,          // preload and page JS are in separate contexts
    sandbox: true,                   // OS-level sandbox where Electron supports it
    webSecurity: true,               // same-origin policy enforced
    allowRunningInsecureContent: false,
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

These settings are non-negotiable and must not be relaxed for any feature.

---

## 3. Content Security Policy

All renderer pages are served with a strict CSP header set by the main process:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self' data:;
  connect-src 'none';
  object-src 'none';
  frame-src 'none';
```

`'unsafe-inline'` for styles is required by Tailwind's JIT output in
development. In production the stylesheet is a static file so `'unsafe-inline'`
can be removed — tracked as a post-v1 hardening task.

`connect-src 'none'` prevents the renderer from making any outbound network
requests directly. All network access goes through the main process via IPC.

---

## 4. IPC hardening

### 4.1 Channel allowlist

Only channels registered in `src/main/ipc/index.ts` are active. The preload
script exposes only the namespaced `window.gsd.*` API; raw `ipcRenderer.invoke`
is not exposed to page JS.

### 4.2 Input validation

Every IPC handler validates its arguments before use:

- `sessionId` parameters are checked against the live session map; unknown IDs
  return `SESSION_NOT_FOUND` without touching any state.
- File paths from the renderer are not used for arbitrary reads or writes; only
  whitelisted operations (reveal in Explorer, git diff for a known `cwd`) are
  permitted.
- No IPC handler calls `eval` or constructs shell commands from renderer input.

### 4.3 `shell.openExternal` allowlist

Only `http` and `https` URL schemes are permitted:

```ts
function openExternal(url: string) {
  const { protocol } = new URL(url);
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new GsdIpcError({ code: 'SHELL_DENIED', message: 'Scheme not allowed' });
  }
  shell.openExternal(url);
}
```

### 4.4 Shell bridge whitelist

`window.gsd.shell` exposes a limited set of operations. The main-process
handler does **not** accept arbitrary commands — each operation is a
named function with fixed semantics:

| Allowed | Not allowed |
|---|---|
| `openPath(absPath)` — reveal in Explorer | Arbitrary `exec` / `spawn` |
| `openExternal(httpUrl)` — open browser | Shell commands from renderer input |
| `gitDiff(cwd, safeArgs[])` — predefined git args only | Writing files outside the app data dir |
| `gitStatus(cwd)` — read-only status | Reading arbitrary files |
| `which(binary)` — PATH lookup | Setting env vars |

`gitDiff` accepts only a whitelist of git arguments (`['HEAD', '--staged',
'--name-only', ...]`); freeform arguments from the renderer are rejected.

---

## 5. Credential handling

- **Auth tokens** are owned by pi, stored in `%USERPROFILE%\.gsd\auth.json`.
  gsd-tau never reads, writes, or copies this file.
- **Copilot device codes** are shown to the user via pi's
  `extension_ui_request` modal. We render the code; we never store it.
- **No credentials cross IPC.** `get_available_models` returns model names and
  auth state (boolean `authenticated`), not tokens.
- **Nothing is logged that could contain credentials.** See
  [12-logging.md §7](./12-logging.md).

---

## 6. pi child process trust

pi is treated as a **trusted subprocess** on par with other globally-installed
developer tools (`git`, `node`, `npm`). We do not sandbox pi beyond what the OS
provides for normal child processes.

Trust boundary decisions:
- We do not verify pi's binary signature at runtime (that is npm's job on
  install).
- We do pass `cwd` to pi; we do not filter what pi reads or writes within
  that cwd — that is the user's and pi's domain.
- If a malicious binary is placed on PATH ahead of the real pi, the user's
  machine is already compromised. This is outside our threat model.

---

## 7. Registry file

`registry.json` contains session metadata and settings. It does not contain
credentials. Security properties:

- Stored in `%APPDATA%\gsd-tau\` — user-writable, user-readable, not world-
  readable on standard Windows ACLs.
- No secrets fields are defined in the schema. If a future feature requires
  storing a token, it must use DPAPI (`safeStorage.encryptString`) — never
  plaintext JSON.
- Schema validated on load; unknown keys are preserved but ignored.

---

## 8. Auto-update integrity

`electron-updater` verifies the downloaded update against a code-signing
certificate and the `sha512` hash published in `latest.yml` before installing.
Updates that fail signature verification are rejected and logged at
`error update:signature-failed`. See [91-auto-update.md §8](./91-auto-update.md).

---

## 9. Dependency hygiene

- `npm audit` runs in CI on every PR. High/critical vulnerabilities block merge.
- Direct dependencies are pinned to exact versions in `package.json`.
- `electron` major version is updated on a regular schedule to stay within
  Chromium's security support window.

---

## 10. Known limitations (v1)

| Limitation | Notes |
|---|---|
| `'unsafe-inline'` styles in dev | Hardening tracked post-v1 |
| pi binary not signature-verified at runtime | Matches npm global package trust model |
| No rate-limiting on IPC | Renderer is same-origin trusted; not needed for local app |
| Log files are plaintext | No PII in logs by policy (§7 of logging doc); OS ACLs apply |

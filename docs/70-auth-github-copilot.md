# GitHub Copilot Login

pi already supports `github-copilot` as a first-class provider with a browser-based
OAuth device-code flow. We do not reimplement any of it. See [ADR-003](./decisions/ADR-003-delegate-auth-to-pi.md).

## What pi does today

- Provider id: `github-copilot`
- Env var / token store: `COPILOT_GITHUB_TOKEN` (also aliased as `GITHUB_TOKEN`
  in some places), persisted to `%USERPROFILE%\.gsd\auth.json`.
- Login trigger: `/login` slash command inside the pi TUI, or `gsd config`
  wizard on first run. Both flows do:
  1. Contact GitHub's device-code endpoint.
  2. Show the user a code + a verification URL (e.g. `https://github.com/login/device`).
  3. Open the URL in the system browser (or ask the user to open it).
  4. Poll for token, save on success.
- Available models after login: `claude-sonnet-4-5`, `claude-opus-4`, `gpt-5`
  and friends, proxied via `https://api.individual.githubcopilot.com`. Populated
  automatically by pi in `get_available_models`.

## What gsd-tau does

We trigger and observe pi's flow through RPC. We never touch the token, the
device-code endpoint, or GitHub directly.

### Trigger

The user clicks **Add provider → GitHub Copilot** in the model picker footer,
or runs `/login` from the command palette. Both paths call:

```ts
client.prompt('/login github-copilot');
```

pi's `/login` prompt is a slash command that runs pi's onboarding auth path.
(If the flag/argument differs in some future pi version, we feature-detect and
adapt — see [80-forward-compatibility.md](./80-forward-compatibility.md).)

### Observe

The flow emits standard events:

1. `agent_start` → session enters Working.
2. One or more `extension_ui_request` events:
   - `notify` — pi shows the device code and URL. **We render this specially**
     (see below).
   - `confirm` — "Open browser now?" (Yes/No modal).
   - `notify` — polling status ("Waiting for authorization…").
   - `notify` — "Login succeeded" or "Login failed".
3. `agent_end` — flow done.

### Special renderer for the device-code notify

When we see a `notify` request whose message matches the device-code shape
(URL + short alphanumeric code), we swap the generic toast for a dedicated
**Copilot Login modal**:

```
┌ Sign in to GitHub Copilot ────────────────────┐
│                                               │
│  Enter this code at:                          │
│    https://github.com/login/device            │
│                                               │
│    ┌──────────────┐                           │
│    │  ABCD-1234   │  [ Copy ]                 │
│    └──────────────┘                           │
│                                               │
│  [ Open browser ]  [ Copy URL ]  [ Cancel ]   │
│                                               │
│  Waiting for authorization…                   │
│                                               │
└───────────────────────────────────────────────┘
```

Detection is heuristic (regex on message body). If the shape doesn't match,
we render the plain `notify` UI — no data loss.

On success, we detect the success `notify` and:
- Close the modal.
- Show a toast "Signed in to GitHub Copilot".
- Refresh `get_available_models` and the model picker.

## Where the token lives

`%USERPROFILE%\.gsd\auth.json`, managed by pi. gsd-tau never reads or writes it.
This means:

- Any tool using pi on the same machine shares the login (TUI, gsd-tau, other wrappers).
- Signing out is a pi concern — we surface a "Sign out" menu item that calls
  `/logout github-copilot` via `prompt()` (again, feature-detected).
- Multiple GitHub accounts: whatever pi supports, we surface. In v1 we don't
  build multi-account UI on top.

## First-run: no provider at all

If `get_available_models()` returns empty on a brand-new session, we show a
provider-choice screen with three options:

1. **Sign in with GitHub Copilot** (recommended, cheapest for many users) → runs the flow above.
2. **Sign in with browser (ChatGPT / Codex)** → same flow, different provider id.
3. **Paste an API key** → deep-links into pi's `/login` command with the chosen provider.

This screen is a v1 must-have because a session with no models can do nothing.

## Failure modes

- **Device code expired**: pi emits a failure `notify`. Modal shows the message,
  offers Retry (re-runs `/login`).
- **Browser didn't open**: our "Open browser" button uses Electron's
  `shell.openExternal`. If it fails, we show a "Copy URL" fallback.
- **Network to `github.com` blocked**: pi surfaces the error message; we show it verbatim.
- **User closes the modal mid-flow**: we send `{ cancelled: true }` on the
  outstanding UI-request. pi aborts the login attempt.

## Why not a native device-code flow inside gsd-tau

We could speak the GitHub device-code endpoint directly and write to
`.gsd\auth.json`. We deliberately don't:

- Duplicates code that changes when pi updates its auth format.
- Two writers to the same auth file = corruption risk.
- Copilot endpoint headers and token refresh behaviour are pi's concern.
- The delegated flow is ~50 lines. The native flow is ~500 and would need to
  track pi's schema forever.

See [ADR-003](./decisions/ADR-003-delegate-auth-to-pi.md) for the full rationale.

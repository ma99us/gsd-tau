# Forward Compatibility

The user will update `gsd` (pi) on their own schedule via `npm i -g @opengsd/gsd-pi`
or `gsd update`. gsd-tau must keep working. See [ADR-005](./decisions/ADR-005-forward-compatibility-strategy.md)
and [ADR-007](./decisions/ADR-007-no-bundled-pi.md).

## What we depend on

Stable, contract-versioned surfaces only:

| Surface | Stability | Notes |
|---|---|---|
| `@opengsd/contracts` RPC types | Contract-versioned (`RPC_CONTRACT_VERSION`) | Changes bump the version. |
| RPC v2 protocol over stdio | Stable v2. Anything below → refuse to connect. | |
| `@opengsd/rpc-client` API | Semver | We pin to a minimum. |
| `.gsd/` folder layout | Documented conventions | Templates in pi ship with format guarantees. |
| `gsd_*` MCP tool names | Very stable, aliases preserved | e.g. `gsd_plan_milestone` has alias `gsd_milestone_plan`. |

## What we deliberately do NOT depend on

- pi's internal module structure (`packages/pi-*`, `dist/*`).
- Private CLI flags that aren't in `--help` (we only rely on `--mode rpc` and standard args).
- TUI rendering, colour codes, or output scraping.
- Direct reads of `.gsd/gsd.db` (WAL-locked, single-writer). Always go through `gsd_milestone_status` etc.
- pi's session file format on disk. We treat session files as opaque handles for `switch_session`.
- pi's exact `/login` slash command name — we feature-detect from `get_commands`.

## Feature detection

Every runtime interaction has three tiers of fallback:

### Tier 1 — Capability probe from `init`

```ts
const init = await client.init({ clientId: 'gsd-tau' });
if (init.protocolVersion !== 2) {
  showIncompatibleDialog(init.protocolVersion);
  await client.shutdown();
  return;
}
const caps = init.capabilities; // { commands: string[], events: string[] }
```

We build a `Capabilities` object per session and gate every UI feature on it:

```ts
if (caps.commands.includes('fork')) showForkMenu();
if (caps.commands.includes('set_thinking_level')) showThinkingMenu();
if (caps.events.includes('cost_update')) enableLiveCostMeter();
```

### Tier 2 — Runtime `get_commands` probe

Slash commands (`/login`, `/gsd auto`, `/compact`) can be added by extensions
and skills. Their names are not in `RPC_COMMAND_TYPES`. We fetch the live list
per session:

```ts
const commands = await client.getCommands(); // RpcSlashCommand[]
```

Store, cache, and consult before calling. If a slash command we expected is
missing, the corresponding UI action either hides or offers a manual fallback
("Paste the URL manually").

### Tier 3 — Graceful RPC error

Any `RpcResponse` with `success: false` for a command we thought was available
is caught and logged. The user sees "Not supported by your pi version — updating
may fix this" with a link to pi's update docs. Session is not killed.

## Version detection UI

On session first-attach we display the pi version in the session settings pane
(fetched by `client.bash({ command: 'gsd --version', excludeFromContext: true })`).
This is diagnostic-only — we don't gate features on it. All gating is capability-based.

## When to update our minimum pi version

We bump `@opengsd/rpc-client` (which pins to a pi minor) only when:

- We need a new capability that isn't feature-detectable (rare).
- A protocol version bump forces it (`RPC_CONTRACT_VERSION` change).
- A stable command we depend on has been renamed with no alias.

Every bump is called out in gsd-tau's release notes with the required pi minimum.

## When to expect breakage

Realistic risks we can't fully mitigate:

- **`.gsd/` template format changes** (the `- [ ] **S01: Title** \`risk:...\``
  syntax). Mitigation: prefer `gsd_milestone_status` (DB-backed) over parsing.
- **New `extension_ui_request` methods.** Mitigation: we render unknown methods
  as a generic "pi asks:" fallback modal with the raw JSON, letting the user
  respond with a plain text answer or cancel.
- **New `SdkAgentEvent` types.** Mitigation: log-and-forward unknown events; don't crash.

## Testing matrix

We test gsd-tau against three pi versions on every release:

- Minimum supported (the version `@opengsd/rpc-client` is pinned to).
- Latest stable.
- Latest pre-release (best-effort — surfaces upcoming breaking changes).

Automated via a matrix job in CI that spawns each pi and runs a smoke suite:
open a session, prompt, receive `agent_end`, `set_model`, `abort`, `shutdown`.

## Migration when pi requires it

If a pi update introduces a required capability we don't yet support:

1. User sees "pi has been updated. gsd-tau is compatible but new features are unavailable."
2. gsd-tau ships a matching release within N days, bumping its minimum.

If a pi update *breaks* our current baseline (protocol version change), our
"Incompatible pi version" screen tells the user how to pin pi back OR update
gsd-tau, whichever they prefer.

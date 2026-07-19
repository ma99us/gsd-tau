# pi Integration

Everything the app does with GSD flows through `@opengsd/rpc-client`. This doc
covers the exact API surface we use, the event model, and the boundaries we hold.

## The transport

Every session is one pi child process:

```
gsd --mode rpc     # spawned by the SDK on our behalf
```

The SDK (`@opengsd/rpc-client`) manages spawn, stdio pipes, the v2 protocol
handshake, request/response correlation by `id`, and the event stream. It's a
zero-dep, standalone package pinned to a pi version.

**Version pinning:** we install `@opengsd/rpc-client` at the same major.minor as
the minimum pi version we support. See [ADR-005](./decisions/ADR-005-forward-compatibility-strategy.md).

## Client factory

```ts
// app/main/pi/client-factory.ts
import { RpcClient } from '@opengsd/rpc-client';
import { resolvePiBinary } from './resolve-pi';

export async function createClient(opts: {
  cwd: string;
  provider?: string;
  model?: string;
  sessionFile?: string;   // for resume
}): Promise<RpcClient> {
  const cliPath = await resolvePiBinary();       // %USERPROFILE%\...\gsd or PATH lookup
  const client = new RpcClient({
    cliPath,
    cwd: opts.cwd,
    provider: opts.provider,
    model: opts.model,
    args: opts.sessionFile ? ['--continue'] : [], // TBD: we may use switch_session RPC instead
  });
  await client.start();
  const init = await client.init({ clientId: 'gsd-tau' });
  return client;  // caller wires event pump + subscribe(['*'])
}
```

## The command surface we use

Full command inventory is in `@opengsd/contracts` (`RPC_COMMAND_TYPES`). We use
the following. Feature-detection: any command not in `init.capabilities.commands`
gets its UI hidden with a "requires pi vX" tooltip.

### Turn control
| Command | When we call it |
|---|---|
| `prompt(msg, images?)` | User submits a message. Returns `runId`. |
| `steer(msg)` | User sends a mid-turn steer (when supported by their steering mode). |
| `follow_up(msg)` | User queues a message while agent is still streaming. |
| `abort()` | User hits Cancel on a turn. |
| `subscribe(['*'])` | Once, right after `init`, to receive every event type. |

### Session lifecycle
| Command | When we call it |
|---|---|
| `init({ clientId: 'gsd-tau' })` | Immediately after `start()`. Returns `sessionId` + `capabilities`. |
| `shutdown({ graceful: true })` | On tab close or app quit. Waits for pi to flush. |
| `new_session({ parentSession? })` | User picks "New session" in the tab menu. |
| `switch_session({ sessionPath })` | On app relaunch to resume the same conversation. |
| `fork({ entryId })` | User right-clicks a turn → "Fork from here". |

### Model & thinking
| Command | When we call it |
|---|---|
| `get_available_models()` | On model picker open. Cached for 60s. |
| `set_model({ provider, modelId })` | User selects a model. |
| `cycle_model()` | Optional keyboard shortcut. |
| `set_thinking_level({ level })` | Thinking-level menu. |

### State & stats (polled)
| Command | When we call it |
|---|---|
| `get_state()` | On session focus, and every 5s while focused. Powers header badges. |
| `get_session_stats()` | On demand + after every `execution_complete`. Powers context gauge. |
| `get_commands()` | On command palette open. Cached until session close. |
| `get_messages()` | On first tab attach to render backlog. |

### Escape hatches
| Command | When we call it |
|---|---|
| `bash({ command, excludeFromContext: true })` | To call `gsd_milestone_status`, `gsd_journal_query`, or any GSD MCP tool via the pi process's own shell. See [50-auto-run-view.md](./50-auto-run-view.md). Marked `excludeFromContext` so it doesn't pollute the LLM's history. |
| `compact({ customInstructions? })` | User hits "Compact" when context gauge is red. |

Commands we deliberately **do not** use:

- `terminal_input`, `terminal_resize`, `terminal_redraw` — those exist for
  embedding pi's TUI inside a pty. We render our own UI, so these are irrelevant.
- `export_html` — not in v1 scope.

## The event stream

Consumed once per session via the async generator:

```ts
for await (const event of client.events()) {
  handleEvent(sessionId, event);
}
```

Every event is loosely typed as `SdkAgentEvent = { type: string; [k: string]: unknown }`.
We route on `event.type`. The important types we care about:

| Event type | What we do with it |
|---|---|
| `agent_start` | Move state → **Working**. Record `runId` on the current turn. |
| `agent_end` | Move state → **Idle** (or **Waiting** if a blocker is pending). Note `abortOrigin`: `"session-transition"` is internal (ignore for state); `"user"`/`"timeout"`/`"unknown"` update the UI accordingly. |
| `message` | Append to chat view. |
| `text_delta` | Stream tokens into the current assistant message. Throttled to ~60fps at the main-process boundary before forwarding to the renderer. |
| `tool_use` | Render a "tool call" card. Feed into the progress tracker for `gsd_*` tools (see [50-*](./50-auto-run-view.md)). |
| `tool_result` | Update the tool card with output/error. |
| `execution_complete` (RpcV2) | Trigger a `get_session_stats` refresh; update context gauge. |
| `cost_update` (RpcV2) | Update cost line + live token counters. |
| `extension_ui_request` | **Blocker**. Move state → **Waiting on you**. Fire OS notification. Show modal on the tab. See [40-ui-design.md](./40-ui-design.md#the-ui-request-bridge). |

Unknown/future event types are logged (dev builds) and passed through to the
renderer as opaque records. We never crash on an unknown type.

## The UI-request contract (the trickiest bit)

pi's skills and extensions can ask the user questions mid-turn. These arrive as
`extension_ui_request` events with an `id` and a `method` (`select`, `confirm`,
`input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`).

**We must respond**, or pi hangs. Every open request has a matching response:

```ts
client.sendUIResponse(id, response);
```

Response shapes (from `RpcExtensionUIResponse`):
- `select` (single) → `{ value: string }`
- `select` (multiple, `allowMultiple:true`) → `{ values: string[] }`
- `confirm` → `{ confirmed: boolean }`
- `input`, `editor` → `{ value: string }`
- Any → `{ cancelled: true }` (only for user-close and app-shutdown)

`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text` are *informational*
(one-way). We still must send a response, but the shape is a plain `{ value: '' }`
ack — this is captured in the response type union.

**On tab close or app quit with an outstanding blocker**: we send `{ cancelled: true }`
for every open request, then `shutdown`. See [40-ui-design.md](./40-ui-design.md#modal-lifecycle-and-shutdown).

## Version detection and capability probing

```ts
const init = await client.init({ clientId: 'gsd-tau' });
// init.protocolVersion === 2 (we require ≥2)
// init.capabilities.commands: string[]   ← check before calling
// init.capabilities.events: string[]     ← check before subscribing
```

We hard-require `protocolVersion === 2`. Anything else → show "Incompatible pi
version — please update" and refuse to open the session.

Per-command feature detection:

```ts
const caps = session.capabilities;
if (!caps.commands.includes('fork')) hideForkMenuItem();
if (!caps.commands.includes('set_thinking_level')) hideThinkingLevelMenu();
```

Full strategy in [80-forward-compatibility.md](./80-forward-compatibility.md).

## Session-file resume

When we restore a tab on relaunch, we need pi to attach to the same conversation.
Two options:

1. **`switch_session({ sessionPath })`** — after `init`, switch the fresh session to the persisted file.
2. **CLI arg `--continue` / `--resume <path>`** — resume at spawn time.

We prefer **(1) `switch_session`** because it's part of the stable RPC contract
and doesn't depend on CLI flag stability. (2) is a fallback if it turns out
`switch_session` has caveats we haven't discovered.

## What lives where

| Thing | Owner |
|---|---|
| Spawning `gsd` | Main process (`client-factory.ts`) |
| Event pump per session | Main process (`session-handle.ts`) |
| Event throttling (text_delta) | Main process |
| Ring buffer of recent events | Main process |
| Rendering chat, tool cards, modals | Renderer |
| Deciding *when* to `abort`, `steer`, etc. | Renderer → IPC → main → RPC |

# S01 — Research: Session Header (Model Chip and Cost Line)

**Date:** 2026-07-21

## Summary

S01 adds a static `SessionHeaderBar` component above the turn list in `SessionView`. It shows `provider/model-id  $cost`, sourced from `RpcClient.getState()` (for model) and `cost_update` events / `RpcClient.getSessionStats()` (for cumulative cost). The work is mechanical IPC-wiring plus a new UI component. No novel architecture decisions are needed — the pattern (session-manager passthrough → handlers IPC channel → preload bridge → renderer hook) is already established by `getAvailableModels` / `setModel`.

Key discovery: the existing `IPC.GET_STATE` handler already returns the *state-machine* state (`Working/Idle/Stopped/Waiting`), **not** the RPC session state. A second channel is required — `GET_RPC_STATE` — that calls `client.getState()` and returns `RpcSessionState` (which carries `model?: ModelInfo, thinkingLevel: ThinkingLevel`). `getSessionStats()` also needs its own channel for on-demand cost fetching.

`cost_update` events already fan out to the renderer: `session-handle.ts` routes all unknown event types through the generic `event` channel, which `handlers.ts` forwards as `session:event` push. `SessionView.onEvent` already receives them — the renderer just needs to handle `event.type === 'cost_update'` and extract `event.cost`.

## Recommendation

Add two new IPC channels (`GET_RPC_STATE`, `GET_SESSION_STATS`) following the exact pattern of `GET_AVAILABLE_MODELS`. Create `SessionHeaderBar.tsx` that calls `getRpcState` on mount (and after `execution_complete` arrives via `onEvent`), and accumulates cost from `cost_update` events. Wire it at the top of `SessionView` above `TurnList`. Feature-detect both IPC calls (try/catch → degrade to `model: null, cost: 0`).

## Implementation Landscape

### Key Files

- `shared/types.ts` — re-export `RpcSessionState` and `SessionStats` from `@opengsd/contracts`; add `getRpcState(sessionId)` and `getSessionStats(sessionId)` to `GsdApi` interface
- `main/session/session-manager.ts` — add `getRpcState(id)` → `entry.client.getState()` and `getSessionStats(id)` → `entry.client.getSessionStats()` (exact same shape as existing `getAvailableModels`)
- `main/ipc/handlers.ts` — add `GET_RPC_STATE: 'getRpcState'` and `GET_SESSION_STATS: 'getSessionStats'` to `IPC` const; add `ipcMain.handle` blocks (try/catch → return `null` on unknown session or RPC error)
- `preload/preload.ts` — mirror `IPC` additions; add `getRpcState` and `getSessionStats` to `createGsdApi()` return object
- `main/session/session-handle.ts` — add `'cost_update'` to `KNOWN_TYPES` set for clean dispatch logging (advisory, does not block event delivery)
- `renderer/state/sessions-store.ts` — add optional `modelInfo?: { provider: string; id: string }` and `cost: number` fields to `TabEntry`; initialise `cost: 0`
- `renderer/components/SessionHeaderBar.tsx` — **new file**; reads model from local state (via `getRpcState`) and cost from `cost_update` events; degrades gracefully when model is null
- `renderer/components/SessionView.tsx` — import and render `<SessionHeaderBar sessionId={...} isActive={...} onEvent subscription>` above `TurnList`

### Contracts surface (confirmed)

```ts
// RpcClient methods available:
client.getState()           → Promise<RpcSessionState>
client.getSessionStats()    → Promise<SessionStats>

// RpcSessionState (from @opengsd/contracts):
{ model?: ModelInfo, thinkingLevel: ThinkingLevel, isStreaming, ... }

// ModelInfo:
{ provider: string; id: string; contextWindow?: number; reasoning?: boolean }

// SessionStats:
{ cost: number; tokens: { input, output, cacheRead, cacheWrite, total }; ... }

// cost_update: emitted by pi, arrives via session:event push
// event.type === 'cost_update'; payload shape: { type, cost: number, ... }
// (duck-typed SdkAgentEvent — extract event.cost as number)
```

### Build Order

1. **`shared/types.ts`** — add type re-exports and `GsdApi` method signatures. Unblocks all downstream files. TypeScript will catch any mismatches immediately.
2. **`main/session/session-manager.ts`** — add `getRpcState` and `getSessionStats` methods (trivial passthrough).
3. **`main/ipc/handlers.ts` + `preload/preload.ts`** — add IPC channels and preload bridge (parallel; no dependency between them after step 1–2 merge).
4. **`renderer/state/sessions-store.ts`** — add `modelInfo` / `cost` fields to `TabEntry`.
5. **`renderer/components/SessionHeaderBar.tsx`** — new component with local state for model and cost; fetches `getRpcState` on mount via `useEffect`, handles `cost_update` via the `onEvent` prop/callback passed from `SessionView`.
6. **`renderer/components/SessionView.tsx`** — insert `<SessionHeaderBar>` and pass `sessionId` + event hook.
7. **`main/session/session-handle.ts`** — add `cost_update` to `KNOWN_TYPES` (1-line; low risk, do last).

### Verification Approach

```
pnpm tsc --noEmit          # must be clean
pnpm test                  # 602+ passing, no regressions
```

Visual check: open a project → header row shows `anthropic/claude-sonnet-4.6  $0.00`. Send a prompt → after `execution_complete` cost updates (e.g. `$0.01`). On `cost_update` events during streaming, cost ticks up live.

## Common Pitfalls

- **`GET_STATE` name collision** — The existing `IPC.GET_STATE` returns `SessionState` (state machine). The new `GET_RPC_STATE` calls `client.getState()` → `RpcSessionState`. Do NOT replace or shadow the existing channel; downstream code depends on it.
- **`cost_update` payload is duck-typed** — `SdkAgentEvent` is `{ type: string; [key: string]: unknown }`. Cast `event.cost` as `number | undefined` and fall back to `0`; do not assume it's always present.
- **`RpcSessionState.model` is optional** — pi returns `model: undefined` briefly on session open before the first `get_state` response settles. Render `—` (em-dash) or a skeleton until it resolves.
- **IPC mirroring** — `IPC` constants in `handlers.ts` and `preload/preload.ts` are kept in sync by hand (no shared import). Add to both or TSC will catch the `GsdApi` shape mismatch.
- **`getState` vs `getRpcState` on `SessionManager`** — `SessionManager` does not currently have a public `getState()` method (the IPC handler reads `entry.machine.state` directly). Name the new manager method `getRpcState` to avoid confusion.

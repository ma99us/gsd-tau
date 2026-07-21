# S04 Research: Context Window Gauge with Compact Button

## Spec (from docs/60-model-and-context.md)

### Gauge display
```
Context ██████░░░░ 62%
```
- Value = `tokens.total / model.contextWindow`
- Colour bands: Green 0–60%, Amber 60–85%, Red 85–100%+
- Click opens a popover showing token breakdown + Compact button
- At 85%+ a nudge pill appears in the chat scroll (see 45-chat-experience.md §8.1 — out of S04 scope)
- Refresh: on mount, after every `execution_complete`, throttled 1 Hz on `cost_update`

### Popover breakdown
```
Input:        45,200
Output:         4,800
Cache read:   82,100
Cache write:    1,500
─────────────────────
Total:       133,600 / 200,000  (67%)

[ Compact context ]
```

### Unknown contextWindow fallback ladder
1. `model.contextWindow` from `get_state()` / `get_available_models()`
2. Local well-known model table (compile-time)
3. Show `Context 133k tokens` (raw count, no bar)

### Compact flow
- Button calls `compact()` RPC
- Session state → Working with "Compacting…" label during compaction
- On completion, `CompactionResult` surfaced as system message in chat

---

## Key Types

### `SessionStats` (from `@opengsd/contracts` / `shared/types.ts`)
```typescript
interface SessionStats {
  sessionFile: string | undefined;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}
```

### `CompactionResult` (from `@opengsd/contracts`)
```typescript
interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
}
```

### `ModelInfo` (already in `shared/types.ts`)
```typescript
interface ModelInfo {
  provider: string;
  id: string;
  contextWindow?: number;  // may be absent → fallback ladder applies
  reasoning?: boolean;
}
```

---

## Existing Wiring (what S01 already built)

### `shared/types.ts`
- `SessionStats` and `RpcCostUpdateEvent` re-exported from `@opengsd/contracts`
- `GsdApi.getSessionStats(sessionId)` declared → returns `Promise<SessionStats | null>`
- `GsdApi.getRpcState(sessionId)` declared → returns `Promise<RpcSessionState | null>`

### `preload/preload.ts`
- `getSessionStats` → `ipcRenderer.invoke(IPC.GET_SESSION_STATS, sessionId)` (line 154)
- `getRpcState` → `ipcRenderer.invoke(IPC.GET_RPC_STATE, sessionId)` (line 152)
- **`compact` is NOT yet exposed** — must be added

### `main/ipc/handlers.ts`
- `IPC.GET_RPC_STATE` ('getRpcState') — registered, null-on-error pattern (line 556)
- `IPC.GET_SESSION_STATS` ('getSessionStats') — registered, null-on-error pattern (line 571)
- `COMPACT` channel — **does NOT exist yet** — must be added
- All session events fan out via `fanOut(getWc, PUSH.SESSION_EVENT, { sessionId, event })` (line 388)
- 17 IPC channels currently registered

### `main/session/session-manager.ts`
- `getRpcState(id)` → `entry.handle.client.getState()` (line 501)
- `getSessionStats(id)` → `entry.client.getSessionStats()` (line 514)
- **`compact(id)` method does NOT exist yet** — must be added

### `renderer/components/SessionHeaderBar.tsx`
- Local `useState` for `model` and `cost`
- Subscribes to `onEvent` for `cost_update` (extracts `cumulativeCost`) and `execution_complete` (triggers model refresh)
- **No token state, no gauge, no popover** — all must be added
- Currently: `provider/model-id  ·  $0.0000`

---

## RpcClient surface (node_modules/@opengsd/rpc-client)

The public `RpcClient` class already has:
```typescript
compact(customInstructions?: string): Promise<CompactionResult>
getSessionStats(): Promise<SessionStats>
```
Both are confirmed in `rpc-client.d.ts` (lines ~135 and ~160).

The `compact` command is in `RPC_COMMAND_TYPES` and maps to the response type:
```typescript
{ command: "compact"; data: CompactionResult }
```

---

## What Needs to Be Built

### 1. `main/session/session-manager.ts`
Add `compact(id: SessionId, customInstructions?: string): Promise<CompactionResult>`:
```typescript
async compact(id: SessionId, customInstructions?: string): Promise<CompactionResult> {
  const entry = this.sessions.get(id)
  if (!entry) throw new Error(`SessionManager.compact(): unknown session '${id}'`)
  return entry.client.compact(customInstructions)
}
```

### 2. `main/ipc/handlers.ts`
- Add `COMPACT: 'compact'` to `IPC` const
- Register handler: `ipcMain.handle(IPC.COMPACT, async (_, sessionId, customInstructions?) => { ... })`
- Add `ipcMain.removeHandler(IPC.COMPACT)` in teardown
- After `compact()` resolves, fan out a synthetic system event so renderer can show the CompactionResult as a chat message (or leave that to a future slice — spec says "surfaced as system message in chat pane")

### 3. `preload/preload.ts`
- Mirror `IPC.COMPACT` constant
- Expose `compact(sessionId, customInstructions?): Promise<CompactionResult>`

### 4. `shared/types.ts`
- Add `compact(sessionId: SessionId, customInstructions?: string): Promise<CompactionResult>` to `GsdApi`
- Import and re-export `CompactionResult` from `@opengsd/contracts`

### 5. `renderer/components/ContextGauge.tsx` (new file)
New component displaying the gauge in the header and the popover on click.

Props:
```typescript
interface ContextGaugeProps {
  sessionId: SessionId
  contextWindow?: number   // from modelInfo
}
```
State:
- `stats: SessionStats | null` — fetched via `getSessionStats()`
- `isOpen: boolean` — popover open state
- `isCompacting: boolean` — compact in-flight guard

Refresh triggers (same as S01 model fetch):
- Mount (and `sessionId` change)
- `execution_complete` events
- `cost_update` events (throttled 1 Hz — use a ref-based timestamp guard)

Colour logic:
```typescript
const pct = stats && contextWindow ? stats.tokens.total / contextWindow : null
const colour = pct === null ? 'neutral' : pct >= 0.85 ? 'red' : pct >= 0.60 ? 'amber' : 'green'
```

Bar rendering: progress bar (10 segments or CSS width) + percentage text.

Fallback: if `contextWindow` is nullish, show `Context {total}k tokens` (no bar).

### 6. `renderer/components/SessionHeaderBar.tsx`
- Import and render `<ContextGauge sessionId={sessionId} contextWindow={model?.contextWindow} />`
- Pass `modelInfo.contextWindow` once available from `getRpcState`
- `RpcSessionState` from `@opengsd/contracts` includes `model: ModelInfo`

---

## Architecture Notes

### Popover approach
Use Radix `@radix-ui/react-popover` (already in deps per ADR/tech-stack) or a simple controlled `<div>` positioned below the gauge. No routing or Zustand — local component state sufficient.

### Compact IPC flow
```
Renderer: window.gsd.compact(sessionId)
  → preload: ipcRenderer.invoke('compact', sessionId)
  → handlers: manager.compact(id)
  → session-manager: entry.client.compact()
  → pi RPC: { type: 'compact' }
  ← CompactionResult
```
During compaction, session state transitions to `Working` (pi drives this via state-machine events — handlers already wire `state-changed` → `SESSION_STATE_CHANGE` push). No extra state tracking needed in renderer; the `isCompacting` flag in `ContextGauge` is just a UI guard to disable the button during the IPC round-trip.

### Token data in cost_update
`RpcCostUpdateEvent` from `@opengsd/contracts` — need to check if it carries token counts directly so the gauge can update without a full `getSessionStats()` round-trip. The S01 milestone context says cost_update can be extended to carry token data. Worth checking `rpc.d.ts` line ~444 (`stats: SessionStats`).

From the grep results: `rpc.d.ts:444: stats: SessionStats` — the `cost_update` event already carries a full `SessionStats` object. The renderer can extract `event.stats.tokens` from `cost_update` events without a separate `getSessionStats()` call, saving a round-trip. This is the preferred approach for live updates.

---

## Files to Create/Modify

| File | Action | What |
|---|---|---|
| `renderer/components/ContextGauge.tsx` | **Create** | Gauge + popover + compact button |
| `renderer/components/SessionHeaderBar.tsx` | **Modify** | Add ContextGauge, pass contextWindow |
| `shared/types.ts` | **Modify** | Add `compact` to GsdApi, re-export CompactionResult |
| `main/ipc/handlers.ts` | **Modify** | Add COMPACT channel, register handler + teardown |
| `main/session/session-manager.ts` | **Modify** | Add compact() method |
| `preload/preload.ts` | **Modify** | Mirror COMPACT, expose compact() |

---

## Verification Plan

1. `pnpm tsc --noEmit` passes (no type errors)
2. Unit tests for `ContextGauge`:
   - Green/amber/red colour at 50%/70%/90% fill
   - Unknown contextWindow renders raw token count
   - Compact button fires IPC and shows loading state
3. Unit test for `session-manager.compact()` delegates to `client.compact()`
4. Unit test for `handlers COMPACT` channel (null-on-error pattern)
5. Playwright smoke: gauge renders in header, popover opens on click, compact button visible

---

## Open Questions for Planner

1. **cost_update token extraction**: Confirm `RpcCostUpdateEvent.stats.tokens` is the live path (avoid extra getSessionStats round-trip). If confirmed, `ContextGauge` should read tokens from `cost_update` events rather than calling `getSessionStats()` on every event.
2. **CompactionResult as system message**: The spec says it's "surfaced as system message in chat pane". Is that in scope for S04 or deferred to the chat-experience slice? If deferred, the compact button just resolves silently (gauge updates on next cost_update).
3. **85% nudge pill in chat**: Out of S04 scope (per spec, see §8.1). Confirm this is left for the chat-experience phase.

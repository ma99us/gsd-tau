# S03 Research: Thinking Level Chip and Picker

## Summary

S03 is a self-contained chip + dropdown that follows exactly the same pattern as
the model chip from S01. All required types, RPC commands, and client methods
already exist. No new IPC channels are needed — `getRpcState` (existing) returns
`thinkingLevel`, and a new `setThinkingLevel` IPC channel mirrors the `setModel`
pattern.

---

## Spec (from docs/60-model-and-context.md)

- **Chip:** `💡 medium ▼` shown in `SessionHeaderBar` **only** when `model?.reasoning === true`.
  Hidden (not greyed) when the model doesn't support thinking.
- **Picker:** Small dropdown below the chip listing all 7 levels.
  Levels `minimal`–`max` are greyed/unselectable when `supportsThinking` is false
  (per spec: same reasoning-model guard).
- **Levels:** `off | minimal | low | medium | high | xhigh | max`
  (from `RPC_THINKING_LEVELS` const in contracts).
- **RPC call:** `set_thinking_level({ level })` → takes effect next turn.
  Chip updates **optimistically** immediately; confirmed on next `get_state`.
- **Keyboard shortcut:** `Ctrl+Shift+T` cycles levels (via `cycleThinkingLevel`).
- **Session override:** Overrides `settings.defaultThinkingLevel` for the session lifetime.

---

## Types and Constants

### From `@opengsd/contracts` (`packages/contracts/dist/rpc.d.ts`)

```typescript
export declare const RPC_THINKING_LEVELS: readonly [
  "off", "minimal", "low", "medium", "high", "xhigh", "max"
];
export type ThinkingLevel = (typeof RPC_THINKING_LEVELS)[number];

export interface RpcSessionState {
  model?: ModelInfo;
  thinkingLevel: ThinkingLevel;   // ← already present, always populated
  isStreaming: boolean;
  // ...
}

export interface ModelInfo {
  provider: string;
  id: string;
  contextWindow?: number;
  reasoning?: boolean;            // ← guard for showing/enabling chip
}
```

`ThinkingLevel` and `RPC_THINKING_LEVELS` are exported from the contracts package.
`RpcSessionState.thinkingLevel` is non-optional — always present.

### Already re-exported in `shared/types.ts`

`RpcSessionState`, `ModelInfo` are already re-exported. `ThinkingLevel` and
`RPC_THINKING_LEVELS` are **not** currently re-exported from `shared/types.ts` —
they need to be added.

---

## RPC Client API

### `packages/rpc-client/dist/rpc-client.d.ts`

```typescript
setThinkingLevel(level: ThinkingLevel): Promise<void>;
cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null>;
```

Both methods exist on the `RpcClient`. `setThinkingLevel` is the primary call.
`cycleThinkingLevel` can back the `Ctrl+Shift+T` shortcut.

---

## Current State — What Exists vs What's Missing

### Exists (no changes needed)
| Thing | Location | Notes |
|---|---|---|
| `RpcSessionState.thinkingLevel` | contracts | Non-optional field |
| `ThinkingLevel` type | contracts | Union of 7 string literals |
| `RPC_THINKING_LEVELS` const | contracts | Readonly tuple |
| `ModelInfo.reasoning` | contracts | Boolean flag for chip visibility |
| `getRpcState` IPC channel | `main/ipc/handlers.ts` | Returns full `RpcSessionState` incl. `thinkingLevel` |
| `getRpcState` preload method | `preload/preload.ts` | Exposed on `window.gsd` |
| `rpcClient.setThinkingLevel()` | rpc-client | Takes `ThinkingLevel`, returns `Promise<void>` |
| `rpcClient.cycleThinkingLevel()` | rpc-client | Returns new level |

### Missing (must be added)
| Thing | Where | Notes |
|---|---|---|
| `ThinkingLevel` + `RPC_THINKING_LEVELS` re-export | `shared/types.ts` | So renderer never imports contracts at runtime |
| `SET_THINKING_LEVEL` IPC channel | `main/ipc/handlers.ts` | Mirrors `SET_MODEL` pattern; calls `session.setThinkingLevel(level)` |
| `setThinkingLevel` on `SessionHandle` | `main/session/session-handle.ts` | Thin wrapper over `rpcClient.setThinkingLevel(level)` |
| `setThinkingLevel` on `GsdApi` | `shared/types.ts` | `(sessionId, level) => Promise<void>` |
| `setThinkingLevel` preload binding | `preload/preload.ts` | `ipcRenderer.invoke('SET_THINKING_LEVEL', sessionId, level)` |
| `ThinkingLevelChip` component | `renderer/components/ThinkingLevelChip.tsx` | Chip + dropdown |
| Chip wired into `SessionHeaderBar` | `renderer/components/SessionHeaderBar.tsx` | Show only when `model?.reasoning === true` |
| `Ctrl+Shift+T` keybinding | `SessionHeaderBar` or `SessionView` | Calls `cycleThinkingLevel` (future: own IPC channel or reuse setThinkingLevel) |

---

## Implementation Pattern

Follow the `setModel` pattern established in S02 (or use `getRpcState`/`setModel` from S01):

```typescript
// main/session/session-handle.ts (new method)
async setThinkingLevel(level: ThinkingLevel): Promise<void> {
  await this.client.setThinkingLevel(level)
}

// main/ipc/handlers.ts (new channel)
ipcMain.handle('SET_THINKING_LEVEL', async (_e, sessionId: SessionId, level: ThinkingLevel) => {
  const session = manager.get(sessionId)
  if (!session) throw new Error(`No session: ${sessionId}`)
  return session.setThinkingLevel(level)
})

// renderer — optimistic update
const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevel>('medium')

async function handleSelect(level: ThinkingLevel) {
  setThinkingLevelState(level)   // optimistic
  await window.gsd.setThinkingLevel(sessionId, level)
}
```

---

## SessionHeaderBar Integration

Current `SessionHeaderBar` structure:
```
[model chip] · [cost]
```

Target after S03:
```
[model chip] · [💡 thinking chip ▼] · [cost]
```

The thinking chip is conditionally rendered:
```tsx
{model?.reasoning === true && (
  <ThinkingLevelChip level={thinkingLevel} onSelect={handleSelect} />
)}
```

`thinkingLevel` is fetched alongside `model` from `getRpcState` on mount and
after `execution_complete`. No new polling needed.

---

## Feature Detection (ADR-005)

`set_thinking_level` appears in `RPC_COMMAND_TYPES` in the contracts package. Per
ADR-005, check `capabilities.commands` from the init handshake before showing the
chip. `PiCapabilities.commands` is already stored on `PiInitInfo` and available
via `session.initInfo`. Gate: only show chip if `commands.includes('set_thinking_level')`.

In practice every pi ≥ 1.11.0 supports it, but the feature-detect is cheap and
correct.

---

## Files to Touch

1. `shared/types.ts` — add `ThinkingLevel`, `RPC_THINKING_LEVELS` re-exports and `setThinkingLevel` on `GsdApi`
2. `main/session/session-handle.ts` — add `setThinkingLevel(level)` method
3. `main/ipc/handlers.ts` — register `SET_THINKING_LEVEL` channel
4. `preload/preload.ts` — expose `setThinkingLevel` on `window.gsd`
5. `renderer/components/ThinkingLevelChip.tsx` — new component (chip + dropdown)
6. `renderer/components/SessionHeaderBar.tsx` — integrate chip, fetch `thinkingLevel` from `getRpcState`

Tests to add/update:
- `main/session/session-handle.test.ts` — `setThinkingLevel` happy + error
- `main/ipc/handlers.test.ts` — `SET_THINKING_LEVEL` channel
- `preload/preload.test.ts` — `setThinkingLevel` exposed
- `renderer/components/SessionHeaderBar.test.ts` (or co-test) — chip visible/hidden, optimistic update

---

## Risk Assessment

Low. All the building blocks exist. The main work is wiring (4 files) plus one new
component. The `reasoning` flag on `ModelInfo` already handles the
show/hide logic. No new event types. The optimistic update pattern is
identical to S01's cost display.

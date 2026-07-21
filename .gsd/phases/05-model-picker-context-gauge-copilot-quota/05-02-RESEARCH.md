# S02: Model Picker Dropdown — Research

## Goal
Add a clickable dropdown to the model chip in `SessionHeaderBar`. Clicking opens a grouped list of available models (from `get_available_models`). Picking a model calls `set_model`, updates the chip optimistically, then confirms on the next `getRpcState`.

---

## Files Retrieved

1. `renderer/components/SessionHeaderBar.tsx` (full) — Current model chip: plain `<span>` with `modelDisplay`, local state `model: {provider,id}|null`, fetches via `getRpcState` on mount + after `execution_complete`. **This is the primary file to extend.**
2. `main/ipc/handlers.ts` (full) — IPC channel `GET_AVAILABLE_MODELS` and `SET_MODEL` are **already registered** and delegating to `manager.getAvailableModels()` / `manager.setModel()`.
3. `main/session/session-manager.ts` (full) — `getAvailableModels(id)` and `setModel(id, provider, modelId)` are **already implemented**, delegating to `entry.client.getAvailableModels()` / `entry.client.setModel()`.
4. `preload/preload.ts` (full) — `window.gsd.getAvailableModels(sessionId)` and `window.gsd.setModel(sessionId, provider, modelId)` are **already exposed**.
5. `shared/types.ts` (full) — `ModelInfo`, `RpcSessionState`, `GsdApi` all already include the methods. `ModelInfo` has `{ provider, id, contextWindow?, reasoning? }`.
6. `node_modules/@opengsd/contracts/dist/rpc.d.ts` — `ModelInfo` shape confirmed: `{ provider: string; id: string; contextWindow?: number; reasoning?: boolean; }`. No `supportsThinking` field — use `reasoning?: boolean` for the reasoning badge.
7. `node_modules/@opengsd/rpc-client/dist/*.d.ts` — `RpcClient.getAvailableModels(): Promise<ModelInfo[]>` and `RpcClient.setModel(provider, modelId): Promise<{provider, id}>` confirmed.
8. `package.json` — `@radix-ui/react-dropdown-menu: ^2.1.0` already installed.

---

## Key Types

```typescript
// From @opengsd/contracts
interface ModelInfo {
  provider: string;
  id: string;
  contextWindow?: number;   // e.g. 200000 → "200k ctx"
  reasoning?: boolean;      // true → show "reasoning" badge
}

// Already in window.gsd (preload)
getAvailableModels(sessionId: SessionId): Promise<ModelInfo[]>
setModel(sessionId: SessionId, provider: string, modelId: string): Promise<{ provider: string; id: string }>
```

---

## Architecture

### What already exists (zero backend work needed)
- `IPC.GET_AVAILABLE_MODELS` + `IPC.SET_MODEL` handlers registered in `handlers.ts`
- `manager.getAvailableModels()` + `manager.setModel()` in `session-manager.ts`
- `window.gsd.getAvailableModels()` + `window.gsd.setModel()` in `preload.ts`
- `ModelInfo` type exported from `shared/types.ts`
- `@radix-ui/react-dropdown-menu` installed

**S02 is pure renderer work.**

### State management decision (from S01 follow-up note)
S01 used **local component state** in `SessionHeaderBar` (not Zustand). The S01 summary noted:
> S02 model picker will need to update the model chip — the local state architecture means S02 must either lift state or trigger a re-fetch via the existing GET_RPC_STATE channel.

**Recommended approach:** Stay in local state. On model selection:
1. Optimistically set `model` state immediately.
2. Call `window.gsd.setModel(sessionId, provider, modelId)`.
3. The next `execution_complete` event already triggers `fetchModel()` → confirms from pi.

No Zustand changes needed.

### Dropdown implementation
- Use `@radix-ui/react-dropdown-menu` (already installed, already used pattern in project).
- Wrap the model chip `<span>` in `DropdownMenu.Root + DropdownMenu.Trigger`.
- `DropdownMenu.Content` renders grouped model list.
- Models are fetched on trigger open, cached for 60 s (per spec).
- Group by `model.provider`; sort groups alphabetically; within group sort by `model.id`.

### S02 mock support
The `makeMockClient` in `session-manager.test.ts` uses `as unknown as RpcClient` — `getAvailableModels` and `setModel` are NOT in the mock. Tests for S02 will need to add them to the mock or use `vi.spyOn` on `window.gsd`.

---

## Natural Seams (task breakdown for planner)

**T01 — Model list cache hook (`useAvailableModels`)**
- New file: `renderer/hooks/useAvailableModels.ts`
- `useAvailableModels(sessionId)` → returns `ModelInfo[] | null` (null while loading).
- Fetches via `window.gsd.getAvailableModels(sessionId)`.
- Caches result with a 60 s TTL (use `useRef` for cache + timestamp; no external lib needed).
- Returns stale data while re-fetching (avoids flash).
- Verify: unit test with mocked `window.gsd`.

**T02 — ModelPickerDropdown component**
- New file: `renderer/components/ModelPickerDropdown.tsx`
- Props: `sessionId`, `currentModel: {provider,id}|null`, `onModelSelected: (m: ModelInfo) => void`
- Uses `@radix-ui/react-dropdown-menu` (Root + Trigger + Content + Group + Item).
- Trigger is the model chip text (styled to match the existing `<span>`).
- Content groups models by provider, shows `contextWindow` formatted as "200k ctx" and `reasoning` badge.
- Calls `onModelSelected(model)` on item click; Radix closes the menu automatically.
- Verify: unit test.

**T03 — Wire picker into SessionHeaderBar**
- Edit `renderer/components/SessionHeaderBar.tsx`.
- Replace the plain chip `<span>` with `<ModelPickerDropdown>`.
- `onModelSelected` callback:
  1. Optimistically `setModel({ provider, id })`.
  2. Calls `window.gsd.setModel(sessionId, model.provider, model.id)` (fire-and-forget with catch logging).
  3. Next `execution_complete` → `fetchModel()` confirms.
- Verify: unit test that `setModel` IPC is called and chip updates immediately.

**T04 — handlers.test.ts mock update**
- Add `getAvailableModels: vi.fn().mockResolvedValue([])` and `setModel: vi.fn().mockResolvedValue({ provider: 'anthropic', id: 'claude-sonnet-4-6' })` to `makeMockClient` in `session-manager.test.ts` (or wherever the mock client is used in handler tests).
- Existing tests should still pass; this removes the `as unknown` cast gap.
- Verify: `vitest run` passes.

---

## First Proof (highest risk)
**T02 (ModelPickerDropdown)** is the highest-risk task — it introduces the Radix dropdown and the grouping/formatting logic. Build and render it first, even with stub data, to validate the Radix integration and CSS fit within the 32px header bar before wiring live data.

---

## Verification Commands
```pwsh
# Build check
pnpm tsc --noEmit

# Unit tests
pnpm vitest run

# Playwright smoke (manual)
pnpm test:e2e
```

---

## Constraints / Gotchas
1. **Model chip is 32px tall** — the picker trigger must match the existing `py-1.5 text-xs` height; don't expand the header bar.
2. **`reasoning` not `supportsThinking`** — the `ModelInfo` field is `reasoning?: boolean`, not `supportsThinking`. Spec says "reasoning" badge; map `reasoning === true` → badge.
3. **No `supportsThinking` field** — S02 does NOT add the thinking-level chip (that's S03). Just show the `reasoning` badge as metadata in the list.
4. **`setModel` takes `(provider, modelId)` not an object** — `client.setModel(provider, modelId)` and `window.gsd.setModel(sessionId, provider, modelId)` are positional, not `{ provider, modelId }`.
5. **`makeMockClient` needs updating** — currently lacks `getAvailableModels` and `setModel`; any test that exercises these will fail without the mock addition.
6. **Cache TTL in renderer** — use `Date.now()` + a ref for the 60 s cache; no need for a module-level Map (session can unmount).
7. **Ctrl+. keyboard shortcut** (per spec) — optional for S02; can be deferred to S03 or as a follow-up.

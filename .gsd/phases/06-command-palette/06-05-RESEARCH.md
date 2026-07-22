# S05: Pi Slash Commands in Palette and Regression Check — Research

**Date:** 2026-07-22

## Summary

S05 wires `get_commands` RPC into the command palette so pi slash commands appear alongside app commands with a source badge, and confirms the full test suite still passes. The infrastructure is already in place: `GsdApi.getCommands(sessionId)` is declared in `shared/types.ts`, `RpcSlashCommand` is re-exported from `@opengsd/contracts` (fields: `name`, `description?`, `source: "extension"|"prompt"|"skill"`, `location?`, `path?`), and the palette component is fully wired from S01–S04. The work is a targeted extension with no architectural surprises.

The implementation follows the `useAvailableModels` fetch-on-demand + TTL-cache pattern exactly. A new `usePiCommands` hook fetches slash commands lazily when the palette opens; the CommandPalette merges them with app commands, renders the source badge, and on execute sends `/commandName` via `window.gsd.prompt()`. The existing `AppCommand` interface gets two optional fields (`badge?: string`, `description?: string`) so both command types flow through the same `filterAndSortCommands` pipeline.

## Recommendation

Add `badge?` and `description?` to `AppCommand`; create `renderer/hooks/usePiCommands.ts` following the `useAvailableModels` pattern; update `CommandPalette` to trigger the fetch on open and merge/render the new fields; keep `filterAndSortCommands` unchanged (it already handles any `AppCommand` array). Run `pnpm vitest run` as the regression gate.

## Implementation Landscape

### Key Files

- `renderer/hooks/useAppCommands.ts` — Add `badge?: string` and `description?: string` to `AppCommand` interface and `buildAppCommands` factory. Pi commands will carry `badge = source` and `description`; app commands leave both undefined.
- `renderer/hooks/usePiCommands.ts` — **New file.** Mirrors `useAvailableModels.ts`: module-level TTL cache keyed by sessionId, exported `fetchPiCommands` pure function, `usePiCommands` hook with `{ commands, loading, error, fetch }` return. TTL = 60 s (same as models).
- `renderer/hooks/usePiCommands.test.ts` — **New file.** Test cache hit/miss, error path, fetch-on-null-sessionId no-op.
- `renderer/components/CommandPalette.tsx` — (1) Accept `usePiCommands` output (call the hook internally, trigger `piCommands.fetch()` in a `useEffect` when `open` becomes true). (2) Merge pi commands into the `commands` array passed to `filterAndSortCommands`. (3) Render `badge` and `description` in the list item.
- `renderer/components/CommandPalette.test.ts` — Add tests: pi command appears with badge, selecting sends `/name` prompt, badge renders correctly, loading state shows app commands before pi commands arrive.
- `renderer/hooks/useAppCommands.test.ts` — Update `buildAppCommands` test expectations for new optional fields (no behaviour change, just interface conformance).

### Pi Command → AppCommand mapping

```typescript
// In CommandPalette.tsx — convert RpcSlashCommand → AppCommand
function toPaletteCommand(cmd: RpcSlashCommand, sessionId: SessionId): AppCommand {
  return {
    id: `pi:${cmd.name}`,
    label: `/${cmd.name}`,
    description: cmd.description,
    badge: cmd.source,            // "skill" | "prompt" | "extension"
    sessionId,
    execute: async () => {
      await window.gsd.prompt(sessionId, `/${cmd.name}`)
    },
  }
}
```

### Badge rendering in list item

```tsx
<li ...>
  <span>{cmd.label}</span>
  {cmd.description && (
    <span className="text-xs text-neutral-500 ml-1">{cmd.description}</span>
  )}
  {cmd.badge && (
    <span className="ml-auto text-xs text-neutral-400 bg-neutral-800 px-1 rounded">
      {cmd.badge}
    </span>
  )}
</li>
```

### Build Order

1. **`usePiCommands` hook + tests** — unblocks everything else. Pure fetch logic, no React changes needed.
2. **Extend `AppCommand` + update `useAppCommands`** — backward-compatible (optional fields). Update its tests.
3. **Update `CommandPalette`** — merge pi commands, trigger fetch on open, render badge/description. Update its tests.
4. **Regression: `pnpm vitest run`** — must pass ≥1002 tests (suite was 1002 at end of S04).

### Verification Approach

- Unit: `pnpm vitest run` — all tests pass.
- Manual (UAT): launch app with a live pi session → Ctrl+Shift+P → type `/gsd` → `/gsd` skill appears with `skill` badge → Enter sends `/gsd` to the composer/pi.

## Constraints

- `filterAndSortCommands` is a pure function tested in node env — it must not touch any new DOM or React APIs.
- Pi commands are only fetchable when a session is active (`sessionId !== null`). When null, `usePiCommands` is a no-op and the palette shows only app commands.
- `get_commands` RPC is already declared in `GsdApi` — no IPC bridge changes needed.
- The `source` badge values are a closed union (`"extension" | "prompt" | "skill"`) — safe to render directly.

## Common Pitfalls

- **Stale pi commands after slash-command install** — TTL cache will naturally expire in 60 s. Acceptable for v1; no manual invalidation needed.
- **Duplicate ids** — pi command ids must be namespaced (`pi:${cmd.name}`) to avoid collisions with app command ids like `new-session`.
- **`execute` on pi command when sessionId null** — the mapping function captures `sessionId` from the enclosing scope; if null, calling `window.gsd.prompt(null, ...)` would throw. Guard: only map pi commands when `sessionId !== null` (same as the fetch no-op guard).
- **vi.mock in tests** — `usePiCommands` will need to be mocked in `CommandPalette.test.ts`; use `vi.mock('../hooks/usePiCommands', ...)` with an explicit factory to avoid the MEM021 gotcha (enumerate all exports).

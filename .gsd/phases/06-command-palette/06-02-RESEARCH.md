# S02: App Command Registry — Research

**Date:** 2026-07-22

## Summary

S02 delivers `useAppCommands(sessionId)` — a React hook that returns a typed array of `AppCommand` objects for the command palette. Every required IPC method for the seven commands already exists in `window.gsd.*` (via `GsdApi` in `shared/types.ts`). The sessions store (`renderer/state/sessions-store.ts`) and `useSession` already expose `sessionId`, `send`, `compact`, `closeSession`, `openProject`, and `showFolderPicker`. No new IPC channels are needed.

Two commands — `show-tray` and `toggle-auto-run-panel` — have no current IPC or store backing. The slice goal says these entries only need to be **present** in the returned array; no-op stubs satisfy the roadmap check and will be wired in later slices (S04+). This is the correct approach; don't add phantom IPC now.

The hook is a pure renderer-side factory: takes `sessionId | null`, returns a stable `AppCommand[]` (memoized with `useMemo`). The `copy-last-turn` command needs access to the last turn's text — it can read from the sessions store's `tabOrder`/`sessions` map, which is already Zustand-exported.

## Recommendation

Create `renderer/hooks/useAppCommands.ts` with an `AppCommand` interface and a `useAppCommands(sessionId)` hook. Wire seven commands against existing `window.gsd.*` APIs. Stub `show-tray` and `toggle-auto-run-panel` as no-ops with a `console.warn`. Co-locate `useAppCommands.test.ts` using the established `vi.stubGlobal('gsd', mock)` pattern from `sessions-store.test.ts`.

## Implementation Landscape

### Key Files

- `renderer/hooks/useAppCommands.ts` — **new file**; exports `AppCommand` interface and `useAppCommands(sessionId)` hook
- `renderer/hooks/useAppCommands.test.ts` — **new file**; vitest tests verifying all 7 entries present, execute() calls correct GsdApi methods
- `renderer/state/sessions-store.ts` — read for Zustand store shape and `gsd()` accessor pattern to copy into the hook
- `shared/types.ts` — source of truth for `GsdApi`, `SessionId`; defines `compact()`, `closeSession()`, `openProject()`, `showFolderPicker()`
- `renderer/hooks/fuzzyMatch.ts` + `useMRU.ts` — established hook conventions to follow (no default exports, named exports, pure TS)
- `renderer/state/sessions-store.test.ts` — shows `vi.stubGlobal('gsd', mock)` pattern for testing IPC-calling hooks

### AppCommand interface

```ts
export interface AppCommand {
  id: string
  label: string
  /** undefined = session-agnostic; present = session-scoped */
  sessionId?: SessionId
  execute: () => void | Promise<void>
}
```

### Command → IPC mapping

| id | label | execute() |
|----|-------|-----------|
| `new-session` | New session | `gsd().showFolderPicker()` → if non-null `gsd().openProject(cwd)` |
| `open-project` | Open project | same as above |
| `close-tab` | Close tab | `gsd().closeSession(sessionId)` (no-op if null) |
| `compact-context` | Compact context | `gsd().compact(sessionId)` (no-op if null) |
| `copy-last-turn` | Copy last turn | `navigator.clipboard.writeText(lastTurnText)` |
| `show-tray` | Show tray | `console.warn('show-tray: not yet wired')` stub |
| `toggle-auto-run-panel` | Toggle auto-run panel | `console.warn('toggle-auto-run-panel: not yet wired')` stub |

### `copy-last-turn` approach

Read the last assistant turn text from the sessions store directly (not via IPC):
```ts
import { useSessionsStore } from '../state/sessions-store'
// inside hook:
const tab = useSessionsStore(s => sessionId ? s.sessions[sessionId] : null)
// last turn text: tab?.turns at last AssistantTurn — but turns live in useSession, not sessions-store
```
Actually `turns` live in `useSession` (local hook state via `turnsReducer`), not in the Zustand sessions-store. The simplest approach: accept an optional `lastTurnText?: string` parameter (or a `getLastTurnText?: () => string` callback) so the caller (the palette component, S03) can inject the turn text. This keeps the hook pure and testable.

### Build Order

1. **Define `AppCommand` type + `useAppCommands` hook** (no dependencies, pure factory)
2. **Write vitest tests** — mock `globalThis.gsd`, verify 7 entries present by `id`, verify `execute()` calls correct mock methods
3. Confirm `pnpm vitest run renderer/hooks/useAppCommands.test.ts` passes

### Verification Approach

```
pnpm vitest run renderer/hooks/useAppCommands.test.ts
```
Tests must confirm:
- Hook returns array of length 7
- All required `id` strings present
- `close-tab`, `compact-context` no-op when `sessionId` is null
- `close-tab` calls `gsd().closeSession(sessionId)` when sessionId provided
- `compact-context` calls `gsd().compact(sessionId)` when sessionId provided
- `new-session` / `open-project` call `gsd().showFolderPicker()` then `gsd().openProject()`

## Constraints

- `copy-last-turn` cannot read turn history from sessions-store (turns are local to `useSession`). Accept a `getLastTurnText?: () => string` callback parameter instead.
- No new IPC channels for `show-tray` or `toggle-auto-run-panel` — stubs only.
- Follow the `gsd()` accessor pattern (`(globalThis as unknown as { gsd: GsdApi }).gsd`) so tests work in vitest node env.

## Common Pitfalls

- **Capturing `sessionId` in closures** — build commands inside `useMemo([sessionId, getLastTurnText])` so stale closures don't fire on old session IDs.
- **`navigator.clipboard` in vitest node env** — mock `navigator.clipboard.writeText` in the test or skip clipboard assertion; don't let it hard-fail the suite.

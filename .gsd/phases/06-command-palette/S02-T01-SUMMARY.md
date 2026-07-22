---
id: T01
parent: S02
milestone: M006
key_files:
  - renderer/hooks/useAppCommands.ts
  - renderer/hooks/useAppCommands.test.ts
key_decisions:
  - Exported buildAppCommands as a pure factory alongside the hook so tests call it directly without renderHook or jsdom — avoids adding @testing-library/react to devDeps
  - copy-last-turn accepts getLastTurnText?: () => string callback so the hook stays pure and testable; turn history lives in useSession local state, not the Zustand store
  - show-tray and toggle-auto-run-panel are console.warn stubs — no phantom IPC added; wired in S04+
duration: 
verification_result: passed
completed_at: 2026-07-22T12:32:45.017Z
blocker_discovered: false
---

# T01: Delivered useAppCommands hook + buildAppCommands pure factory with 7 typed AppCommand entries and 34 passing vitest tests

**Delivered useAppCommands hook + buildAppCommands pure factory with 7 typed AppCommand entries and 34 passing vitest tests**

## What Happened

Implemented `renderer/hooks/useAppCommands.ts` exporting:
- `AppCommand` interface (id, label, sessionId?, execute)
- `buildAppCommands(sessionId, getLastTurnText?)` — pure factory callable without React, so tests avoid needing `renderHook`/jsdom
- `useAppCommands(sessionId, getLastTurnText?)` — thin React hook wrapping the factory in `useMemo([sessionId, getLastTurnText])`

Key design decision: extracting `buildAppCommands` as a pure exported function lets vitest node-env tests call it directly. No `@testing-library/react` is in devDeps, so this avoids a dependency add.

All 7 required commands are present:
- `new-session` / `open-project`: `gsd().showFolderPicker()` → `gsd().openProject(cwd)` (skipped when picker returns null)
- `close-tab`: `gsd().closeSession(sessionId)`, no-op when sessionId is null
- `compact-context`: `gsd().compact(sessionId)`, no-op when sessionId is null
- `copy-last-turn`: `navigator.clipboard.writeText(getLastTurnText?.() ?? '')`
- `show-tray` / `toggle-auto-run-panel`: `console.warn(...)` stubs for S04+ wiring

Session scope: close-tab, compact-context, copy-last-turn carry `sessionId` on the object when one is provided; session-agnostic commands (new-session, open-project, show-tray, toggle-auto-run-panel) never carry it.

The GSD accessor `(globalThis as unknown as { gsd: GsdApi }).gsd` matches sessions-store.ts so `vi.stubGlobal('gsd', mock)` works identically in the test environment.

Tests cover: array shape (length 7, all ids present, all labels non-empty), session scope fields, all command execute() paths including null-session no-ops, null-picker guard, clipboard mock, console.warn stubs, boundary/negative cases (stale closure isolation, zero-arity callback contract).

## Verification

Ran: pnpm vitest run renderer/hooks/useAppCommands.test.ts
Result: 1 test file, 34 tests — all passed in 1.39 s.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/hooks/useAppCommands.test.ts` | 0 | ✅ pass | 8522ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/hooks/useAppCommands.ts`
- `renderer/hooks/useAppCommands.test.ts`

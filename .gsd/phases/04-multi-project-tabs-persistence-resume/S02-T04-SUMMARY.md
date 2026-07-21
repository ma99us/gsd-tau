---
id: T04
parent: S02
milestone: M004
key_files:
  - main/session/session-manager.ts
  - main/session/session-manager.test.ts
  - main/ipc/handlers.ts
  - main/index.ts
key_decisions:
  - restore() treats switchSession failure as non-fatal — session stays in restored[] because the pi client is live even if it failed to attach to the previous conversation file
  - registryStore.flush() is called at the START of before-quit (before closing sessions) so the registry captures wasAutoRunning flags and session list from the live state, not the post-close empty state
  - RESTORE_COMPLETE fanned out to BrowserWindow.getAllWindows() (not electronWebContents.getAllWebContents()) to avoid importing a second webContents alias in index.ts
  - restore() restores ALL registry sessions, not only wasAutoRunning ones — the plan wording was ambiguous but docs/30-persistence.md is clear that all sessions restore; wasAutoRunning is used post-restore for the auto-resume banner (future phase)
duration: 
verification_result: passed
completed_at: 2026-07-21T12:56:12.427Z
blocker_discovered: false
---

# T04: Session restore on launch: SessionManager.restore() opens sessions from registry, calls switchSession when sessionFile present, emits restore-complete IPC push

**Session restore on launch: SessionManager.restore() opens sessions from registry, calls switchSession when sessionFile present, emits restore-complete IPC push**

## What Happened

Implemented the full session-restore-on-launch flow across four files.

**session-manager.ts** — Three additions:
1. `isRestored?: boolean` field on `ActiveSession` (internal flag, not exposed in `SessionRecord`).
2. `RestoreResult` interface exported: `{ restored: SessionId[]; failed: Array<{ record, error }> }`.
3. `restore(records: SessionRecord[]): Promise<RestoreResult>` method. Opens all records in parallel via `Promise.all`. For each record: calls `this.open(record.cwd)` → marks `entry.isRestored = true` → if `record.sessionFile` is present, calls `client.switchSession({ sessionPath })` via a cast to the stable RPC contract type (switchSession is in `RPC_COMMAND_TYPES` but not typed in the local mock surface). switchSession failure is caught and logged as a warning — non-fatal, session remains live and in `restored[]`. Factory failures are caught per-record and pushed to `failed[]` so other records still attempt. Returns `{ restored, failed }` with structured logging at start and end.

**session-manager.test.ts** — Added `switchSession: vi.fn().mockResolvedValue(undefined)` to `makeMockClient()`. Added `import type { SessionRecord }` to the shared-types import. Added `describe('restore()')` with 7 tests: (1) empty records → empty arrays, (2) single restored session appears in list(), (3) both records appear in list() after restoring 2 sessions, (4) switchSession called when sessionFile present, (5) switchSession NOT called when sessionFile absent, (6) factory failure captured in failed[] without blocking other records, (7) switchSession failure is non-fatal — session still in restored[]. Total: 64 tests (up from 57), all pass.

**handlers.ts** — Added `RESTORE_COMPLETE: 'session:restore-complete'` to the `PUSH` constants. JSDoc notes the payload type is `RestoreResult`.

**index.ts** — Four changes: (1) Added `RegistryStore` import from `./persistence/registry-store`; added `PUSH` to the `registerHandlers` import. (2) Created `const registryStore = new RegistryStore()` at module level, changed `new SessionManager()` to `new SessionManager({ registryStore })` so all open/close/rename/state-change events persist debounced registry writes. (3) Added `registryStore.flush()` at the start of `before-quit` (before closing sessions) so the current state — sessions still open with their wasAutoRunning flags — reaches disk even when the 500ms debounce has not elapsed. (4) Changed `app.whenReady().then(() => {` to `async () => {`; added `const registry = registryStore.load()` before `createMainWindow()`; after creating the window, calls `await sessionManager.restore(registry.sessions)`, then fans out `PUSH.RESTORE_COMPLETE` to all non-destroyed BrowserWindow webContents; guards against unexpected errors with a try/catch (restore() itself never throws).

## Verification

pnpm test -- session-manager: 64 tests passed, 0 failed (7 new restore() tests, previously 57). tsc --noEmit --project tsconfig.node.json: 0 type errors (only pnpm config warnings about onlyBuiltDependencies).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- session-manager --reporter=verbose` | 0 | ✅ pass — 64 tests passed, 0 failed | 570ms |
| 2 | `pnpm exec tsc --noEmit --project tsconfig.node.json` | 0 | ✅ pass — 0 type errors | 1358ms |

## Deviations

restore() restores ALL sessions regardless of wasAutoRunning (the task plan said "for each SessionRecord with wasAutoRunning=true" but docs/30-persistence.md shows all sessions are restored; wasAutoRunning only gates the auto-resume banner which is out of T04 scope). This aligns with the verify criterion: "both appear in session list" regardless of their wasAutoRunning value.

## Known Issues

None.

## Files Created/Modified

- `main/session/session-manager.ts`
- `main/session/session-manager.test.ts`
- `main/ipc/handlers.ts`
- `main/index.ts`

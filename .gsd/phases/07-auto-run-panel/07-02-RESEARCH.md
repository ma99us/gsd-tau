# M007/S02 — SessionHandle Integration and Path B Reconciliation

**Date:** 2026-07-22

## Summary

S02 wires the S01 `ProgressTracker` into the live session pipeline and adds the IPC surface that lets the renderer subscribe to progress updates. The work has three natural seams: (1) wiring ProgressTracker into `handlers.ts` doOpenProject(), (2) adding PUSH/IPC channels + preload methods, and (3) implementing Path B filesystem reconciliation.

The codebase has a clear, tested pattern for every piece of this work. `handlers.ts` already handles `execution_complete`, wires per-session state machines, and fans out over `webContents.getAllWebContents()`. `ProgressTracker.on('updated', ...)` is exactly the EventEmitter hook that needs to be bridged to IPC. Path B can be implemented cleanly with a dedicated `progress-reconciler.ts` helper that reads `.gsd/phases/{milestoneId}/{milestoneId}-ROADMAP.md` from the session CWD — the docs mention `client.bash(...)` as the primary vector but in practice the `gsd headless` subcommand times out in testing; direct filesystem reads via `node:fs` from the main process are reliable and avoid polluting the pi conversation context.

`cost_update` events currently fall through to the `unknown-event` channel in `SessionHandle` because `cost_update` is not in `KNOWN_TYPES`. A one-line addition to `KNOWN_TYPES` in `session-handle.ts` is required so handlers.ts can listen on the named channel.

## Recommendation

Implement in three tasks: (1) add `cost_update` to KNOWN_TYPES, instantiate ProgressTracker per session in `doOpenProject()`, wire handle events → tracker, wire tracker → IPC fanOut; (2) add PUSH channel, IPC channel, GsdApi interface extensions, and preload wiring; (3) implement `progress-reconciler.ts` that parses `.gsd/phases/` markdown and wire it to fire on `execution_complete` and on a new `REFRESH_PROGRESS` IPC command.

## Implementation Landscape

### Key Files

- `main/session/session-handle.ts` — Add `'cost_update'` to `KNOWN_TYPES` (line ~25). No other changes needed; existing `tool_use` dispatch already works.
- `main/ipc/handlers.ts` — Primary change target. `doOpenProject()` (~L340-490) instantiates per-session state; add `ProgressTracker` there alongside `BlockerTracker`. `SessionEntry` interface (~L150) needs a `progressTracker: ProgressTracker` field. `onEvent` handler (~L380) already catches `execution_complete` — trigger Path B there. `PUSH` constant (~L87) needs `PROGRESS_UPDATE: 'session:progress-update'`. `IPC` constant (~L22) needs `GET_PROGRESS: 'getProgress'` and `REFRESH_PROGRESS: 'refreshProgress'`.
- `main/session/progress-tracker.ts` — Already complete (S01). No modifications needed; exposes `handleToolUse()`, `handleCostUpdate()`, `snapshot()`, and `'updated'` event.
- `main/session/progress-reconciler.ts` — **New file.** Reads `{cwd}/.gsd/phases/{milestoneId}/{milestoneId}-ROADMAP.md` with `node:fs` to get authoritative slice statuses from markdown checkboxes (`- [x]` = complete, `- [ ]` = pending). For in-progress slices, optionally reads task SUMMARY files. Returns a `ReconcileResult` that callers merge into the ProgressTracker snapshot.
- `shared/types.ts` — `GsdApi` interface needs two new methods: `getProgress(sessionId: SessionId): Promise<GsdProgress | null>` and `onProgressUpdate(sessionId: SessionId, cb: (progress: GsdProgress) => void): Unsubscribe`. `PUSH` channel name should also be exported.
- `preload/preload.ts` — Wire `getProgress` (ipcRenderer.invoke) and `onProgressUpdate` (ipcRenderer.on with sessionId filter), following the exact pattern of `onQuotaUpdate` (~L348) and `onStateChange` (~L210).

### Build Order

1. **session-handle.ts** — add `cost_update` to KNOWN_TYPES. Tiny, unblocks cost tracking. Verify: existing tests still pass.
2. **progress-reconciler.ts** — new standalone module. Parses ROADMAP.md checkbox format (`- [x] **S01: ...** \`risk:...\``). Returns `Map<sliceId, GsdNodeStatus>`. No external deps. Unit-testable in isolation.
3. **handlers.ts + shared/types.ts + preload.ts** — wire ProgressTracker into doOpenProject, add PUSH/IPC channels, add GsdApi methods, add preload bindings. This is the integration task; do it atomically so TS compiles clean throughout.

### Verification Approach

```
# Type-check all layers
pnpm tsc --noEmit

# Unit tests for progress-reconciler (parse ROADMAP.md fixtures)
pnpm vitest run main/session/progress-reconciler.test.ts

# Integration smoke: run app, open DevTools, start /gsd auto
# → window.gsd.onProgressUpdate fires when ProgressTracker emits
# → after execution_complete, snapshot reflects reconciled statuses
```

The S02 demo criterion ("open DevTools, observe window.gsd.onProgressUpdate callbacks firing; after execution_complete the reconciliation runs") is satisfied when the preload method registers without error and the push channel delivers GsdProgress payloads.

## Constraints

- `ProgressTracker` must be cleaned up in `SessionEntry.cleanup()` — remove all listeners to avoid memory leaks. Call `tracker.removeAllListeners()` there.
- The `progress-reconciler.ts` MUST use `node:fs` reads from the main process only. Never expose filesystem paths over IPC to renderer.
- The ROADMAP.md checkbox regex pattern: `/^- \[([ x])\] \*\*(\w+):/m` — handles both checked and unchecked items. The milestoneId embedded in the path is `tracker.snapshot().milestone?.id`.
- `cost_update` event type: from the RPC stream, `ev.totalCostUsd` is the cumulative session total (consistent with ProgressTracker.handleCostUpdate's expected signature).

## Common Pitfalls

- **`cost_update` not in KNOWN_TYPES** — currently falls to `unknown-event` channel. Without adding it, ProgressTracker.handleCostUpdate() is never called and the cost gauge stays at $0.00. Fix: add to KNOWN_TYPES before wiring.
- **SessionEntry missing progressTracker field** — TypeScript will catch this at compile, but forgetting to include it in cleanup() causes a listener leak. The `cleanup()` function currently calls `tracker.off(...)` for each listener; the same pattern applies.
- **Path B fires before milestone is known** — on `execution_complete`, `tracker.snapshot().milestone?.id` may be null if no `gsd_plan_milestone` tool was called this session. Guard: `if (!milestoneId) return` before running reconciler.
- **fanOut for progress must filter by sessionId on renderer side** — the push payload shape is `{ sessionId, progress: GsdProgress }`. The preload `onProgressUpdate` must filter `payload.sessionId === sessionId`, exactly like `onUiRequestAdded` does.

## Open Risks

- Path B ROADMAP.md parsing relies on a stable checkbox format. If the pi roadmap template changes its checkbox syntax the parser silently returns no slice statuses. Mitigation: unit test with fixture files; fall back gracefully (keep Path A data if Path B returns empty).
- `client.bash('gsd headless gsd_milestone_status ...')` as an alternative Path B approach timed out in testing — do not use; stick with direct filesystem reads.

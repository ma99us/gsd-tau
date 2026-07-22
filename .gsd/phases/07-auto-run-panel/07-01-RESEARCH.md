# M007/S01 — Research: GsdProgress data model and progress tracker

**Date:** 2026-07-22

## Summary

S01 establishes the in-memory data model and mutation engine that all later slices (S02–S04) build on. The work is entirely in `main/` (Node/Electron main process) — no renderer changes yet — and is pure TypeScript with no new runtime dependencies.

The existing `GsdProgress` stub in `shared/types.ts` is a 4-field placeholder that is nowhere near sufficient for the panel. It must be replaced with a full milestone → slice → task tree that carries statuses, replan markers, costs, wall-clock data, and current-task tracking. The replacement must be backwards-compatible or the stub must be superseded (it is currently unused in any renderer code, so a full replacement is safe).

The `ProgressTracker` class should live in `main/session/progress-tracker.ts`, mirroring the existing `BlockerTracker` pattern: an `EventEmitter` that accepts raw `tool_use` event payloads and emits an `'updated'` event every time the in-memory tree changes. S02 will subscribe to that event and push updates over IPC.

## Recommendation

1. **Expand `GsdProgress` in `shared/types.ts`** into a full tree:  
   `GsdProgress` → `GsdMilestone[]` → `GsdSlice[]` → `GsdTask[]`, each with a `status` discriminant (`pending | in-progress | complete | skipped`), plus a replan-marker field on slice/task nodes, plus top-level cost/time aggregates.

2. **Create `main/session/progress-tracker.ts`** — a class that accepts `tool_use` event payloads one at a time and mutates the in-memory `GsdProgress` tree.

3. **Unit-test in `main/session/progress-tracker.test.ts`** — the slice demo criterion is "vitest run passes; feeding events produces the correct tree". This is the verification.

No new npm packages. Pure reducer logic on plain objects.

## Implementation Landscape

### Key Files

- `shared/types.ts` — replace the `GsdProgress` stub (4 fields → full tree). The stub is currently dead code (no renderer or main code reads `GsdProgress` yet). New shape:
  ```ts
  export type GsdNodeStatus = 'pending' | 'in-progress' | 'complete' | 'skipped'

  export interface GsdTask {
    id: string        // e.g. "T01"
    title: string
    status: GsdNodeStatus
  }

  export interface GsdSlice {
    id: string        // e.g. "S01"
    title: string
    status: GsdNodeStatus
    tasks: GsdTask[]
    replanned: boolean
    replanNote?: string
  }

  export interface GsdMilestone {
    id: string        // e.g. "M007"
    title: string
    status: GsdNodeStatus
    slices: GsdSlice[]
    cumulativeCostUsd: number
    autoStartedAt: string | null   // ISO-8601
  }

  export interface GsdProgress {
    milestone: GsdMilestone | null
    currentSliceId: string | null
    currentTaskId: string | null
    lastToolAt: string | null       // ISO-8601 of most recent tool_use
  }
  ```

- `main/session/progress-tracker.ts` — **new file**. EventEmitter subclass that holds a `GsdProgress` and exposes:
  - `handleToolUse(name: string, args: unknown): void` — the main mutation entry point  
  - `snapshot(): GsdProgress` — returns a deep copy  
  - Event `'updated'` carrying the new `GsdProgress`
  - Handles: `gsd_plan_milestone`, `gsd_plan_slice`, `gsd_plan_task`, `gsd_task_complete`, `gsd_slice_complete`, `gsd_complete_milestone`, `gsd_skip_slice`, `gsd_replan_slice`, `gsd_reassess_roadmap`
  - Also handles cost: `cost_update` events carry `totalCostUsd`; tracker accumulates per-milestone cost

- `main/session/progress-tracker.test.ts` — **new file**. Tests feed raw mock `tool_use` payloads and assert the resulting `GsdProgress` tree. Should cover: plan → execute → complete happy path; skip slice; replan slice mutates task list; cost accumulation; snapshot returns a copy (mutation isolation).

- `main/session/blocker-tracker.ts` — **reference/pattern only**. Follow its EventEmitter class pattern exactly (typed `declare interface` overloads, private inner state, `export { ClassName }` at bottom).

- `shared/types.ts` — also note: `SessionEvent` (`{ type: string; [key: string]: unknown }`) is the shape coming over IPC. The `tool_use` event from pi has shape `{ type: 'tool_use', toolName: string, toolInput: Record<string,unknown> }` — check `@opengsd/contracts` RPC types before assuming field names.

### Build Order

1. **Define the new `GsdProgress` tree types in `shared/types.ts`** first — unblocks everything else. Remove the old 4-field stub or alias it.
2. **Implement `ProgressTracker`** with pure mutation logic — no IPC, no Electron, fully testable in Node.
3. **Write `progress-tracker.test.ts`** to confirm all Path A tool names produce correct mutations. This is the slice gate.
4. S02 will then wire `ProgressTracker` into `SessionHandle`'s `tool_use` event and push `GsdProgress` over IPC.

### Verification Approach

```
pnpm vitest run main/session/progress-tracker.test.ts
```

All existing tests must continue to pass (`pnpm vitest run`). No renderer or Electron tests are needed for S01.

## Constraints

- `shared/types.ts` must not import Node.js APIs or Electron — it is bundled into the renderer. Plain types only.
- `progress-tracker.ts` lives in `main/` so it can use `EventEmitter` from `node:events`, matching `BlockerTracker`.
- Do NOT read `gsd.db` directly (ADR-004). Path A is entirely from `tool_use` event args.
- `tool_use` event shape from pi: check `@opengsd/contracts` — the field is `toolName` not `name`. The `SdkAgentEvent` discriminant is `type === 'tool_use'`. Executor must verify actual field names from contracts before coding.
- The `GsdProgress` type crosses the IPC boundary (pushed from main to renderer in S02), so it must remain JSON-serialisable — no `Map`, `Set`, or `Date` instances.

## Common Pitfalls

- **Stale `GsdProgress` stub** — the current 4-field stub in `shared/types.ts` is used nowhere (confirmed by search). Replace it entirely; don't extend it. Leaving the old shape risks S03/S04 accidentally importing the stub.
- **`tool_use` field names** — pi's RPC emits `toolName` + `toolInput` (not `name` + `input` or `args`). Confirm from `C:/nvm4w/nodejs/node_modules/@opengsd/gsd-pi/packages/contracts/dist/rpc.d.ts` before implementing `handleToolUse`.
- **Mutation vs. copy** — `snapshot()` must return a deep copy. If the caller holds a reference and ProgressTracker mutates it, S02 IPC pushes will carry stale data. Use `structuredClone`.
- **`gsd_replan_slice` mutates task list** — the `updatedTasks` and `removedTaskIds` args fully replace tasks in a slice. The tracker must merge/replace, not append.

## Sources

- `docs/50-auto-run-view.md` — full design spec (Path A tool names, Path B reconciliation, UI layout, cost/time display).
- `docs/decisions/ADR-004-progression-from-tools-and-fs.md` — why `tool_use` + `gsd_milestone_status`, not direct DB reads.
- `main/session/blocker-tracker.ts` — canonical EventEmitter pattern to follow.
- `shared/types.ts` — existing `GsdProgress` stub to replace; `SessionEvent` shape for IPC boundary contract.

# M001: Auto-run Panel

**Gathered:** 2026-07-22
**Status:** Ready for planning
**Phase:** 6 (follows Phase 5 — Command Palette)

## Project Description

gsd-tau is a Windows Electron desktop shell over headless `@opengsd/gsd-pi` sessions. M001 adds the panel that makes `/gsd auto` observable — showing real-time milestone/slice/task progress as pi drives itself for hours.

## Why This Milestone

When pi runs auto-mode, the user has no visibility into what it's currently doing, how far it's progressed, or whether it's stuck. The auto-run panel fills that gap. Without it, auto-mode sessions are a black box.

Phase 5 (command palette) comes before this in execution order — but M001 is architecturally independent. M001 wires its own Ctrl+/ keyboard toggle; Phase 5 can reuse or replace it when it lands.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Watch the milestone/slice/task tree update live as pi works through a `/gsd auto` session — status symbols updating in real time (✔ complete, ▶ active, ○ pending, ⤫ skipped, ↻ replanned)
- See which task pi is currently executing, with a timestamp showing how long ago it started
- Press Pause to gracefully stop auto-mode (`abort()` + `/gsd stop` prompt)
- Toggle the panel with Ctrl+/ at any time; it auto-slides in when the session enters Auto state
- See cumulative cost and wall-clock time under the tree
- Click Refresh to force a Path B reconciliation against `gsd_milestone_status`
- Click "Open roadmap in editor" to shell-open the `{MM}-ROADMAP.md` file

### Entry point / environment

- Entry point: Running gsd-tau app with an active pi session executing `/gsd auto`
- Environment: Windows Electron desktop app
- Live dependencies involved: pi RPC subprocess (tool_use events, bash calls), `.gsd/` filesystem

## Completion Class

- Contract complete means: ProgressTracker unit tests cover Path A event handling for all workflow tools; IPC channel types verified; panel component renders correctly against mock GsdProgress objects
- Integration complete means: Live auto-mode session shows the panel updating in real time; Path B reconciliation calls succeed via `client.bash()` with `excludeFromContext: true`; Pause button stops pi gracefully
- Operational complete means: Panel survives session relaunch (Path B seeds state on reattach); panel stays stable across 60s cadence Path B refreshes; no IPC flood during rapid tool_use sequences

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Start a `/gsd auto` session; the panel appears automatically; milestone/slice/task tree updates frame-perfectly as pi calls workflow tools; at least one task transitions from ▶ to ✔ live in the UI
- Press Pause mid-session; pi receives abort + `/gsd stop` and winds down; session returns to idle state; panel reflects the stopped state
- Relaunch the app mid-milestone; panel reseeds from `gsd_milestone_status` on session reattach and shows the correct prior state

## Architectural Decisions

### Progress Tracker in Main Process

**Decision:** `ProgressTracker` lives in the main process, attached to `SessionHandle`, and pushes `GsdProgress` state updates over IPC to the renderer.

**Rationale:** Consistent with how all other session state flows (session status, model info, quota). `tool_use` events are already handled in main via `session-handle.ts`. Centralising Path B (`client.bash()` reconciliation calls) in main keeps subprocess calls out of the renderer. Renderer stays a pure display layer.

**Alternatives Considered:**
- Renderer-side tracking — would require exposing raw tool_use events over IPC and duplicating state logic in the renderer; harder to test and violates the existing architecture pattern
- Hybrid main/renderer — adds complexity without clear benefit given the existing IPC pattern

---

### Path A + Path B Two-Source Strategy (per ADR-004)

**Decision:** Derive progress from `tool_use` events (Path A, frame-perfect) reconciled periodically by `gsd_milestone_status` called through `client.bash()` with `excludeFromContext: true` (Path B, authoritative).

**Rationale:** pi does not emit typed progression events over RPC. Filesystem watchers on `.gsd/` are fragile (Markdown checkbox parsing). Direct `.gsd/gsd.db` reads are forbidden (WAL-locked single-writer). `tool_use` events are millisecond-latent; Path B catches any drift. Validated by ADR-004.

**Alternatives Considered:**
- Filesystem-watch only — fragile Markdown parsing; Tier-3 fallback only
- Direct DB reads — forbidden

---

### M001 Owns Ctrl+/ Toggle

**Decision:** M001 wires `Ctrl+/` directly in the session view to toggle the panel. Phase 5 (command palette) can reuse or replace the binding when it lands.

**Rationale:** Phase 5 comes before M001 in the roadmap, but M001 is architecturally independent. Not blocking M001 on Phase 5 infrastructure avoids artificial sequencing. The binding is local to the session view; Phase 5 can absorb it into its palette registration layer without a breaking change.

**Alternatives Considered:**
- Wait for Phase 5 keyboard infrastructure — unnecessarily blocks M001; command palette has its own scope

---

### Pause = abort() + /gsd stop

**Decision:** The Pause button sends `client.abort()` (interrupt current tool call) followed by `client.prompt('/gsd stop')` (request graceful wind-down).

**Rationale:** `abort()` alone may leave pi mid-task in inconsistent state. `/gsd stop` alone waits for current tool to finish — may take 30–60s for long-running tools. The combination gives an immediate interrupt signal followed by a graceful exit request. Matches the approach documented in `docs/50-auto-run-view.md`.

**Alternatives Considered:**
- `abort()` only — fast but risks inconsistent task state
- `/gsd stop` only — clean but may take 30–60s

## Error Handling Strategy

- **Path B failures** (bash call fails or returns no JSON): log a warning, keep the last in-memory state, surface a subtle "Progress may be stale" hint in the panel. Do not crash the session.
- **`excludeFromContext` not supported** (older pi version): feature-detect once on session attach via `get_commands`; fall back to file-watching `.gsd/phases/*/` as Tier-3 path.
- **ProgressTracker drift** (Path B shows 3+ events out of date): full resync from DB, log a discrepancy warning. If repeated, surface "Progress display may be stale — refresh?" hint.
- **Pause during blocker** (extension_ui_request open): abort() cancels the blocker (BlockerTracker handles cancellation); `/gsd stop` sent after cancellation resolves.
- **client.abort() not available** (version check): disable Pause button and show tooltip "Upgrade pi to enable Pause".

## Risks and Unknowns

- `client.bash()` `excludeFromContext` parameter — needs verification against `@opengsd/contracts` RPC contract; if absent, bash reconciliation calls will pollute LLM context
- `gsd_milestone_status` called via `bash` syntax — need to confirm the exact CLI invocation (`gsd tool gsd_milestone_status --milestone-id X`) returns parseable JSON output
- Ctrl+/ may conflict with existing keybindings — verify no collision in current `App.tsx` / `Composer.tsx` bindings
- Milestone discovery on reattach — `STATE.md` format and `.gsd/phases/` directory structure needs validation against live pi output before implementing the seeder

## Existing Codebase / Prior Art

- `src/main/session/session-handle.ts` — already subscribes to `tool_use` events from the RPC stream; ProgressTracker hooks in here
- `src/main/session/session-manager.ts` — manages SessionHandle lifecycle; ProgressTracker is injected or instantiated here
- `src/main/ipc/handlers.ts` — existing IPC channel pattern; add `progress:update` channel here
- `src/renderer/hooks/useSession.ts` — renderer-side session state; add `useProgress` hook following the same pattern
- `src/renderer/App.tsx` — session view host; panel is conditionally rendered here based on session state + user toggle
- `src/main/session/state-machine.ts` — Auto state is already defined; panel visibility ties to this state
- M002 `src/main/pi/client-factory.ts` — RpcClient creation; check `bash()` method signature for `excludeFromContext` support

## Relevant Requirements

- R4 — Auto-run panel and progression visibility (this milestone directly delivers R4)
- R3 — Session state at a glance (panel surfaces Auto/Waiting-on-you state during blockers)

## Scope

### In Scope

- `ProgressTracker` in main process: Path A (tool_use event handling for all workflow tools), Path B (gsd_milestone_status reconciliation)
- `GsdProgress` data model: milestone, slices, tasks with status, timestamps, replan annotations
- IPC channel `progress:update` pushed from main to renderer per session
- `AutoRunPanel` renderer component: milestone/slice/task tree, status symbols, current-task marker with timestamp, last-action line, cost/wall-clock footer
- Pause button: `abort()` + `/gsd stop`
- Refresh button: manual Path B trigger
- "Open roadmap in editor" button: `shell.openPath()` via IPC
- Panel auto-show on Auto state entry; Ctrl+/ toggle
- Session reattach seeding: read `.gsd/STATE.md` or phases directory, fire Path B
- Blocker-during-auto-mode: current task grows red border + "Blocked on user input" label; Auto badge overridden by Waiting-on-you

### Out of Scope / Non-Goals

- Individual task diffs / files-touched (dashboard feature, explicitly deferred)
- Gantt-style timeline
- Completion time prediction
- Modifying the roadmap from the UI (read-only)
- Multi-milestone tracking in a single panel view (show active milestone only)
- Phase 5 command palette integration (Phase 5 may reuse Ctrl+/ binding; M001 doesn't depend on it)

## Technical Constraints

- No direct `.gsd/gsd.db` reads — forbidden per ADR-004 and pi's own guidance
- Markdown checkbox parsing as Tier-3 fallback only
- `excludeFromContext: true` on all `client.bash()` reconciliation calls — must not pollute LLM context
- Renderer remains a pure display layer — all subprocess calls stay in main process
- Windows-only target; no cross-platform abstractions needed

## Integration Points

- `SessionHandle` (main) — source of `tool_use` events; ProgressTracker attaches here
- `RpcClient.bash()` — Path B reconciliation calls; verify `excludeFromContext` support in contracts
- `SessionStateMachine` — Auto state drives panel auto-show; Waiting-on-you state drives blocker badge
- `BlockerTracker` — coordinates with Pause to cancel open blockers before abort
- `shell.openPath()` (Electron main) — "Open roadmap in editor" action
- `.gsd/STATE.md` / `.gsd/phases/` — milestone discovery on session reattach

## Testing Requirements

- **Unit:** ProgressTracker handles all workflow tool events correctly (Path A); reconciliation merges Path B results correctly; GsdProgress data model covers all status transitions including replan/reassess
- **Unit:** AutoRunPanel renders correctly for all GsdProgress shapes (pending-only, mixed, complete, blocked)
- **Integration:** `client.bash()` with `excludeFromContext: true` returns `gsd_milestone_status` JSON without polluting session context
- **E2E (Playwright):** Launch app, start auto-mode on a test repo, verify panel appears and at least one task transitions live; verify Pause stops pi within 5s

## Acceptance Criteria

- Panel auto-shows when session enters Auto state; hides when Auto exits (unless pinned with Ctrl+/)
- All workflow tools (`gsd_plan_milestone`, `gsd_plan_slice`, `gsd_plan_task`, `gsd_task_complete`, `gsd_slice_complete`, `gsd_complete_milestone`, `gsd_skip_slice`, `gsd_replan_slice`, `gsd_reassess_roadmap`) produce correct Path A updates
- Path B reconciliation fires on: relaunch/reattach, every `execution_complete`, 60s cadence, manual Refresh
- If Path B disagrees with Path A by 3+ events, full resync occurs and a warning is logged
- Pause sends `abort()` + `/gsd stop`; session returns to idle within 10s; panel reflects stopped state
- Cost accumulates correctly from `cost_update` events scoped to the current milestone
- "Open roadmap in editor" opens the correct `{MM}-ROADMAP.md` file in the system default editor
- Replanned nodes show ↻ symbol with hover tooltip displaying the `whatChanged` field
- Blocker during auto-mode: current task gets red border + "Blocked on user input" label; answering returns to normal

## Open Questions

- `client.bash()` `excludeFromContext` field — present in contracts? If absent, need an alternative isolation mechanism or accept context pollution for reconciliation calls
- `gsd tool gsd_milestone_status --milestone-id X` exact CLI syntax — confirm via pi binary before implementing Path B
- `Ctrl+/` collision check — verify no conflict with Composer's existing slash-picker trigger

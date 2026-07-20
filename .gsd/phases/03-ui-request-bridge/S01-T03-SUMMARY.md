---
id: T03
parent: S01
milestone: M003
key_files:
  - main/session/state-machine.ts
  - main/session/state-machine.test.ts
  - main/session/session-handle.ts
key_decisions:
  - Added StateMachineTrigger as a wider union over StateMachineInputEvent so StateChangedPayload.trigger captures blocker events without polluting the feed()-able input set
  - blockerAdded/blockerRemoved are separate methods (not feed() variants) because blockerRemoved requires remainingCount context and the pattern matches BlockerTracker's docstring API
  - _preWaitingState stores the return-to state at blocker-add time; agent_start/agent_end while Waiting silently update it so the transition knows where to land
  - wireBlockerTracker returns a cleanup closure — callers control the lifetime without the handle owning the state machine
duration: 
verification_result: passed
completed_at: 2026-07-20T18:24:48.603Z
blocker_discovered: false
---

# T03: Extended SessionStateMachine with Waiting state, blockerAdded/blockerRemoved methods, and wired BlockerTracker into SessionHandle — 45 tests all pass

**Extended SessionStateMachine with Waiting state, blockerAdded/blockerRemoved methods, and wired BlockerTracker into SessionHandle — 45 tests all pass**

## What Happened

## What Happened

Extended `SessionStateMachine` to add the `'Waiting'` state representing a session blocked on at least one open `extension_ui_request`.

**state-machine.ts changes:**
- `SessionState` widened to `'Working' | 'Idle' | 'Stopped' | 'Waiting'`
- Added `StateMachineTrigger` type (`StateMachineInputEvent | 'blocker-added' | 'blocker-removed'`) so `StateChangedPayload.trigger` can represent all transition drivers without polluting `StateMachineInputEvent`
- Added `_preWaitingState: 'Working' | 'Idle' | null` to remember where to return when all blockers clear
- Added `blockerAdded()`: Idle/Working → Waiting; clears watchdog if from Working; no-op from Stopped or already-Waiting
- Added `blockerRemoved(remainingCount: number)`: if Waiting and count==0, transition back to pre-Waiting state (Working or Idle), re-arming watchdog if returning to Working; no-op otherwise
- Updated `feed()`: while Waiting, `agent_start`/`agent_end` silently update `_preWaitingState` (no visible state change), letting `blockerRemoved` know where to land; `transport-error`/`watchdog-timeout` fall through and still transition to Stopped
- Updated `_nextState()`: added `Waiting` guard in `agent_start` case (double-safety, though it's already handled by the early return in `feed()`)
- Updated `destroy()`: also clears `_preWaitingState`

**state-machine.test.ts changes:**
- All 26 existing tests preserved unchanged
- Added `describe('Waiting state')` with 19 new tests covering: Idle→Waiting, Working→Waiting, watchdog cleared on enter, no-op from Stopped, no-op from already-Waiting, Waiting→Idle, Waiting→Working, watchdog re-armed on return to Working, n>0 no-op, non-Waiting no-op, multiple-blocker sequence, agent_end mid-wait updates return state, agent_start mid-wait updates return state, transport-error→Stopped, preWaitingState cleared on transport-error, blockerAdded after Stopped, heartbeat no-op in Waiting, watchdog-timeout from Waiting

**session-handle.ts changes:**
- Added `import type` for `BlockerTracker` and `SessionStateMachine` (renderer-safe, zero runtime footprint)
- Added `wireBlockerTracker(tracker, sm)` method: wires `ui-request-added` → `sm.blockerAdded()` and `ui-request-removed` → `sm.blockerRemoved(tracker.size)`; returns a cleanup function for teardown/replacement

## Failure Modes

No external dependencies. `SessionStateMachine` is pure in-memory state with synchronous transitions and a single `setTimeout`-based watchdog. `SessionHandle.wireBlockerTracker` only attaches/detaches EventEmitter listeners. No APIs, filesystem, network, or subprocesses involved in this task.

## Load Profile

Single-session object with O(1) operations per event. No persistent collections or concurrency. No runtime load dimension applies.

## Negative Tests

Covered in `describe('Waiting state')` in `main/session/state-machine.test.ts`:

| Case | Test |
|---|---|
| `blockerAdded()` from Stopped (terminal — no-op) | "blockerAdded() is a no-op when Stopped" |
| `blockerAdded()` from Waiting (already blocked — no-op) | "blockerAdded() while already Waiting is a no-op" |
| `blockerRemoved(n > 0)` while Waiting (blockers remain — no-op) | "blockerRemoved(n > 0) is a no-op — stays in Waiting" |
| `blockerRemoved(0)` when not in Waiting (wrong state — no-op) | "blockerRemoved(0) is a no-op when not in Waiting state" |
| `transport-error` from Waiting clears preWaitingState; subsequent `blockerRemoved` inert | "transport-error from Waiting clears preWaitingState" |
| `blockerAdded` after Stopped (via Waiting path) still no-op | "blockerAdded() after Stopped is still a no-op" |
| `heartbeat()` from Waiting is silent no-op | "heartbeat() is a no-op in Waiting state" |
| `agent_start` while Waiting — no state change | "agent_start while Waiting does not change state" |
| `agent_end` while Waiting — no state change | "agent_end while Waiting does not change state" |

## Verification

Ran `pnpm test -- state-machine --reporter=verbose`: 45 tests passed, 0 failed, 1 file, 568ms total.

## Verification

pnpm test -- state-machine --reporter=verbose: 45 passed (45), exit 0, 568ms. All existing transitions confirmed; all 19 new Waiting-state tests pass including blocker-added, blocker-removed, watchdog pause/resume, agent event mid-wait, transport-error from Waiting, and multiple-blocker sequence.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- state-machine --reporter=verbose` | 0 | ✅ pass — 45/45 tests passed | 568ms |

## Deviations

None. SessionHandle.wireBlockerTracker added as a method (not constructor param) per the non-breaking, cleanup-function pattern from the BlockerTracker docstring. All task-plan transitions implemented exactly as specified.

## Known Issues

None.

## Files Created/Modified

- `main/session/state-machine.ts`
- `main/session/state-machine.test.ts`
- `main/session/session-handle.ts`

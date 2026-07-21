---
id: T03
parent: S01
milestone: M005
key_files:
  - renderer/components/SessionHeaderBar.tsx
  - renderer/state/sessions-store.ts
  - renderer/state/sessions-store.test.ts
key_decisions:
  - SessionHeaderBar manages its own local state for model+cost (not Zustand store) — fast reactive updates without coupling the component to store actions; TabEntry fields are structural additions for downstream use
  - Use RpcCostUpdateEvent.cumulativeCost directly (not summing turnCost) — prevents drift from missed or out-of-order push events
  - cost: 0 added to all 6 TabEntry creation sites; modelInfo is optional (no default needed) — consistent with the field being populated asynchronously after getRpcState resolves
  - sessions-store.test.ts makeTabEntry updated as a necessary companion fix — cost is a required field on TabEntry so the test helper must include it
duration: 
verification_result: passed
completed_at: 2026-07-21T18:16:25.713Z
blocker_discovered: false
---

# T03: Created SessionHeaderBar component (model chip + cost display) and added modelInfo/cost fields to TabEntry

**Created SessionHeaderBar component (model chip + cost display) and added modelInfo/cost fields to TabEntry**

## What Happened

Three changes delivered:

**`renderer/components/SessionHeaderBar.tsx` (new)**  
Self-contained component that renders `provider/model-id  ·  $0.0000` above the turn list. Uses local `useState` for model and cost. On mount, calls `window.gsd.getRpcState(sessionId)` to populate the model chip; re-fetches after `execution_complete` events (model may change between turns). Accumulates cumulative cost from `cost_update` events using `RpcCostUpdateEvent.cumulativeCost` directly — not a running sum of `turnCost` — so the display stays accurate if a push is missed or arrives out of order. Subscribes to events independently via `window.gsd.onEvent` and returns the unsub in the cleanup function. Degrades gracefully: shows `—` when `getRpcState` returns null/model absent, swallows errors silently (keeps last known model). Cost shown with 4 decimal places so fractional-cent usage is visible.

**`renderer/state/sessions-store.ts`**  
Added optional `modelInfo?: { provider: string; id: string }` and required `cost: number` (default `0`) to `TabEntry` interface. Applied `cost: 0` to all 6 TabEntry construction sites: `tabFromRecord`, `openTab`, `replaceMissingTab`, `init()` missing-path phantom loop, `_missingPathSub` callback phantom, and `_restoreSub` newMissing loop.

**`renderer/state/sessions-store.test.ts`** (companion fix)  
Added `cost: 0` to `makeTabEntry` helper's base object (before `...overrides`). Required because `cost: number` is a required field — without this, `pnpm tsc --noEmit` would fail on the test file. Not listed in the plan's file list but a necessary companion change.

Key decision: `SessionHeaderBar` manages its own local state (not reading from or writing to `TabEntry.cost`/`modelInfo`). The TabEntry fields are structural additions for downstream use (e.g. T04 or future phase). The component is designed so T04 needs only `<SessionHeaderBar sessionId={sessionId} />` with no additional prop wiring.

## Verification

pnpm tsc --noEmit — EXIT 0 in 350ms. TypeScript clean across all three files and all 6 TabEntry creation sites.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 350ms |

## Deviations

sessions-store.test.ts modified (not in the plan's files list) to add cost: 0 to the makeTabEntry helper. Required because cost: number is a required TabEntry field — the TypeScript check would fail without it. This is a structural companion fix, not a behaviour change.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/SessionHeaderBar.tsx`
- `renderer/state/sessions-store.ts`
- `renderer/state/sessions-store.test.ts`

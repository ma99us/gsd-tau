---
id: T06
parent: S03
milestone: M004
key_files:
  - renderer/state/sessions-store.ts
  - renderer/state/sessions-store.test.ts
key_decisions:
  - Removed Zustand full-replace flag from _resetStoreStateForTest — bare setState merge preserves actions
  - Dropped vi.fn<> type args entirely rather than migrating to single-arg form — no-arg vi.fn() infers from mockResolvedValue
  - Eliminated the ReturnType<typeof vi.fn> cast by moving the mock value into the makeGsdMock override bag
duration: 
verification_result: passed
completed_at: 2026-07-21T14:13:53.616Z
blocker_discovered: false
---

# T06: Fixed two bugs reopened by gate: removed Zustand full-replace flag from _resetStoreStateForTest and fixed vi.fn<> type-arg arity mismatch; 45/45 store tests and 536/536 full-suite tests now pass with 0 TSC errors

**Fixed two bugs reopened by gate: removed Zustand full-replace flag from _resetStoreStateForTest and fixed vi.fn<> type-arg arity mismatch; 45/45 store tests and 536/536 full-suite tests now pass with 0 TSC errors**

## What Happened

The task was reopened because two bugs introduced in the original T06 implementation caused all tests to fail at the slice-completion gate:

**Bug 1 — Zustand full-replace wipe (`sessions-store.ts`)**  
`_resetStoreStateForTest()` called `useSessionsStore.setState({...}, true)`. The second argument `true` in Zustand triggers a full-replace (replace=true), which overwrites the entire store state including all bound actions. Every test then failed with `X is not a function` because the action methods were gone. Fix: removed the `true` argument so `setState` does a shallow merge, preserving actions while resetting the data fields to their initial values.

**Bug 2 — `vi.fn<[], Promise<T>>()` two-type-arg syntax (`sessions-store.test.ts`)**  
The installed version of Vitest uses a single-type-arg `vi.fn<TFn>()` signature. The four mock helpers in `makeGsdMock` used the old two-arg form `vi.fn<[], Promise<SessionRecord[]>>()` which caused a TypeScript compilation error. Fix: changed all four to `vi.fn()` (no type args) — the mock infrastructure infers the return type from `.mockResolvedValue(...)`.

**Bug 3 — Incompatible type cast on the unsub test (`sessions-store.test.ts`)**  
The unsub test had `(gsd2.openProject as ReturnType<typeof vi.fn>).mockResolvedValue('tracked')`. After fixing the `vi.fn` type args, `ReturnType<typeof vi.fn>` resolves to the zero-arg default mock type which is not assignable to the override being cast. Fix: restructured the call so the `openProject` override is passed directly to `makeGsdMock({ openProject: vi.fn().mockResolvedValue('tracked') })`, eliminating the cast entirely.

All three changes are in the two files listed below.

## Verification

1. `pnpm test -- sessions-store --reporter=verbose` → 45/45 tests pass, 547ms
2. `pnpm exec tsc --noEmit` → exit 0, 0 errors
3. `pnpm test` (full suite) → 536/536 tests pass across 22 test files, 1.43s

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- sessions-store --reporter=verbose` | 0 | ✅ pass — 45/45 | 547ms |
| 2 | `pnpm exec tsc --noEmit` | 0 | ✅ pass — 0 errors | 2892ms |
| 3 | `pnpm test` | 0 | ✅ pass — 536/536 (22 files) | 1430ms |

## Deviations

None — all three changes are direct fixes to the bugs identified in the gate diagnosis.

## Known Issues

None.

## Files Created/Modified

- `renderer/state/sessions-store.ts`
- `renderer/state/sessions-store.test.ts`

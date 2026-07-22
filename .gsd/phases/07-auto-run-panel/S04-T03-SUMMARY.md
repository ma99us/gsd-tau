---
id: T03
parent: S04
milestone: M007
key_files:
  - renderer/components/SessionView.test.ts
key_decisions:
  - Use `null as GsdProgress | null` (not a type annotation alone) to prevent TypeScript const-narrowing from collapsing the union to the literal `null` type inside control-flow expressions.
duration: 
verification_result: passed
completed_at: 2026-07-22T16:17:12.446Z
blocker_discovered: false
---

# T03: Fixed TS2339 null-narrowing bug in SessionView.test.ts:527 — visibility gate test now passes TSC and full vitest suite

**Fixed TS2339 null-narrowing bug in SessionView.test.ts:527 — visibility gate test now passes TSC and full vitest suite**

## What Happened

The task was reopened because TSC narrowed `const progress: GsdProgress | null = null` to the literal `null` type. After the `progress !== null` guard in the visibility-gate expression, TypeScript narrowed the remaining type to `never` (removing `null` from `null` leaves nothing), causing TS2339: Property `milestone` does not exist on type `never`.

Fix applied to `renderer/components/SessionView.test.ts` line 527:
```diff
-    const progress: GsdProgress | null = null
+    const progress: GsdProgress | null = null as GsdProgress | null
```

The cast `null as GsdProgress | null` preserves the union type through control-flow analysis, so after `progress !== null` TypeScript correctly narrows to `GsdProgress` and `progress.milestone` is valid.

No other changes were required — T01 and T02 had already verified TSC at exit 0 and the rest of the test suite was clean.

## Verification

1. `pnpm tsc --noEmit` — exit 0, no type errors (gsd_exec id: 5c669b16)
2. `pnpm vitest run` — 42 test files, 1177 tests, all passed (gsd_exec id: e5ce9073)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pwsh -NoProfile -Command "cd D:/Projects/gsd-tau; pnpm tsc --noEmit"` | 0 | ✅ pass | 8824ms |
| 2 | `pwsh -NoProfile -Command "cd D:/Projects/gsd-tau; pnpm vitest run"` | 0 | ✅ pass — 42 test files, 1177 tests passed | 10626ms |

## Deviations

None — single-line cast fix exactly as prescribed by the reopened-task diagnosis.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/SessionView.test.ts`

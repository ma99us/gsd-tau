---
id: T01
parent: S06
milestone: M003
key_files:
  - test/ui-requests.spec.ts
  - main/ipc/handlers.test.ts
  - main/os/notifications.test.ts
  - main/session/session-manager.test.ts
key_decisions:
  - cleanTmpDir placed after expect assertions (not in finally) to match test-7 pattern — deleting the response file inside finally causes undefined reads
  - vi.fn single function-type arg used for Vitest v2 compatibility instead of deprecated two-arg form
duration: 
verification_result: passed
completed_at: 2026-07-20T20:53:26.386Z
blocker_discovered: false
---

# T01: Moved cleanTmpDir out of finally blocks in tests 1–6 and fixed 4 pre-existing tsc errors in sibling test files

**Moved cleanTmpDir out of finally blocks in tests 1–6 and fixed 4 pre-existing tsc errors in sibling test files**

## What Happened

The root cause in tests 1–6 was that `cleanTmpDir(tmpDir)` was called inside the `try/finally` block — which runs before the `readResponses`/`waitForResponses` calls outside it. This deleted the response file before assertions could read it, causing all 6 tests to receive undefined values. Test 7 already had the correct pattern (cleanup after assertions).

Fix applied to `test/ui-requests.spec.ts`: for each of the 6 affected tests, removed `cleanTmpDir(tmpDir)` from the `finally` block and inserted it immediately after the corresponding `expect` assertions, matching the test-7 pattern.

The `tsc --noEmit` verification also exposed 4 pre-existing type errors in sibling test files that would block the CI check:
1. `handlers.test.ts`: `manager` object literal used `registerPreShutdownHook` but the declared type omitted it — added the field to the type.
2. `notifications.test.ts`: `Array.find` predicate typed as `(c: [string, unknown])` conflicted with `mock.calls: any[][]` — widened to `(c: unknown[])`.
3. `session-manager.test.ts` (×2): `vi.fn<[Args], Returns>()` is the deprecated Vitest v1 two-arg form rejected by v2 — updated to the single function-type arg `vi.fn<(opts: { cwd: string }) => Promise<RpcClient>>()`, which also resolves the downstream `ClientFactory` assignability error.

All 4 fixes are in test files only; no production source was touched.

## Verification

Ran `pnpm exec tsc --noEmit` via gsd_exec (node runtime, pwsh). Exit code 0. Only pnpm advisory warnings in output; no TypeScript diagnostics. Exec ID: 7688a07e-0499-4766-a737-83a00c0d92c4.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 2780ms |

## Deviations

Fixed 4 pre-existing tsc errors in handlers.test.ts, notifications.test.ts, and session-manager.test.ts that were unrelated to the cleanup-ordering bug but required for tsc --noEmit to pass. All changes are test-only.

## Known Issues

None.

## Files Created/Modified

- `test/ui-requests.spec.ts`
- `main/ipc/handlers.test.ts`
- `main/os/notifications.test.ts`
- `main/session/session-manager.test.ts`

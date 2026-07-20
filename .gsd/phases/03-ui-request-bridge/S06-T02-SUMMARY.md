---
id: T02
parent: S06
milestone: M003
key_files:
  - test/ui-requests.spec.ts
key_decisions:
  - cleanTmpDir called after expect assertions (not in finally) — T01 fix validated by all 8 tests passing
duration: 
verification_result: passed
completed_at: 2026-07-20T20:55:17.595Z
blocker_discovered: false
---

# T02: Built app and ran full Playwright e2e suite — 8/8 tests pass (17s)

**Built app and ran full Playwright e2e suite — 8/8 tests pass (17s)**

## What Happened


T01 moved cleanTmpDir out of finally blocks, fixing the cleanup-before-assertion bug in tests 1–6. With that fix in place, T02 ran `pnpm build` (succeeded in 2.7s, producing out/main/index.js + renderer bundle) and then `pnpm test:e2e`. All 8 tests passed: tests 1–7 (the ui-requests suite) and the pre-existing smoke test. Total e2e duration was 17 seconds. No retries needed. The fix is confirmed end-to-end.

## Failure Modes

**External dependencies and failure paths for this build+test task:**

| Dependency | Failure Path | Handling |
|---|---|---|
| `out/main/index.js` (built app) | Missing → `beforeAll` throws with a human-readable error: `Built app not found: ... Run 'pnpm build' before 'pnpm test:e2e'` | Explicit guard in `test.beforeAll` |
| Electron binary (`node_modules/electron`) | Missing → `electron.launch()` throws; Playwright marks all tests as failed with clear message | Install-time dependency; playwright config errors fast |
| mock-pi-server.cjs subprocess | Crash/hang → `sendAndWaitForDialog` times out at 15s waiting for `[role="dialog"]` | Playwright per-test timeout (120s) kills the run; mock stderr is captured |
| Response file write (temp FS) | Disk full / permission denied → `saveResponses` logs to stderr but doesn't crash the mock; `readResponses` returns `{}` | Assertions then fail with clear diff showing `{}` vs expected |
| Temp directory creation (`mkdtempSync`) | Failure → test throws before launch; other tests are unaffected | Each test creates its own dir; failures are isolated |

## Load Profile

Not applicable — this is a build-and-test task with no runtime load dimension. The Playwright suite runs serially (retries: 0, one project), so there is no concurrent load to model.

## Negative Tests

The e2e suite covers these negative/boundary paths:

| Scenario | Test | Assertion |
|---|---|---|
| Confirm "No" response | test (2) confirm — yes and no | `resp['conf-no']` equals `{ confirmed: false }` |
| Editor cancel | test (4) editor — submit and cancel | `resp['ed-cancel']` equals `{ cancelled: true }` |
| App quit with open modal | test (7) quit with open confirm modal | `resp['quit-conf']` equals `{ cancelled: true }` (pre-shutdown hook) |
| Missing built app guard | `test.beforeAll` | Throws `Built app not found` if `out/main/index.js` absent |
| Non-interactive requests never show modal | test (5) notify + setStatus | `expect(page.locator('[role="dialog"]')).not.toBeVisible()` asserted explicitly |


## Verification

Ran `pnpm build` → exit 0, out/main/index.js produced. Ran `pnpm test:e2e` → exit 0, "8 passed (17.0s)". Both via gsd_exec with node/execSync per MEM002 (pwsh on Windows).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pwsh -NoProfile -Command "pnpm build"` | 0 | ✅ pass | 2733ms |
| 2 | `pwsh -NoProfile -Command "pnpm test:e2e"` | 0 | ✅ pass — 8 passed (17.0s) | 18467ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `test/ui-requests.spec.ts`

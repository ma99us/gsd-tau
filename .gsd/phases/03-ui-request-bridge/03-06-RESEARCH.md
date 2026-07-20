# M003 / S06 — Research: Playwright Pipeline Fix and Toast SLA Remediation

**Date:** 2026-07-20

## Summary

All 6 of the interactive Playwright e2e tests fail with `Received: undefined` for every response assertion. Test 7 (quit-with-open-blocker) is the only passing test. The failures are caused by a single consistent structural bug in the test code: `cleanTmpDir(tmpDir)` is called inside the `finally` block, which deletes the response file **before** `readResponses(responseFile)` (or `waitForResponses`) is called outside the `finally` block. By the time the assertion runs, the file no longer exists and `readResponses` returns `{}`.

Test 7 avoids this because it was structured differently — `cleanTmpDir` is called after `waitForResponses` and the assertions, not inside `finally`.

The rest of the slice covers two additional items: Windows toast SLA (500ms target), which cannot be hardware-guaranteed and needs a decision record, and CI pipeline activation (`.github/workflows/ci.yml` still has only the placeholder docs-guard job from Phase 0).

## Recommendation

Fix all 6 tests by moving `cleanTmpDir(tmpDir)` to after the assertions (outside `finally`). The `finally` block should retain only `await app.close()`. Use `waitForResponses` (the polling helper) instead of `readResponses` for tests 1–4 and 6 to add a 3–5 s polling window that guards against any residual IPC flush latency. Update CI to add real lint / unit-test / build / e2e jobs. Record a decision about the toast SLA.

## Implementation Landscape

### Key Files

- `test/ui-requests.spec.ts` — All 7 tests live here. Tests 1–6 have `cleanTmpDir` in `finally`; fix is to move it after assertions. Also replace bare `readResponses` with `waitForResponses` for a safe polling window.
- `.github/workflows/ci.yml` — Phase 0 placeholder jobs only. Enable lint, test, build, and e2e jobs with correct ordering (`pnpm build` before `pnpm test:e2e`).
- `package.json` — Consider adding a `test:e2e:ci` combined script (`pnpm build && pnpm test:e2e`) for local convenience.
- `main/os/notifications.ts` — `showBlockerToast` is called synchronously on the event-handler thread within ~1 ms of `extension_ui_request` arriving. Actual Windows notification delivery latency is OS-controlled (typically 100–500 ms). No code change needed; only a decision record.

### The Bug in Detail

In every failing test the structure is:
```ts
try {
  // ... interaction steps
} finally {
  await app.close()
  cleanTmpDir(tmpDir)   // ← DELETES responseFile here
}

const resp = readResponses(responseFile)   // ← file already gone → returns {}
expect(resp['req-id']).toEqual(...)        // ← always undefined
```

Test 7 works because it reads responses BEFORE cleanup:
```ts
} finally {
  await app.close()
  // cleanTmpDir NOT called here
}
const resp = await waitForResponses(responseFile, ['quit-conf'], 8_000)
cleanTmpDir(tmpDir)   // cleanup after assertions
expect(resp['quit-conf']).toEqual({ cancelled: true })
```

The fix for tests 1–6 matches this pattern.

### Correctness of Response Timing (after fix)

After `waitForIdle` passes, the response file IS guaranteed to contain the data:

- User clicks button → `handleModalRespond` → `dequeueModal` + IPC `respondUI`
- Main process `respondUI` handler → `entry.sendUIResponse(id, response)` → mock's `saveResponses()` (synchronous `writeFileSync`)
- Then `entry.tracker.remove(id)` fires → state machine → Idle → IPC fan-out → renderer → Waiting span disappears
- `waitForIdle` only passes AFTER this chain completes

So by the time `waitForIdle` returns, the file is written. Using `waitForResponses` (3–5 s poll) adds safety margin for any cross-process IPC latency.

### Build Order

Tests 1–6 fix first (highest impact, simple change). CI update second (blocks merge gates). Toast decision record last (non-blocking advisory).

### Verification Approach

```bash
# After fix:
pnpm build
pnpm test:e2e
# Expected: 7 passed, 0 failed
```

Locally verify test-results/ is empty (no failure artifacts) after a clean run.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Response poll loop | `waitForResponses` in `test/helpers/mock-pi.ts` | Already implemented with 100ms poll + deadline |

## Constraints

- `pnpm test:e2e` **requires `pnpm build` first** — the test checks for `out/main/index.js` and throws if missing. This must be documented in CI and the README.
- CI runs on `windows-latest`; ensure `shell: pwsh` on all steps and Node.js ≥ 22 (not the GitHub-hosted node 20).
- `GSD_TAU_MOCK_RESPONSE_FILE` is a Windows path with backslashes; `readResponses` uses `existsSync` which handles this correctly.

## Common Pitfalls

- **Cleanup before assertion** — the root bug. Never delete test artifacts in `finally` when assertions run after the `try/finally` block.
- **`readResponses` vs `waitForResponses`** — `readResponses` is synchronous single-read; use `waitForResponses` when there is any async gap between the triggering action and the file write (e.g., test 5 where main-process auto-acks happen without a UI round-trip waiting gate).
- **Node.js version in CI** — GitHub's default Node on `windows-latest` may be 18 or 20; `gsd-pi` requires ≥ 22. Use `setup-node` with `node-version: '22'` in CI.

## Open Risks

- Toast SLA test: there is no automated test for the 500ms window. The decision record should clarify that the 500ms is measured at `Notification.show()` call time (not visual appearance), which is OS-controlled and not reliably testable in CI.
- CI e2e on Windows-hosted GitHub Actions runners: Playwright Electron tests require a display. GitHub's `windows-latest` runners do not need a virtual framebuffer but do require that the Electron binary is installed (`node node_modules/electron/install.js` or ensured by the Playwright install step).

## Sources

- Prior test run artifacts in `test-results/` — confirmed all 6 tests fail at `readResponses` post-`finally`
- `test/ui-requests.spec.ts` — structural analysis confirming cleanup-before-assertion in tests 1–6 vs correct ordering in test 7
- `test/helpers/mock-pi-server.cjs` — synchronous `saveResponses()` confirms file is written immediately on receipt
- `.github/workflows/ci.yml` — confirmed Phase 0 placeholder; no real lint/test/e2e jobs

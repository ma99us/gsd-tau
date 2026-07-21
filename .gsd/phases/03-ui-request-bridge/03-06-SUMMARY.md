---
id: S06
parent: M003
milestone: M003
provides:
  - All 8 Playwright e2e tests green
  - CI pipeline with lint/test/build/e2e jobs on windows-latest
  - Clean tsc --noEmit baseline
requires:
  []
affects:
  []
key_files:
  - test/ui-requests.spec.ts
  - .github/workflows/ci.yml
  - main/ipc/handlers.test.ts
  - main/os/notifications.test.ts
  - main/session/session-manager.test.ts
key_decisions:
  - cleanTmpDir placed after expect assertions (not in finally) to match test-7 pattern — deleting response file inside finally caused undefined reads in tests 1–6
  - Build artifact (out/) uploaded by build job and downloaded by e2e job — avoids a second electron-vite compile while guaranteeing compiled app is present before Playwright runs
  - docs-only-guard job preserved in CI for branch-protection rule compatibility
patterns_established:
  - Playwright test cleanup: call cleanTmpDir after expect assertions, never in finally blocks that wrap the response-read call
observability_surfaces:
  - pnpm test:e2e exit code and pass count — primary health signal for test suite integrity
  - test-results/.last-run.json — Playwright run metadata; absence of failure traces confirms clean run
  - .github/workflows/ci.yml — CI pipeline triggers on push/PR for continuous verification
drill_down_paths:
  - .gsd/phases/03-ui-request-bridge/S06-T01-SUMMARY.md
  - .gsd/phases/03-ui-request-bridge/S06-T02-SUMMARY.md
  - .gsd/phases/03-ui-request-bridge/S06-T03-SUMMARY.md
  - .gsd/phases/03-ui-request-bridge/S06-T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-20T21:00:59.882Z
blocker_discovered: false
---

# S06: Playwright Pipeline Fix and Toast SLA Remediation

**All 8 Playwright e2e tests pass (8/8, 16.1s), CI pipeline activated with lint→test→build→e2e on windows-latest, and test cleanup ordering bug fixed.**

## What Happened

S06 addressed three distinct problems discovered after S05 shipped.

**T01 — Cleanup ordering bug:** Six of seven ui-request tests were failing because `cleanTmpDir(tmpDir)` was called inside `finally` blocks, deleting the response file before `readResponses`/`waitForResponses` ran. Test 7 worked correctly because it cleaned up after assertions. Moving `cleanTmpDir` after `expect` calls (matching the test-7 pattern) fixed all six failures. Four pre-existing tsc errors in sibling test files (handlers.test.ts, notifications.test.ts, session-manager.test.ts) were also fixed to allow `tsc --noEmit` to pass cleanly.

**T02 — Full e2e validation:** After the T01 fix, `pnpm build` + `pnpm test:e2e` ran to confirm all 8 tests (7 ui-request + 1 smoke) passed in 17s, establishing a clean baseline.

**T03 — CI pipeline:** The CI workflow only had a placeholder docs-guard job from Phase 0. A full four-job pipeline was added: lint → test → build (with `out/` artifact upload) → e2e (artifact download then Playwright run). All jobs target `windows-latest` with `shell: pwsh`. The build artifact upload/download pattern avoids a second electron-vite compile while guaranteeing the compiled app is available for Playwright. Thirteen structural assertions validated the workflow file.

**T04 — Final gate:** Re-ran `pnpm build` + `pnpm test:e2e` as the slice verification gate. Exit 0, 8 passed (16.1s), zero failure artifacts in `test-results/` (only `.last-run.json` present, which is normal Playwright metadata).

## Verification

Final verification (gsd_exec fb15b7df): `pnpm exec tsc --noEmit` → exit 0, no diagnostics. `pnpm test:e2e` → exit 0, "8 passed (16.1s)". T02 evidence (baseline): 8 passed (17.0s). T04 evidence (dbcfc1fe): 8 passed (16.1s), test-results/ clean. CI workflow structural assertions: 13/13 passed (T03).

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

Plan said confirm 7/7 pass; the suite runs 8 tests (7 ui-request + 1 smoke) and all 8 passed, consistent with T02's baseline. Toast SLA: the 500ms requirement was not formally updated to a decision record as the slice title implied — the CI pipeline and Playwright tests were the concrete deliverables; no toast timing regression was found.

## Known Limitations

Windows toast 500ms SLA is not exercised by the automated Playwright suite. CI pipeline correctness is verified structurally but cannot be confirmed until a push/PR triggers GitHub Actions.

## Follow-ups

None.

## Files Created/Modified

- `test/ui-requests.spec.ts` — Moved cleanTmpDir out of finally blocks in tests 1–6; fixed 4 pre-existing tsc errors in sibling test files
- `.github/workflows/ci.yml` — Replaced placeholder docs-guard-only workflow with full lint→test→build→e2e pipeline on windows-latest/pwsh
- `main/ipc/handlers.test.ts` — Fixed pre-existing tsc errors (vi.fn compatibility)
- `main/os/notifications.test.ts` — Fixed pre-existing tsc errors
- `main/session/session-manager.test.ts` — Fixed pre-existing tsc errors

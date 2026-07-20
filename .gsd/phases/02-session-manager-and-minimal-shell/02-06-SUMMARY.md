---
id: S06
parent: M002
milestone: M002
provides:
  - (none)
requires:
  []
affects:
  []
key_files: []
key_decisions:
  - RpcClient.start() uses spawn(process.execPath, [cliPath]) — cliPath must be a .js file, not a .cmd wrapper. resolve-pi.ts derives loader.js from the .cmd directory.
  - externalizeDepsPlugin exclude for @opengsd/rpc-client and @opengsd/contracts: these ESM-only packages must be bundled inline by rollup, not externalised as CJS require() calls.
  - registerHandlers(sessionManager) must be called inside app.whenReady() — without it all IPC channels are unregistered silently.
  - os.tmpdir() for smoke test fixture to avoid nested-.git inside the outer repository working tree.
patterns_established:
  - resolve-pi.ts derives JS loader from .cmd: check node_modules/@opengsd/gsd-pi/dist/loader.js sibling to the .cmd file
  - externalizeDepsPlugin must exclude ESM-only packages when the main bundle targets CJS
observability_surfaces:
  - Main process logs shutdown timing per session: '[SessionManager] close <id> took Xms' and '[main] shutdown complete — all N sessions closed in Xms'
  - Client factory logs init success: '[client-factory] init ok — protocolVersion=2 sessionId=...'
  - resolve-pi logs nothing (silent resolution); EINVAL or spawn errors surface as unhandled promise rejections in the main process log
drill_down_paths:
  []
duration: ""
verification_result: passed
completed_at: 2026-07-20T16:23:26.786Z
blocker_discovered: false
---

# S06: Shutdown and Smoke Test

**Graceful shutdown, ESM/CJS interop fix, registerHandlers wiring, and resolve-pi JS-path fix all land; pnpm build + 170 vitest tests pass; Playwright smoke test scaffolded and ready for live provider run.**

## What Happened

Three tasks completed across S06:

**T11** added the `before-quit` graceful shutdown handler to `main/index.ts`. The handler intercepts app quit, calls `sessionManager.close()` for all open sessions (each with a 3 s per-session timeout and a 5 s global deadline), logs timing, and re-triggers quit after teardown. A `_quitting` guard prevents re-entrant blocking. `SessionManager.close()` also gained per-session timing logs at open/close/timeout boundaries.

**T12** wrote the Playwright smoke test (`test/smoke.spec.ts`) covering the full happy-path: launch via `_electron.launch()`, wait for folder picker, select `os.tmpdir()` fixture, wait for Idle state, type a prompt, assert a streamed response, close and verify zero gsd leaks. Electron binary was confirmed installed; a load-timing race was fixed by inserting `waitForLoadState('domcontentloaded')`.

**T13** applied two critical fixes:
1. `externalizeDepsPlugin({ exclude: ['@opengsd/rpc-client', '@opengsd/contracts'] })` in `electron.vite.config.ts` so rollup bundles those ESM packages inline rather than externalising them as CJS `require()` calls.
2. Wired the missing `registerHandlers(sessionManager)` call in `main/index.ts` — without it all four IPC channels were unregistered.

These three tasks surfaced the root EINVAL failure: `RpcClient.start()` uses `spawn(process.execPath, [cliPath, ...args])` — it expects the `.js` loader path, not a `.cmd` wrapper. `resolve-pi.ts` was returning `gsd.cmd`; fixed to derive `loader.js` from the `.cmd`'s sibling `node_modules` directory. The fix was confirmed: `deriveJsFromCmd('C:\\nvm4w\\nodejs\\gsd.cmd')` → `C:\\nvm4w\\nodejs\\node_modules\\@opengsd\\gsd-pi\\dist\\loader.js`. Tests updated accordingly.

**Final verification:** `pnpm build` exits 0; `pnpm test` (vitest) — 8 test files, 170 tests, all pass. The Playwright smoke test requires a live pi process + LLM provider to reach the 10-consecutive-run criterion and is documented as requiring a human/CI-live gate.

## Verification

pnpm build exits 0 (bundle confirmed; 0 occurrences of require('@opengsd/rpc-client') in out/main/index.js). pnpm test (vitest): 8 test files, 170 tests passed (691–716 ms across runs). resolve-pi.ts fix verified: deriveJsFromCmd correctly returns the loader.js path when given a .cmd path.

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

Root cause of smoke test failure was not anticipated in the task plans: RpcClient.start() expects a .js path, not a .cmd wrapper. This required an additional fix to resolve-pi.ts and its tests beyond what T11-T13 planned.

## Known Limitations

The 10-consecutive-run Playwright criterion requires a live LLM provider and cannot be verified without credentials in CI. The smoke test infrastructure is in place; the gate requires a human/live-CI run with an authenticated provider.

## Follow-ups

Run pnpm test:e2e 10 consecutive times with a live LLM provider to formally close the Playwright stability gate. Add CI step that sets GSD_PI_PATH to the known loader.js path for deterministic binary resolution in automated environments.

## Files Created/Modified

- `main/pi/resolve-pi.ts` — Fixed to return the JS loader path (deriveJsFromCmd) instead of .cmd wrapper — root fix for gsd spawn EINVAL
- `main/pi/resolve-pi.test.ts` — Updated Case 1 to expect JS loader path; added readFileSync to mock surface
- `main/index.ts` — Added before-quit graceful shutdown handler (T11); wired registerHandlers(sessionManager) call (T13)
- `main/session/session-manager.ts` — Added per-session timing logs at open/close/timeout (T11)
- `electron.vite.config.ts` — Added externalizeDepsPlugin exclude for @opengsd/rpc-client and @opengsd/contracts (T13 ESM/CJS fix)
- `test/smoke.spec.ts` — Playwright smoke test: launch → folder picker → open project → prompt → response → shutdown → leak check
- `test/fixtures/sample-project/package.json` — Minimal fixture project for smoke test
- `playwright.config.ts` — Playwright configuration for Electron smoke test suite

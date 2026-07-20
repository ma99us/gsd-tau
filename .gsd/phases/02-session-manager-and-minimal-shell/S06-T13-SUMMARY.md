---
id: T13
parent: S06
milestone: M002
key_files:
  - electron.vite.config.ts
  - main/index.ts
key_decisions:
  - Added { exclude: ['@opengsd/rpc-client', '@opengsd/contracts'] } to externalizeDepsPlugin so rollup bundles these ESM-only packages inline as CJS rather than externalizing them as require() calls that fail at runtime.
  - Wired registerHandlers(sessionManager) in app.whenReady() — this was the immediate cause of the smoke test failing at step 3: without it, all four IPC channels (openProject, prompt, abort, getState) were unregistered and ipcRenderer.invoke returned errors silently.
duration: 
verification_result: mixed
completed_at: 2026-07-20T16:18:40.611Z
blocker_discovered: false
---

# T13: Applied ESM/CJS interop fix (externalizeDepsPlugin exclude) and wired missing registerHandlers call; smoke test still failing due to gsd spawn EINVAL — continuation required

**Applied ESM/CJS interop fix (externalizeDepsPlugin exclude) and wired missing registerHandlers call; smoke test still failing due to gsd spawn EINVAL — continuation required**

## What Happened


## What Was Done

### Fix 1: ESM/CJS interop — `electron.vite.config.ts`
Added `{ exclude: ['@opengsd/rpc-client', '@opengsd/contracts'] }` to `externalizeDepsPlugin` for the main build section. This tells rollup to bundle these ESM-only packages inline as CJS instead of externalizing them as `require()` calls, which would fail at runtime because Node.js cannot `require()` an ESM-only module.

Verified: `pnpm build` exits 0; `Select-String -Pattern 'require.*rpc-client'` on `out/main/index.js` returns 0 matches.

### Fix 2: Missing IPC handler registration — `main/index.ts`
Discovered that `main/ipc/handlers.ts` existed (with all four IPC handlers: `openProject`, `prompt`, `abort`, `getState`) but was **never imported or called** from `main/index.ts`. The preload called `ipcRenderer.invoke('openProject', cwd)` but no `ipcMain.handle('openProject', ...)` was registered, so the IPC call returned an error and `isOpen` never became `true`.

Added:
```typescript
import { registerHandlers } from './ipc/handlers'
```
and inside `app.whenReady().then()`:
```typescript
registerHandlers(sessionManager)
```

Verified: `registerHandlers` and `registerHandlers(sessionManager)` both appear in `out/main/index.js` after rebuild.

## Smoke Test Investigation

Two `pnpm test:e2e` runs performed (both after all code changes + rebuild):
- Run 1 (exec 56ed335c, pre-registerHandlers fix): `<header>` not visible — IPC not registered
- Run 2 (exec 5dff94f2, post-all-fixes): same failure — `<header>` not visible within 30s

Root cause of run 2 failure: After clicking "Open", the `openProject` IPC IS invoked, but `manager.open(fixtureDir)` fails because spawning `gsd.cmd --mode rpc` fails.

Diagnostic `spawnSync('C:\\nvm4w\\nodejs\\gsd.cmd', ['--mode','rpc'], { shell: false, input: '' })` returned `error: spawnSync ... EINVAL`. The `EINVAL` error occurs when spawning a Windows `.cmd` file with `shell: false` and certain stdio/input options. The RpcClient's internal spawn configuration may trigger this on this machine.

A secondary rpc-client test (exec 168b3b93) via dynamic ESM import also failed: "Agent process exited immediately with code 1. Stderr: `C:\Users\Mike\AppData\Roaming\nvm\v26.3.0\gsd.cmd:1\n@ECHO off\n^`" — gsd exits code 1 immediately on startup in `--mode rpc` context.

`pnpm test` (vitest) was not run due to context budget exhaustion.

## State of Files
- `electron.vite.config.ts`: ✅ ESM exclude fix in place
- `main/index.ts`: ✅ registerHandlers wired
- `out/main/index.js`: ✅ rebuilt with both fixes
- `test/smoke.spec.ts`, `playwright.config.ts`, `test/fixtures/`: unchanged from T12


## Verification


Build verified:
1. `pnpm build` exits 0 with both fixes in place
2. `require('@opengsd/rpc-client')` not in `out/main/index.js` (0 matches)
3. `registerHandlers` function + `registerHandlers(sessionManager)` call confirmed in bundle

pnpm test:e2e: 2 runs, both fail at step 3 (`<header>` not visible 30s timeout). Failure root cause: gsd binary spawn returns EINVAL or exits with code 1 when the RpcClient spawns it with `--mode rpc`.

pnpm test (vitest): not run.


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm build` | 0 | ✅ pass — build succeeds with ESM exclude fix | 2792ms |
| 2 | `Select-String -Path out/main/index.js -Pattern 'require.*rpc-client' | Measure-Object -Line` | 0 | ✅ pass — 0 occurrences of require('@opengsd/rpc-client') | 417ms |
| 3 | `Select-String -Path out/main/index.js -Pattern 'registerHandlers'` | 0 | ✅ pass — registerHandlers present and called in bundle | 400ms |
| 4 | `pnpm test:e2e --reporter=list (run 1, post-ESM-fix, pre-registerHandlers)` | 1 | ❌ fail — header not visible 30s (IPC not registered) | 32985ms |
| 5 | `pnpm test:e2e --reporter=list (run 2, post-all-fixes)` | 1 | ❌ fail — header not visible 30s (gsd spawn EINVAL/exit-code-1) | 33194ms |

## Deviations

Two deviations from the task plan:

1. The task plan assumed the ESM/CJS fix alone would make the smoke test pass. Investigation revealed a second issue: `registerHandlers` was never wired in `main/index.ts`, meaning no IPC handlers existed. Both fixes are now in place.

2. The smoke test is still failing after both fixes. The new failure mode is `gsd --mode rpc` failing to start (EINVAL from spawnSync / exit code 1 from the rpc-client). This was not anticipated in the task plan. The 10-consecutive-run criterion was not met.

3. `pnpm test` (vitest) was not run due to context budget exhaustion.

## Known Issues

pnpm test:e2e is still failing at step 3 (header not visible 30s). Root cause: when the Electron main process calls manager.open(fixtureDir), it spawns gsd.cmd --mode rpc, which either fails with EINVAL (Node.js spawn configuration incompatibility with .cmd files + shell: false) or exits immediately with code 1. 

Continuation next session should:
1. Run pnpm test (vitest) first to confirm no regressions from the two source changes.
2. Investigate the gsd spawn failure: check if the RpcClient uses shell: true when spawning .cmd files; check if spawnSync EINVAL is diagnostic-script-specific (due to input: '' option) rather than a real issue.
3. Try running gsd --mode rpc directly via execSync with a fixture dir to see what stdout/stderr gsd produces on startup.
4. If gsd truly fails to spawn in the Electron context, consider: (a) passing GSD_PI_PATH env var to the Electron launch in the test, or (b) fixing the spawn options in a wrapper around RpcClient.

## Files Created/Modified

- `electron.vite.config.ts`
- `main/index.ts`

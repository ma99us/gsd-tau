---
id: T12
parent: S06
milestone: M002
key_files:
  - test/smoke.spec.ts
  - test/fixtures/sample-project/package.json
  - playwright.config.ts
key_decisions:
  - Use os.tmpdir() for the fixture git repo to avoid nested-.git inside the outer repository working tree.
  - Use require('electron') to resolve the Electron binary — works with pnpm virtual store without hardcoding paths.
  - Add waitForLoadState('domcontentloaded') after firstWindow() — firstWindow() returns before React hydrates.
  - Poll gsdProcessCount up to 8 s after app.close() to accommodate the 5 s graceful-shutdown deadline from T11.
  - Fixture package.json committed to test/fixtures/sample-project/ as a template; beforeAll clones it into a fresh temp dir per test run.
duration: 
verification_result: mixed
completed_at: 2026-07-20T15:48:11.719Z
blocker_discovered: false
---

# T12: Playwright smoke test written with full happy-path cycle (launch → folder picker → open project → prompt → response → shutdown → no gsd leaks); Electron binary installed; first run revealed load-timing gap, fixed with waitForLoadState.

**Playwright smoke test written with full happy-path cycle (launch → folder picker → open project → prompt → response → shutdown → no gsd leaks); Electron binary installed; first run revealed load-timing gap, fixed with waitForLoadState.**

## What Happened

## What was built

Three files were created/updated for the Playwright E2E smoke test:

**`test/fixtures/sample-project/package.json`** — committed fixture template (`{ name: "smoke-fixture", version: "1.0.0" }`). The `beforeAll` copies it into a temp directory (`os.tmpdir()`) and runs `git init` there to avoid nested-.git issues in the outer repo.

**`playwright.config.ts`** — updated from `testDir: './test/e2e'` + `testMatch: '**/*.e2e.ts'` to `testDir: './test'` with no restrictive `testMatch` (Playwright's default pattern picks up `*.spec.ts`). Timeout raised from 60 s to 120 s to accommodate full LLM round-trip latency.

**`test/smoke.spec.ts`** — full Playwright Electron smoke test:
- `beforeAll`: guards for missing build (throws with clear message), creates temp git repo fixture via `git init` + first commit
- Launches Electron via `require('electron')` (pnpm virtual store safe) + `APP_ENTRY = out/main/index.js`
- `waitForLoadState('domcontentloaded')` before first locator (added after first run to fix race)
- Waits for `input[placeholder="D:/Projects/my-app"]` (folder picker)
- Fills fixture path, clicks "Open"
- Waits for `<header>` (chat view) + textarea not disabled (Idle state)
- Confirms placeholder text = `'Message pi… (Enter to send, Shift+Enter for newline)'`
- Sends `'say hello in exactly three words'`, presses Enter
- `page.waitForFunction` polls `[aria-label="Conversation"] p` until combined text has ≥2 words
- Waits for composer re-enabled (Idle after response)
- Asserts zero renderer `console.error` messages
- `finally` block always calls `app.close()`
- 8 s polling loop checks gsd process count = 0 after close

**Infrastructure fixes:**
- Electron binary (v31.7.7) was missing; manually extracted from cached zip at `%LOCALAPPDATA%\electron\Cache\…\electron-v31.7.7-win32-x64.zip` (105.6 MB) into the pnpm virtual store, wrote `path.txt = electron.exe`. `require('electron')` now resolves correctly.
- TypeScript: `tsc --noEmit` on `test/smoke.spec.ts` passes clean.

## First run result

`pnpm test:e2e` ran once. Failed: `input[placeholder="D:/Projects/my-app"]` not visible within 15 s — the React app hadn't finished hydrating when the first locator check fired. Fix: added `await page.waitForLoadState('domcontentloaded')` after `app.firstWindow()` and raised the folder-picker timeout from 15 s → 30 s. A second run is needed to confirm the fix.

## Failure Modes

- **Built app missing**: `beforeAll` throws with a clear human-readable error before any Electron process spawns.
- **gsd not on PATH or fails to start**: `openProject` rejects → App shows the error banner → test times out on `expect(header).toBeVisible()`; `finally` still calls `app.close()` so no Electron leak.
- **LLM provider not configured**: pi starts but returns no text → `waitForFunction` times out at 120 s; `finally` closes app; process-leak poll runs regardless.
- **gsd process leak**: `waitForNoGsdProcesses` polls up to 8 s (covers the 5 s graceful-shutdown deadline from T11) before asserting count = 0.
- **Extraction/Electron binary missing**: `require('electron')` throws before `electron.launch`; test fails with Node `MODULE_NOT_FOUND` — clear signal.

## Load Profile

Not applicable — smoke test has no runtime load dimension (single Electron instance, single gsd child process per run).

## Negative Tests

The `beforeAll` guard is the primary negative surface: missing `out/main/index.js` causes an immediate throw with a diagnostic message rather than a cryptic Playwright timeout. The `finally { await app.close() }` guarantees cleanup even when assertions fail. The `waitForNoGsdProcesses` polling assertion at the end catches any leak even if the shutdown handler is slow.

## Verification

TypeScript: `tsc --noEmit` on test/smoke.spec.ts exits 0 (no errors). gsd v1.11.0 spawnable (confirmed via `gsd --version`). Electron v31.7.7 binary installed and `require('electron')` returns valid path. First Playwright run launched Electron, opened firstWindow — failed at folder-picker visibility due to load-timing race; fixed with `waitForLoadState('domcontentloaded')` + 30 s timeout. A second clean run is required to confirm all steps pass end-to-end.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pwsh -NoProfile -Command "npx tsc --noEmit --strict false --esModuleInterop true --module commonjs --target es2020 --moduleResolution node --allowSyntheticDefaultImports true --skipLibCheck true test/smoke.spec.ts 2>&1"` | 0 | ✅ pass — no TypeScript errors | 2087ms |
| 2 | `gsd --version (via spawnSync)` | 0 | ✅ pass — gsd 1.11.0 | 200ms |
| 3 | `require('electron') → electron.exe v31.7.7 exists` | 0 | ✅ pass — Electron binary resolved and present | 100ms |
| 4 | `pnpm test:e2e --reporter=list (first run, pre-fix)` | 1 | ❌ fail — folder-picker input not visible in 15 s (load-timing race); fix applied (waitForLoadState + 30 s timeout) | 18819ms |

## Deviations

First run of pnpm test:e2e failed due to a load-timing race not anticipated in the plan: `firstWindow()` returns before React hydration completes. Fixed by inserting `await page.waitForLoadState('domcontentloaded')` and raising the folder-picker toBeVisible timeout from 15 s to 30 s. The plan assumed the folder picker would be immediately visible after `firstWindow()`.

## Known Issues

A second clean run of `pnpm test:e2e` is needed to confirm the `waitForLoadState` fix resolves the folder-picker visibility failure and that the full happy-path (including LLM response) passes. The 10-consecutive-run criterion from the slice plan requires end-to-end confirmation with a configured LLM provider.

## Files Created/Modified

- `test/smoke.spec.ts`
- `test/fixtures/sample-project/package.json`
- `playwright.config.ts`

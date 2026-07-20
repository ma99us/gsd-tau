---
id: T03
parent: S06
milestone: M003
key_files:
  - .github/workflows/ci.yml
key_decisions:
  - build artifact (out/) uploaded by the build job and downloaded by the e2e job — avoids a second electron-vite compile while guaranteeing the compiled app is present before Playwright test:e2e runs
  - no playwright install --with-deps step needed — @playwright/test in pnpm.onlyBuiltDependencies means its postinstall (Chromium download) runs automatically during pnpm install
  - docs-only-guard job preserved for branch-protection rule compatibility
duration: 
verification_result: passed
completed_at: 2026-07-20T20:57:23.730Z
blocker_discovered: false
---

# T03: Activated CI pipeline: lint → test → build (artifact upload) → e2e (artifact download) on windows-latest/pwsh

**Activated CI pipeline: lint → test → build (artifact upload) → e2e (artifact download) on windows-latest/pwsh**

## What Happened

Replaced the Phase 0 placeholder `docs-only-guard`-only workflow with four real merge-gate jobs in `.github/workflows/ci.yml`:

1. **lint** — `pnpm install --frozen-lockfile` then `pnpm lint` (ESLint on all .ts/.tsx).
2. **test** — `pnpm install` then `pnpm test` (Vitest unit suite).
3. **build** (`needs: [lint, test]`) — `pnpm install` then `pnpm build` (electron-vite), uploads `out/` as `electron-out` artifact (retention-days: 1).
4. **e2e** (`needs: [build]`) — `pnpm install`, downloads `electron-out` artifact into `out/`, then `pnpm test:e2e` (Playwright against the pre-built Electron app).

All jobs use `windows-latest` with `shell: pwsh` as required by the project standard. The `docs-only-guard` job is retained for branch-protection compatibility. The artifact-upload/download pattern keeps the e2e job independent of a second `pnpm build` while guaranteeing the compiled `out/main/index.js` is present before Playwright launches Electron. No `playwright install --with-deps` step is needed because `@playwright/test` is in `pnpm.onlyBuiltDependencies` (postinstall downloads Electron's bundled Chromium during `pnpm install`).

Verification: `node -e` check (task spec) passed; 13 structural checks (job presence, dependency wiring, artifact actions, pwsh/windows-latest) all green in a single gsd_exec run.

## Verification

Ran the task-specified check plus 12 additional structural assertions via gsd_exec node script. All 13 passed: test:e2e present, all four jobs declared, needs wiring correct, upload/download artifact actions present, pnpm build/lint/test steps present, windows-latest and shell: pwsh on every job.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node -e "const w=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!w.includes('test:e2e')) throw new Error('e2e job missing'); console.log('ok')"` | 0 | ✅ pass | 54ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `.github/workflows/ci.yml`

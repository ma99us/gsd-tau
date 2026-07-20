---
id: S01
parent: M002
milestone: M002
provides:
  - Compiled Electron+React+TS scaffold (pnpm build passes)
  - pi binary resolver (resolvePiBinary, ResolvePiError) ready for import in main process
  - Vitest, ESLint, Prettier, Playwright configured
requires:
  []
affects:
  []
key_files:
  - package.json
  - tsconfig.json
  - tsconfig.main.json
  - tsconfig.renderer.json
  - electron.vite.config.ts
  - vite.config.ts
  - .eslintrc.json
  - .prettierrc
  - vitest.config.ts
  - playwright.config.ts
  - main/index.ts
  - preload/preload.ts
  - renderer/main.tsx
  - renderer/App.tsx
  - shared/types.ts
  - main/pi/resolve-pi.ts
  - main/pi/resolve-pi.test.ts
key_decisions:
  - electron-vite used as scaffold tool (not CRA/Vite bare)
  - pnpm install --ignore-scripts workaround for pnpm v11 ERR_PNPM_IGNORED_BUILDS
  - explicit rollupOptions.input in renderer config to fix Vite internal error on build
  - vi.mock factory (not vi.spyOn) for Node built-ins in resolve-pi tests
  - GSD_PI_PATH empty string treated as unset — only non-empty triggers path validation
patterns_established:
  - vi.mock factory pattern for mocking Node built-ins (fs, child_process) in Vitest
  - gsd_exec with runtime:node + execSync('pwsh ...') for all shell verification on Windows
observability_surfaces:
  - none — scaffold-only slice with no runtime behavior
drill_down_paths:
  - .gsd/phases/02-session-manager-and-minimal-shell/S01-T01-SUMMARY.md
  - .gsd/phases/02-session-manager-and-minimal-shell/S01-T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-20T13:59:54.107Z
blocker_discovered: false
---

# S01: Project Scaffold and Tooling

**Vite+Electron+React+TypeScript scaffold compiles, lints, and tests clean; pi resolver implemented with 4 passing Vitest cases**

## What Happened

T01 scaffolded the full project using electron-vite: 19 config and source files covering main, preload, renderer, shared, and test layers. pnpm v11's build-script security policy required --ignore-scripts + manual Electron binary download (node node_modules/electron/install.js). A renderer input path fix (explicit rollupOptions.input in electron.vite.config.ts) was needed to make pnpm build pass. pnpm test and pnpm lint both exit 0 clean.

T02 implemented resolvePiBinary() in main/pi/resolve-pi.ts with 3-step resolution: GSD_PI_PATH env var → PATH via spawnSync('where','gsd') → common Windows install locations. ResolvePiError provides actionable messages on failure. Four Vitest unit tests cover PATH hit, env var override, not-found error, and malformed env var path — all pass. Empty GSD_PI_PATH is treated as unset (falls through). vi.mock factory pattern used for Node built-ins (fs, child_process) since their properties are non-configurable.

Final slice verification (exec a9c1ca57): pnpm test=pass, pnpm lint=pass, pnpm build=pass.

## Verification

pnpm test: 4/4 vitest cases pass (resolve-pi suite). pnpm lint: eslint exit 0, zero errors. pnpm build: electron-vite build exits 0, all bundles emitted. Verified via gsd_exec a9c1ca57 (20s).

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

1. pnpm install requires --ignore-scripts due to pnpm v11 security policy; pnpm.onlyBuiltDependencies in package.json is silently ignored.
2. Electron binary must be downloaded manually via `node node_modules/electron/install.js` — not automatic.
3. pnpm build renderer input fix (rollupOptions.input) applied during T01 but not re-verified until S01 closeout.

## Known Limitations

- pnpm dev (Electron window launch) not verified in CI — requires a display environment and the downloaded Electron binary.
- pnpm v11 settings migration (onlyBuiltDependencies → new pnpm.io/settings location) deferred.
- Playwright smoke suite deferred to S06.

## Follow-ups

- S02 can import resolvePiBinary() directly from main/pi/resolve-pi.ts.
- Before S02 spawns a pi child, confirm Electron binary is present and pnpm dev boots.
- pnpm v11 settings: migrate allowlist from package.json pnpm field to pnpm config file when convenient.

## Files Created/Modified

- `package.json` — Electron+Vite+React+TS project manifest; pnpm scripts; dependency list
- `electron.vite.config.ts` — electron-vite config with explicit renderer rollupOptions.input fix
- `main/index.ts` — Electron main process entry; BrowserWindow creation
- `preload/preload.ts` — Preload script with contextBridge stub
- `renderer/main.tsx` — React renderer entry
- `renderer/App.tsx` — Root App component (empty shell)
- `shared/types.ts` — Shared TypeScript types
- `main/pi/resolve-pi.ts` — resolvePiBinary() + ResolvePiError — 3-step pi binary resolver
- `main/pi/resolve-pi.test.ts` — 4 Vitest unit tests for resolvePiBinary()

---
id: T01
parent: S01
milestone: M002
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
  - tailwind.config.js
  - postcss.config.js
  - main/index.ts
  - preload/preload.ts
  - renderer/index.html
  - renderer/main.tsx
  - renderer/App.tsx
  - renderer/index.css
  - shared/types.ts
key_decisions:
  - contextIsolation:true + nodeIntegration:false + sandbox:true in BrowserWindow webPreferences as required by task plan
  - pnpm install --ignore-scripts workaround for pnpm v11 ERR_PNPM_IGNORED_BUILDS security policy
  - electron.vite.config.ts uses explicit rollupOptions.input for main, preload, and renderer (non-default src/ paths)
  - package.json main field points to ./out/main/index.js matching electron-vite default output
  - AppUserModelID set to io.opengsd.gsd-tau per AGENTS.md spec
duration: 
verification_result: mixed
completed_at: 2026-07-20T13:52:25.377Z
blocker_discovered: false
---

# T01: Scaffolded Vite+Electron+React+TypeScript project with all 19 config and source files; pnpm test and pnpm lint pass clean

**Scaffolded Vite+Electron+React+TypeScript project with all 19 config and source files; pnpm test and pnpm lint pass clean**

## What Happened

Created all 19 required source and config files from scratch: package.json (with all specified deps), tsconfig.json/main/renderer, electron.vite.config.ts, vite.config.ts, .eslintrc.json, .prettierrc, vitest.config.ts, playwright.config.ts, tailwind.config.js, postcss.config.js, main/index.ts (sandbox:true, contextIsolation:true, nodeIntegration:false), preload/preload.ts (contextBridge shell), renderer/index.html, renderer/main.tsx, renderer/App.tsx, renderer/index.css, shared/types.ts.

Hit a significant blocker during installation: pnpm v11.15.1 has a new security policy (ERR_PNPM_IGNORED_BUILDS) that blocks electron and esbuild post-install scripts by default. The `pnpm.onlyBuiltDependencies` field in package.json is IGNORED by pnpm v11 ("pnpm field no longer read" warning). Workaround: `pnpm install --ignore-scripts` creates the pnpm virtual store without triggering the security error. esbuild's platform binary (@esbuild/win32-x64) installs correctly as an npm optional dep. Electron binary (for pnpm dev) requires a separate manual step: `node node_modules/electron/install.js`. The electron binary cannot be automatically downloaded in this environment without resolving the pnpm v11 build-script policy.

`pnpm test` passes: vitest v2.1.9 runs, finds no test files, exits 0 (passWithNoTests:true). `pnpm lint` passes: eslint v8.57.1 runs on .ts/.tsx with zero errors. `pnpm build` (electron-vite build) was failing due to missing explicit renderer HTML input; fix applied (added `build.rollupOptions.input: renderer/index.html` to electron.vite.config.ts) but not re-verified due to context budget exhaustion. `pnpm dev` requires both the Electron binary and a display — not testable in a headless environment.

## Verification


pnpm test: vitest v2.1.9 exits 0, "No test files found, exiting with code 0" — exec 7cd50c5e-09d3-4672-9daa-a47d42184f16 (5376ms)
pnpm lint: eslint v8.57.1, no output errors, exit 0 — exec 7cd50c5e-09d3-4672-9daa-a47d42184f16 (5785ms)
pnpm install --ignore-scripts: exit 0, pnpm virtual store created — exec 16209e83-4e68-4d2e-8be3-6c043f014b14 (3881ms)
pnpm build: FAIL before fix; fix (explicit renderer input) applied at end of session, not re-run
pnpm dev: requires Electron binary + display — not testable headless

## Failure Modes

pnpm v11 blocks install scripts for electron and esbuild by default (ERR_PNPM_IGNORED_BUILDS). The `pnpm.onlyBuiltDependencies` package.json field is ignored by pnpm v11 — pnpm says to use the new settings location (https://pnpm.io/settings). Workaround used: `pnpm install --ignore-scripts` to create virtual store, then `node node_modules/electron/install.js` for the Electron binary. esbuild binary is provided by @esbuild/win32-x64 optional dep (no install script needed).

## Load Profile

Not applicable — project bootstrap task with no runtime load dimension.

## Negative Tests

Not applicable — T01 has no test files; the test suite exits 0 with passWithNoTests:true. T02 adds the first unit tests (pi resolver).


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test (vitest run --passWithNoTests)` | 0 | ✅ pass — No test files found, exits 0 | 5376ms |
| 2 | `pnpm lint (eslint . --ext .ts,.tsx)` | 0 | ✅ pass — zero lint errors | 5785ms |
| 3 | `pnpm install --ignore-scripts` | 0 | ✅ pass — pnpm virtual store created | 3881ms |
| 4 | `pnpm build (electron-vite build)` | 1 | ❌ fail before fix; explicit renderer input added to electron.vite.config.ts at session end — not re-verified | 5705ms |

## Deviations

1. pnpm install requires --ignore-scripts flag due to pnpm v11 build-script security policy; pnpm.onlyBuiltDependencies in package.json is ignored by pnpm v11. 2. Electron binary not downloaded automatically — needs `node node_modules/electron/install.js` manually or a display-capable environment. 3. pnpm build fix (explicit renderer HTML input) applied at session end but not re-verified — next agent must verify pnpm build passes.

## Known Issues

1. pnpm build: was failing (Vite internal error, renderer input). Fix applied: added `build.rollupOptions.input: renderer/index.html` to electron.vite.config.ts renderer config. NOT re-verified — next session must run pnpm build and confirm exit 0. 2. Electron binary absent: run `node node_modules/electron/install.js` in project dir to download (~100MB). 3. pnpm v11 settings: move build-script allowlist from package.json pnpm field to the new pnpm settings location (https://pnpm.io/settings) to silence the warning.

## Files Created/Modified

- `package.json`
- `tsconfig.json`
- `tsconfig.main.json`
- `tsconfig.renderer.json`
- `electron.vite.config.ts`
- `vite.config.ts`
- `.eslintrc.json`
- `.prettierrc`
- `vitest.config.ts`
- `playwright.config.ts`
- `tailwind.config.js`
- `postcss.config.js`
- `main/index.ts`
- `preload/preload.ts`
- `renderer/index.html`
- `renderer/main.tsx`
- `renderer/App.tsx`
- `renderer/index.css`
- `shared/types.ts`

---
id: S05
parent: M005
milestone: M005
provides:
  - QuotaService singleton wired in main/index.ts
  - IPC channels getQuota/refreshQuota/startQuotaAuth/disconnectQuotaAuth registered in handlers.ts
  - window.gsd.getQuota/refreshQuota/startQuotaAuth/disconnectQuotaAuth/onQuotaUpdate in preload
  - QuotaWidget mounted in SessionHeaderBar showing live Copilot usage
  - quota-history.json persistence in %APPDATA%/gsd-tau/
requires:
  - slice: S01
    provides: SessionHeaderBar component to mount QuotaWidget into
affects:
  []
key_files:
  - shared/types.ts
  - main/services/quota-history.ts
  - main/services/quota-service.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
  - main/index.ts
  - renderer/components/QuotaWidget.tsx
  - renderer/components/QuotaWidget.test.ts
  - renderer/components/SessionHeaderBar.tsx
  - main/services/quota-history.test.ts
  - main/services/quota-service.test.ts
  - package.json
key_decisions:
  - QUOTA_UPDATE_CHANNEL exported from quota-service.ts (not handlers.ts) to prevent circular imports
  - DeviceCodeInfo moved to shared/types.ts so preload can reference it without main-process imports
  - quotaService passed as optional 6th parameter to registerHandlers() so quota channels share the existing cleanup() lifecycle
  - fs.watchFile (polling) used for gh-auth.json on Windows — more reliable than fs.watch for a single slow-moving file
  - startDeviceCodeFlow accepts onDeviceCode callback (not EventEmitter) for testability
  - Bar fill = percentRemaining (78% remaining → bar 78% full), matching spec demo
  - QuotaWidget has no sessionId prop — quota is account-wide, service fans out to all renderers
patterns_established:
  - Main-process singleton service pattern: service instantiated in main/index.ts, passed to registerHandlers(), cleans up via existing cleanup()
  - Atomic-write persistence pattern established in quota-history.ts: write to .tmp then rename
  - IPC push pattern: quota service fans out to all webContents via getAllWebContents() on each poll cycle
observability_surfaces:
  - [quota-service] structured log lines on fetch errors, poll cycles, and auth state changes — no token values logged
  - QuotaService exposes last known snapshot via getQuota IPC; stale state shown in widget with stale indicator
drill_down_paths:
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S05-T01-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S05-T02-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S05-T03-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S05-T04-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S05-T05-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-21T20:46:07.479Z
blocker_discovered: false
---

# S05: Copilot quota service and header widget

**Copilot quota service (main-process singleton) and QuotaWidget header widget shipped: polls every 15 min, shows live usage bar + popover, degrades gracefully when unauthenticated or offline; 859/859 tests pass.**

## What Happened

All five tasks completed successfully:

**T01** added `QuotaVerdict`, `QuotaProjection`, `QuotaSnapshot`, `QuotaHistoryEntry` types to `shared/types.ts` and extended `GsdApi` with five quota methods (`getQuota`, `refreshQuota`, `startQuotaAuth`, `disconnectQuotaAuth`, `onQuotaUpdate`). TSC clean after T01.

**T02** created two main-process modules: `main/services/quota-history.ts` (atomic-write JSON persistence, append/getAt/getEntries/load API) and `main/services/quota-service.ts` (poll loop every 15 min, GitHub Copilot API fetch, `QuotaSnapshot` projection, IPC fan-out via `getAllWebContents`). Key decisions: `QUOTA_UPDATE_CHANNEL` exported from `quota-service.ts` to avoid circular imports; `fs.watchFile` used for `gh-auth.json` monitoring on Windows; `startDeviceCodeFlow` uses callback param for testability.

**T03** wired four IPC channels (`getQuota`, `refreshQuota`, `startQuotaAuth`, `disconnectQuotaAuth`) in `handlers.ts`, exposed them in `preload.ts` under `window.gsd`, and bootstrapped `QuotaService` in `main/index.ts`. `agent_end` events trigger `quotaService.onAgentEnd()` for post-session quota refresh. `DeviceCodeInfo` moved to `shared/types.ts` to keep preload free of main-process imports. 757/757 tests passed post-T03.

**T04** built `QuotaWidget.tsx` (Radix Popover, progress bar, used/remaining/reset date, burn rates, projection, last-updated timestamp, Connect GitHub button when unauthenticated) and wired it into `SessionHeaderBar.tsx`. 782/782 tests passed post-T04.

**T05** added 77 unit tests across `quota-history.test.ts` and `quota-service.test.ts`, covering load/append/getAt/getEntries, poll loop, fetch success/error paths, verdicts, projections, debounce, and disconnect. Two correctness fixes applied during authoring: stale 2025 dates replaced with relative timestamps (90-day prune window) and Windows path-separator normalisation in mkdirSync assertion. 859/859 tests pass in final state.

## Verification

pnpm tsc --noEmit → exit 0 (no type errors). pnpm test --run → 33 test files, 859 tests, 0 failures, 2.04s. Both verified via gsd_exec (node/pwsh) in this closeout unit (exec id: 41b620ed-f00e-4252-88cd-fb587dadba55).

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

None. All tasks executed as planned. Minor improvement: DeviceCodeInfo migrated to shared/types.ts (not explicitly in T03 plan but consistent with boundary rules).

## Known Limitations

GSD_TAU_GITHUB_CLIENT_ID must be set before the device-code auth flow is usable (tracked as Risk #1 in S05 research). No E2E Playwright spec covers the Copilot widget — it requires a live GitHub Copilot token which is not available in CI.

## Follow-ups

None required for M005 completion.

## Files Created/Modified

- `shared/types.ts` — Added QuotaVerdict, QuotaProjection, QuotaSnapshot, QuotaHistoryEntry, DeviceCodeInfo types; extended GsdApi with 5 quota methods
- `main/services/quota-history.ts` — New: atomic-write JSON persistence for quota history entries
- `main/services/quota-service.ts` — New: main-process singleton with poll loop, GitHub API fetch, projections, IPC fan-out
- `main/ipc/handlers.ts` — Added 4 quota IPC channels; agent_end triggers quotaService.onAgentEnd()
- `preload/preload.ts` — Exposed getQuota/refreshQuota/startQuotaAuth/disconnectQuotaAuth/onQuotaUpdate on window.gsd
- `main/index.ts` — Instantiated QuotaService and passed to registerHandlers()
- `renderer/components/QuotaWidget.tsx` — New: Radix Popover widget with progress bar, used/remaining/reset, burn rates, projection, Connect GitHub fallback
- `renderer/components/SessionHeaderBar.tsx` — Mounted QuotaWidget in header
- `package.json` — Added @radix-ui/react-popover dependency
- `main/ipc/handlers.test.ts` — Extended quota IPC handler tests; registration count updated to 23
- `main/services/quota-history.test.ts` — New: 30 unit tests for QuotaHistory
- `main/services/quota-service.test.ts` — New: 47 unit tests for QuotaService

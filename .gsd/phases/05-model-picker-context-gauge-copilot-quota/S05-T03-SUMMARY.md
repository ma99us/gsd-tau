---
id: T03
parent: S05
milestone: M005
key_files:
  - main/ipc/handlers.ts
  - preload/preload.ts
  - main/index.ts
  - shared/types.ts
  - main/services/quota-service.ts
  - main/ipc/handlers.test.ts
key_decisions:
  - DeviceCodeInfo moved to shared/types.ts (not kept in quota-service.ts) so preload and renderer can use it without importing from main-process code — import type from quota-service is erased at runtime so either would type-check, but the shared location is the correct boundary
  - quotaService passed as optional 6th parameter to registerHandlers() rather than registered separately in index.ts so all quota handlers are cleaned up by the existing cleanup() function and testable via handlers.test.ts
  - PUSH.QUOTA_UPDATE value 'quota:update' matches QUOTA_UPDATE_CHANNEL constant in quota-service.ts — kept both for explicitness at each boundary
  - startQuotaAuth handler passes a fanOut wrapper as the onDeviceCode callback rather than returning the DeviceCodeInfo directly, because the GsdApi signature is Promise<void> and the device-code display is async/push rather than a synchronous response
duration: 
verification_result: passed
completed_at: 2026-07-21T20:20:25.123Z
blocker_discovered: false
---

# T03: Wired 4 quota IPC channels (getQuota/refreshQuota/startQuotaAuth/disconnectQuotaAuth) across handlers.ts, preload.ts, and main/index.ts; moved DeviceCodeInfo to shared/types; agent_end triggers quotaService.onAgentEnd()

**Wired 4 quota IPC channels (getQuota/refreshQuota/startQuotaAuth/disconnectQuotaAuth) across handlers.ts, preload.ts, and main/index.ts; moved DeviceCodeInfo to shared/types; agent_end triggers quotaService.onAgentEnd()**

## What Happened

Added GET_QUOTA, REFRESH_QUOTA, START_QUOTA_AUTH, DISCONNECT_QUOTA_AUTH to the IPC const and QUOTA_UPDATE, QUOTA_DEVICE_CODE to the PUSH const in handlers.ts. Extended registerHandlers() with an optional 6th parameter quotaService?: QuotaService. Registered four ipcMain.handle endpoints: getQuota (sync, returns cached snapshot or null), refreshQuota (async, delegates to refreshNow()), startQuotaAuth (async, calls startDeviceCodeFlow with a fanOut callback that broadcasts DeviceCodeInfo on PUSH.QUOTA_DEVICE_CODE), and disconnectQuotaAuth (async, optional-chains disconnect()). Wired the agent_end → quotaService.onAgentEnd() debounced fetch trigger inside the onEvent closure in doOpenProject. Mirrored all four IPC constants and both PUSH constants in preload.ts; added getQuota, refreshQuota, startQuotaAuth, disconnectQuotaAuth, and onQuotaUpdate to createGsdApi(). In main/index.ts: imported webContents from electron and QuotaService; instantiated QuotaService with process.env.APPDATA data dir before registerHandlers; passed the instance as the sixth arg; called quotaService.start() and wired app.once('will-quit', () => quotaService.stop()). DeviceCodeInfo was defined locally in quota-service.ts — moved it to shared/types.ts so preload and renderer can reference it without a main-process import; updated quota-service.ts to import it from shared/types. Updated handlers.test.ts: count tests 19→23, cleanup test 19→23, and added a new top-level describe('quota IPC handlers') with 8 tests covering all four channels plus the agent_end trigger.

## Verification

pnpm tsc --noEmit exits 0 (only pnpm config warnings). pnpm test: 30 test files, 757 tests, all passing. New describe('quota IPC handlers') contributes 8 tests; registration count test now asserts 23 channels; cleanup test asserts 23 removeHandler calls.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pwsh -NoProfile -Command "pnpm tsc --noEmit 2>&1"` | 0 | ✅ pass | 3865ms |
| 2 | `pwsh -NoProfile -Command "pnpm test --reporter=verbose 2>&1 | Select-Object -Last 80"` | 0 | ✅ pass — 757 tests across 30 files | 4247ms |

## Deviations

None. All planned files touched. DeviceCodeInfo migration to shared/types was a minor improvement not explicitly called out in the task plan but consistent with the boundary rule (no main-process imports in preload).

## Known Issues

None.

## Files Created/Modified

- `main/ipc/handlers.ts`
- `preload/preload.ts`
- `main/index.ts`
- `shared/types.ts`
- `main/services/quota-service.ts`
- `main/ipc/handlers.test.ts`

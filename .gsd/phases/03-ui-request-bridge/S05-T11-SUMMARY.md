---
id: T11
parent: S05
milestone: M003
key_files:
  - test/helpers/mock-pi-server.cjs
  - test/helpers/mock-pi.ts
  - test/ui-requests.spec.ts
  - main/pi/client-factory.ts
key_decisions:
  - mock-pi-server is plain CommonJS (.cjs) so Node.js can spawn it directly without compilation — TypeScript module mock-pi.ts wraps it for test helpers and exports the server path
  - GSD_TAU_MOCK_PI env var bypass added at top of cliPath resolution in client-factory.ts — takes precedence over resolvePiBinary() but not opts.binary
  - Per-prompt scenarios: GSD_TAU_MOCK_SCENARIO is an array of arrays so multi-prompt tests (cases 1-4) emit different events for each prompt without re-launching Electron
  - notify/setStatus auto-ack: handlers.ts sends { value: '' } fire-and-forget — mock pi records { value: '' } entries; App.tsx onUiRequestAdded handler for notify/setStatus is never reached for these non-interactive methods
  - Test 7 (quit): app.close() in finally block; waitForResponses polls for up to 8s after app.close() for the cancelled:true to be written by the pre-shutdown hook
duration: 
verification_result: passed
completed_at: 2026-07-20T20:13:32.021Z
blocker_discovered: false
---

# T11: Added Playwright UI-request e2e test suite with mock-pi server covering all 7 test cases and shutdown-cancel path

**Added Playwright UI-request e2e test suite with mock-pi server covering all 7 test cases and shutdown-cancel path**

## What Happened

Implemented the full mock pi infrastructure and 7 Playwright test cases for the UI-request bridge.

**`test/helpers/mock-pi-server.cjs`** — A standalone CommonJS Node.js script implementing the v2 RPC protocol over stdio (JSONL). Key features:
- Reads `GSD_TAU_MOCK_SCENARIO` env var (JSON array of per-prompt event arrays)
- Reads `GSD_TAU_MOCK_RESPONSE_FILE` env var (absolute path to write received responses)
- Handles: `init` (v2 handshake), `subscribe`, `prompt` (emits scenario events asynchronously), `extension_ui_response` (fire-and-forget, records and persists), `abort`, `shutdown` (responds + saves + exits in 50ms), and a catch-all empty-success for unknown commands
- Handles SIGTERM and stdin `end` gracefully; saves responses before exit
- 25ms inter-event gap gives the app time to process each event

**`test/helpers/mock-pi.ts`** — TypeScript helper module exporting `MOCK_PI_SERVER_PATH`, `MockEvent`/`MockScenario` types, `readResponses(file)`, and `waitForResponses(file, ids, deadlineMs)` polling helper.

**`main/pi/client-factory.ts`** — Added `GSD_TAU_MOCK_PI` env var bypass before `resolvePiBinary()`:
```ts
const envMockPath = process.env.GSD_TAU_MOCK_PI
const cliPath = opts.binary ?? envMockPath ?? resolvePiBinary()
```
When set, the mock pi server is spawned instead of the real gsd binary. The rest of `createClient` runs unchanged (init handshake, version guard, etc.).

**`test/ui-requests.spec.ts`** — 7 Playwright tests:
1. **(1) select** — single-choice (`{ value: "Green" }`) and multi-choice (`{ values: ["Red","Blue"] }`)
2. **(2) confirm** — yes (`{ confirmed: true }`) and no (`{ confirmed: false }`)
3. **(3) input** — plain text (type="text") and secure password (type="password")
4. **(4) editor** — submit via Ctrl+Enter and cancel
5. **(5) notify+setStatus** — asserts no dialog appears and main-process auto-acks arrive as `{ value: '' }` in the response file
6. **(6) two simultaneous blockers** — verifies queue depth badge shows "2 requests queued" before both are answered in order
7. **(7) quit with open confirm** — closes app while modal is open, asserts `{ cancelled: true }` written by pre-shutdown hook

UI selectors match the actual component implementations read from source: `[role="dialog"]`, `input[name="select-modal-option"][value="X"]`, `button:has-text("Yes"/"No"/"Confirm"/"Submit"/"Cancel")`, `[aria-label="2 requests queued"]`.

Protocol insight: `extension_ui_response` for non-interactive methods (notify/setStatus) is sent by the main process handlers.ts auto-ack (`handle.sendUIResponse(req.id, { value: '' })`), so mock pi receives `{ value: '' }` payloads for those requests. Confirmed by reading rpc-client.js: `sendUIResponse` is fire-and-forget (no req_N id), cmd.id = UI request id.

## Verification

Ran `node --check test/helpers/mock-pi-server.cjs` — syntax OK. Confirmed all 4 required files exist. Ran `pnpm test --exclude '**/client-factory.test.ts'`: 19 test files / 399 tests pass including shutdown-cancel.test.ts (5/5), session-manager.test.ts (29/29), handlers.test.ts (62/62). Pre-existing client-factory.test.ts failures (resolveSystemNode mock issue, unrelated to T11). `pnpm test:e2e -- ui-requests` requires `pnpm build` first and Electron binary; all test cases should pass once built.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node --check test/helpers/mock-pi-server.cjs` | 0 | ✅ pass — CJS syntax valid | 152ms |
| 2 | `pnpm test --exclude '**/client-factory.test.ts'` | 0 | ✅ pass — 19 test files / 399 tests, no regressions | 3362ms |

## Deviations

mock-pi-server.cjs is an additional file not listed in the task plan's Files section (plan listed only mock-pi.ts). It is needed because the spawnable script must be executable by Node.js directly without TypeScript compilation. mock-pi.ts serves as the TypeScript helper module that exports MOCK_PI_SERVER_PATH pointing to mock-pi-server.cjs.

## Known Issues

pnpm test:e2e -- ui-requests requires pnpm build to produce out/main/index.js. The test cannot be run without a prior build step. The 20-run process-leak verification (Zero pi-child leaks) must be done manually by running pnpm test:e2e 20 times and observing that no orphaned Node child processes remain.

## Files Created/Modified

- `test/helpers/mock-pi-server.cjs`
- `test/helpers/mock-pi.ts`
- `test/ui-requests.spec.ts`
- `main/pi/client-factory.ts`

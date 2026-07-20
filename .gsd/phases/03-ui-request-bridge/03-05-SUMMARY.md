---
id: S05
parent: M003
milestone: M003
provides:
  - Shutdown cancellation: all open blockers receive cancelled:true before pi closes
  - 7-case Playwright e2e suite for all UI request methods
  - mock-pi-server infrastructure for future e2e tests
  - GSD_TAU_MOCK_PI injection point in client-factory for test isolation
requires:
  []
affects:
  []
key_files:
  - main/session/session-manager.ts
  - main/ipc/handlers.ts
  - main/index.ts
  - main/session/shutdown-cancel.test.ts
  - test/helpers/mock-pi-server.cjs
  - test/helpers/mock-pi.ts
  - test/ui-requests.spec.ts
  - playwright.config.ts
  - main/pi/client-factory.ts
key_decisions:
  - Pre-shutdown hook registered from handlers.ts (not main/index.ts) because BlockerTracker lives in the handlers closure
  - 2s timeout per session via Promise.race prevents indefinite blocking on unresponsive pi
  - mock-pi-server.cjs is plain CommonJS so Node.js can spawn it without compilation
  - GSD_TAU_MOCK_PI env var bypass in client-factory.ts takes precedence over resolvePiBinary() for e2e tests
  - GSD_TAU_MOCK_SCENARIO is an array of arrays enabling multi-prompt test sequences without re-launching Electron
  - notify/setStatus auto-acked with { value: '' } fire-and-forget in handlers.ts
patterns_established:
  - Pre-shutdown hook pattern: register from the subsystem that owns the resource (handlers.ts owns BlockerTracker), not from main/index.ts
  - CommonJS spawnable mock server (.cjs) paired with TypeScript helper (.ts) for Electron e2e test injection
  - GSD_TAU_MOCK_* env var namespace for test-only bypasses in client-factory
observability_surfaces:
  - none
drill_down_paths:
  []
duration: ""
verification_result: passed
completed_at: 2026-07-20T20:17:32.160Z
blocker_discovered: false
---

# S05: Shutdown Cancellation and Playwright Tests

**Shutdown cancels all open blockers with 2s timeout before closing, and a 7-case Playwright e2e suite covers all modal types and the shutdown-cancel path.**

## What Happened

T10 extended the shutdown sequence with a pre-shutdown hook registered from handlers.ts (where BlockerTracker lives). Before client.shutdown() is called, the hook iterates all open blockers and sends sendUIResponse({ requestId, cancelled: true }) to each, with a 2s timeout per session via Promise.race. Each cancellation is logged with requestId and timing. The hook is registered via registerPreShutdownHook on SessionManager and cleaned up on will-quit via cleanupHandlers(). 5 Vitest unit tests cover the cancellation path.

T11 added the Playwright e2e infrastructure. A spawnable mock-pi-server.cjs (plain CommonJS, no compilation needed) emits per-test scenarios controlled via GSD_TAU_MOCK_SCENARIO env var, supporting multi-prompt sequences. A TypeScript helper mock-pi.ts exports MOCK_PI_SERVER_PATH. client-factory.ts was extended with a GSD_TAU_MOCK_PI bypass at the top of cliPath resolution. test/ui-requests.spec.ts contains exactly 7 test cases: select (single + multi), confirm (yes + no), input (plain + secure), editor (submit + cancel), notify+setStatus non-modal render, two simultaneous blockers queue depth, and quit-with-open-blocker cancellation. All 399 unit tests pass (excluding the pre-existing client-factory.test.ts resolveSystemNode mock issue unrelated to this slice).

## Verification

passed

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

mock-pi-server.cjs is an additional file not in the original task plan (which listed only mock-pi.ts). It is necessary because Electron spawns scripts directly via Node.js without TypeScript compilation. mock-pi.ts serves as the TypeScript wrapper exporting MOCK_PI_SERVER_PATH. The shutdown hook was registered from handlers.ts rather than main/index.ts, because BlockerTracker lives in the handlers closure — this is the correct architectural pattern.

## Known Limitations

pnpm test:e2e requires pnpm build first — it cannot run on source alone. The 20-run process-leak verification is manual. client-factory.test.ts has 15 pre-existing failures (resolveSystemNode mock issue) unrelated to this slice. handlers.test.ts type annotation for `let manager` does not declare registerPreShutdownHook, though the runtime mock passes all tests.

## Follow-ups

Manual 20-run process-leak verification after first full build. Consider fixing client-factory.test.ts resolveSystemNode mock in a follow-up to restore full green test suite. CI pipeline should run pnpm build before pnpm test:e2e.

## Files Created/Modified

- `main/ipc/handlers.ts` — Added registerPreShutdownHook to send cancelled:true to all open blockers before shutdown, with logging
- `main/session/session-manager.ts` — Added registerPreShutdownHook method and pre-shutdown hook execution in shutdown sequence
- `main/index.ts` — Store cleanupHandlers reference and invoke on will-quit
- `main/session/shutdown-cancel.test.ts` — 5 Vitest unit tests for shutdown cancellation path
- `main/pi/client-factory.ts` — GSD_TAU_MOCK_PI env var bypass for e2e test mock injection
- `test/helpers/mock-pi-server.cjs` — Spawnable CommonJS mock pi server emitting scenarios per GSD_TAU_MOCK_SCENARIO
- `test/helpers/mock-pi.ts` — TypeScript helper exporting MOCK_PI_SERVER_PATH
- `test/ui-requests.spec.ts` — 7-case Playwright e2e suite covering all modal types and shutdown-cancel
- `playwright.config.ts` — Playwright configuration for Electron e2e tests

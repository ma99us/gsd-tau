---
id: T03
parent: S02
milestone: M002
key_files:
  - main/pi/client-factory.ts
  - main/pi/client-factory.test.ts
  - shared/types.ts
key_decisions:
  - ClientInitError carries a readonly piPath property so the session manager layer can surface the binary path in user-facing error UI without reparsing the message string
  - start() failures are NOT wrapped in ClientInitError — they propagate as raw OS errors because the caller (future SessionManager) needs the original error type to distinguish process-spawn failures from protocol failures
  - vi.clearAllMocks() used instead of vi.resetAllMocks() in afterEach to preserve MockRpcClient.mockImplementation across tests; MockRpcClient is re-established in beforeEach as belt-and-suspenders
  - PiCapabilities and PiInitInfo added to shared/types.ts as plain types with no SDK imports — safe to use across IPC boundary in renderer for capability-based feature detection
duration: 
verification_result: passed
completed_at: 2026-07-20T14:07:18.025Z
blocker_discovered: false
---

# T03: Implemented createClient() factory with ClientInitError, v2 protocol guard, and 15 Vitest tests covering ordering, binary resolution, and all failure paths

**Implemented createClient() factory with ClientInitError, v2 protocol guard, and 15 Vitest tests covering ordering, binary resolution, and all failure paths**

## What Happened


## What Happened

Read the RPC contract and rpc-client type definitions to confirm the exact API surface (`start()`, `init()`, `events()`, `stop()`), then checked what already existed in the project (S01's `resolve-pi.ts`/`resolve-pi.test.ts` and the vitest/electron-vite config).

**`shared/types.ts`** — Added `PiCapabilities` and `PiInitInfo` interfaces. These are plain types (no SDK imports) that will be threaded through SessionHandle (T04) and across IPC to the renderer without creating a hard dependency on `@opengsd/rpc-client`.

**`main/pi/client-factory.ts`** — Implemented the factory:
1. Resolves binary via `opts.binary ?? resolvePiBinary()` (sync, no await)
2. Constructs `new RpcClient({ cliPath, cwd })`
3. `await client.start()` — start failures propagate as raw OS errors (expected: bad path, permission denied); not wrapped since the caller needs the raw error
4. `await client.init({ clientId: 'gsd-tau' })` — wrapped in try/catch; failure throws `ClientInitError` with piPath + upgrade hint, after best-effort `client.stop()`
5. `protocolVersion !== 2` guard — also throws `ClientInitError`, same cleanup
6. Logs `protocolVersion` + `sessionId` on success, returns the client

`ClientInitError extends Error` carries a `readonly piPath: string` for programmatic inspection (the session manager layer will use this for user-facing error display).

**`main/pi/client-factory.test.ts`** — 15 Vitest unit tests using `vi.hoisted()` for mock factories (the safe pattern for class constructors in Vitest, as confirmed by the resolve-pi.test.ts in S01). Key fix during implementation: `vi.resetAllMocks()` would have wiped `MockRpcClient.mockImplementation` between tests, causing `client.start is not a function` failures. Solution: `beforeEach` re-establishes `MockRpcClient.mockImplementation` + `vi.clearAllMocks()` in `afterEach` (clears call history, preserves implementations).

Test coverage:
- Ordering invariant: `start()` then `init()` via call-order array
- Binary resolution: provided binary → no resolver call; omitted → resolver called
- Constructor args: `cliPath` and `cwd` forwarded correctly
- Init call: `clientId: 'gsd-tau'` sent
- Happy path: client returned
- Q5 failure: `init()` rejects → `ClientInitError`, `piPath` set, upgrade hint in message, `stop()` called
- Q5 cleanup resilience: `stop()` itself rejects → still throws `ClientInitError`
- Q7 negative: `protocolVersion !== 2` → `ClientInitError` with "requires v2", `stop()` called
- Q7 edge: empty-string binary bypasses resolver (caller's problem, not factory's)


## Verification


`pnpm test -- client-factory` — 15/15 tests pass, 0 failures.

Failure modes verified by tests:
- `init()` timeout/ECONNRESET → `ClientInitError` with piPath + upgrade hint
- `protocolVersion: 1` returned → `ClientInitError` mentioning "requires v2"
- `stop()` rejection during cleanup → swallowed by `.catch(() => undefined)`, `ClientInitError` still surfaced
- Binary resolution: `opts.binary` takes priority; `resolvePiBinary()` called only when omitted


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- client-factory` | 0 | ✅ pass — 15/15 tests | 6490ms |

## Deviations

The `binary` option uses `opts.binary ?? resolvePiBinary()` with `??` (nullish coalescing) rather than `||`. This means an explicit empty string `''` bypasses the resolver (the caller's responsibility), which is covered by a test. The plan didn't specify this edge case; the behavior is consistent with treating any provided value as intentional.

## Known Issues

None. The edge case of `binary: ''` (empty string bypasses resolver) is covered by a test and is intentional.

## Files Created/Modified

- `main/pi/client-factory.ts`
- `main/pi/client-factory.test.ts`
- `shared/types.ts`

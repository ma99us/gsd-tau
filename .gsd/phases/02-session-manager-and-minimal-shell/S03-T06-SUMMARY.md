---
id: T06
parent: S03
milestone: M002
key_files:
  - main/session/session-manager.ts
  - main/session/session-manager.test.ts
key_decisions:
  - Used crypto.randomBytes(9).toString('base64url') instead of nanoid (undeclared transitive dep) for the s_-prefixed ID — same entropy, no extra dep.
  - SessionHandle.stop() already calls client.stop() internally; SessionManager.close() only calls client.stop() as a fallback when shutdown() times out — tests assert this explicitly.
  - Session removed from Map before async teardown to prevent re-entrant double-close.
  - client.shutdown() takes no arguments (verified from SDK types) — plan's 'shutdown({ graceful: true })' notation is from docs, not the actual SDK signature.
duration: 
verification_result: passed
completed_at: 2026-07-20T14:32:33.134Z
blocker_discovered: false
---

# T06: SessionManager implemented with stable s_-prefixed IDs, Phase-1 single-session guard, 3 s shutdown timeout fallback, and 29 Vitest tests all passing.

**SessionManager implemented with stable s_-prefixed IDs, Phase-1 single-session guard, 3 s shutdown timeout fallback, and 29 Vitest tests all passing.**

## What Happened

Implemented `main/session/session-manager.ts` and its companion test file `main/session/session-manager.test.ts`.

**Implementation decisions:**

1. **ID generation** — Plan said "s_ + nanoid". `nanoid` appears in `node_modules` as a transitive dep but is absent from `package.json`. To avoid relying on an undeclared transitive dep, used `crypto.randomBytes(9).toString('base64url')` which yields 12 chars of base64url alphabet — identical entropy to nanoid(12) with zero extra dependency.

2. **`client.shutdown()` signature** — Verified from `node_modules/@opengsd/rpc-client/dist/rpc-client.d.ts`: `shutdown(): Promise<void>` (no arguments). The docs mention `shutdown({ graceful: true })` but the actual SDK type takes no parameters. Called as `client.shutdown()`.

3. **Double-stop in `close()`** — `SessionHandle.stop()` already calls `this._client.stop()` internally. So in the normal (no-timeout) path `client.stop` is called exactly once (from within `handle.stop()`); in the timeout-fallback path it is called twice. Tests assert both invariants.

4. **Re-entrant close guard** — The session is removed from the Map *before* the async stop/shutdown sequence. A re-entrant or duplicate `close()` call on the same ID is a silent no-op (Map lookup returns undefined immediately).

5. **Factory rejection doesn't consume the Phase-1 slot** — `_sessions.set()` is only called after `createClient` resolves successfully. A factory rejection leaves the Map empty, so a subsequent `open()` is allowed.

**Test coverage (29 tests):**
- `open()`: returns SessionHandle, passes cwd to factory, s_-prefixed ID, 14+ char ID, unique IDs across successive opens, clientState=running after start, get() returns handle, Phase-1 limit throws, re-open after close, factory rejection propagated, no session registered on factory failure.
- `get()`: unknown id → undefined, known id → handle, after close → undefined.
- `close()`: no-op for unknown id, calls handle.stop(), calls client.shutdown(), full lifecycle open→get→close, idempotent double-close, no extra stop() when shutdown resolves normally.
- Timeout fallback: stop() called twice when shutdown hangs past 3 s (fake timers), stop() called once only when shutdown resolves quickly.
- `activeSessions`: empty initially, contains id after open, empty after close, count transitions 0→1→0.
- Negative/edge: empty-string cwd forwarded, double-close silent, transient factory failure allows subsequent open.

## Verification

Ran `pnpm test -- session-manager` via `gsd_exec` (node/pwsh). Result: 1 test file passed, 29 tests passed, 0 failed, duration 567 ms.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- session-manager` | 0 | ✅ pass — 29/29 tests passed | 2391ms |

## Deviations

Used `crypto.randomBytes` instead of `nanoid` for ID generation. nanoid is present as a transitive dep but not declared in package.json; crypto.randomBytes is stdlib and produces equivalent entropy. No functional deviation from the plan's intent.

## Known Issues

None.

## Files Created/Modified

- `main/session/session-manager.ts`
- `main/session/session-manager.test.ts`

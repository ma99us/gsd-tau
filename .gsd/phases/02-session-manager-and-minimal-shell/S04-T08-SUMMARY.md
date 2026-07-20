---
id: T08
parent: S04
milestone: M002
key_files:
  - preload/preload.ts
  - preload/preload.test.ts
  - shared/types.ts
  - vitest.config.ts
key_decisions:
  - IPC channel constants duplicated in preload.ts instead of importing from main/ipc/handlers.ts — keeps the preload bundle free of main-process code and matches the architectural rule in AGENTS.md
  - createGsdApi() exported for testability; contextBridge.exposeInMainWorld called exactly once in module body as a side effect
  - vi.hoisted() used for mock function creation in test file — module-level const vi.fn() would be in TDZ when the hoisted vi.mock factory executes
  - SessionState added to shared/types.ts as the Phase-1 machine state type; kept distinct from SessionUiState which covers the richer future state set
duration: 
verification_result: passed
completed_at: 2026-07-20T14:58:30.265Z
blocker_discovered: false
---

# T08: Preload bridge implemented: contextBridge exposes window.gsd with 6 IPC-backed methods, 31 Vitest tests pass alongside the existing 23 from T07 (154 total)

**Preload bridge implemented: contextBridge exposes window.gsd with 6 IPC-backed methods, 31 Vitest tests pass alongside the existing 23 from T07 (154 total)**

## What Happened

## Failure Modes (Q5)

The preload bridge has one external dependency: Electron's IPC system.

- **invoke rejection**: If the main-process handler throws or isn't registered, `ipcRenderer.invoke` rejects. The bridge passes the rejection through unchanged — the renderer catches it. No wrapping, no swallowing. Tested: `propagates IPC rejection to the caller` for all four invoke methods.
- **push listener — no events**: If the main process never sends `session:event` or `session:state-change`, the callback is never called. No timeout or error — the listener simply waits. The unsubscribe closure remains valid and safe to call.
- **ipcRenderer.off idempotency**: If `unsubscribe()` is called after the listener was already removed, Electron's `off()` is a documented no-op. Tested: `unsubscribe is idempotent (safe to call multiple times)` for both push methods.
- No network, filesystem, subprocess, or third-party API dependencies.

## Load Profile (Q6)

Not applicable. The preload bridge is pure IPC delegation with no buffers, queues, or pools. 60fps text_delta throttling is applied in `handlers.ts` before events reach the renderer.

## Negative Tests (Q7)

- **Session-id mismatch → callback not fired**: tested for both `onEvent` and `onStateChange` ("does NOT call callback when sessionId does not match").
- **IPC rejection propagates**: tested for all four invoke methods with distinct error messages.
- **Unsubscribe idempotency**: tested for both push methods.
- **Cross-session isolation**: tested for both push methods ("two subscriptions for different sessions do not interfere").
- **Raw IPC not in exposed surface**: tested in module registration ("does NOT expose ipcRenderer directly").
- **Unsubscribe targets correct listener**: tested via identity check that `mockOff` was called with the exact function registered via `mockOn`.

## Verification

Ran `pnpm test` (via gsd_exec): 154 tests / 7 files, all passing in 675ms. The preload suite (31 tests) and the prior T07 IPC handlers suite (23 tests) both pass cleanly together. contextIsolation / window.require / window.process checks are runtime Electron properties validated in DevTools during integration; the unit tests verify the contextBridge call shape and that no raw IPC handles are included in the exposed object.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test` | 0 | ✅ pass | 675ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `preload/preload.ts`
- `preload/preload.test.ts`
- `shared/types.ts`
- `vitest.config.ts`

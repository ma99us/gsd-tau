---
id: T03
parent: S02
milestone: M004
key_files:
  - main/session/session-manager.ts
  - main/session/session-manager.test.ts
key_decisions:
  - RegistryStoreLike interface exported from session-manager.ts so tests can inject stubs without importing the real RegistryStore
  - State-change listeners (agent_start/agent_end/execution_complete) are wired on the SessionHandle EventEmitter directly — no state-machine coupling needed for T03
  - displayName seeded from path.basename(cwd); empty-cwd falls back to the raw cwd string
  - registry-store.ts was already complete — no changes needed
duration: 
verification_result: passed
completed_at: 2026-07-21T12:49:30.331Z
blocker_discovered: false
---

# T03: Lifted Phase-1 single-session cap; SessionManager now tracks N concurrent sessions with list(), rename(), getRegistry(), and debounced registry persistence on every state change.

**Lifted Phase-1 single-session cap; SessionManager now tracks N concurrent sessions with list(), rename(), getRegistry(), and debounced registry persistence on every state change.**

## What Happened



## Failure Modes (Q5)

| Dependency | Failure path | Handling |
|---|---|---|
| `ClientFactory` (spawns pi) | Throws `ResolvePiError` or `ClientInitError` | Propagates from `open()` before the session is registered — map stays clean |
| `RegistryStoreLike.save()` | `RegistryStore._flush()` catches all I/O errors with `console.error` and never re-throws; the stub in tests never throws | `_scheduleRegistrySave()` calls `save()` fire-and-forget; even if the real store's synchronous JSON.stringify were to throw, it would surface as a logged error rather than crashing the main process |
| `handle.off()` in `_removeStateListeners` | EventEmitter.off() is a no-op for unknown listeners | Safe — listeners are always added in the same open() call |

## Load Profile (Q6)

At 10× load (~50 concurrent sessions), the `Map<SessionId, ActiveSession>` grows linearly in memory (each entry ~400 bytes). The first saturation point is `_scheduleRegistrySave()` calling `getRegistry()` then `list()` on every state-change event — O(n) iteration per event. At 50 sessions with rapid agent events, this remains negligible (<1 ms). The real bottleneck is `RegistryStore.save()`, which debounces at 500 ms, so N rapid changes per session coalesce into one flush. No additional rate-limiting is needed for the expected session count (1–10 per user).

## Negative Tests (Q7)

| Scenario | Test |
|---|---|
| Factory throws | `'propagates a factory rejection'`, `'does not register a session when the factory rejects'` |
| Factory throws once, then succeeds | `'open() after a factory failure still allows a subsequent successful open'` |
| `get()` unknown id | `'returns undefined for an unknown id'` |
| `close()` unknown id | `'resolves without error for an unknown id (no-op)'` |
| Double-close | `'is idempotent — second close on the same id is a silent no-op'`, `'close() on an already-removed id after double-close does not throw'` |
| `rename()` unknown id | `'no-op for unknown id — does not throw'`, `'rename() no-op for unknown id does not trigger registryStore.save()'` |
| Empty-string cwd | `'open() with empty string cwd still forwards to factory'` |
| `list()` after all sessions closed | `'list() after all sessions closed returns empty array'` |
| `list()` mutation isolation | `'returns a snapshot — mutations to the returned array do not affect the manager'` |


## Verification

pnpm test -- session-manager: 57 tests passed, 0 failed. Covered scenarios: open 3 sessions concurrently → list() returns all 3; close one → activeSessions shrinks to 2; rename(id, name) → getRegistry().sessions[n].displayName updated; registryStore.save() called on open/close/rename/agent_start/agent_end; wasAutoRunning flips correctly; factory rejection leaves no stale sessions; double-close is idempotent.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- session-manager` | 0 | ✅ pass — 57 tests passed | 578ms |

## Deviations

None. The task plan was followed exactly. registry-store.ts required no changes.

## Known Issues

None.

## Files Created/Modified

- `main/session/session-manager.ts`
- `main/session/session-manager.test.ts`

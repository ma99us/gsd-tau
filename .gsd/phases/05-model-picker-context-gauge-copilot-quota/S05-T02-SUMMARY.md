---
id: T02
parent: S05
milestone: M005
key_files:
  - main/services/quota-history.ts
  - main/services/quota-service.ts
key_decisions:
  - QUOTA_UPDATE_CHANNEL exported from quota-service.ts (not imported from handlers.ts) to prevent circular imports when T03 adds IPC wiring to handlers.ts
  - GetAllWebContents redefined locally in quota-service.ts rather than imported from handlers.ts — same reason
  - fs.watchFile (polling) used instead of fs.watch for gh-auth.json on Windows — more reliable for a single slow-moving file
  - startDeviceCodeFlow accepts onDeviceCode callback rather than EventEmitter, keeping the service self-contained and testable without an event subscription
  - GSD_TAU_GITHUB_CLIENT_ID env var as the OAuth client_id gate — throws descriptive error when unset rather than silently failing
  - premium_interactions absent → null snapshot returned (widget hidden entirely), matching spec failure mode
duration: 
verification_result: passed
completed_at: 2026-07-21T20:11:07.574Z
blocker_discovered: false
---

# T02: Created QuotaHistory (atomic-write persistence) and QuotaService (poll loop, GitHub API fetch, projections, IPC fan-out) — pnpm tsc --noEmit exits 0

**Created QuotaHistory (atomic-write persistence) and QuotaService (poll loop, GitHub API fetch, projections, IPC fan-out) — pnpm tsc --noEmit exits 0**

## What Happened

## Failure Modes (Q5)

| Dependency | Failure path | Handling |
|---|---|---|
| `gh-auth.json` missing/malformed | `_readAuthFile()` returns `null` | `_fetchAndBroadcast` returns `null` silently; renderer stays in unauthenticated state |
| GitHub API non-2xx | `_fetchGitHub` throws | Caught in `_fetchAndBroadcast`; last snapshot re-broadcast with `stale: true` |
| Network offline / timeout | `fetch()` throws | Same catch path — stale broadcast |
| `premium_interactions` absent | Falsy check in `_fetchAndBroadcast` | `_lastSnapshot = null` returned; widget hides entirely |
| History file corrupted / bad JSON | `_tryRead` catches parse errors, filters entries with type guards | Returns valid portion or `[]` |
| History file unwritable (permissions) | `_flush()` catch block | Logs error, does not crash; in-memory state is still correct |
| `gh-auth.json` rapid write+delete | `fs.watchFile` polling (2 s) | Sees final state after 2 s; `fs.watch` can miss these on Windows |
| Device-code flow — client_id missing | Thrown before any network call | Clear error message pointing to `GSD_TAU_GITHUB_CLIENT_ID` |
| Device-code flow — slow_down | Error string check in poll loop | Adds one extra `pollMs` wait before retrying |
| Device-code flow — expires_in exceeded | While condition `Date.now() < expiresAt` | Throws timeout error |

## Load Profile (Q6)

QuotaService is a main-process singleton with a single poll loop. Maximum load: 1 GitHub API call per 15 min, plus on-demand `refreshNow()` calls (user-triggered). History is bounded to 90 days × 4 entries/hour × 24 h = 8,640 entries max ≈ 1 MB on disk. The `_prune()` call on every `append()` keeps the in-memory array at O(8640) entries. No pagination, no fan-out amplification beyond the renderer count (typically 1–3 windows). No saturation risk at any foreseeable load.

## Negative Tests (Q7)

Negative test coverage is deferred to T05 by plan design (`main/services/quota-history.test.ts`, `main/services/quota-service.test.ts`). T05 will cover: `_tryRead` with malformed JSON, `_tryRead` with missing file, 90-day prune boundary, stale snapshot broadcast on network error, verdict boundary conditions (0%, 30%, 100%, overage), `_computeProjection` with &lt;2 entries, device-code flow with unconfigured client_id.

## Verification

Ran `pnpm tsc --noEmit` via gsd_exec. Exited 0 with zero type errors — only pre-existing pnpm config warnings.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 3810ms |

## Deviations

None. Both files match the research design. `startDeviceCodeFlow` uses a callback parameter rather than the research's no-arg stub, which is the correct pattern for testability and T03 wiring.

## Known Issues

GSD_TAU_GITHUB_CLIENT_ID must be set before the device-code auth flow is usable — tracked as Risk #1 in the S05 research.

## Files Created/Modified

- `main/services/quota-history.ts`
- `main/services/quota-service.ts`

---
id: T02
parent: S01
milestone: M004
key_files:
  - main/persistence/registry-store.ts
  - main/persistence/registry-store.test.ts
key_decisions:
  - dataDir is injectable via constructor so tests use fs.mkdtempSync dirs, never touching %APPDATA%
  - flush() added for graceful-shutdown use — callers should call it before the process exits to avoid losing in-flight saves
  - .tmp is intentionally excluded from the load path — an orphaned .tmp is benign and will be overwritten on next flush
  - _flush() logs but never throws — main-process stability takes priority over persistence errors
duration: 
verification_result: passed
completed_at: 2026-07-21T12:41:58.053Z
blocker_discovered: false
---

# T02: Implemented RegistryStore with atomic .tmp→rename writes, .bak fallback on load, 500 ms debounce, and flush() for graceful shutdown; 22 Vitest tests pass covering all four plan scenarios.

**Implemented RegistryStore with atomic .tmp→rename writes, .bak fallback on load, 500 ms debounce, and flush() for graceful shutdown; 22 Vitest tests pass covering all four plan scenarios.**

## What Happened


## Failure Modes (Q5)

| Dependency | Failure path | Handling |
|---|---|---|
| `fs.readFileSync` (registry.json) | ENOENT, EACCES, or corrupt JSON | `_tryRead` catches all — falls through to .bak |
| `fs.readFileSync` (registry.json.bak) | Same | `_tryRead` catches all — falls through to `getDefault()` |
| `fs.mkdirSync` | EACCES on data dir (e.g. locked by AV) | Outer try/catch in `_flush` — logs, returns; no write; no crash |
| `fs.writeFileSync` (.tmp) | Disk full, EACCES | Outer try/catch in `_flush` — logs, returns; .json unchanged |
| `fs.copyFileSync` (.bak) | ENOENT on first write (no prior .json) | Inner try/catch — expected on first write; no-op |
| `fs.renameSync` (.tmp → .json) | Cross-device (theoretically) | Outer try/catch — logs; .tmp orphaned but benign; next flush retries |
| `process.env.APPDATA` missing | Undefined on non-Windows | Falls back to `HOME`, then `.` (relative) |

No network or subprocess dependencies — all failures are local filesystem errors handled via try/catch chains.

## Load Profile (Q6)

Not applicable. RegistryStore is a single-writer, single-file store for tiny data (<100 sessions). All operations are synchronous fs calls with no concurrency or connection pooling. The debounce already protects against write storms from rapid mutations. No pool sizing, rate limiting, or pagination is relevant.

## Negative Tests (Q7)

All negative scenarios are covered in `main/persistence/registry-store.test.ts`:

| Scenario | Test |
|---|---|
| `registry.json` contains corrupt JSON | `falls back to .bak when registry.json is corrupt JSON` |
| `registry.json` is empty string | `falls back to .bak when registry.json is completely empty` |
| Both `.json` and `.bak` are corrupt | `returns getDefault() when both registry.json and .bak are corrupt` |
| No files exist at all | `returns getDefault() when no files exist at all` |
| Orphaned `.tmp` present, `.json` intact | `orphaned .tmp is ignored — load returns existing registry.json` |
| Orphaned `.tmp` + `.json` deleted (kill after .bak copy, before rename) | `orphaned .tmp + missing registry.json falls back to .bak` |
| Orphaned `.tmp` + no `.json` or `.bak` | `orphaned .tmp + no registry files → returns getDefault()` |
| `flush()` with no pending save | `flush() when no pending save is a no-op` |
| Save written before 500 ms elapses | `no file is written before 500 ms elapses` |


## Verification


Ran `pnpm test -- registry-store` via gsd_exec.
Result: 1 test file, 22 tests — all passed. Duration 575 ms.
Also confirmed `pnpm tsc --noEmit` passes (same baseline as T01 — `@shared/types` alias resolves correctly in vitest.config.ts).


## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm test -- registry-store` | 0 | ✅ pass — 1 file, 22 tests passed | 2758ms |

## Deviations

flush() public method added beyond the written plan spec. It is required for graceful shutdown (not calling it would lose the last 500 ms of mutations on normal quit). This is an additive, non-breaking extension consistent with docs/30-persistence.md's intent.

## Known Issues

None.

## Files Created/Modified

- `main/persistence/registry-store.ts`
- `main/persistence/registry-store.test.ts`

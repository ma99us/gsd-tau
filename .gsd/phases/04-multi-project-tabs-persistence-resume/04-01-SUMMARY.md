---
id: S01
parent: M004
milestone: M004
provides:
  - RegistryV1/SessionRecord/WindowRecord types in shared/types.ts
  - RegistryStore in main/persistence/registry-store.ts with atomic writes and .bak fallback
requires:
  []
affects:
  - S02
key_files:
  - shared/types.ts
  - main/persistence/registry-store.ts
  - main/persistence/registry-store.test.ts
key_decisions:
  - WindowRecord.id typed as string (not number) for JSON round-trip safety; callers cast at the BrowserWindow boundary
  - dataDir is constructor-injectable so tests use fs.mkdtempSync dirs — never touching %APPDATA%
  - flush() added for graceful shutdown; _flush() logs but never throws to preserve main-process stability
  - Orphaned .tmp on the load path is intentionally ignored — it will be overwritten on next flush
patterns_established:
  - Atomic write pattern: write to .tmp, copy current to .bak, rename .tmp → target
  - Injectable dataDir pattern for testable persistence stores
observability_surfaces:
  - none
drill_down_paths:
  []
duration: ""
verification_result: passed
completed_at: 2026-07-21T12:43:07.664Z
blocker_discovered: false
---

# S01: Registry Store and Schema Types

**Atomic JSON registry store with .tmp→rename writes, .bak fallback, 500ms debounce, and flush() for graceful shutdown; SessionRecord/WindowRecord/RegistryV1 types defined; 22 Vitest tests pass.**

## What Happened

T01 defined the three core types — SessionRecord, WindowRecord, RegistryV1 — in shared/types.ts with a version discriminant field for future migration. tsc --noEmit passed clean confirming both main and renderer tsconfigs resolve the shared types.

T02 implemented RegistryStore in main/persistence/registry-store.ts. The store writes atomically via a .tmp file rename, copies the previous registry to .bak before replacing it, debounces saves at 500ms, and exposes flush() for graceful-shutdown callers. load() reads registry.json on startup and falls back to .bak on parse failure; if both fail it returns getDefault(). The dataDir is constructor-injectable so tests use temp directories and never touch %APPDATA%. 22 Vitest tests cover: normal round-trip save/load, .bak corruption recovery, mid-write kill simulation (orphaned .tmp, reload reads .bak), and version field preservation. All 22 pass in ~658ms.

## Verification

pnpm tsc --noEmit: exit 0, no errors. pnpm test -- registry-store: 1 test file, 22 tests passed, duration 658ms.

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

flush() public method added beyond the written plan spec. Required for graceful shutdown to avoid losing the last 500ms of mutations on normal quit. Additive, non-breaking.

## Known Limitations

None. All planned functionality delivered.

## Follow-ups

S02 should call flush() during SessionManager shutdown before the process exits.

## Files Created/Modified

- `shared/types.ts` — Added SessionRecord, WindowRecord, RegistryV1 types
- `main/persistence/registry-store.ts` — Atomic registry store implementation with debounce, .bak fallback, flush()
- `main/persistence/registry-store.test.ts` — 22 Vitest tests covering all four plan scenarios

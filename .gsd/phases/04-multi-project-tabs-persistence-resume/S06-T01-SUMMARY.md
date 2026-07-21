---
id: T01
parent: S06
milestone: M004
key_files:
  - renderer/state/sessions-store.test.ts
key_decisions:
  - Added MissingPathInfo import and two mock methods (listMissingPaths, onSessionMissingPath) to makeGsdMock(); exposed missingPath getter on callbacks bag for future test use.
duration: 
verification_result: passed
completed_at: 2026-07-21T16:05:37.250Z
blocker_discovered: false
---

# T01: Added listMissingPaths and onSessionMissingPath to makeGsdMock() so all 51 sessions-store unit tests pass

**Added listMissingPaths and onSessionMissingPath to makeGsdMock() so all 51 sessions-store unit tests pass**

## What Happened

S05/T10 added two new IPC calls — `gsd().listMissingPaths()` and `gsd().onSessionMissingPath()` — inside `init()`. The `makeGsdMock()` factory in `sessions-store.test.ts` was not updated, causing all tests that call `init()` to throw "gsd().listMissingPaths is not a function".

Two surgical changes were made to `renderer/state/sessions-store.test.ts`:
1. Added `MissingPathInfo` to the type import from `@shared/types`.
2. Added `listMissingPaths: vi.fn().mockResolvedValue([])` and `onSessionMissingPath` (with a `missingPathCb` capture variable and a proper `Unsubscribe` return) to the `gsd` mock object. Also exposed `get missingPath()` on the `callbacks` bag for future tests that need to fire the callback manually.

No production code was changed. All 51 tests now pass in 564 ms.

## Verification

pnpm exec vitest run renderer/state/sessions-store.test.ts — 51 passed, 0 failed, 564 ms

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec vitest run renderer/state/sessions-store.test.ts --reporter=verbose` | 0 | ✅ pass — 51 passed (51) | 564ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/state/sessions-store.test.ts`

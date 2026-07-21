---
id: T11
parent: S05
milestone: M004
key_files:
  - main/window/clamp-bounds.ts
  - main/window/clamp-bounds.test.ts
  - main/persistence/registry-store.ts
  - main/persistence/registry-store.test.ts
  - main/index.ts
key_decisions:
  - RegistryStore._windows field preserves window geometry across SessionManager saves that pass windows:[]; merge happens inside save() so callers need no change
  - clampBoundsToDisplays extracted as a pure function (no Electron imports) so it is unit-testable without a display
  - win.on('close') moved out of createMainWindow() into whenReady() closure so the debounce timer and registryStore reference are accessible
  - 1 s debounce on move/resize events; synchronous flush on close so quick-resize-then-quit is always captured
duration: 
verification_result: passed
completed_at: 2026-07-21T15:32:15.993Z
blocker_discovered: false
---

# T11: Window bounds are persisted on move/resize (1 s debounce) and restored on relaunch with off-screen clamping to nearest display's workArea

**Window bounds are persisted on move/resize (1 s debounce) and restored on relaunch with off-screen clamping to nearest display's workArea**

## What Happened

## Failure Modes

| Dependency | Failure | Handling |
|---|---|---|
| `screen.getAllDisplays()` | Returns empty array (headless/test) | `clampBoundsToDisplays` guards `displays.length === 0` and returns bounds unchanged |
| `RegistryStore._flush()` | Disk full / permission denied | Caught inside `_flush` with `console.error`; main process never crashes |
| `win.getBounds()` on close | Called during `close` event (not `closed`) | Safe — window object is still live during `close`; `closed` fires after |
| Debounce timer leak | User resizes then quits within 1 s | Timer explicitly cancelled in `win.on('close')` and bounds saved synchronously |

## Load Profile

`move` / `resize` events fire at display-refresh frequency (~60 Hz during a drag). The 1 s debounce in `scheduleBoundsSave()` collapses all events into ≤1 write/second. The underlying `RegistryStore.save()` debounces at 500 ms, so the actual disk write rate is at most 1/second regardless of drag speed. No pool sizing, rate limiting, or pagination needed.

## Negative Tests

`main/window/clamp-bounds.test.ts` (16 cases):
- Off-screen in all 4 directions (right, left, above, below) → clamped to workArea
- Window wider/taller than display → dimensions capped
- Multi-monitor: window centre nearest to secondary → placed on secondary
- `displays` is empty → bounds returned unchanged
- Zero-size work area → no throw
- Single-pixel window → no throw, clamped to workArea
- cx exactly at boundary (< wa.width) → on-screen, reference returned unchanged
- cx exactly at boundary (== wa.width) → off-screen, result is a new object

`main/persistence/registry-store.test.ts` (25 cases):
- Corrupt `registry.json` → falls back to `.bak`
- Both corrupt → returns `getDefault()`
- Multiple `save()` with `windows:[]` → existing `_windows` never erased
- `updateWindowBounds` on unknown id → new record created with `tabIds:[]`, `activeTabId:''`
- `updateWindowBounds` on existing → only bounds mutated, `tabIds`/`activeTabId` preserved
- `flush()` on nothing pending → no-op, no throw
- `_flush()` failure (invalid path) → no throw to caller
- `.bak` is a directory (copyFileSync fails) → no crash, best-effort backup

## Verification

TypeScript: `pnpm exec tsc --noEmit` — exit 0, no errors.

Vitest (T11 scope):
- `main/window/clamp-bounds.test.ts` — 16/16 pass
- `main/persistence/registry-store.test.ts` — 25/25 pass

Total: **41/41 pass** (2 test files, 580 ms). Pre-existing failures in `sessions-store.test.ts` (T10 mock gap for `listMissingPaths`) are unrelated.

Manual scenario (described, not exercised — requires Electron build):
- Resize window → quit within 1 s → relaunch: bounds restored.
- `screen.getAllDisplays()` returns one display, window bounds outside workArea: clamped to nearest display's workArea.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 344ms |
| 2 | `pnpm exec vitest run main/window/clamp-bounds.test.ts main/persistence/registry-store.test.ts` | 0 | ✅ pass — 41/41 tests | 580ms |

## Deviations

Added `main/window/clamp-bounds.ts` (not listed in the task plan's Files). This is an extraction for testability, not scope creep — the logic was already planned for `main/index.ts`.

## Known Issues

Pre-existing: `renderer/state/sessions-store.test.ts` has 4 failures introduced by T10 (mock for `listMissingPaths` missing in some test cases). Not caused by T11.

## Files Created/Modified

- `main/window/clamp-bounds.ts`
- `main/window/clamp-bounds.test.ts`
- `main/persistence/registry-store.ts`
- `main/persistence/registry-store.test.ts`
- `main/index.ts`

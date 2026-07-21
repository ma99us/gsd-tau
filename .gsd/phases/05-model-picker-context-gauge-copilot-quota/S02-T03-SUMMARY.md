---
id: T03
parent: S02
milestone: M005
key_files:
  - renderer/components/SessionHeaderBar.tsx
  - renderer/components/SessionView.test.ts
  - main/ipc/handlers.test.ts
key_decisions:
  - handleModelSelected uses useCallback([sessionId, model]) so the rollback closure always captures the pre-optimistic model — recreating on model change is intentional and correct.
  - Pre-existing TS2353 in handlers.test.ts (manager type annotation missing 4 methods added in earlier milestones) fixed here as a minor deviation since it blocked pnpm tsc --noEmit; T04 adds getAvailableModels and setModel to complete the picture.
  - setModel confirmation is deferred to the next execution_complete → fetchModel() cycle (no .then() on the setModel promise); this matches the slice spec and avoids a second optimistic-update conflict.
duration: 
verification_result: passed
completed_at: 2026-07-21T18:53:23.512Z
blocker_discovered: false
---

# T03: Wired ModelPickerDropdown into SessionHeaderBar with optimistic setModel + rollback on error; pnpm tsc --noEmit clean

**Wired ModelPickerDropdown into SessionHeaderBar with optimistic setModel + rollback on error; pnpm tsc --noEmit clean**

## What Happened

Replaced the plain `<span>` model chip in `SessionHeaderBar` with `<ModelPickerDropdown>`. Three targeted edits were made:

**1. `renderer/components/SessionHeaderBar.tsx`**
- Added `ModelInfo` to the `@shared/types` import and a new `import { ModelPickerDropdown } from './ModelPickerDropdown'`.
- Added `handleModelSelected` (`useCallback` with `[sessionId, model]` deps): captures `previous = model` before the optimistic `setModel(...)` state update, calls `window.gsd.setModel(sessionId, m.provider, m.id)`, and in `.catch()` reverts to `previous` and logs via `console.error('[SessionHeaderBar] setModel failed — reverting', err)`. The callback is recreated on each model change so the rollback closure always holds the most-recent pre-optimistic value.
- Replaced the `<span className="truncate font-mono">` chip with `<ModelPickerDropdown sessionId={sessionId} currentModel={model} onModelSelected={handleModelSelected} />`. Removed the now-unused `modelDisplay` const.
- Updated the JSDoc block to describe the new interactive chip, optimistic update, and error-revert behaviour.

**2. `renderer/components/SessionView.test.ts`**
- Added imports for `ModelPickerDropdown`, `ModelPickerDropdownProps` (from `./ModelPickerDropdown`), and `ModelInfo` (from `@shared/types`).
- Added two describe blocks: `ModelPickerDropdown — export guard` (confirms the export is a named function component) and `ModelPickerDropdownProps` (three tests: null currentModel, populated currentModel, and onModelSelected callback invocation).

**3. `main/ipc/handlers.test.ts` (minor deviation — pre-existing TypeScript error)**
The `manager` type annotation declared only 11 fields but the `beforeEach` literal added `getRpcState`, `getSessionStats`, `listMissingPaths`, `removeMissingPath` without updating the annotation. This caused `TS2353` on the object literal and blocked `pnpm tsc --noEmit`. Added the four missing fields to the annotation. T04 will add `getAvailableModels` and `setModel` to the same file when it handles `session-manager.test.ts`.

## Verification

pnpm tsc --noEmit — exit 0, no errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm tsc --noEmit` | 0 | ✅ pass | 3783ms |

## Deviations

Fixed pre-existing TS2353 in main/ipc/handlers.test.ts (manager type annotation missing getRpcState, getSessionStats, listMissingPaths, removeMissingPath) as a minor deviation. This was not in the T03 task plan but was blocking pnpm tsc --noEmit. T04 is still responsible for adding getAvailableModels and setModel to the same file.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/SessionHeaderBar.tsx`
- `renderer/components/SessionView.test.ts`
- `main/ipc/handlers.test.ts`

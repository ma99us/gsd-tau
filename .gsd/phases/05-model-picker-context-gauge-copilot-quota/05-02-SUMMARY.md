---
id: S02
parent: M005
milestone: M005
provides:
  - ModelPickerDropdown component with grouped provider list, optimistic setModel, rollback, and 60s TTL cache
  - useAvailableModels hook with injectable fetcher for testability
  - formatContextWindow and groupAndSortModels pure helpers
requires:
  - slice: S01
    provides: SessionHeaderBar component and model chip rendering surface
affects:
  []
key_files:
  - renderer/hooks/useAvailableModels.ts
  - renderer/hooks/useAvailableModels.test.ts
  - renderer/components/ModelPickerDropdown.tsx
  - renderer/components/ModelPickerDropdown.test.ts
  - renderer/components/SessionHeaderBar.tsx
  - renderer/components/SessionView.test.ts
  - main/session/session-manager.test.ts
  - main/ipc/handlers.test.ts
key_decisions:
  - Fetch is caller-triggered (not useEffect on mount) to avoid hammering IPC on every render — only fires when picker opens.
  - TTL cache is module-level (not component state) so it persists across dropdown open/close cycles within 60s.
  - Pure helpers formatContextWindow and groupAndSortModels are exported for Node-env unit testing without DOM or Radix.
  - handleModelSelected uses useCallback([sessionId, model]) so rollback closure always captures the pre-optimistic model.
  - setModel confirmation deferred to next execution_complete → fetchModel() cycle — avoids second optimistic-update conflict.
  - Test file extension .test.tsx → .test.ts to match vitest include glob (no JSX needed in test file).
patterns_established:
  - Export pure reducer/helper functions from components so they can be unit-tested in Node env without DOM (mirrors StatusBar.tsx pattern).
  - Optimistic UI update with rollback: apply change immediately, call IPC, revert on rejection — no confirmation spinner needed.
  - Module-level TTL cache for IPC calls that return stable data: avoids repeated round-trips within a short window.
observability_surfaces:
  - setModel call errors caught and logged via console.error in SessionHeaderBar handleModelSelected
drill_down_paths:
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S02-T01-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S02-T02-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S02-T03-SUMMARY.md
  - .gsd/phases/05-model-picker-context-gauge-copilot-quota/S02-T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-07-21T18:56:16.487Z
blocker_discovered: false
---

# S02: Model picker dropdown

**ModelPickerDropdown wired into SessionHeaderBar with optimistic setModel, grouped provider list, rollback on error, and 672 tests passing.**

## What Happened

T01 introduced a `useAvailableModels` hook with a module-level 60-second TTL cache and 13 unit tests. Fetch is caller-triggered (not on mount) so the IPC channel is only hit when the dropdown opens; failed fetches are not cached so the user can retry.

T02 built `ModelPickerDropdown` as a self-contained Radix DropdownMenu component. Two pure helpers — `formatContextWindow` and `groupAndSortModels` — were exported and tested in isolation in the Node environment (40 tests). The test file extension was changed from `.test.tsx` to `.test.ts` to match the vitest include glob; no JSX is needed in the test file.

T03 replaced the plain `<span>` in `SessionHeaderBar` with `ModelPickerDropdown`. `handleModelSelected` uses `useCallback([sessionId, model])` so the rollback closure always captures the pre-optimistic model. Confirmation of the new model is deferred to the next `execution_complete` → `fetchModel()` cycle, matching the slice spec and avoiding a second optimistic-update conflict. A pre-existing TS2353 in `handlers.test.ts` (manager type annotation missing four methods from earlier milestones) was fixed here as a minor deviation since it blocked `pnpm tsc --noEmit`.

T04 completed the mock surface: `getAvailableModels` and `setModel` were added to `makeMockClient` in `session-manager.test.ts` and to the manager mock type/init in `handlers.test.ts`. Final run: 28 test files, 672 tests, all passed.

## Verification

passed

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

T02: Test file extension changed from .test.tsx to .test.ts (plan said .tsx) to match vitest include glob — semantically equivalent, no JSX in file.
T03: Fixed pre-existing TS2353 in handlers.test.ts (manager type missing 4 methods from earlier milestones) as a minor deviation since it blocked pnpm tsc --noEmit.

## Known Limitations

No live Electron integration test — all coverage is via unit tests with IPC mocks. Playwright e2e for the picker is deferred.

## Follow-ups

Add Playwright e2e spec for the model picker dropdown in a future test-hardening slice.

## Files Created/Modified

- `renderer/hooks/useAvailableModels.ts` — New hook: fetches available models via IPC with module-level 60s TTL cache
- `renderer/hooks/useAvailableModels.test.ts` — 13 unit tests for the hook and cache logic
- `renderer/components/ModelPickerDropdown.tsx` — New component: Radix DropdownMenu grouped by provider with formatContextWindow and groupAndSortModels helpers
- `renderer/components/ModelPickerDropdown.test.ts` — 40 unit tests for helpers and component logic
- `renderer/components/SessionHeaderBar.tsx` — Replaced plain model span with ModelPickerDropdown; added optimistic setModel + rollback
- `renderer/components/SessionView.test.ts` — Updated to cover SessionHeaderBar with picker
- `main/session/session-manager.test.ts` — Added getAvailableModels and setModel to makeMockClient
- `main/ipc/handlers.test.ts` — Added getAvailableModels and setModel to manager mock type and init; fixed pre-existing TS2353

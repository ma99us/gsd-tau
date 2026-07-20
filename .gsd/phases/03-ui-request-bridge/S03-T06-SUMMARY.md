---
id: T06
parent: S03
milestone: M003
key_files:
  - renderer/components/modals/SelectModal.tsx
  - renderer/components/modals/SelectModal.test.ts
  - vitest.config.ts
key_decisions:
  - options: string[] not object[] — preview field from the plan is absent in rpc.d.ts; not implemented
  - Pure helpers buildSelectResponse and toggleOption exported from component for testable pure-function unit tests
  - mousedown used for backdrop cancel instead of click to avoid drag-release false dismissals
  - vitest.config.ts include extended to renderer/components/**/*.test.ts
duration: 
verification_result: passed
completed_at: 2026-07-20T19:03:40.791Z
blocker_discovered: false
---

# T06: Implemented SelectModal with radio/checkbox UI, focus trap, keyboard cancel, and 20 passing pure-function tests

**Implemented SelectModal with radio/checkbox UI, focus trap, keyboard cancel, and 20 passing pure-function tests**

## What Happened

Created `renderer/components/modals/SelectModal.tsx` implementing pi's `select` extension UI request modal. The component renders radio buttons for single-select (default) or checkboxes when `allowMultiple: true`. A Confirm button (disabled until a selection is made) sends `{ value }` (single) or `{ values: string[] }` (multi). Cancel and Escape both send `{ cancelled: true }`. Clicking the backdrop also cancels via a `mousedown` handler (rather than `click`, to avoid accidental dismissal on drag-out gestures).

Focus is trapped inside the dialog via a `useEffect` that attaches a `keydown` listener on the dialog container: Tab/Shift+Tab cycle through focusable children, Escape cancels. Initial focus is set to the dialog container on mount so keyboard navigation works immediately.

Two pure helper functions were extracted for unit testability: `buildSelectResponse` (builds the `UiResponseInput` payload from the selection Set) and `toggleOption` (single replaces; multi toggles, never mutates the original Set). These are exported from the component file.

`vitest.config.ts` was updated to add `renderer/components/**/*.test.ts` to the include list so the new test file is picked up by the test runner.

**Deviation noted:** The slice plan mentions a "preview field (markdown) shown alongside the option when present." The RPC contract (`rpc.d.ts`) defines `options` as `string[]` with no preview field — this feature is not present in the actual pi protocol and was not implemented. The component is fully correct against the contract as it exists.

**Pre-existing failures:** `main/pi/client-factory.test.ts` has 15 failing tests due to a missing `resolveSystemNode` export in a vi.mock — these exist in the repo before this task and are unrelated to T06.

## Verification

Ran `npx vitest run renderer/components/modals/SelectModal.test.ts --reporter=verbose`. All 20 tests pass: 8 for `buildSelectResponse` (null on empty, single `{value}`, multi `{values}`, order preservation, special chars) and 12 for `toggleOption` (single replaces, multi toggles, 3 immutability assertions, boundary cases). Also confirmed the full test suite still shows the same pre-existing failure count — no regressions introduced.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx vitest run renderer/components/modals/SelectModal.test.ts --reporter=verbose` | 0 | ✅ pass — 20/20 tests pass (8 buildSelectResponse + 12 toggleOption) | 472ms |

## Deviations

Preview field (markdown alongside each option) mentioned in the plan is not present in the `RpcExtensionUIRequest.select` contract (`options: string[]`). Not implemented — the contract is the ground truth.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/modals/SelectModal.tsx`
- `renderer/components/modals/SelectModal.test.ts`
- `vitest.config.ts`

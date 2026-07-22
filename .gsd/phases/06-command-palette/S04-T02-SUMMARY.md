---
id: T02
parent: S04
milestone: M006
key_files:
  - renderer/components/ModelPickerDropdown.tsx
  - renderer/components/SessionHeaderBar.tsx
  - renderer/components/ModelPickerDropdown.test.ts
key_decisions:
  - Renamed internal state from [open, setOpen] to [internalOpen, setInternalOpen] to prevent prop/state shadowing after adding the open prop.
  - forcePickerOpen is a one-directional trigger (only reacts when true) — App.tsx fires it and never needs to reset it; Radix fires onOpenChange(false) to close, which clears pickerOpen naturally.
  - fetch() is called unconditionally on open regardless of controlled/uncontrolled mode, so the model list loads whether triggered by click or Ctrl+.
duration: 
verification_result: passed
completed_at: 2026-07-22T12:56:04.982Z
blocker_discovered: false
---

# T02: ModelPickerDropdown gains controlled-open props (open/onOpenChange); SessionHeaderBar gains forcePickerOpen with pickerOpen state sync; 6 controlled-open tests added — 46/46 pass

**ModelPickerDropdown gains controlled-open props (open/onOpenChange); SessionHeaderBar gains forcePickerOpen with pickerOpen state sync; 6 controlled-open tests added — 46/46 pass**

## What Happened


**ModelPickerDropdown.tsx**
- Added `open?: boolean` and `onOpenChange?: (open: boolean) => void` to `ModelPickerDropdownProps`.
- Renamed internal `[open, setOpen]` state to `[internalOpen, setInternalOpen]` to eliminate prop/state shadowing.
- Derived `isControlled = (controlledOpen !== undefined)` and `effectiveOpen = isControlled ? controlledOpen : internalOpen`.
- In `handleOpenChange`: when controlled, delegates to `onControlledOpenChange?.(nextOpen)` instead of updating internal state; `fetch()` is always called on open regardless of mode.
- `DropdownMenu.Root` now receives `open={effectiveOpen}`.

**SessionHeaderBar.tsx**
- Added `forcePickerOpen?: boolean` to `SessionHeaderBarProps` (used by App.tsx Ctrl+. handler in T03).
- Added `const [pickerOpen, setPickerOpen] = useState(false)`.
- Added `useEffect(() => { if (forcePickerOpen) setPickerOpen(true) }, [forcePickerOpen])` — one-directional sync so App.tsx does not need to reset the flag; the dropdown closes itself via `onOpenChange(false)`.
- `ModelPickerDropdown` receives `open={pickerOpen}` and `onOpenChange={setPickerOpen}`.

**ModelPickerDropdown.test.ts**
- Added 6 new tests inside the `ModelPickerDropdownProps` describe block:
  - `open` is absent/undefined in uncontrolled mode
  - `open=false` is valid (controlled, closed)
  - `open=true` is valid (controlled, open)
  - `onOpenChange` is absent in uncontrolled mode
  - `onOpenChange` is a callable function that receives a boolean
  - Structural distinction between controlled and uncontrolled modes
- Total: 46/46 tests pass.


## Verification

Ran `pnpm vitest run renderer/components/ModelPickerDropdown.test.ts` — 46 tests passed in 1.89 s (exit 0).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/components/ModelPickerDropdown.test.ts` | 0 | ✅ pass — 46/46 tests | 9019ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/ModelPickerDropdown.tsx`
- `renderer/components/SessionHeaderBar.tsx`
- `renderer/components/ModelPickerDropdown.test.ts`

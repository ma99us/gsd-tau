---
id: T03
parent: S04
milestone: M006
key_files:
  - renderer/App.tsx
  - renderer/components/SessionView.tsx
  - renderer/components/SessionView.test.ts
key_decisions:
  - composerRef is passed as null (not undefined) to inactive SessionViews so React explicitly detaches the ref — composerRef.current always targets the visible composer.
  - setForcePickerOpen(false) is called in a setTimeout after setForcePickerOpen(true) so that repeated Ctrl+. presses can re-trigger the SessionHeaderBar useEffect (same stable value won't re-fire a dependency-tracked effect).
  - e.key.toLowerCase() is used for letter shortcuts (P, K) to normalise case regardless of shiftKey state and keyboard layout.
  - !e.shiftKey guard on Ctrl+K prevents Ctrl+Shift+K from triggering the composer-focus shortcut.
duration: 
verification_result: passed
completed_at: 2026-07-22T13:04:42.653Z
blocker_discovered: false
---

# T03: CommandPalette mounted in App.tsx; Ctrl+Shift+P/Ctrl+K/Ctrl+. keyboard shortcuts wired; composerRef and forcePickerOpen threaded through SessionView; 13 tests added — 1002/1002 pass

**CommandPalette mounted in App.tsx; Ctrl+Shift+P/Ctrl+K/Ctrl+. keyboard shortcuts wired; composerRef and forcePickerOpen threaded through SessionView; 13 tests added — 1002/1002 pass**

## What Happened


### What was implemented

**`renderer/App.tsx`** (5 changes):
- Added `useRef` to the React import.
- Imported `type ComposerHandle` from `./components/Composer` and `CommandPalette` from `./components/CommandPalette`.
- Added three pieces of shortcut-wiring state: `paletteOpen` (bool), `forcePickerOpen` (bool), and `composerRef = useRef<ComposerHandle>(null)`.
- Added a `useEffect` keyboard handler (registered on `window`) for the three shortcuts:
  - **Ctrl+Shift+P** — `setPaletteOpen(true)`. Uses `e.key.toLowerCase() === 'p'` for layout-independence.
  - **Ctrl+K** — `composerRef.current?.focus()`. Optional chaining guards the null case (no active session). `!e.shiftKey` prevents Ctrl+Shift+K from firing this handler.
  - **Ctrl+.** — `setForcePickerOpen(true)`, then `setTimeout(() => setForcePickerOpen(false), 0)`. The reset is required because `SessionHeaderBar.useEffect([forcePickerOpen])` only fires when the value changes; leaving it `true` would prevent subsequent Ctrl+. presses from reopening the picker.
- Updated the `tabOrder.map` render to pass `composerRef={id === activeTabId ? composerRef : null}` and `forcePickerOpen={id === activeTabId ? forcePickerOpen : undefined}`. Inactive tabs receive `null` so React detaches the ref and `composerRef.current` always points to the visible composer.
- Mounted `<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} sessionId={activeTabId} />` after the `tabOrder.map` block. Radix Dialog portal-renders to `document.body` so placement in the JSX tree is cosmetic.

**`renderer/components/SessionView.tsx`** (6 changes):
- Added `type Ref` to the React import.
- Combined the `Composer` import to include `type ComposerHandle`.
- Added `composerRef?: Ref<ComposerHandle>` and `forcePickerOpen?: boolean` to `SessionViewProps` with JSDoc explaining their lifecycle.
- Updated the function destructuring to include both new props.
- Passed `forcePickerOpen={forcePickerOpen}` to `<SessionHeaderBar>` (SessionHeaderBar already supports it from T02).
- Passed `ref={composerRef}` to `<Composer>` (Composer already supports it from T01).

**`renderer/components/SessionView.test.ts`** (2 changes):
- Added 3 imports: `CommandPalette`, `type CommandPaletteProps`, `type ComposerHandle`.
- Added 4 test groups (13 tests total):
  - `SessionViewProps — optional wiring props (T03)`: 5 tests covering `composerRef` undefined/RefObject/null, `forcePickerOpen` undefined/true.
  - `SessionHeaderBarProps — forcePickerOpen`: 2 tests (undefined default, true trigger).
  - `CommandPalette — export guard (T03)`: 2 tests (is function, name check).
  - `CommandPaletteProps — interface contract (T03)`: 4 tests (open false/true, sessionId null, onClose callable).

### Key decisions
- `composerRef: null` for inactive tabs (not `undefined`) so React explicitly detaches the ref on tab switch, guaranteeing `composerRef.current` points only to the active composer.
- `setTimeout(() => setForcePickerOpen(false), 0)` is required to allow the same shortcut to re-trigger on repeated presses — a stable `true` value won't re-fire the `SessionHeaderBar.useEffect([forcePickerOpen])` dependency.
- `e.key.toLowerCase()` for letter keys to handle keyboard layout variations (the `shiftKey` state changes the character case but `toLowerCase()` normalises both).


## Verification

Ran `pnpm vitest run --reporter=verbose` via gsd_exec. Exit code 0. 38 test suites, 1002 tests — all passed in 5.10s. No regressions. The 13 new tests in SessionView.test.ts cover the new SessionViewProps optional props (composerRef, forcePickerOpen), the SessionHeaderBarProps forcePickerOpen prop contract, and the CommandPalette/CommandPaletteProps export and interface contracts.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run --reporter=verbose` | 0 | ✅ pass — 1002/1002 tests, 38/38 suites | 5100ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `renderer/App.tsx`
- `renderer/components/SessionView.tsx`
- `renderer/components/SessionView.test.ts`

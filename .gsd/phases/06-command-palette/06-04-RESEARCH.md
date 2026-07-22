# S04: Keyboard Shortcut Wiring and Palette Integration — Research

**Date:** 2026-07-22

## Summary

S04 wires three keyboard shortcuts (`Ctrl+Shift+P`, `Ctrl+K`, `Ctrl+.`) into the running app and mounts the `CommandPalette` component (delivered by S03) at the right location in the component tree. The work is low-risk and entirely within the renderer — no new IPC channels needed.

`CommandPalette` already accepts `open`/`onClose`/`sessionId` props and is ready to mount. The only non-trivial changes are (a) making `Composer` expose a `focus()` imperative handle and (b) making `ModelPickerDropdown` accept an optional controlled `open` prop so `Ctrl+.` can open it programmatically.

The natural decomposition is: mount CommandPalette in `App.tsx` + window-level keydown listener for `Ctrl+Shift+P`; put `Ctrl+K` and `Ctrl+.` listeners inside `SessionView` (guarded by `isActive`) to stay session-scoped; add `forwardRef` to `Composer`; add optional controlled open to `ModelPickerDropdown`.

## Recommendation

**Mount CommandPalette in App.tsx, use per-session listeners for Ctrl+K and Ctrl+.**

- `App.tsx`: Add `paletteOpen` state. Mount `<CommandPalette open={paletteOpen} onClose={...} sessionId={activeTabId} />` at the bottom of the JSX (after SessionViews). Add `window.addEventListener('keydown', ...)` in a `useEffect` to toggle on `Ctrl+Shift+P`.
- `SessionView.tsx`: Add a `window.addEventListener('keydown', ...)` guarded by `isActive` for `Ctrl+K` (focus Composer) and `Ctrl+.` (open ModelPickerDropdown). This naturally limits shortcuts to the active session.
- `Composer.tsx`: Convert to `forwardRef` and expose `{ focus(): void }` via `useImperativeHandle`. The internal `ref` on `<textarea>` is already there (`const ref = useRef<HTMLTextAreaElement>(null)`); just wrap in `forwardRef + useImperativeHandle`.
- `ModelPickerDropdown.tsx`: Add optional `open?: boolean` and `onOpenChange?: (v: boolean) => void` props. When provided, use them (controlled mode); when absent, keep existing internal state (uncontrolled). Radix `DropdownMenu.Root` already accepts `open`/`onOpenChange` — it's a one-line change.
- `SessionHeaderBar.tsx`: Accept an optional `forcePickerOpen?: boolean` prop. When it flips to `true`, call `setOpen(true)` via `useEffect`. This avoids exposing internal Radix state machine directly.

## Implementation Landscape

### Key Files

- `renderer/App.tsx` — Mount `CommandPalette`; add `paletteOpen` state; add global `Ctrl+Shift+P` keydown listener in a `useEffect`.
- `renderer/components/CommandPalette.tsx` — No changes needed; `open`/`onClose`/`sessionId` props already exist.
- `renderer/components/Composer.tsx` — Convert `function Composer(...)` to `forwardRef`; add `useImperativeHandle` exposing `focus()`. The `ref` on the textarea is already `const ref = useRef<HTMLTextAreaElement>(null)`.
- `renderer/components/SessionView.tsx` — Accept `ComposerHandle` ref; add `isActive`-guarded keydown listener for `Ctrl+K` (calls `composerRef.current.focus()`) and `Ctrl+.` (sets local `forcePickerOpen` state → passed as prop to SessionHeaderBar).
- `renderer/components/SessionHeaderBar.tsx` — Accept `forcePickerOpen?: boolean` prop; `useEffect(() => { if (forcePickerOpen) setOpen(true) }, [forcePickerOpen])`.
- `renderer/components/ModelPickerDropdown.tsx` — Promote internal `open` state to semi-controlled: accept optional `open`/`onOpenChange`; merge with internal state via Radix's native controlled API.

### Build Order

1. **Composer forwardRef + useImperativeHandle** — unblocks `Ctrl+K` wiring. Isolated change, easy to verify with vitest.
2. **ModelPickerDropdown controlled open props** — unblocks `Ctrl+.` wiring. Add `forcePickerOpen` to SessionHeaderBar next.
3. **App.tsx: mount CommandPalette + Ctrl+Shift+P listener** — highest visibility, last so the component tree is wired up first.
4. **SessionView.tsx: Ctrl+K and Ctrl+. listeners** — assemble after the above pieces are ready.

### Verification Approach

- `pnpm vitest run` — all 859+ existing tests still pass (no regressions).
- New unit tests: Composer forwardRef exposes `focus()`; ModelPickerDropdown opens when `open=true` is passed.
- Manual smoke: In running app (`pnpm dev`):
  - `Ctrl+Shift+P` opens the overlay from any focused state.
  - `Ctrl+K` moves focus to the composer textarea (cursor visible).
  - `Ctrl+.` opens the ModelPickerDropdown chip.
  - Escape dismisses the palette.

## Constraints

- `Composer` currently uses `function Composer(...)` (not `forwardRef`) — must be converted carefully; `ComposerProps` interface must be preserved.
- `SessionView` renders ALL sessions always (`display:none` for inactive). The `isActive` guard in the keydown `useEffect` is mandatory — otherwise inactive sessions respond to shortcuts.
- Radix `DropdownMenu.Root` supports `open`/`onOpenChange` for controlled mode — no workaround needed.
- Do NOT use Electron `globalShortcut` (main process) — these are in-window shortcuts, not system-global. A `window.addEventListener('keydown')` in the renderer is correct.

## Common Pitfalls

- **Double-firing on inactive sessions** — All `window.addEventListener` keydown listeners in SessionView must be `return`-ed if `!isActive`. Without this, all sessions handle the same keypress.
- **Default browser behaviour for Ctrl+K** — Browsers treat Ctrl+K as a focus-URL-bar shortcut; call `e.preventDefault()` before focusing the textarea.
- **Ctrl+. conflicts** — No known browser default for Ctrl+. on Windows; safe to use as-is.
- **CommandPalette sessionId on empty tab state** — When `activeTabId` is `null` (no open sessions, landing screen), pass `sessionId={null}` to CommandPalette. `useAppCommands` already handles `null` by returning session-scoped commands as empty.

# M006: Command Palette

**Vision:** A global Ctrl+Shift+P overlay that merges static app commands with pi slash commands (fetched via get_commands RPC), delivering fuzzy-matched, MRU-boosted, keyboard-navigable command dispatch. Wires the full v1 keyboard shortcut baseline alongside it.

## Success Criteria

- Ctrl+Shift+P opens the palette from any focused state in the app
- App commands (New session, Open project, Close tab, Compact context, etc.) are listed and executable
- Pi slash commands from get_commands appear with source badge (extension/prompt/skill), fuzzy-match filters them, selecting one sends /commandName as a prompt
- Arrow-key nav + Enter to confirm + Escape to dismiss works correctly
- MRU ordering — recently used commands float to the top
- Ctrl+. opens the model picker chip (links to existing ModelPickerDropdown)
- Ctrl+K focuses the composer textarea
- All 859 existing unit tests still pass; new palette component has unit tests covering fuzzy match, MRU, keyboard nav, and app command execution

## Slices

- [x] **S01: Fuzzy match engine and MRU hook** `risk:low` `depends:[]`
  > After this: vitest run passes; fuzzy('cp', 'compact context') scores higher than fuzzy('cp', 'open project'); MRU hook round-trips through localStorage.

- [x] **S02: App command registry** `risk:low` `depends:[S01]`
  > After this: useAppCommands(sessionId) returns a typed array; 'new-session', 'open-project', 'close-tab', 'compact-context', 'copy-last-turn', 'show-tray', 'toggle-auto-run-panel' entries present.

- [x] **S03: CommandPalette overlay component** `risk:medium` `depends:[S01,S02]`
  > After this: Storybook/vitest-component: open palette, type 'comp', 'Compact context' floats to top, Enter fires execute(), palette closes.

- [x] **S04: Keyboard shortcut wiring and palette integration** `risk:low` `depends:[S03]`
  > After this: In the running app: Ctrl+Shift+P opens palette; Ctrl+K moves focus to composer textarea; Ctrl+. triggers the model picker dropdown open state.

- [ ] **S05: Pi slash commands in palette and regression check** `risk:medium` `depends:[S04]`
  > After this: In the running app with a live pi session: open palette, type '/gsd', the /gsd skill appears with its description and 'skill' badge; pressing Enter sends '/gsd' to pi.

## Boundary Map

Not provided.

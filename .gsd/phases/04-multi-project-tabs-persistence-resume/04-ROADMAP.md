# M004: Multi-project Tabs, Persistence, Resume

**Vision:** A real multi-project desktop shell that survives reboots. Users can have multiple pi sessions open simultaneously and return to their work exactly where they left off.

## Success Criteria

- Tab bar with multiple concurrent sessions
- All sessions survive app quit and reboot
- Open Project flyout with recents and folder picker
- Single-instance: second launch opens a tab, not a second window
- Playwright 3-tab reboot test passes

## Slices

- [x] **S01: Registry Store and Schema Types** `risk:medium` `depends:[]`
  > After this: Unit tests: write registry, kill process mid-write, relaunch reads .bak, no data loss.

- [x] **S02: Multi-session SessionManager and Registry Integration** `risk:high` `depends:[S01]`
  > After this: Three sessions open simultaneously; registry reflects all three; registry survives app kill.

- [x] **S03: Single-instance Lock, IPC Upgrade, Zustand Store** `risk:low` `depends:[S02]`
  > After this: Second app instance with --open-project opens a new tab in the first and exits.

- [x] **S04: Tab Bar and Open Project Flyout** `risk:low` `depends:[S03]`
  > After this: Tab bar with three projects; reorder by drag; right-click menu works; Open Project flyout shows recents.

- [ ] **S05: Restore Flow, Missing-file Banner, Window Bounds, Tests** `risk:medium` `depends:[S04]`
  > After this: Playwright test: open 3 tabs, quit, relaunch, all 3 restore with history.

## Boundary Map

Not provided.

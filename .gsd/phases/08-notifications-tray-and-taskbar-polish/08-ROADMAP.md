# M008: Notifications, Tray, and Taskbar Polish

**Vision:** Full Windows notification surface: expanded toast coverage (Stopped + milestone complete), always-on system tray with aggregate state badge, per-window taskbar overlay icons, and close-last-window → minimize-to-tray behaviour. Satisfies R3 (full).

## Success Criteria

- Windows toast fires on Stopped transition and milestone complete in addition to Waiting blocker
- System tray icon always present while app is running, state badge updates in real time
- Close last window minimizes to tray; sessions continue running; explicit Quit shuts down cleanly
- Taskbar overlay icon per window reflects max-severity session state
- All existing 1184+ tests still pass; new unit tests cover all new logic paths

## Slices

- [x] **S01: Expand toast coverage to Stopped and milestone complete** `risk:low` `depends:[]`
  > After this: Session crashes → Stopped toast appears. gsd_complete_milestone tool fires → milestone-complete toast appears. Blocker toast still works.

- [ ] **S02: System tray icon with state badge** `risk:medium` `depends:[S01]`
  > After this: App launches with tray icon. Open two sessions — one Working, one Waiting. Tray goes red with count 1. Resolve blocker → back to blue. Right-click shows session list.

- [ ] **S03: Close-last-window minimizes to tray** `risk:low` `depends:[S02]`
  > After this: Close all windows via X button → app stays in tray, sessions running. File > Quit → app exits and sessions are shut down.

- [ ] **S04: Taskbar overlay icons per window** `risk:low` `depends:[S02]`
  > After this: Window with a Waiting session gets a red dot on its taskbar entry. Resolving the blocker clears it to blue or grey.

## Boundary Map

Not provided.

# M002: Session Manager and Minimal Shell

**Vision:** A running Electron app that spawns a pi child for one project, streams every RPC event to a chat pane, and shuts down cleanly. Proves the core loop end-to-end before any UI polish.

## Success Criteria

- pnpm dev boots to an Electron window
- User can pick a folder, send a message, and see a streamed assistant response
- Tool cards appear for read/write/bash events
- Window close terminates the pi child within 3s — verified in Task Manager
- Playwright smoke test passes 10 consecutive runs
- Zero unhandled promise rejections in the main-process log

## Slices

- [x] **S01: Project Scaffold and Tooling** `risk:low` `depends:[]`
  > After this: pnpm dev opens an empty Electron window. pnpm test passes. pnpm lint passes.

- [x] **S02: pi Client and Event Pump** `risk:high` `depends:[S01]`
  > After this: Node script opens a client, sends a prompt, prints every event to stdout, closes cleanly.

- [x] **S03: Session State Machine and Manager** `risk:medium` `depends:[S02]`
  > After this: State machine unit tests pass for all valid transitions.

- [ ] **S04: IPC Bridge and Preload** `risk:medium` `depends:[S03]`
  > After this: DevTools console: window.gsd.prompt('hello') returns a response streamed via events.

- [ ] **S05: Renderer Chat View** `risk:low` `depends:[S04]`
  > After this: Full chat turn visible: user message, streaming assistant text, tool card.

- [ ] **S06: Shutdown and Smoke Test** `risk:medium` `depends:[S05]`
  > After this: Playwright test run passes 10 consecutive times.

## Boundary Map

Not provided.

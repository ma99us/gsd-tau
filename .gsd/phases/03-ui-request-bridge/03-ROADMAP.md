# M003: UI-request Bridge

**Vision:** Every pi question reaches the user as a native modal. The app is usable for real pi workflows end-to-end. Sessions never hang.

## Success Criteria

- Every extension_ui_request method handled with a correct modal
- Session state transitions Working → Waiting on you → Working correctly
- Shutdown with open blockers: pi receives cancellations and exits cleanly
- Windows toast fires within 500ms of blocker arrival
- Playwright test suite green

## Slices

- [x] **S01: Contract Types and BlockerTracker** `risk:medium` `depends:[]`
  > After this: Session state shows Waiting on you in DevTools when a blocker is injected via mock.

- [x] **S02: IPC Handler and Windows Notifications** `risk:medium` `depends:[S01]`
  > After this: Windows toast appears when a blocker is injected; respondUI IPC call clears it.

- [x] **S03: Modal Components** `risk:low` `depends:[S02]`
  > After this: All four modal types render and respond using a mock pi that emits each request type.

- [x] **S04: Non-modal Renderers and Modal Queue** `risk:low` `depends:[S03]`
  > After this: notify, setStatus, setWidget all render without a modal. Two simultaneous blockers show queue depth badge.

- [x] **S05: Shutdown Cancellation and Playwright Tests** `risk:medium` `depends:[S04]`
  > After this: Playwright test run passes covering all methods and the shutdown-cancel path.

- [x] **S06: Playwright Pipeline Fix and Toast SLA Remediation** `risk:medium` `depends:[S05]`
  > After this: After this: All 7 Playwright e2e tests pass with non-undefined modal responses; Windows toast fires within 500ms or SLA updated with decision record; pnpm test:e2e runs clean after pnpm build.

## Boundary Map

Not provided.

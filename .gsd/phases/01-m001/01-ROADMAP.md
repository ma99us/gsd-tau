# M001: Auto-run Panel

**Vision:** Give users real-time visibility into `/gsd auto` sessions — milestone/slice/task tree updating live as pi works, Pause/Refresh controls, and correct state on reattach.

## Success Criteria

- Panel auto-shows when session enters Auto state and updates live as pi calls workflow tools
- Pause sends abort() + /gsd stop and session returns to idle within 10s
- Session reattach seeds panel state from Path B reconciliation (not blank)
- All 1184+ existing tests continue to pass with no regression

## Slices

- [ ] **S01: Verify and patch session-reattach Path B seeding** `risk:medium` `depends:[]`
  > After this: Run `pnpm test`; all tests pass. Read `doOpenProject` in handlers.ts and confirm a post-open reconcileProgress call exists (added or already present). Proof level: unit tests + code audit.

- [ ] **S02: End-to-end integration and acceptance verification** `risk:low` `depends:[S01]`
  > After this: Manual smoke: launch gsd-tau, open a project, run `/gsd auto`, observe panel appearing and task tree updating; press Pause and confirm pi winds down within 10s.

## Boundary Map

Not provided.

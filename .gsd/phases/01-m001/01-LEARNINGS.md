---
phase: "01-m001"
phase_name: "Auto-run Panel"
project: "gsd-tau"
generated: "2026-07-22T19:30:00.000Z"
counts:
  decisions: 2
  lessons: 3
  patterns: 2
  surprises: 1
missing_artifacts: []
---

# M001: Auto-run Panel — Learnings

### Decisions

- **Fire-and-forget async IIFE for open-time Path B seeding** — Chose to wrap `reconcileProgress` in a fire-and-forget `void (async () => {...})()` immediately after `progressTracker.on('updated')` wiring in `doOpenProject`. Errors are swallowed silently so new projects with no STATE.md are unaffected. Alternative (await the call) was rejected because it would block the IPC handler and fail for fresh projects with no STATE.md.
  Source: 01-01-SUMMARY.md/Key decisions

- **Discover milestoneId from STATE.md 'Active Milestone' line** — At open-time seeding, `ProgressTracker` has no milestone ID yet. Chose to read `{cwd}/.gsd/STATE.md` and extract the 'Active Milestone' line as the ID source. This avoids coupling `ProgressTracker` to milestone ID at construction time and handles the case where the user opens a project mid-milestone.
  Source: 01-01-SUMMARY.md/Key decisions

### Lessons

- **Source file paths in plan may omit `src/` prefix** — The original S01 plan listed `src/main/ipc/handlers.ts`; the actual path is `main/ipc/handlers.ts` (no `src/` prefix). Always verify actual project file layout before editing rather than trusting plan-authored paths verbatim.
  Source: 01-01-SUMMARY.md/Deviations

- **`vi.runAllTimersAsync()` needed after dispatching OPEN_PROJECT** — The void seeding IIFE in `doOpenProject` is asynchronous. Without draining the microtask queue via `vi.runAllTimersAsync()` after dispatching `OPEN_PROJECT`, assertions on mock call counts fail non-deterministically. This is required in any test that exercises fire-and-forget async side effects triggered by IPC handler dispatch.
  Source: 01-02-SUMMARY.md/Key decisions

- **`vi.mocked()` for type-safe mock setup** — Using `vi.mocked(fn)` is safer than double-casting `as ReturnType<typeof vi.fn>` for setting up mocked function behavior. Avoids TypeScript errors and ensures mock types stay in sync with the real module signature.
  Source: 01-02-SUMMARY.md/Key decisions

### Patterns

- **Fire-and-forget IIFE for open-time async seeding** — Wrap background async work at IPC handler open-time in `void (async () => { try { ... } catch {} })()`. Errors are swallowed so the happy-path IPC handler is never blocked. Guard downstream consumers with a `hasData` check before applying reconciliation results.
  Source: 01-01-SUMMARY.md/Patterns established

- **Module-level mock hoisting + vi.runAllTimersAsync() for async IIFE tests** — Hoist module mocks at the module level (avoid per-test setup overhead), then call `vi.runAllTimersAsync()` after the triggering dispatch to drain the void IIFE before asserting mock call counts. Applies to any test exercising fire-and-forget async side effects.
  Source: 01-02-SUMMARY.md/Patterns established

### Surprises

- **T03 manual acceptance (NEEDS-HUMAN) resolved by live UI validation session** — S02's T03 was flagged NEEDS-HUMAN because automated tests cannot cover the Electron renderer layer. The validation run resolved this by running a live `/gsd auto` session: Abort button appeared, GSD workflow tools fired (`gsd_summary_save` confirmed), and the session returned to idle. The SelectModal dialogs appeared live during pi tool calls. No blocking issues surfaced.
  Source: 01-VALIDATION.md/Verdict Rationale

---
phase: "05"
phase_name: "Model Picker, Context Gauge, Copilot Quota"
project: "gsd-tau"
generated: "2026-07-21T21:30:00.000Z"
counts:
  decisions: 7
  lessons: 6
  patterns: 5
  surprises: 3
missing_artifacts: []
---

# M005 Learnings

### Decisions

- **SessionHeaderBar uses local component state (not Zustand) for model+cost.** Fast reactive updates without store coupling; avoids unnecessary global state churn for high-frequency cost_update events.
  Source: 05-01-SUMMARY.md/Key decisions

- **Fetch is caller-triggered (not useEffect on mount) for available models.** Avoids hammering IPC on every render — models list only fetched when picker opens. Module-level 60s TTL cache persists across open/close cycles.
  Source: 05-02-SUMMARY.md/Key decisions

- **ThinkingLevel defined locally in shared/types.ts — not imported from @opengsd/contracts.** The contracts package does not export it from its index; local definition prevents build-time coupling to a private contracts surface.
  Source: 05-03-SUMMARY.md/Key decisions

- **Inline controlled-div popover used instead of @radix-ui/react-popover.** The package was assumed present by the research doc but is absent from package.json. Inline div satisfies all spec requirements (breakdown, Compact button, click-to-open, colour coding) without a new dependency.
  Source: 05-04-SUMMARY.md/Deviations

- **QUOTA_UPDATE_CHANNEL exported from quota-service.ts (not handlers.ts) to prevent circular imports.** handlers.ts imports quota-service.ts; exporting from the service avoids a circular dependency chain.
  Source: 05-05-SUMMARY.md/Key decisions

- **quotaService passed as optional 6th parameter to registerHandlers().** Quota channels share the existing cleanup() lifecycle without requiring a separate service registry.
  Source: 05-05-SUMMARY.md/Key decisions

- **QuotaWidget has no sessionId prop — quota is account-wide, service fans out to all renderers.** Quota is a GitHub account-level resource; attaching it to a session would be misleading and would duplicate polling.
  Source: 05-05-SUMMARY.md/Key decisions

### Lessons

- **@opengsd/contracts does not export ThinkingLevel from its index.** When adding new IPC-backed types, check the contracts package index before assuming a type is available; define locally in shared/types.ts if absent.
  Source: 05-03-SUMMARY.md/Key decisions

- **Test file extension matters for vitest include glob.** `.test.tsx` vs `.test.ts` is not semantically equivalent — vitest includes are glob-matched. ModelPickerDropdown test was changed from .test.tsx to .test.ts because JSX was not needed; ensure test file extensions match the configured vitest include pattern.
  Source: 05-02-SUMMARY.md/Deviations

- **pnpm v11 blocks build scripts by default (ERR_PNPM_IGNORED_BUILDS).** The `pnpm.onlyBuiltDependencies` field is ignored; must list allowed build-script packages explicitly in pnpm settings to unblock electron/esbuild.
  Source: last-snapshot.md/MEM004

- **RpcClient.start() expects a .js file path, not a .cmd wrapper.** On Windows, resolvePiBinary() must return the JS entry path (e.g. loader.js in the gsd-pi dist/), not gsd.cmd. Derive it from the .cmd sibling directory.
  Source: last-snapshot.md/MEM005

- **pi message_update event: text deltas are nested at event.assistantMessageEvent.delta.** The top-level event does not carry text. text_start duplicates the first token and must be skipped; only text_delta carries new content.
  Source: last-snapshot.md/MEM007

- **For every turn pi emits both agent_start AND turn_start (and message_start per message).** Treating all three as turn-open signals creates duplicate empty "Thinking…" placeholders. Fix: only dispatch AGENT_START when currentAssistantId.current === null.
  Source: last-snapshot.md/MEM008

### Patterns

- **Optimistic UI update with rollback for IPC-backed state.** Apply change immediately to local state, call IPC, revert on rejection. No confirmation spinner needed. Used for both model selection (S02) and thinking level (S03).
  Source: 05-02-SUMMARY.md/Patterns established

- **Module-level TTL cache for stable IPC calls.** Cache persists across component mount/unmount cycles within the TTL window, preventing repeated IPC round-trips for data that rarely changes (e.g. available models list).
  Source: 05-02-SUMMARY.md/Patterns established

- **Export pure helpers from components for Node-env unit testing.** Pure reducer/helper functions (formatContextWindow, groupAndSortModels) are exported so they can be unit-tested without DOM or Radix dependencies. Mirrors the StatusBar.tsx pattern.
  Source: 05-02-SUMMARY.md/Patterns established

- **Main-process singleton service pattern.** Service instantiated in main/index.ts, passed to registerHandlers(), cleans up via existing cleanup(). Used for QuotaService; applicable to any always-on background polling service.
  Source: 05-05-SUMMARY.md/Patterns established

- **Atomic-write persistence pattern.** Write to .tmp then rename for crash-safe file persistence. Used in quota-history.ts; applicable to any JSON state file written from main process.
  Source: 05-05-SUMMARY.md/Patterns established

### Surprises

- **@radix-ui/react-popover was not in package.json despite being referenced in the research doc.** Discovered during S04 implementation; required an inline controlled-div fallback to avoid adding a new dependency mid-slice.
  Source: 05-04-SUMMARY.md/Deviations

- **TS2353 pre-existing failures in handlers.test.ts** were surfaced as a side-effect of S02's full tsc --noEmit run. The mock manager type was missing 4 methods added by earlier milestones. Fixed as a minor deviation since it blocked the TypeScript clean gate.
  Source: 05-02-SUMMARY.md/Deviations

- **The "Thinking…" spinner bug** (spinner persisting after turn completion) was discovered during S05 validation and required a TURN_COMPLETE action dispatch on turn_end plus a TurnList guard on !turn.completed. Not originally scoped to M005.
  Source: 05-VALIDATION.md/Success Criteria Checklist

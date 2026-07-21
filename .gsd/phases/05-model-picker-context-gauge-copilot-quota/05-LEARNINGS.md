---
phase: "M005"
phase_name: "Model Picker, Context Gauge, Copilot Quota"
project: "gsd-tau"
generated: "2026-07-21T21:15:00.000Z"
counts:
  decisions: 6
  lessons: 5
  patterns: 5
  surprises: 3
missing_artifacts: []
---

# M005 Learnings

### Decisions

- **Local component state for model/cost in SessionHeaderBar** — chose local React state (not Zustand) for model chip and cost display; fast reactive updates without store coupling, avoids unnecessary re-renders of unrelated UI.
  Source: 05-01-SUMMARY.md/Key decisions

- **Fetch-on-open for available models (not useEffect mount)** — ModelPickerDropdown triggers IPC fetch only when the dropdown opens, with a 60s module-level TTL cache; avoids hammering IPC on every render cycle.
  Source: 05-02-SUMMARY.md/Key decisions

- **ThinkingLevel defined locally in shared/types.ts** — @opengsd/contracts does not export ThinkingLevel from its index; defined locally to avoid runtime-import coupling with pi internals.
  Source: 05-03-SUMMARY.md/Key decisions

- **Inline div popover instead of @radix-ui/react-popover** — @radix-ui/react-popover was not in package.json; replaced with a controlled-div popover; all spec requirements (breakdown, Compact button, click-to-open, colour coding, fallback) satisfied without a new dependency.
  Source: 05-04-SUMMARY.md/Key decisions

- **QUOTA_UPDATE_CHANNEL exported from quota-service.ts (not handlers.ts)** — prevents circular imports; handlers.ts imports from quota-service.ts, not the other way around.
  Source: 05-05-SUMMARY.md/Key decisions

- **QuotaService passed as optional 6th parameter to registerHandlers()** — quota channels share the existing cleanup() lifecycle; no separate registration or teardown path needed.
  Source: 05-05-SUMMARY.md/Key decisions

### Lessons

- **cumulativeCost from RpcCostUpdateEvent must be used directly (not summing turnCost)** — summing individual turn costs drifts when events are missed; the server-provided cumulative value is authoritative and prevents display drift.
  Source: 05-01-SUMMARY.md/Key decisions

- **Test file extension matters for vitest glob** — vitest include glob matched `.test.ts` but not `.test.tsx` when no JSX was used; changing extension from .test.tsx to .test.ts resolved the test not being picked up.
  Source: 05-02-SUMMARY.md/Deviations

- **fs.watchFile (polling) is more reliable than fs.watch on Windows for single slow-moving files** — fs.watch can silently miss events on some Windows filesystem configurations; fs.watchFile polling is the safe default for monitoring credential files like gh-auth.json.
  Source: 05-05-SUMMARY.md/Key decisions

- **DeviceCodeInfo must live in shared/types.ts, not main-process modules** — preload.ts cannot import from main-process modules; types shared between main and renderer must be defined in shared/.
  Source: 05-05-SUMMARY.md/Key decisions

- **TS2322 can surface in preload.ts from void arrow expressions without braces** — TypeScript type narrowing for void-returning arrow functions requires explicit braces `() => { fn() }` vs `() => fn()` when the return type matters in an IPC context.
  Source: 05-VALIDATION.md/Success Criteria Checklist

### Patterns

- **Optimistic-update + rollback pattern for IPC-backed UI state** — apply the UI change immediately on user action, call IPC, revert to prior value on rejection or null response; no confirmation spinner needed; established in S02 (model) and applied in S03 (thinking level).
  Source: 05-02-SUMMARY.md/Patterns established

- **Module-level TTL cache for stable IPC data** — a module-level cache with a TTL (e.g. 60s) avoids repeated IPC round-trips for data that changes infrequently (available models list); persists across component mount/unmount cycles.
  Source: 05-02-SUMMARY.md/Patterns established

- **Main-process singleton service: instantiate in main/index.ts, pass to registerHandlers(), clean up via existing cleanup()** — keeps service lifecycle tied to the app lifecycle without a separate teardown path; established by QuotaService in S05.
  Source: 05-05-SUMMARY.md/Patterns established

- **IPC push fan-out via getAllWebContents()** — main-process services that must push updates to all open renderers (quota, future cost broadcast) use webContents.getAllWebContents() on each poll/event cycle.
  Source: 05-05-SUMMARY.md/Patterns established

- **Atomic-write persistence: write to .tmp then rename** — guarantees quota-history.json (and similar files) are never left in a partially-written state; safe on Windows where rename is atomic at NTFS level.
  Source: 05-05-SUMMARY.md/Patterns established

### Surprises

- **@radix-ui/react-popover was assumed in the research doc but absent from package.json** — the design doc referenced Radix popover but it was never added as a dependency; discovered during S04 implementation. Replaced with an inline controlled-div popover.
  Source: 05-04-SUMMARY.md/Deviations

- **session-manager.test.ts had pre-existing type failures (TS2353) from earlier milestones** — earlier milestones left the mock manager type incomplete; surfaced when S02 ran full tsc --noEmit; fixed as a minor deviation since it blocked compilation.
  Source: 05-02-SUMMARY.md/Deviations

- **Routing SET_THINKING_LEVEL through SessionEntry closure capture (not SessionManager method)** — session-manager.ts was not in the task file list for S03 T02; the existing sendUIResponse delegation pattern was used instead; architecturally equivalent.
  Source: 05-03-SUMMARY.md/Deviations

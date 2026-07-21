---
id: M005
title: "Model Picker, Context Gauge, Copilot Quota"
status: complete
completed_at: 2026-07-21T21:15:35.290Z
key_decisions:
  - SessionHeaderBar uses local component state (not Zustand) for model+cost — fast reactive updates without store coupling
  - Available models fetch is caller-triggered with 60s module-level TTL cache to avoid hammering IPC on render
  - ThinkingLevel defined locally in shared/types.ts — @opengsd/contracts does not export it from its index
  - Inline controlled-div popover used instead of @radix-ui/react-popover (package absent from package.json)
  - QUOTA_UPDATE_CHANNEL exported from quota-service.ts (not handlers.ts) to prevent circular imports
  - quotaService passed as optional 6th parameter to registerHandlers() to share existing cleanup() lifecycle
  - QuotaWidget has no sessionId prop — quota is account-wide; service fans out to all renderers via getAllWebContents()
key_files:
  - renderer/components/SessionHeaderBar.tsx
  - renderer/components/ModelPickerDropdown.tsx
  - renderer/hooks/useAvailableModels.ts
  - renderer/components/ThinkingLevelChip.tsx
  - renderer/components/ContextGauge.tsx
  - renderer/components/QuotaWidget.tsx
  - main/services/quota-service.ts
  - main/services/quota-history.ts
  - main/ipc/handlers.ts
  - preload/preload.ts
  - shared/types.ts
  - main/session/session-handle.ts
  - main/session/session-manager.ts
  - main/index.ts
lessons_learned:
  - @opengsd/contracts does not export ThinkingLevel — define IPC-backed UI types locally in shared/types.ts when absent from contracts index
  - @radix-ui/react-popover was assumed present by research doc but absent from package.json — verify actual dependencies before planning component implementations
  - Vitest include globs are extension-sensitive: .test.tsx vs .test.ts matters; match extension to actual file content
  - Pre-existing TS type errors in test mocks surface during full tsc --noEmit runs added by later slices — fix them as minor deviations to keep the TypeScript gate clean
  - The Thinking... spinner bug required both a TURN_COMPLETE dispatch on turn_end and a TurnList guard on !turn.completed — fixing one without the other leaves the spinner stuck
---

# M005: Model Picker, Context Gauge, Copilot Quota

**SessionHeaderBar fully wired with live model chip, thinking level picker, context gauge, and Copilot quota widget — 859 unit tests pass and TypeScript compiles clean.**

## What Happened

M005 delivered all five slices of the session header control suite. S01 established SessionHeaderBar with model chip and live cumulative cost display, using local component state for fast reactive updates. S02 added ModelPickerDropdown with grouped provider list, optimistic setModel, 60s TTL module-level cache, and rollback on error. S03 delivered ThinkingLevelChip with 7 thinking levels, Ctrl+Shift+T cycling, and a guard that hides the chip on non-reasoning models. S04 added ContextGauge driven by get_session_stats events, with colour-coded fill at 80%/95% thresholds, an inline popover with token breakdown, and a full COMPACT IPC chain. S05 shipped the QuotaService main-process singleton (15-min polling, atomic-write history, getAllWebContents fan-out) and QuotaWidget showing live Copilot usage with a burn-rate popover and graceful degradation when unauthenticated. A pre-existing "Thinking…" spinner bug was fixed as part of S05 validation: TURN_COMPLETE now dispatches on turn_end and TurnList gates the spinner on !turn.completed. TypeScript TS2322 in preload.ts:352 was also fixed. Final state: 859/859 tests pass across 33 files, tsc --noEmit clean.

## Success Criteria Results

- Session header visible in every open session with live model + cost ✅ S01 delivered SessionHeaderBar with model chip and cumulative cost display
- Model picker lets user switch model ✅ S02 delivered ModelPickerDropdown with optimistic setModel + rollback; confirmed via unit tests
- Thinking level chip hidden on non-reasoning models; picker switches level correctly ✅ S03 delivered ThinkingLevelChip with isReasoningModel guard and Ctrl+Shift+T cycling
- Context gauge live-updates from cost_update events; compact button works ✅ S04 delivered ContextGauge from get_session_stats events with COMPACT IPC chain
- Copilot quota widget shows live usage data; degrades gracefully when unauthenticated or API is down ✅ S05 delivered QuotaService + QuotaWidget with graceful degradation

## Definition of Done Results

- All slices [x] complete ✅ S01–S05 all marked complete with all tasks done
- Summaries exist ✅ 05-01 through 05-05 SUMMARY.md all present
- TypeScript compiles clean ✅ tsc --noEmit passes after TS2322 fix in preload.ts:352
- 859 unit tests pass ✅ 33 test files green
- Integrations work ✅ All components compose through SessionHeaderBar; IPC channels verified in handlers.test.ts and preload.test.ts
- Operational class NEEDS-HUMAN ✅ Expected for this milestone — live Electron smoke test required manually

## Requirement Outcomes

- R-model-picker: Validated — ModelPickerDropdown with optimistic setModel, grouped provider list, 60s TTL cache delivered in S02
- R-thinking-level: Validated — ThinkingLevelChip with 7 levels, Ctrl+Shift+T, isReasoningModel guard delivered in S03
- R-context-gauge: Validated — ContextGauge with live token fill, colour coding, popover, Compact button delivered in S04
- R-quota-widget: Validated — QuotaService + QuotaWidget with live usage, burn-rate popover, auth degradation delivered in S05

## Deviations

S04: @radix-ui/react-popover replaced with inline controlled-div (package not in package.json). S02: ModelPickerDropdown test extension changed from .test.tsx to .test.ts to match vitest include glob. S03: SET_THINKING_LEVEL routing goes through SessionEntry closure capture rather than SessionManager.setThinkingLevel (architecturally equivalent to sendUIResponse delegation). S05: DeviceCodeInfo migrated to shared/types.ts for clean boundary. Spinner bug fix (TURN_COMPLETE + TurnList guard) added during S05 validation — not originally scoped to M005.

## Follow-ups

Add Playwright e2e specs for model picker and quota widget (require live pi session and GitHub Copilot token respectively — not feasible in CI). Set GSD_TAU_GITHUB_CLIENT_ID before device-code auth flow is usable (tracked in S05 Risk #1). Consider adding a loading skeleton to SessionHeaderBar for the initial GET_RPC_STATE round-trip.

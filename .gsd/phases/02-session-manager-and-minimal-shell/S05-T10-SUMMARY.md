---
id: T10
parent: S05
milestone: M002
key_files:
  - renderer/components/ToolCard.tsx
  - renderer/components/TurnList.tsx
  - renderer/components/ToolCard.test.ts
key_decisions:
  - Exported formatInputSummary and formatResult as named exports so pure unit tests cover formatting logic without requiring jsdom or @testing-library/react (neither is in devDependencies)
  - Expand/collapse guards against items with no expandable content by checking hasExpandableContent — avoids a dead chevron on empty-input tool calls
  - resultText gated on both !pending and result !== undefined to avoid showing an empty Result section during streaming
duration: 
verification_result: mixed
completed_at: 2026-07-20T15:18:02.928Z
blocker_discovered: false
---

# T10: ToolCard component implemented with expand/collapse, pending/result states, and exported helper functions covered by 22 unit tests

**ToolCard component implemented with expand/collapse, pending/result states, and exported helper functions covered by 22 unit tests**

## What Happened

Created `renderer/components/ToolCard.tsx` as a self-contained collapsible card for tool invocations. The component:

- Collapsed header: tool name (blue mono), status badge (`running…` animated while pending, `✓` on complete), 80-char truncated input JSON summary, chevron indicator.
- Expanded body: full pretty-printed input JSON (scrollable, max-h-48), result section (shown once `item.pending` is false and `item.result` is defined), "Waiting for result…" placeholder while pending.
- `data-tool-use-id` attribute on the root div for Playwright/E2E targeting.
- `aria-expanded` on the toggle button for accessibility.
- No external libraries — plain React + Tailwind only.

Two pure formatting helpers were exported so they can be unit-tested without a DOM environment:
- `formatInputSummary(input)` — JSON.stringify sliced to 80 chars, circular-ref safe.
- `formatResult(result)` — strings verbatim, objects/arrays pretty-printed, null/undefined → empty string.

Updated `renderer/components/TurnList.tsx` to import and delegate to `ToolCard` in `AssistantItemView`, removing the inline 20-line stub that T09 had left as a placeholder.

Added `renderer/components/ToolCard.test.ts` with 22 pure unit tests covering both helpers: null/undefined guards, serialisation of plain objects/arrays/primitives, 80-char truncation boundary, non-serialisable circular-ref fallback, multi-line string pass-through, pretty-print shape.

## Verification

TypeScript check (tsc --noEmit): no new errors introduced by T10; only pre-existing error in session-manager.test.ts remains (unrelated). Vitest run: 8 test files, 170 tests, all passed — includes the 22 new ToolCard tests covering formatInputSummary and formatResult edge cases.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 1 | ⚠ pre-existing failure in session-manager.test.ts only — no T10 regressions | 2904ms |
| 2 | `npx vitest run --passWithNoTests` | 0 | ✅ pass — 8 files, 170 tests, all passed | 2875ms |

## Deviations

None. Component, files, and tests match the task plan exactly.

## Known Issues

Pre-existing TypeScript error in `main/session/session-manager.test.ts` (Mock type mismatch on ClientFactory). This predates T10 and is not introduced by this task.

## Files Created/Modified

- `renderer/components/ToolCard.tsx`
- `renderer/components/TurnList.tsx`
- `renderer/components/ToolCard.test.ts`

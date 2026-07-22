# S03: AutoRunPanel React component — Research

**Date:** 2026-07-22

## Summary

S03 is a pure presentation slice: build `AutoRunPanel.tsx` as a controlled React component that accepts a `GsdProgress` prop and two callbacks (`onPause`, `onRefresh`). All types from `shared/types.ts` are already complete (S01). No IPC wiring happens in this slice — that is S04's job. The component renders the milestone→slice→task tree with status icons, a replan marker, and a panel footer showing cost and wall-clock time.

The vitest environment is `node` (not jsdom), so DOM-dependent render tests cannot run. The established project pattern (MEM020, MEM030) is to extract all display logic into pure exported helper functions and test those in the Node environment. Render-level tests (component mounting, click events) would require `@testing-library/react` + jsdom which are not present as devDependencies.

The roadmap success criteria says "Storybook/vitest-component: render panel with fixture". Given the absence of Storybook and jsdom, the deliverable is: pure helper exports + Node-runnable tests covering the logic, with a manual render path available in S04 integration.

## Recommendation

Build `AutoRunPanel.tsx` as a prop-driven display component. Extract the following as pure exported helpers so they can be unit-tested in the node environment:

- `statusIcon(status: GsdNodeStatus): string` — maps status to an emoji/string icon (✓ / ▶ / ○ / —)
- `formatCost(usd: number): string` — "$0.00" display formatter
- `formatElapsed(startedAt: string | null): string` — wall-clock "1m 23s" from ISO timestamp
- `computePanelFooter(milestone: GsdMilestone | null): { costLabel: string; elapsedLabel: string }` — derives both footer strings from milestone data

Keep the component itself free of logic. Tests cover all the pure helpers. The component's click bindings and visibility are integration-tested in S04.

## Implementation Landscape

### Key Files

- `shared/types.ts` — `GsdProgress`, `GsdMilestone`, `GsdSlice`, `GsdTask`, `GsdNodeStatus` all exist, IPC-safe, ready to use as props
- `renderer/components/AutoRunPanel.tsx` — **new file**; prop-driven panel with exported pure helpers
- `renderer/components/AutoRunPanel.test.ts` — **new file**; tests for `statusIcon`, `formatCost`, `formatElapsed`, `computePanelFooter` in Node environment
- `renderer/components/SessionView.tsx` — reference for component structure/import style; S04 will add `AutoRunPanel` here
- `renderer/components/ContextGauge.tsx` — reference pattern: pure helpers exported from the component module, tested separately (MEM030)

### Build Order

1. `AutoRunPanel.tsx` — implement component + pure helper exports. Pure helpers first, then JSX shell around them.
2. `AutoRunPanel.test.ts` — unit tests for the pure helpers (node env, no mocks needed).
3. `pnpm tsc --noEmit` + `pnpm vitest run renderer/components/AutoRunPanel.test.ts` as verification gates.

### Verification Approach

```
pnpm vitest run renderer/components/AutoRunPanel.test.ts
pnpm tsc --noEmit
```

Both must pass. Manual visual check deferred to S04 (SessionView integration). The test file should cover: all four `statusIcon` status values, `formatCost` at $0 / $1.23 / sub-cent, `formatElapsed` with null and a valid timestamp, `computePanelFooter` with null and non-null milestone.

## Constraints

- Vitest environment is `node` — no DOM, no `@testing-library/react`, no jsdom. Do NOT add `@testing-library/react` as a devDependency in this slice; that decision belongs to a later milestone.
- No new npm dependencies. Tailwind + plain React is sufficient for all status indicators (no icon library).
- `GsdProgress.milestone` is nullable — the panel must handle `null` gracefully (render a "No active milestone" placeholder).
- Component is **prop-driven only** in S03; it does NOT call `window.gsd.onProgressUpdate`. That wiring is S04's responsibility.

## Common Pitfalls

- **Testing TSX with node environment** — The vitest config includes `renderer/components/**/*.test.{ts,tsx}`. Use `.test.ts` (not `.test.tsx`) for the AutoRunPanel tests since they contain no JSX. Importing the TSX module from a `.ts` test file works fine because Vitest transpiles it. Alternatively, split logic into a `.ts` helper file.
- **`formatElapsed` with `Date.now()`** — Pure helper tests must mock `Date.now()` or accept an injected `nowMs` parameter to avoid flaky time-dependent assertions. Prefer an optional `nowMs` parameter with `Date.now()` as default.
- **Replan marker** — `GsdSlice.replanned` is a boolean; render a small badge/marker only when `true`. `replanNote` may be undefined, so default to a generic label.

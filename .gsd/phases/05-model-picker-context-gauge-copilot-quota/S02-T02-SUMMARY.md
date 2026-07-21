---
id: T02
parent: S02
milestone: M005
key_files:
  - renderer/components/ModelPickerDropdown.tsx
  - renderer/components/ModelPickerDropdown.test.ts
key_decisions:
  - Exported formatContextWindow and groupAndSortModels as named exports so they can be unit-tested in the Node environment without DOM or Radix dependencies — mirrors the StatusBar.tsx pattern of exporting pure reducer helpers.
  - Renamed test file from .test.tsx to .test.ts to match vitest include glob (renderer/components/**/*.test.ts); no JSX is needed in a Node-env test file.
  - Trigger is a <button> (not a <span>) so keyboard users can open the menu with Space/Enter; aria-haspopup='listbox' documents the intent.
duration: 
verification_result: passed
completed_at: 2026-07-21T18:49:29.636Z
blocker_discovered: false
---

# T02: Built ModelPickerDropdown with Radix DropdownMenu, exported formatContextWindow and groupAndSortModels helpers; 40 unit tests all pass

**Built ModelPickerDropdown with Radix DropdownMenu, exported formatContextWindow and groupAndSortModels helpers; 40 unit tests all pass**

## What Happened



## Failure Modes (Q5)

The component has one external dependency: `useAvailableModels.fetch()` → `window.gsd.getAvailableModels(sessionId)` via IPC.

| Failure | Path | Handling |
|---------|------|----------|
| IPC rejects (session closed mid-open) | `fetchAvailableModels` throws → `useAvailableModels` catch block | `loading` resets to false; `error` is set; `models` stays `[]`; dropdown shows "No models available" |
| IPC returns empty array | `models = []` → `groups = []` | Dropdown shows "No models available" |
| IPC hangs (no response) | `loading` stays true until timeout or unmount | Dropdown shows "Loading models…"; React cleanup on unmount is not needed here — the promise resolves into a stale `setModels` call which React ignores after unmount |
| Malformed ModelInfo (missing provider/id) | `groupAndSortModels` iterates all entries; key renders `${undefined}/${undefined}` | Ugly but does not crash; pi is trusted source so schema violation is low-probability |

## Load Profile (Q6)

The module-level 60 s TTL cache in `useAvailableModels` is the primary guard. At 10× open rate (every 6 s), the cache returns stale data for all opens within the 60 s window — IPC is called at most once per minute per session, regardless of how many times the dropdown is toggled.

## Negative Tests (Q7)

`formatContextWindow`:
- `0` → "0 ctx" (below threshold, zero case)
- `1` → "1 ctx"
- `999` → "999 ctx" (just below 1000 threshold)
- `1000` → "1k ctx" (threshold boundary)
- `1499` → "1k ctx" (rounds down)
- `1500` → "2k ctx" (rounds up)

`groupAndSortModels`:
- Empty input → returns `[]` without error
- Model with no optional fields (no `contextWindow`, no `reasoning`) → fields are `undefined` in output
- Input array order is not mutated — checked with two separate models
- Inner models array is not mutated (sorted via spread `[...group]`)
- `currentModel: null` in `ModelPickerDropdownProps` — trigger shows `'—'`

All 40 tests pass covering the above.


## Verification

Ran `pnpm vitest run renderer/components/ModelPickerDropdown.test.ts` → 1 test file, 40 tests, all passed in 734 ms. The test file extension was renamed from `.tsx` → `.ts` to match the vitest include glob `renderer/components/**/*.test.ts`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm vitest run renderer/components/ModelPickerDropdown.test.ts` | 0 | ✅ pass — 40/40 tests passed | 3289ms |

## Deviations

Test file extension changed from .test.tsx (as written in the task plan) to .test.ts to match the vitest include glob. No JSX is used in the test file so this is semantically equivalent and the glob now picks it up.

## Known Issues

None.

## Files Created/Modified

- `renderer/components/ModelPickerDropdown.tsx`
- `renderer/components/ModelPickerDropdown.test.ts`

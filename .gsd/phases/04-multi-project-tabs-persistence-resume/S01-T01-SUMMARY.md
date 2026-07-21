---
id: T01
parent: S01
milestone: M004
key_files:
  - shared/types.ts
key_decisions:
  - WindowRecord.id is typed as string (not number) for JSON round-trip safety even though Electron exposes BrowserWindow.id as number — callers must cast at the boundary.
  - version: 1 is a literal type so TypeScript can exhaustively discriminate future RegistryV2 in a migration switch.
duration: 
verification_result: passed
completed_at: 2026-07-21T12:38:13.649Z
blocker_discovered: false
---

# T01: Added SessionRecord, WindowRecord, and RegistryV1 types to shared/types.ts; tsc --noEmit passes clean.

**Added SessionRecord, WindowRecord, and RegistryV1 types to shared/types.ts; tsc --noEmit passes clean.**

## What Happened

Appended three persistence registry interfaces to `shared/types.ts` below the existing type definitions:

- **SessionRecord** — per-session persistent record with `id` (SessionId alias), `cwd`, `displayName`, optional `sessionFile`, `lastOpenedAt` (ISO-8601), and `wasAutoRunning`.
- **WindowRecord** — per-BrowserWindow record with `id` (string), `tabIds: string[]`, `activeTabId`, and `bounds: {x,y,width,height}`. Window id is string for JSON-safety even though Electron exposes it as number.
- **RegistryV1** — root schema with `version: 1` literal (enables future migration discrimination), `sessions: SessionRecord[]`, `windows: WindowRecord[]`, and `mruOrder: string[]` for the recents list.

No changes to existing types. All new exports follow the file's existing pattern of plain interfaces with no Node/Electron/browser imports, so they are safe in both main and renderer tsconfigs. Both `tsconfig.main.json` and `tsconfig.renderer.json` include `shared/**/*`, making the types available to the full codebase.

## Verification

Ran `pnpm tsc --noEmit` (base tsconfig, which drives both main and renderer include sets) via gsd_exec; exit 0, no errors, no warnings. Both tsconfigs extend the base and include `shared/**/*`, confirming the new types compile in both contexts.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pwsh -NoProfile -Command "pnpm tsc --noEmit 2>&1"` | 0 | ✅ pass | 3319ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `shared/types.ts`

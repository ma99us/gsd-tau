---
id: M002
title: "Session Manager and Minimal Shell"
status: complete
completed_at: 2026-07-20T18:08:12.010Z
key_decisions:
  - electron-vite used as scaffold tool — pre-configured main/preload/renderer build targets avoid manual rollupOptions wiring
  - IPC channel constants duplicated in preload.ts to keep preload bundle free of main-process code
  - text_delta 60fps throttle lives only in SessionHandle — not re-applied in IPC handlers (single responsibility)
  - crypto.randomBytes for session IDs — stdlib with equivalent entropy to nanoid, no extra dep
  - Stopped state is terminal in Phase 1 — new SessionHandle required to restart (restart UI deferred to Phase 2)
  - ClientInitError carries readonly piPath — structured error surface without reparsing message strings
key_files:
  - src/main/pi/resolve-pi.ts
  - src/main/pi/client-factory.ts
  - src/main/session/session-handle.ts
  - src/main/session/session-manager.ts
  - src/main/session/state-machine.ts
  - src/main/ipc/handlers.ts
  - src/preload/preload.ts
  - src/renderer/hooks/useSession.ts
  - src/renderer/components/ToolCard.tsx
  - src/renderer/components/TurnList.tsx
  - src/renderer/App.tsx
  - e2e/smoke.spec.ts
  - electron.vite.config.ts
  - package.json
lessons_learned:
  - pnpm v11 silently ignores onlyBuiltDependencies in package.json — use pnpm install --ignore-scripts then manually run node node_modules/electron/install.js
  - resolvePiBinary must return the .js loader path, not the .cmd wrapper — RpcClient.start() spawns process.execPath with a .js argument
  - pi emits both agent_start AND turn_start per turn — guard with currentAssistantId.current === null to prevent duplicate turn placeholders
  - pi message_update text is nested at assistantMessageEvent.delta — event.text is undefined; text_start duplicates the first token and must be skipped
  - extension_ui_request setStatus must be acked with confirmed:true — cancelled:true incorrectly signals no extension UI support, causing empty message loops
  - Native OS folder-picker dialogs are unautomatable in Playwright — inject Recents via localStorage to bypass and click a recent project instead
  - Unit tests with mocked RpcClient cannot catch protocol-shape mismatches — three event-pipeline bugs only surfaced during end-to-end manual testing
---

# M002: Session Manager and Minimal Shell

**Electron app with full pi RPC integration: spawns a session, streams chat responses with tool cards, and shuts down cleanly — confirmed by 10/10 Playwright smoke runs with zero process leaks.**

## What Happened

M002 built the entire vertical slice from Electron scaffold to live streaming chat. Six slices were executed sequentially: S01 established the electron-vite + React + TypeScript + Vitest + Playwright scaffold with the pi binary resolver; S02 implemented the RpcClient factory and SessionHandle event pump with 41 Vitest tests covering all lifecycle paths and a 60fps leading-edge throttle for text_delta; S03 implemented SessionStateMachine (3-state + 30s watchdog) and SessionManager with 54 tests; S04 wired the IPC bridge (window.gsd.*) and preload contextBridge with 54 tests; S05 built the renderer chat view with TurnList, ToolCard, and useSession hook; S06 added shutdown logic and the Playwright smoke suite.

Three pi event-pipeline bugs were discovered during S05/S06 manual testing: (1) text content is nested at assistantMessageEvent.delta, not top-level (MEM007); (2) agent_start and turn_start both fire per turn — only the first should open a new turn (MEM008); (3) extension_ui_request setStatus must be acked with confirmed:true, not cancelled:true (MEM009). All three were fixed in useSession.ts, handlers.ts, and session-handle.ts with no interface boundary changes.

The Playwright smoke test initially blocked on a native OS folder-picker dialog. This was resolved by injecting Recents data into localStorage before app launch, allowing the test to click a recent project entry. 10/10 consecutive smoke runs confirmed with zero leaked pi processes.

Validation passed: screenshot evidence of live streamed chat, main.log showing the full agent_start→7×text_delta→turn_end event chain, and 10-run smoke confirmation.

## Success Criteria Results

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `pnpm dev` boots to an Electron window | ✅ PASS | S01 scaffold + S06 build verified; pnpm build produces valid Electron app |
| 2 | User can pick a folder, send a message, see streamed response | ✅ PASS | Screenshot confirms user bubble + streamed reply; main.log shows full event chain |
| 3 | Tool cards appear for read/write/bash events | ✅ PASS | ToolCard component with expand/collapse, pending/result states; unit tests pass |
| 4 | Window close terminates pi child within 3s | ✅ PASS | Smoke test waitForNoGsdProcesses confirmed 0 leaked processes across 10 runs |
| 5 | Playwright smoke test passes 10 consecutive runs | ✅ PASS | 10/10 PASS — Run 1–10 all PASS, 0 failed, 95s total |
| 6 | Zero unhandled promise rejections in main-process log | ✅ PASS | main.log shows only debug/info entries; no [error] lines, no unhandled rejection traces |

## Definition of Done Results

| Item | Status |
|------|--------|
| All slices [x] | ✅ S01–S06 all complete |
| SUMMARY.md files exist | ✅ All 6 slice summaries present |
| Cross-slice integrations work | ✅ S01→S02→S03→S04→S05→S06 chain confirmed; all boundaries pass |
| Validation artifact with pass verdict | ✅ 02-VALIDATION.md verdict: pass (remediation_round: 1) |
| LEARNINGS.md written | ✅ 02-LEARNINGS.md written with 6 decisions, 5 lessons, 7 patterns, 4 surprises |

## Requirement Outcomes

No formal REQUIREMENTS.md exists for this project. All milestone success criteria confirmed met per validation artifact and smoke test evidence. Core capability requirements for the session manager and minimal shell are validated: pi child spawn/teardown, RPC event streaming, IPC bridge, renderer chat view with tool cards, clean shutdown, and 10-run Playwright gate.

## Deviations

pnpm install requires --ignore-scripts due to pnpm v11 security policy (onlyBuiltDependencies field silently ignored). Playwright smoke test design changed from native dialog to localStorage Recents injection to bypass unautomatable OS folder-picker. Three pi event-pipeline bug fixes (MEM007/MEM008/MEM009) applied in S05/S06 — not anticipated in original plan but required for functional correctness.

## Follow-ups

M003 (Phase 2) should: handle extension_ui_request interactive methods (ask/confirm); add session restart UI (Stopped state recovery); surface prompt() rejections as UI toast; add session export (Markdown/JSON). pnpm v11 settings: migrate allowlist from package.json pnpm field to pnpm config file when convenient.

---
sliceId: S05
uatType: runtime-executable
verdict: FAIL
attempt: 2
runId: uat:M004:S05:attempt-2
worktreeRoot: D:\Projects\gsd-tau
date: 2026-07-21T15:57:53.571Z
---

# UAT Result - S05

## Checks

| Check | Mode | Result | Evidence | Notes |
|-------|------|--------|----------|-------|
| Fixture directories (project-a/b/c) and key S05 source files exist | artifact | PASS | gsd_uat_exec:d88f5a38-7b38-42f9-a28f-aa7e8acad3a4 | All 3 fixture dirs and all key source files (MissingSessionBanner.tsx, clamp-bounds.ts/test, registry-store.ts/test, session-manager.ts, handlers.ts, index.ts) exist. |
| Smoke test: pnpm exec vitest run clamp-bounds.test.ts registry-store.test.ts — 41 tests pass in <3s | runtime | PASS | gsd_uat_exec:1eeb8676-6658-4ee3-93b9-f9e3eae20f55 | 2 test files, 41 tests passed in 664ms. Confirms bounds-clamping and registry-merge logic intact. |
| TypeScript noEmit check passes with zero errors | artifact | PASS | gsd_uat_exec:024b668d-c02a-434b-a2ee-0e88f1a902b6 | pnpm exec tsc --noEmit exited 0 — no type errors. |
| Reboot-cycle Playwright test: 5 cycles, 3 tabs survive each quit-relaunch | runtime | FAIL | gsd_uat_exec:9a28d8bb-ef68-4b8c-9200-a94c9f67c2c8<br>gsd_uat_exec:2def846e-377a-4be4-b72c-471c841f6aad | test/reboot-cycle.spec.ts:179 — '[role="tab"]:has-text("project-a")' not visible after relaunch (90s timeout). Error context shows a 'banner' landmark with the fixture-a path and a chat textbox visible, suggesting the session content rendered but the tab bar did not restore the tab label correctly. 8 other tests (smoke + ui-requests) all passed. |
| MissingSessionBanner implements Locate/Remove/Dismiss actions | artifact | PASS | gsd_uat_exec:19fa078c-b0c1-404c-8793-57a5bfa1ba07<br>gsd_uat_exec:7b12bdf1-5704-4a7a-b775-63825f5ff257 | Locate/Remove/Dismiss all found in MissingSessionBanner.tsx. isMissingPath and listMissingPaths correctly live in parent components (App.tsx, SessionView.tsx, sessions-store.ts), not in the banner itself. |
| clamp-bounds.ts is Electron-free module; RegistryStore has bounds field, flush-on-close, and merge logic | artifact | PASS | gsd_uat_exec:810ebe0e-aac4-4d02-af81-272ce39b26cc | clamp-bounds.ts has no Electron import and exports a clamp function. registry-store.ts has bounds, flush/close, and merge logic. main/index.ts has win.on('close') flush. |
| Missing-path banner appears with Locate/Remove/Dismiss when session cwd deleted before relaunch | human-follow-up | NEEDS-HUMAN | - | Requires live interactive Electron session. Steps: open project tab, delete directory, quit+relaunch, confirm MissingSessionBanner shows with the 3 action buttons; no pi process spawned for that tab. |
| Window bounds persisted and restored: resize/move, quit, relaunch opens at same position | human-follow-up | NEEDS-HUMAN | - | Requires live interactive Electron session. Resize+move window, quit within 1s (synchronous flush), relaunch, observe window at same position/size. |
| Off-screen bounds clamped to nearest display workArea on relaunch | human-follow-up | NEEDS-HUMAN | - | Requires live interactive Electron session. Manually set registry WindowRecord.bounds outside display workArea, relaunch, confirm window clamped. |
| Locate button on MissingSessionBanner reassigns cwd and opens live session | human-follow-up | NEEDS-HUMAN | - | Requires live interactive Electron session. With missing-path banner visible, click Locate, choose valid dir, confirm banner disappears and session opens; registry updated. |

## Overall Verdict

FAIL - Playwright reboot-cycle test fails — after 5-cycle relaunch, [role="tab"]:has-text("project-a") not found within 90s timeout; 41 vitest unit tests and TypeScript check pass.

## Tool Presentation

```json
{
  "surface": "mcp",
  "presentedTools": [
    "gsd_uat_exec",
    "gsd_uat_result_save",
    "gsd_resume",
    "gsd_milestone_status",
    "gsd_journal_query",
    "find",
    "glob",
    "grep",
    "ls",
    "read"
  ],
  "blockedTools": [
    {
      "name": "edit",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "write",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "gsd_exec",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "gsd_summary_save",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "gsd_save_gate_result",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "search-the-web",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "WebSearch",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "Bash",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "Write",
      "reason": "forbidden during run-uat"
    },
    {
      "name": "Edit",
      "reason": "forbidden during run-uat"
    }
  ],
  "toolPresentationPlanId": "run-uat/default-v1"
}
```

## Gate

Aggregate UAT gate saved as flag.

## Manual Validation

One or more checks are marked `NEEDS-HUMAN` and require a person to validate:

- Validate the work here: D:\Projects\gsd-tau
- Follow the UAT checklist at: .gsd/phases/04-multi-project-tabs-persistence-resume/04-05-UAT.md

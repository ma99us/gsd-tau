---
sliceId: S06
uatType: runtime-executable
verdict: FAIL
attempt: 1
runId: uat:M002:S06:attempt-1
worktreeRoot: D:\Projects\gsd-tau
date: 2026-07-20T16:26:23.541Z
---

# UAT Result - S06

## Checks

| Check | Mode | Result | Evidence | Notes |
|-------|------|--------|----------|-------|
| Build artifacts exist: out/main/index.js, out/preload, Electron binary installed | artifact | PASS | gsd_uat_exec:f0e620f0-96b3-43eb-8b57-388781a9c2c2 | out/main/index.js exists, out/preload/preload.js exists (named preload.js not index.js — minor naming deviation), electron installed. auth.json absent but that is provider-credential precondition, not a build precondition. |
| resolve-pi.ts derives loader.js path from .cmd — gsd spawn uses .js not .cmd | artifact | PASS | gsd_uat_exec:e74eccbe-c75a-4a9f-a9c6-b20081a653f5<br>gsd_uat_exec:2d376223-62a6-4915-abf0-63948b42c5d5 | resolve-pi.ts at main/pi/resolve-pi.ts checks for loader.js sibling, falls back to parsing .cmd. deriveJs logic confirmed present. .js path returned, not .cmd wrapper. |
| test/smoke.spec.ts and playwright.config.ts exist; test:e2e script defined | artifact | PASS | gsd_uat_exec:b141e67d-80db-444b-a369-201f55e75487 | test/smoke.spec.ts: EXISTS, playwright.config.ts: EXISTS, test:e2e script: 'playwright test' |
| 170 vitest unit tests pass (build passes, unit contracts verified) | runtime | PASS | gsd_uat_exec:0e946738-fe3a-41d5-a32f-5066e5604a03 | 8 test files, 170 tests, all passed in 718ms. System node v26.3.0. |
| pnpm test:e2e — Playwright smoke: launch → folder picker → open project → prompt → response → shutdown clean → no gsd process leaks | runtime | FAIL | gsd_uat_exec:8b9af92a-6194-4765-b8f2-fc2bfa66158e<br>gsd_uat_exec:62b7528e-dbc7-48c3-86d1-5791ab5c38d3 | 1 test failed. Error: ClientInitError: pi init handshake failed — stderr from gsd: 'GSD requires Node.js >= 22.0.0 You are running Node.js 20.18.0'. Root cause: RpcClient.start() calls spawn(process.execPath, [loaderJsPath]); inside Electron 31.7.7, process.execPath is the Electron binary which exposes Node 20.18.0, not the system Node (26.3.0). The gsd loader rejects the Electron-embedded runtime. Fix required: spawn gsd using the system node binary (resolved from PATH or a well-known path) instead of process.execPath. |
| 10-consecutive-run stability: all 10 runs pass; no gsd.exe leaks; no EINVAL/ENOENT errors | human-follow-up | NEEDS-HUMAN | - | TC1-E2E must pass first. Additionally requires a live LLM provider (auth.json absent on this machine). Run 'pnpm test:e2e' 10 times consecutively once the Node-version spawn fix is applied and provider is authenticated. |
| Edge case: shutdown under load — start long prompt, close window, verify gsd exits within 5s | human-follow-up | NEEDS-HUMAN | - | Requires TC1-E2E passing (provider + Node fix). Manually: launch app, send a long prompt, immediately close window; observe Get-Process gsd returns 0 within 8s. |
| Edge case: binary not found — ResolvePiError thrown and surfaced as user-readable message | human-follow-up | NEEDS-HUMAN | - | Requires manually removing GSD_PI_PATH / renaming gsd.cmd off PATH, then launching the app to verify the error message appears in the renderer. |

## Overall Verdict

FAIL - Vitest 170/170 pass and resolve-pi.ts fix verified; Playwright smoke test fails because Electron 31 embeds Node.js 20.18.0 and gsd requires >=22.0.0 — the app spawns gsd via process.execPath (Electron binary) instead of the system Node binary.

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
- Follow the UAT checklist at: .gsd/phases/02-session-manager-and-minimal-shell/02-06-UAT.md

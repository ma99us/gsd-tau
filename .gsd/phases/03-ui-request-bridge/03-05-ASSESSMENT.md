---
sliceId: S05
uatType: runtime-executable
verdict: FAIL
attempt: 2
runId: uat:M003:S05:attempt-2
worktreeRoot: D:\Projects\gsd-tau
date: 2026-07-20T20:35:05.410Z
---

# UAT Result - S05

## Checks

| Check | Mode | Result | Evidence | Notes |
|-------|------|--------|----------|-------|
| Precondition: build artifacts and test files exist | artifact | PASS | gsd_uat_exec:23699fc8-6ec0-449a-9135-7dd8e9c03af8 | BUILD_EXISTS: yes, ELECTRON_EXISTS: yes, MOCK_PI_SERVER: yes, PLAYWRIGHT_SPEC: yes, SHUTDOWN_TEST: yes |
| Precondition: pnpm build succeeds with no TypeScript errors | runtime | PASS | gsd_uat_exec:c543b697-0d14-43b7-b8da-5a77a454fc0b | Build succeeded. Renderer bundle: index-CvpUqSnp.js (272.69 kB), built in 576ms |
| Shutdown-cancel unit tests: 5/5 tests pass in under 2s | runtime | PASS | gsd_uat_exec:422e88ea-6fff-4516-8365-3826ff44d846 | 1 test file passed, 5/5 tests pass, duration 571ms. pnpm vitest run main/session/shutdown-cancel.test.ts exit code 0. |
| Full Playwright e2e suite: all 7 test cases pass | runtime | FAIL | gsd_uat_exec:d7cf8c0f-b3f1-4dcf-a68e-daec811de9a9 | 6 failed, 2 passed. Tests 1-6 (select, confirm, input, editor, notify/setStatus, two-blockers) all fail with 'Received: undefined' for response keys. Response file entries never populated — IPC response chain from modal click to mock-pi is not completing. Test 7 (shutdown-cancel) and beforeAll setup pass. |
| Select modal (cases 1a + 1b): single-choice and multi-choice responses recorded | runtime | FAIL | gsd_uat_exec:d7cf8c0f-b3f1-4dcf-a68e-daec811de9a9 | expect(resp['sel-single']).toEqual({ value: 'Green' }) — Received: undefined. Response not recorded in file. |
| Confirm modal (cases 2a + 2b): yes and no responses recorded | runtime | FAIL | gsd_uat_exec:d7cf8c0f-b3f1-4dcf-a68e-daec811de9a9 | expect(resp['conf-yes']).toEqual({ confirmed: true }) — Received: undefined. |
| Input modal (cases 3a + 3b): plain text and secure input responses recorded | runtime | FAIL | gsd_uat_exec:d7cf8c0f-b3f1-4dcf-a68e-daec811de9a9 | expect(resp['inp-plain']).toEqual({ value: 'Alice' }) — Received: undefined. |
| Editor modal (cases 4a + 4b): submit and cancel responses recorded | runtime | FAIL | gsd_uat_exec:d7cf8c0f-b3f1-4dcf-a68e-daec811de9a9 | expect(resp['ed-submit']).toEqual({ value: 'hello editor' }) — Received: undefined. |
| Non-modal render (case 5): notify + setStatus auto-acked by main process | runtime | FAIL | gsd_uat_exec:d7cf8c0f-b3f1-4dcf-a68e-daec811de9a9 | expect(resp['notif-1']).toEqual({ value: '' }) — Received: undefined. Auto-ack path also not completing. |
| Queue depth badge (case 6): two simultaneous blockers show badge '2' | runtime | FAIL | gsd_uat_exec:d7cf8c0f-b3f1-4dcf-a68e-daec811de9a9 | expect(resp['q1']).toEqual({ confirmed: true }) — Received: undefined. Response not recorded. |
| Shutdown-cancel e2e (case 7): cancelled:true received by mock before process exits | runtime | PASS | gsd_uat_exec:d7cf8c0f-b3f1-4dcf-a68e-daec811de9a9 | Test 7 passes in the Playwright suite (2 passed: beforeAll + test 7). Shutdown hook correctly sends cancelled:true to mock-pi. |
| After 20 runs, no orphaned mock-pi-server processes remain | human-follow-up | NEEDS-HUMAN | - | Manual verification: after 20 runs of pnpm test:e2e -- ui-requests, run Get-Process node \| Where-Object CommandLine -like '*mock-pi*' and confirm empty output. Cannot automate here as tests fail before completing full cycles. |

## Overall Verdict

FAIL - Shutdown-cancel unit tests pass 5/5, but 6 of 7 Playwright e2e tests fail: all modal-interaction tests (select, confirm, input, editor, notify/setStatus, queue-depth) report undefined for expected response keys, indicating the IPC response chain from modal→main→mock-pi is not completing; only test 7 (shutdown-cancel quit path) passes.

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
- Follow the UAT checklist at: .gsd/phases/03-ui-request-bridge/03-05-UAT.md

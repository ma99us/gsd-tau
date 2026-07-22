---
sliceId: S01
uatType: runtime-executable
verdict: PASS
attempt: 1
runId: uat:M006:S01:attempt-1
worktreeRoot: D:\Projects\gsd-tau
date: 2026-07-22T12:26:34.399Z
---

# UAT Result - S01

## Checks

| Check | Mode | Result | Evidence | Notes |
|-------|------|--------|----------|-------|
| Roadmap assertion — fuzzyScore ordering: all 15 tests in fuzzyMatch.test.ts pass | runtime | PASS | gsd_uat_exec:74daac51-0bb0-4aa5-8c63-153935dc3a68 | 1 test file passed, 15 tests passed, exit 0. Duration 1.71s. |
| MRU round-trip through injectable storage: all 21 tests in useMRU.test.ts pass | runtime | PASS | gsd_uat_exec:369501c1-85f8-4f51-aac4-1c7aa24ae1ed | 1 test file passed, 21 tests passed, exit 0. Duration 1.69s. |

## Overall Verdict

PASS - All 15 fuzzyMatch tests and 21 useMRU tests passed with exit 0.

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

Aggregate UAT gate saved as pass.

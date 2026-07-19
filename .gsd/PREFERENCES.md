# GSD Preferences

## Tool loop guard

```
tool_call_loop_guard:
  repeated_tool:
    repeatable_cap: 30
    exempt_tools:
      - gsd_plan_slice
      - gsd_plan_task
      - gsd_task_complete
      - gsd_slice_complete
```

# M005: Model Picker, Context Gauge, Copilot Quota

**Vision:** Session header shows live model, thinking level, context gauge, and cost. Model and thinking-level pickers let users switch mid-session. Copilot quota service polls GitHub, maintains rolling history, and surfaces a compact header widget with a click-to-expand popover.

## Success Criteria

- Session header visible in every open session with live model + cost
- Model picker lets user switch model; confirmed with get_state after next turn
- Thinking level chip hidden on non-reasoning models; picker switches level correctly
- Context gauge live-updates from cost_update events; compact button works
- Copilot quota widget shows live usage data; degrades gracefully when unauthenticated or API is down

## Slices

- [x] **S01: Session header: model chip and cost line** `risk:low` `depends:[]`
  > After this: Open a project; header shows 'anthropic/claude-sonnet-4.6  $0.00'. Send a message; cost updates after execution_complete.

- [x] **S02: Model picker dropdown** `risk:medium` `depends:[S01]`
  > After this: Click 'anthropic/claude-sonnet-4.6'; dropdown shows all available models grouped by provider. Pick a different model; chip updates immediately.

- [x] **S03: Thinking level chip and picker** `risk:low` `depends:[S01]`
  > After this: Header shows '💡 medium'. Click chip; picker shows all 7 levels with current selected. Pick 'high'; chip updates to '💡 high'. On a non-reasoning model chip is absent.

- [ ] **S04: Context window gauge with compact button** `risk:medium` `depends:[S01]`
  > After this: Header shows 'Context ██████░░░░ 62%'. Click gauge; popover shows input/output/cache breakdown and Compact button. At 85%+ gauge turns red.

- [ ] **S05: Copilot quota service and header widget** `risk:high` `depends:[S01]`
  > After this: Header shows 'Copilot ████████░░ 78%  ✅'. Click widget; popover shows used/remaining/reset date, burn rates, projection, and last-updated time. Without auth shows Connect GitHub button.

## Boundary Map

Not provided.

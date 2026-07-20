# Model Picker, Thinking Level, and Context Window

## What we show in the header

```
 anthropic/claude-sonnet-4-5 ▼    💡 medium ▼    Context ██████░░░░ 62%    $0.42
```

Four live-updated controls, always visible in the session view header:

| Element | Source | Refresh trigger |
|---|---|---|
| `provider/model-id` | `get_state().model` | Session attach; after `set_model` |
| Thinking level chip | `get_state().thinkingLevel` | Session attach; after `set_thinking_level` |
| Context gauge | `get_session_stats().tokens.total / model.contextWindow` | Session attach; after each `execution_complete`; on `cost_update` (throttled 1 Hz) |
| Cumulative cost | `get_session_stats().cost` | Same as gauge |

## Model picker

Trigger: click the model chip in the header, or `Ctrl+.`.

Populated by `get_available_models()` (cached for 60 s). Grouped by provider:

```
Anthropic
  ● claude-sonnet-4-5           200k ctx  reasoning
  ○ claude-opus-4                200k ctx  reasoning
OpenAI
  ○ gpt-5                        400k ctx  reasoning
  ○ gpt-5-mini                   400k ctx
GitHub Copilot
  ○ claude-sonnet-4-5 (via Copilot)  200k ctx
Ollama
  ○ qwen2.5-coder:7b             128k ctx  local
```

- Radio-select, current model checked.
- `Reasoning` and `Local` badges from `ModelInfo` fields.
- Context window shown per model so users can pick based on how much context
  they need.
- Selecting a model calls `set_model({ provider, modelId })`. Takes effect on
  the **next** turn. Header updates immediately (optimistic) and confirms on
  the next `get_state`.

If the provider requires auth we don’t have (`get_available_models` filters
that out on pi’s side already), we don’t show unavailable models. A footer link
“Add another provider…” opens the auth flow (see [70-auth-github-copilot.md](./70-auth-github-copilot.md)).

## Thinking level picker

A **dedicated chip in the session header**, separate from the model picker:

```
💡 medium ▼
```

Clickable. Opens a small dropdown directly below the chip:

```
┌─────────────────────┐
│  Thinking level       │
│  ○  off               │
│  ○  minimal           │
│  ○  low               │
│  ●  medium        ✔   │
│  ○  high              │
○  ○  xhigh             │
│  ○  max               │
└─────────────────────┘
```

- Levels that the current model does not support are **greyed out and
  unselectable**. Reasoning levels (`minimal` and above) are only enabled for
  models where `ModelInfo.supportsThinking === true`.
- The chip itself is hidden (not greyed) when the current model does not
  support thinking at all — no point showing a disabled control permanently.
- Selecting a level calls `set_thinking_level({ level })`. Takes effect on
  the **next** turn. Chip updates immediately (optimistic).
- The session-level selection overrides the global default from
  `settings.defaultThinkingLevel` for the lifetime of the session.
- Keyboard: `Ctrl+Shift+T` cycles through the available levels for quick
  toggling during interactive use.

## Context window selector

Some models are offered in multiple context-window tiers (e.g. 32k / 128k /
200k). When `ModelInfo` exposes more than one tier for the active model, a
**context size chip** appears in the header next to the thinking chip:

```
💡 medium ▼    200k ▼    Context ████░░░░░░ 38%    $0.42
```

Clickable. Opens a dropdown:

```
┌─────────────────────┐
│  Context window       │
│  ○  32k               │
│  ○  128k              │
│  ●  200k          ✔   │
└─────────────────────┘
```

- Populated from `ModelInfo.contextTiers` (an array of token counts). If the
  array has only one entry (or is absent), the chip is **hidden**.
- Selecting a tier calls `set_model({ provider, modelId, contextWindow: n })`
  (or whichever RPC pi exposes for this — feature-detect via
  `init.capabilities` per ADR-005 before showing the control).
- Takes effect on the next turn.
- When the chip is absent (single-tier model), the context gauge still shows
  the known window size from `ModelInfo.contextWindow`.

## Context window gauge

```
Context ██████░░░░ 62%
```

- Value: `tokens.total / model.contextWindow`.
- `tokens.total` includes input + output + cache read + cache write from
  `SessionStats.tokens`.
- Colour bands:
  - Green: 0–60 %
  - Amber: 60–85 %
  - Red: 85–100 %+
- Click the gauge → popover with the breakdown:
  ```
  Input:        45,200
  Output:         4,800
  Cache read:   82,100
  Cache write:    1,500
  ─────────────────
  Total:       133,600 / 200,000  (67%)

  [ Compact context ]
  ```
- The **Compact context** button calls `compact()`. During compaction the
  session state moves to Working with a “Compacting…” label. On completion,
  `CompactionResult` is surfaced as a system message in the chat pane.
- At 85 % a nudge pill also appears in the chat scroll
  (see [45-chat-experience.md §8.1](./45-chat-experience.md)).

### Handling unknown `contextWindow`

Some models don’t publish a context window in `ModelInfo`. Fallback ladder:
1. `model.contextWindow` from `get_available_models`.
2. A local table for well-known models (compiled from
   `packages/pi-ai/dist/models.generated.js` at build time).
3. Show `Context 133k tokens` (raw count, no bar) if still unknown.

Never guess. Never fabricate.

## Cost line

`$0.42` = cumulative cost this session, from `SessionStats.cost`.

Click → popover with:
- Cost for this session
- Cost for the current turn (from last `cost_update.turnCost`)
- Rate (input/output token counts + prices where known)

## Refresh cadence

- `get_state`: every 5 s while session focused, once on tab switch.
- `get_session_stats`: after every `execution_complete`, throttled to 1/s
  during heavy streaming.
- `get_available_models`: on model picker open, cached 60 s.
- `cost_update` events: live-update cost + tokens without polling.

## What we do not do in v1

- Multi-model routing / per-request model overrides.
- Cost budgets or alerts (later — pairs well with auto-mode).
- Historical cost graphs.

## What we show in the header

```
anthropic/claude-sonnet-4-5 ▼    Context ██████░░░░ 62%  $0.42
```

Three live-updated readouts, always visible in the session view header:

| Element | Source | Refresh trigger |
|---|---|---|
| `provider/model-id` | `get_state().model` | Session attach; after `set_model` |
| Context gauge | `get_session_stats().tokens.total` / `model.contextWindow` | Session attach; after each `execution_complete`; on every `cost_update` (throttled to 1Hz) |
| Cumulative cost | `get_session_stats().cost` | Same as gauge |

## Model picker

Trigger: click the model chip in the header, or `Ctrl+.`.

Populated by `get_available_models()` (cached for 60s). Grouped by provider:

```
Anthropic
  ● claude-sonnet-4-5           200k ctx  reasoning
  ○ claude-opus-4                200k ctx  reasoning
OpenAI
  ○ gpt-5                        400k ctx  reasoning
  ○ gpt-5-mini                   400k ctx
GitHub Copilot
  ○ claude-sonnet-4-5 (via Copilot)  200k ctx
Ollama
  ○ qwen2.5-coder:7b             128k ctx  local
```

- Radio-select, current model checked.
- `Reasoning` and `Local` badges from `ModelInfo` fields.
- Context window shown per model so users can pick based on how much context
  they need.
- Selecting a model calls `set_model({ provider, modelId })`. Takes effect on
  the **next** turn. Header updates immediately (optimistic) and confirms on
  the next `get_state`.

If the provider requires auth we don't have (`get_available_models` filters that
out on pi's side already), we don't show unavailable models. A footer link
"Add another provider…" opens the auth flow (see [70-auth-github-copilot.md](./70-auth-github-copilot.md)).

## Thinking level

Second row in the picker dropdown:

```
Thinking: off | minimal | low | medium | high | xhigh | max
```

Populated from `RPC_THINKING_LEVELS`. Current level from `get_state().thinkingLevel`.
Set via `set_thinking_level({ level })`. Options that the current model doesn't
support are dimmed (heuristic: only shown for models with `reasoning: true`).

## Context window gauge

```
Context ██████░░░░ 62%
```

- Value: `tokens.total / model.contextWindow`.
- `tokens.total` includes input + output + cache read + cache write from
  `SessionStats.tokens`.
- Colour bands:
  - Green: 0-60%
  - Amber: 60-85%
  - Red: 85-100%+
- Click the gauge → popover with the breakdown:
  ```
  Input:        45,200
  Output:        4,800
  Cache read:   82,100
  Cache write:   1,500
  ─────────────────
  Total:       133,600 / 200,000  (67%)

  [ Compact context ]
  ```
- The **Compact context** button calls `compact()`. During compaction, session
  state moves to Working with a "Compacting…" label. On completion,
  `CompactionResult` is surfaced as a system message in the chat pane.

### Handling unknown `contextWindow`

Some models don't publish a context window in `ModelInfo`. Fallback ladder:
1. `model.contextWindow` from `get_available_models`.
2. A local table for well-known models (compiled from
   `packages/pi-ai/dist/models.generated.js` at build time).
3. Show `Context 133k tokens` (raw count, no bar) if we can't determine.

Never guess. Never fabricate.

## Cost line

`$0.42` = cumulative cost this session, from `SessionStats.cost`.

Click → popover with:
- Cost for this session
- Cost for the current turn (from last `cost_update.turnCost`)
- Rate (input/output token counts + prices where known)

## Refresh cadence

- `get_state`: every 5s while session focused, once on tab switch.
- `get_session_stats`: after every `execution_complete`, throttled to at most
  1/s during heavy streaming.
- `get_available_models`: on model picker open, cached 60s.
- `cost_update` events: live-update the cost + tokens without polling.

## What we do not do in v1

- Multi-model routing / per-request model overrides.
- Cost budgets or alerts (later — pairs well with auto-mode).
- Historical cost graphs.

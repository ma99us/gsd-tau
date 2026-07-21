/**
 * SessionHeaderBar — model chip and cost display.
 *
 * Renders above the turn list in SessionView. Shows the active pi model
 * identifier (provider/model-id) and cumulative session cost in USD.
 *
 * Behaviour:
 * - Fetches the active model via `getRpcState` on mount and after each
 *   `execution_complete` event (model may change if the user switches
 *   mid-session).
 * - Accumulates cost from `cost_update` events using `cumulativeCost`
 *   (not a running sum of `turnCost`) so the display is always accurate
 *   even if a push event is missed.
 * - Subscribes to events independently via `window.gsd.onEvent` so it
 *   can be rendered as a standalone child of SessionView without
 *   requiring changes to SessionView's own event handler.
 * - The model chip is now a `ModelPickerDropdown` — clicking it opens a
 *   grouped list of available models from `getAvailableModels`.  Selecting
 *   a model calls `setModel`, updates the chip optimistically, and confirms
 *   on the next `getRpcState` fetch triggered by `execution_complete`.  If
 *   `setModel` rejects the optimistic state is reverted and the error is
 *   logged via `console.error`.
 *
 * Graceful degradation:
 * - Renders '—' for model when `getRpcState` returns null or the model
 *   field is absent (e.g. briefly on session open before state settles).
 * - Shows '$0.0000' on mount until the first `cost_update` arrives.
 * - Silently swallows `getRpcState` errors — keeps the last known model.
 */

import { useState, useEffect, useCallback } from 'react'
import type { SessionId, SessionEvent, RpcCostUpdateEvent, ModelInfo } from '@shared/types'
import { ModelPickerDropdown } from './ModelPickerDropdown'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SessionHeaderBarProps {
  /** Stable RPC session id — used for IPC calls and event subscription. */
  sessionId: SessionId
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a USD cost value.
 * Four decimal places so fractional-cent costs (typical for LLM usage) are
 * visible even after a short prompt.
 */
function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionHeaderBar({ sessionId }: SessionHeaderBarProps): JSX.Element {
  const [model, setModel] = useState<{ provider: string; id: string } | null>(null)
  const [cost, setCost] = useState(0)

  /**
   * Apply an optimistic model update then call setModel over IPC.
   * On rejection the previous model is restored and the error is logged.
   * Memoised on `sessionId` and `model` so the closure always captures the
   * current model for rollback — recreating on model change is intentional.
   */
  const handleModelSelected = useCallback(
    (m: ModelInfo): void => {
      const previous = model
      setModel({ provider: m.provider, id: m.id })
      window.gsd
        .setModel(sessionId, m.provider, m.id)
        .catch((err: unknown) => {
          console.error('[SessionHeaderBar] setModel failed — reverting', err)
          setModel(previous)
        })
    },
    [sessionId, model],
  )

  /**
   * Fetch the active model from the main process.
   * Memoised on `sessionId` so it is stable across re-renders and can be
   * safely listed as a dependency of the event-subscription `useEffect`.
   */
  const fetchModel = useCallback((): void => {
    window.gsd
      .getRpcState(sessionId)
      .then((state) => {
        if (state?.model) {
          setModel({ provider: state.model.provider, id: state.model.id })
        }
        // If state is null or model is absent, retain the current display —
        // this is normal during the brief window between session open and the
        // first `get_state` round-trip.
      })
      .catch(() => {
        // getRpcState rejected (e.g. session closed mid-flight). Keep the
        // last known model rather than blanking the display.
      })
  }, [sessionId])

  // Fetch model on mount (and whenever sessionId changes — tab switch).
  useEffect(() => {
    fetchModel()
  }, [fetchModel])

  // Subscribe to session events for live cost + model-refresh.
  useEffect(() => {
    const unsub = window.gsd.onEvent(sessionId, (event: SessionEvent) => {
      if (event.type === 'cost_update') {
        // RpcCostUpdateEvent carries cumulativeCost — use it directly rather than
        // summing turnCost to avoid drift from missed or out-of-order events.
        // SessionEvent uses [key: string]: unknown, so we extract via type assertion
        // and guard with a typeof check before applying.
        const cumulativeCost = (event as unknown as RpcCostUpdateEvent).cumulativeCost
        if (typeof cumulativeCost === 'number') {
          setCost(cumulativeCost)
        }
      } else if (event.type === 'execution_complete') {
        // Refresh model info after the turn — the user may have switched models
        // since the last fetch, and execution_complete is the earliest reliable
        // signal that the new model is reflected in RPC state.
        fetchModel()
      }
    })
    return unsub
  }, [sessionId, fetchModel])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-1.5 text-xs text-neutral-400"
      data-testid="session-header-bar"
    >
      {/* Model chip — interactive dropdown replaces the plain <span> */}
      <ModelPickerDropdown
        sessionId={sessionId}
        currentModel={model}
        onModelSelected={handleModelSelected}
      />

      {/* Visual separator */}
      <span className="select-none text-neutral-600" aria-hidden="true">
        ·
      </span>

      {/* Cost — tabular-nums keeps digits from shifting during streaming updates */}
      <span className="shrink-0 tabular-nums" title="Cumulative session cost (USD)">
        {formatCost(cost)}
      </span>
    </div>
  )
}

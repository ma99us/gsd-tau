/**
 * ContextGauge — live context-window fill indicator in the session header.
 *
 * Shows a coloured progress bar (green < 60%, amber 60–85%, red ≥ 85%) with a
 * percentage label.  Clicking opens an inline popover with a token breakdown
 * (input / output / cache read / cache write / total) and a Compact button.
 *
 * When `contextWindow` is absent (unknown model), falls back to a raw
 * "Context Nk tokens" label with no bar.
 *
 * Refresh strategy:
 * - On mount (and sessionId change): `getSessionStats` for the initial snapshot.
 * - On `cost_update` events: updates tokens from the event payload (1 Hz throttle).
 * - On `execution_complete` events: re-fetches via `getSessionStats`.
 *
 * The `isCompacting` flag prevents duplicate in-flight compact calls.  It is
 * cleared in the `finally` block so a failed compact never leaves the button
 * permanently disabled.
 *
 * Props:
 *   sessionId     — stable RPC session id for IPC calls and event subscription
 *   contextWindow — model context-window size in tokens; absent = fallback mode
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SessionId, SessionEvent, RpcCostUpdateEvent } from '@shared/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ContextGaugeProps {
  /** Stable RPC session id used for IPC calls and event subscription. */
  sessionId: SessionId
  /**
   * Model context-window size in tokens.
   * When absent, the gauge renders as a raw "Context Nk tokens" label (no bar).
   */
  contextWindow?: number
}

// ── Internal types ────────────────────────────────────────────────────────────

interface TokenCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// ── Exported pure helpers (tested in isolation) ───────────────────────────────

/**
 * Map a fill fraction (0–1+) to a colour tier.
 * Returns `'neutral'` when `pct` is null (no data yet or fallback mode).
 *
 * Thresholds:
 *   - green  : 0 ≤ pct < 0.60
 *   - amber  : 0.60 ≤ pct < 0.85
 *   - red    : pct ≥ 0.85
 */
export function computeGaugeColour(
  pct: number | null,
): 'green' | 'amber' | 'red' | 'neutral' {
  if (pct === null) return 'neutral'
  if (pct >= 0.85) return 'red'
  if (pct >= 0.60) return 'amber'
  return 'green'
}

/**
 * Compute the fill fraction from token counts and a context-window size.
 * Returns `null` when either argument is absent/falsy (renders fallback).
 */
export function computeGaugePct(
  tokens: TokenCounts | null,
  contextWindow: number | undefined,
): number | null {
  if (!tokens || !contextWindow) return null
  const total =
    tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
  return total / contextWindow
}

/**
 * Format a raw token count as a compact "Nk" string.
 * Values ≥ 1 000 are rounded to the nearest thousand and suffixed with "k".
 *
 * @example formatTokensK(133600) → "134k"
 * @example formatTokensK(512)    → "512"
 */
export function formatTokensK(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

// ── CSS helpers ───────────────────────────────────────────────────────────────

const BAR_COLOUR_CLASS: Record<ReturnType<typeof computeGaugeColour>, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
  neutral: 'bg-neutral-600',
}

const TEXT_COLOUR_CLASS: Record<ReturnType<typeof computeGaugeColour>, string> = {
  green: 'text-green-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  neutral: 'text-neutral-400',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ContextGauge({
  sessionId,
  contextWindow,
}: ContextGaugeProps): JSX.Element {
  const [tokens, setTokens] = useState<TokenCounts | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  // Timestamp of the last cost_update that triggered a state update.
  // Guards the 1 Hz throttle without requiring a setInterval.
  const lastCostUpdateRef = useRef<number>(0)
  // Wrapper ref for click-outside detection.
  const wrapperRef = useRef<HTMLDivElement>(null)

  /**
   * Fetch the latest token counts from the main process.
   * Used on mount and after `execution_complete` events.
   * Memoised on `sessionId` so it is stable as a useEffect dependency.
   */
  const fetchStats = useCallback((): void => {
    window.gsd
      .getSessionStats(sessionId)
      .then((stats) => {
        if (stats?.tokens) {
          setTokens({
            input: stats.tokens.input,
            output: stats.tokens.output,
            cacheRead: stats.tokens.cacheRead,
            cacheWrite: stats.tokens.cacheWrite,
          })
        }
      })
      .catch(() => {
        // Keep the last known snapshot on transient error — the gauge stays
        // visible rather than blanking during a brief IPC hiccup.
      })
  }, [sessionId])

  // Initial snapshot.
  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Live updates from event stream.
  useEffect(() => {
    const unsub = window.gsd.onEvent(sessionId, (event: SessionEvent) => {
      if (event.type === 'cost_update') {
        // 1 Hz throttle: skip events that arrive within the same second window.
        const now = Date.now()
        if (now - lastCostUpdateRef.current < 1000) return
        lastCostUpdateRef.current = now

        const ev = event as unknown as RpcCostUpdateEvent
        // ev.tokens is guaranteed by the contracts type — guard defensively.
        if (ev.tokens && typeof ev.tokens.input === 'number') {
          setTokens({
            input: ev.tokens.input,
            output: ev.tokens.output,
            cacheRead: ev.tokens.cacheRead,
            cacheWrite: ev.tokens.cacheWrite,
          })
        }
      } else if (event.type === 'execution_complete') {
        // Re-fetch after each turn so the gauge reflects the settled total.
        fetchStats()
      }
    })
    return unsub
  }, [sessionId, fetchStats])

  // Click-outside dismisses the popover.
  useEffect(() => {
    if (!isOpen) return
    function handleMouseDown(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  /** Fire compact(), guarded by isCompacting to prevent duplicate in-flight calls. */
  async function handleCompact(): Promise<void> {
    if (isCompacting) return
    setIsCompacting(true)
    try {
      await window.gsd.compact(sessionId)
    } catch (err) {
      // Log but do not surface in the UI — the gauge will refresh on the next
      // cost_update or execution_complete that follows a successful compaction.
      console.error('[ContextGauge] compact() failed', err)
    } finally {
      // Always clear the flag so the button never becomes permanently disabled.
      setIsCompacting(false)
    }
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const total =
    tokens !== null
      ? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
      : null

  const pct = computeGaugePct(tokens, contextWindow)
  const colour = computeGaugeColour(pct)

  // ── Fallback: no contextWindow ───────────────────────────────────────────────

  if (!contextWindow) {
    return (
      <span
        className="shrink-0 font-mono text-xs text-neutral-400"
        title="Context token count"
        data-testid="context-gauge-fallback"
      >
        {total !== null ? `Context ${formatTokensK(total)} tokens` : 'Context —'}
      </span>
    )
  }

  // ── Bar + inline popover ─────────────────────────────────────────────────────

  const pctDisplay = pct !== null ? `${Math.round(pct * 100)}%` : '—'
  const barWidthPct =
    pct !== null ? `${Math.min(pct * 100, 100).toFixed(1)}%` : '0%'

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      {/* Trigger button */}
      <button
        className={`flex items-center gap-1.5 font-mono text-xs ${TEXT_COLOUR_CLASS[colour]} hover:opacity-80 focus:outline-none`}
        title="Context window usage — click for breakdown"
        aria-label="Context window usage"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => setIsOpen((v) => !v)}
        data-testid="context-gauge"
      >
        {/* Visually-hidden prefix for assistive technology */}
        <span className="sr-only">Context</span>

        {/* Progress bar track */}
        <span
          className="relative inline-flex h-1.5 w-16 overflow-hidden rounded-full bg-neutral-700"
          aria-hidden="true"
        >
          <span
            className={`absolute left-0 top-0 h-full rounded-full transition-[width] duration-300 ${BAR_COLOUR_CLASS[colour]}`}
            style={{ width: barWidthPct }}
          />
        </span>

        {/* Percentage label */}
        <span className="tabular-nums">{pctDisplay}</span>
      </button>

      {/* Inline popover — absolutely positioned below the trigger */}
      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded border border-neutral-700 bg-neutral-900 p-3 text-xs shadow-xl"
          role="dialog"
          aria-label="Context window breakdown"
          data-testid="context-gauge-popover"
        >
          {/* Token breakdown table */}
          <div className="mb-3 space-y-1 font-mono">
            <div className="flex justify-between text-neutral-300">
              <span>Input</span>
              <span className="tabular-nums">
                {tokens !== null ? tokens.input.toLocaleString() : '—'}
              </span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Output</span>
              <span className="tabular-nums">
                {tokens !== null ? tokens.output.toLocaleString() : '—'}
              </span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Cache read</span>
              <span className="tabular-nums">
                {tokens !== null ? tokens.cacheRead.toLocaleString() : '—'}
              </span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Cache write</span>
              <span className="tabular-nums">
                {tokens !== null ? tokens.cacheWrite.toLocaleString() : '—'}
              </span>
            </div>
            {/* Divider */}
            <div className="my-1 border-t border-neutral-700" />
            <div className="flex justify-between font-semibold text-neutral-200">
              <span>Total</span>
              <span className="tabular-nums">
                {total !== null ? total.toLocaleString() : '—'} /{' '}
                {contextWindow.toLocaleString()} ({pctDisplay})
              </span>
            </div>
          </div>

          {/* Compact button */}
          <button
            className="w-full rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-center text-xs text-neutral-300 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none"
            onClick={handleCompact}
            disabled={isCompacting}
            data-testid="compact-button"
          >
            {isCompacting ? 'Compacting…' : 'Compact context'}
          </button>
        </div>
      )}
    </div>
  )
}

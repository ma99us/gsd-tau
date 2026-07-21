/**
 * QuotaWidget — compact Copilot quota indicator in the session header bar.
 *
 * Shows "Copilot ████████░░ 78% ✅" when authenticated and data is available.
 * Clicking opens a Radix Popover with used / remaining / reset date, burn
 * rates, projection, and last-updated time.  When unauthenticated shows a
 * "Connect GitHub" button that starts the device-code auth flow.
 *
 * Account-wide singleton — no sessionId prop.  Quota is shared across all
 * sessions and pushed to every renderer via the QUOTA_UPDATE channel.
 *
 * State lifecycle:
 * - Mount: `getQuota()` fetches the last cached snapshot from the service.
 * - Live: `onQuotaUpdate()` subscribes to service push events.
 * - On demand: `refreshQuota()` triggers an immediate API fetch.
 * - Auth: `startQuotaAuth()` launches the GitHub device-code flow.
 * - Disconnect: `disconnectQuotaAuth()` removes the stored token.
 *
 * Graceful degradation:
 * - `null` snapshot → "Connect GitHub" unauthenticated state.
 * - `snapshot.login === null` → same unauthenticated state.
 * - `snapshot.stale === true` → stale indicator alongside bar.
 * - Missing projection fields → '—' in popover rows.
 * - Any IPC rejection is caught and logged; UI retains last known state.
 */

import { useState, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { QuotaSnapshot, QuotaVerdict } from '@shared/types'

// ── Exported pure helpers (tested in isolation) ───────────────────────────────

/**
 * Map a `QuotaVerdict` to a single emoji for the compact header bar.
 * Returns `'—'` for `'unknown'` and any unexpected value.
 */
export function verdictIcon(verdict: QuotaVerdict): string {
  switch (verdict) {
    case 'safe':    return '✅'
    case 'tight':   return '⚠️'
    case 'overage': return '🔴'
    case 'runout':  return '❌'
    default:        return '—'
  }
}

/**
 * Format a percentage value (0–100) for display.
 * Returns `'—'` when the value is null.
 */
export function formatPercent(pct: number | null): string {
  if (pct === null) return '—'
  return `${Math.round(pct)}%`
}

/**
 * Format an ISO-8601 date string as a short locale label (e.g. "Aug 1").
 * Returns `'—'` when the value is null or unparseable.
 */
export function formatResetDate(resetDateUtc: string | null): string {
  if (!resetDateUtc) return '—'
  try {
    return new Date(resetDateUtc).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return resetDateUtc
  }
}

/**
 * Format a numeric burn-rate to one decimal place.
 * Returns `'—'` when the value is null.
 */
export function formatBurnRate(value: number | null): string {
  if (value === null) return '—'
  return value.toFixed(1)
}

// ── Colour maps ───────────────────────────────────────────────────────────────

const VERDICT_TEXT_CLASS: Record<QuotaVerdict, string> = {
  safe:    'text-green-400',
  tight:   'text-amber-400',
  overage: 'text-red-400',
  runout:  'text-red-500',
  unknown: 'text-neutral-400',
}

const VERDICT_BAR_CLASS: Record<QuotaVerdict, string> = {
  safe:    'bg-green-500',
  tight:   'bg-amber-400',
  overage: 'bg-red-400',
  runout:  'bg-red-500',
  unknown: 'bg-neutral-600',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuotaWidget(): JSX.Element {
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | null>(null)
  const [isRefreshing, setIsRefreshing]   = useState(false)
  const [isConnecting, setIsConnecting]   = useState(false)
  const [isOpen,       setIsOpen]         = useState(false)

  // Fetch the latest cached snapshot on mount, then subscribe to live pushes.
  useEffect(() => {
    void window.gsd.getQuota().then(setSnapshot)
    return window.gsd.onQuotaUpdate(setSnapshot)
  }, [])

  /** Start the GitHub device-code auth flow. */
  function handleConnect(): void {
    if (isConnecting) return
    setIsConnecting(true)
    window.gsd
      .startQuotaAuth()
      .catch((err: unknown) => {
        console.error('[QuotaWidget] startQuotaAuth failed', err)
      })
      .finally(() => setIsConnecting(false))
  }

  /** Trigger an on-demand quota refresh and apply the returned snapshot. */
  function handleRefresh(): void {
    if (isRefreshing) return
    setIsRefreshing(true)
    window.gsd
      .refreshQuota()
      .then((fresh) => {
        if (fresh !== null) setSnapshot(fresh)
      })
      .catch((err: unknown) => {
        console.error('[QuotaWidget] refreshQuota failed', err)
      })
      .finally(() => setIsRefreshing(false))
  }

  /** Disconnect the stored GitHub token and reset to unauthenticated state. */
  function handleDisconnect(): void {
    window.gsd
      .disconnectQuotaAuth()
      .then(() => {
        setSnapshot(null)
        setIsOpen(false)
      })
      .catch((err: unknown) => {
        console.error('[QuotaWidget] disconnectQuotaAuth failed', err)
      })
  }

  // ── Unauthenticated state ──────────────────────────────────────────────────
  // Show the "Connect GitHub" button when:
  //   1. No snapshot has been received yet (service returned null = no token).
  //   2. Snapshot explicitly carries login === null (unauthenticated snapshot).

  if (snapshot === null || snapshot.login === null) {
    return (
      <button
        className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-300 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none"
        onClick={handleConnect}
        disabled={isConnecting}
        title="Connect GitHub account to see Copilot quota"
        data-testid="quota-connect-button"
      >
        {isConnecting ? 'Connecting…' : 'Connect GitHub'}
      </button>
    )
  }

  // ── Authenticated state ────────────────────────────────────────────────────

  const verdict     = snapshot.verdict
  const pct         = snapshot.percentRemaining ?? null
  // Bar fill = percent remaining (78% remaining → bar 78% filled).
  const barWidthPct = pct !== null ? `${Math.min(pct, 100).toFixed(1)}%` : '0%'
  const textClass   = VERDICT_TEXT_CLASS[verdict] ?? VERDICT_TEXT_CLASS.unknown
  const barClass    = VERDICT_BAR_CLASS[verdict]  ?? VERDICT_BAR_CLASS.unknown

  const lastUpdated = new Date(snapshot.fetchedAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>

      {/* ── Trigger: compact bar shown inline in the header ──────────────── */}
      <Popover.Trigger asChild>
        <button
          className={`flex shrink-0 items-center gap-1.5 font-mono text-xs ${textClass} hover:opacity-80 focus:outline-none`}
          title="Copilot quota — click for details"
          aria-label="Copilot quota"
          data-testid="quota-widget"
        >
          {/* Visually-hidden label for assistive technology */}
          <span className="sr-only">Copilot</span>

          {/* Progress bar track */}
          <span
            className="relative inline-flex h-1.5 w-16 overflow-hidden rounded-full bg-neutral-700"
            aria-hidden="true"
          >
            <span
              className={`absolute left-0 top-0 h-full rounded-full transition-[width] duration-300 ${barClass}`}
              style={{ width: barWidthPct }}
            />
          </span>

          {/* Percentage label */}
          <span className="tabular-nums">{formatPercent(pct)}</span>

          {/* Verdict icon (emoji) */}
          <span aria-hidden="true">{verdictIcon(verdict)}</span>

          {/* Stale indicator — visible when the last API fetch failed */}
          {snapshot.stale && (
            <span
              className="text-neutral-500"
              title="Stale — last known values (network unavailable)"
              aria-label="stale data"
            >
              ↻
            </span>
          )}
        </button>
      </Popover.Trigger>

      {/* ── Popover: quota details ─────────────────────────────────────────── */}
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-72 rounded border border-neutral-700 bg-neutral-900 p-3 text-xs shadow-xl"
          sideOffset={6}
          align="end"
          data-testid="quota-popover"
        >
          {/* Header row */}
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-neutral-200">Copilot Quota</span>
            <span className="text-neutral-500">{snapshot.login}</span>
          </div>

          {/* Usage summary */}
          <div className="mb-3 space-y-1 font-mono">
            <div className="flex justify-between text-neutral-300">
              <span>Used</span>
              <span className="tabular-nums">
                {snapshot.used?.toLocaleString() ?? '—'}
                {' / '}
                {snapshot.entitlement?.toLocaleString() ?? '—'}
              </span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Remaining</span>
              <span className={`tabular-nums ${textClass}`}>
                {snapshot.remaining?.toLocaleString() ?? '—'}
                {pct !== null ? ` (${formatPercent(pct)})` : ''}
              </span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Resets</span>
              <span className="tabular-nums">{formatResetDate(snapshot.resetDateUtc)}</span>
            </div>
            {snapshot.stale && (
              <div className="pt-0.5 italic text-neutral-500">
                ⚠ Stale data — last known values
              </div>
            )}
          </div>

          {/* Burn rates — only shown when projection data is available */}
          {snapshot.projection !== null && (
            <>
              <div className="my-2 border-t border-neutral-700" />
              <div className="mb-2 space-y-1 font-mono">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
                  Burn Rates
                </div>

                {snapshot.projection.burnLast24h !== null && (
                  <div className="flex justify-between text-neutral-300">
                    <span>Last 24 h</span>
                    <span className="tabular-nums">
                      {formatBurnRate(snapshot.projection.burnLast24h)} req
                    </span>
                  </div>
                )}

                {snapshot.projection.burnLast7d !== null && (
                  <div className="flex justify-between text-neutral-300">
                    <span>Last 7 d</span>
                    <span className="tabular-nums">
                      {formatBurnRate(snapshot.projection.burnLast7d)} req
                    </span>
                  </div>
                )}

                {snapshot.projection.burnPerDay !== null && (
                  <div className="flex justify-between text-neutral-300">
                    <span>Avg / day</span>
                    <span className="tabular-nums">
                      {formatBurnRate(snapshot.projection.burnPerDay)} req
                    </span>
                  </div>
                )}

                {snapshot.projection.projectedAtReset !== null && (
                  <div className="flex justify-between text-neutral-300">
                    <span>Proj. at reset</span>
                    <span className="tabular-nums">
                      {snapshot.projection.projectedAtReset.toLocaleString()} rem.
                    </span>
                  </div>
                )}

                {snapshot.projection.safeDailyBudget !== null && (
                  <div className="flex justify-between text-neutral-400">
                    <span>Budget / day</span>
                    <span className="tabular-nums">
                      {formatBurnRate(snapshot.projection.safeDailyBudget)} req
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Footer: last-updated + refresh + disconnect */}
          <div className="my-1 border-t border-neutral-700" />
          <div className="flex items-center justify-between pt-1.5">
            <span className="text-neutral-500">Updated {lastUpdated}</span>
            <div className="flex gap-3">
              <button
                className="text-neutral-400 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title="Refresh quota now"
                data-testid="quota-refresh-button"
              >
                {isRefreshing ? 'Refreshing…' : '↻ Refresh'}
              </button>
              <button
                className="text-neutral-500 hover:text-red-400 focus:outline-none"
                onClick={handleDisconnect}
                title="Disconnect GitHub account"
                data-testid="quota-disconnect-button"
              >
                Disconnect
              </button>
            </div>
          </div>

          <Popover.Arrow className="fill-neutral-700" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

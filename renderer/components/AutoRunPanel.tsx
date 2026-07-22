/**
 * AutoRunPanel — live auto-mode progress tree for the session panel.
 *
 * Renders a milestone → slice → task tree with status icons, a replan marker
 * on replanned slices, and a footer showing cumulative cost and wall-clock time.
 *
 * This component is **purely prop-driven** in S03 — it does not call
 * `window.gsd.onProgressUpdate` or any IPC method.  S04 wires it into
 * SessionView and feeds it a live `GsdProgress` snapshot.
 *
 * All display logic is extracted as pure exported helper functions so the Node
 * vitest environment can cover them without DOM or jsdom.
 *
 * Props:
 *   progress   — GsdProgress snapshot (null milestone → placeholder)
 *   onPause    — callback fired when the Pause button is clicked
 *   onRefresh  — callback fired when the Refresh button is clicked
 */

import type {
  GsdProgress,
  GsdMilestone,
  GsdSlice,
  GsdTask,
  GsdNodeStatus,
} from '@shared/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AutoRunPanelProps {
  /** Current auto-run progress snapshot. Null milestone renders a placeholder. */
  progress: GsdProgress
  /** Called when the user clicks the Pause button. */
  onPause: () => void
  /** Called when the user clicks the Refresh button. */
  onRefresh: () => void
}

// ── Exported pure helpers (tested in AutoRunPanel.test.ts) ────────────────────

/**
 * Map a GsdNodeStatus to a display icon string.
 *
 * Mapping:
 *   complete   → ✓  (checkmark — work done)
 *   in-progress → ▶  (play — currently executing)
 *   skipped    → —  (em-dash — intentionally omitted)
 *   pending    → ○  (circle — not yet started)
 */
export function statusIcon(status: GsdNodeStatus): string {
  switch (status) {
    case 'complete':    return '✓'
    case 'in-progress': return '▶'
    case 'skipped':     return '—'
    case 'pending':     return '○'
    default: {
      // Exhaustiveness guard — TypeScript will catch missing cases at compile
      // time; this branch fires only if the JSON payload contains an unknown
      // string that escaped type-checking (e.g. a future pi version).
      const _: never = status
      void _
      return '?'
    }
  }
}

/**
 * Format a USD cost value as a two-decimal dollar string.
 *
 * @example formatCost(0)      → "$0.00"
 * @example formatCost(1.234)  → "$1.23"
 * @example formatCost(0.005)  → "$0.01"
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/**
 * Format a wall-clock elapsed duration as a human-readable string.
 *
 * Returns "—" when `startedAt` is null (not yet started).
 * Returns elapsed time in the most appropriate unit:
 *   - Under 60 seconds: "42s"
 *   - 60 seconds to under 1 hour: "1m 23s"
 *   - 1 hour or more: "1h 23m"
 *
 * @param startedAt  ISO-8601 timestamp when auto-mode started.
 * @param nowMs      Current epoch milliseconds.  Defaults to `Date.now()`.
 *                   Pass an explicit value in tests to avoid time-dependence.
 */
export function formatElapsed(
  startedAt: string | null,
  nowMs: number = Date.now(),
): string {
  if (startedAt === null) return '—'

  const startMs = new Date(startedAt).getTime()
  if (Number.isNaN(startMs)) return '—'

  const totalSec = Math.max(0, Math.floor((nowMs - startMs) / 1000))

  if (totalSec < 60) {
    return `${totalSec}s`
  }

  const totalMin = Math.floor(totalSec / 60)
  const sec = totalSec % 60

  if (totalMin < 60) {
    return `${totalMin}m ${sec}s`
  }

  const hours = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return `${hours}h ${min}m`
}

/**
 * Derive the footer label strings from a milestone snapshot.
 *
 * Returns placeholder labels when `milestone` is null.
 *
 * @example
 * computePanelFooter(null)
 * // → { costLabel: '$0.00', elapsedLabel: '—' }
 */
export function computePanelFooter(
  milestone: GsdMilestone | null,
  nowMs: number = Date.now(),
): { costLabel: string; elapsedLabel: string } {
  if (milestone === null) {
    return { costLabel: '$0.00', elapsedLabel: '—' }
  }
  return {
    costLabel: formatCost(milestone.cumulativeCostUsd),
    elapsedLabel: formatElapsed(milestone.autoStartedAt, nowMs),
  }
}

// ── CSS helpers ───────────────────────────────────────────────────────────────

const STATUS_COLOUR_CLASS: Record<GsdNodeStatus, string> = {
  'complete':    'text-green-400',
  'in-progress': 'text-blue-400',
  'skipped':     'text-neutral-500',
  'pending':     'text-neutral-400',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TaskRow({ task, isCurrent }: { task: GsdTask; isCurrent: boolean }): JSX.Element {
  return (
    <li
      className={`flex items-center gap-1.5 py-0.5 pl-8 text-xs ${
        isCurrent ? 'text-neutral-100' : 'text-neutral-400'
      }`}
      aria-current={isCurrent ? 'step' : undefined}
    >
      <span
        className={`shrink-0 font-mono ${STATUS_COLOUR_CLASS[task.status]}`}
        aria-label={`Status: ${task.status}`}
      >
        {statusIcon(task.status)}
      </span>
      <span className="truncate">{task.title}</span>
    </li>
  )
}

function SliceRow({
  slice,
  isCurrent,
  currentTaskId,
}: {
  slice: GsdSlice
  isCurrent: boolean
  currentTaskId: string | null
}): JSX.Element {
  return (
    <li>
      {/* Slice header row */}
      <div
        className={`flex items-center gap-1.5 py-0.5 pl-4 text-xs ${
          isCurrent ? 'text-neutral-200 font-medium' : 'text-neutral-400'
        }`}
        aria-current={isCurrent ? 'step' : undefined}
      >
        <span
          className={`shrink-0 font-mono ${STATUS_COLOUR_CLASS[slice.status]}`}
          aria-label={`Status: ${slice.status}`}
        >
          {statusIcon(slice.status)}
        </span>
        <span className="truncate">{slice.title}</span>

        {/* Replan badge — shown only when gsd_replan_slice was called */}
        {slice.replanned && (
          <span
            className="ml-1 shrink-0 rounded bg-amber-900/60 px-1 py-px text-[10px] font-semibold text-amber-300"
            title={slice.replanNote ?? 'Slice was replanned'}
            data-testid="replan-badge"
          >
            replanned
          </span>
        )}
      </div>

      {/* Task list */}
      {slice.tasks.length > 0 && (
        <ul aria-label={`Tasks for ${slice.title}`}>
          {slice.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isCurrent={isCurrent && task.id === currentTaskId}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function MilestoneTree({
  milestone,
  currentSliceId,
  currentTaskId,
}: {
  milestone: GsdMilestone
  currentSliceId: string | null
  currentTaskId: string | null
}): JSX.Element {
  return (
    <section aria-label={`Milestone ${milestone.id}`}>
      {/* Milestone header */}
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-neutral-200">
        <span
          className={`shrink-0 font-mono ${STATUS_COLOUR_CLASS[milestone.status]}`}
          aria-label={`Status: ${milestone.status}`}
        >
          {statusIcon(milestone.status)}
        </span>
        <span className="truncate">
          {milestone.id}: {milestone.title}
        </span>
      </div>

      {/* Slice list */}
      {milestone.slices.length > 0 && (
        <ul aria-label={`Slices for ${milestone.title}`} className="pb-1">
          {milestone.slices.map((slice) => (
            <SliceRow
              key={slice.id}
              slice={slice}
              isCurrent={slice.id === currentSliceId}
              currentTaskId={currentTaskId}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

// ── AutoRunPanel ──────────────────────────────────────────────────────────────

export function AutoRunPanel({
  progress,
  onPause,
  onRefresh,
}: AutoRunPanelProps): JSX.Element {
  const { milestone, currentSliceId, currentTaskId } = progress
  const { costLabel, elapsedLabel } = computePanelFooter(milestone)

  return (
    <div
      className="flex flex-col overflow-hidden rounded border border-neutral-700 bg-neutral-900 text-neutral-300"
      data-testid="auto-run-panel"
      aria-label="Auto-run progress"
    >
      {/* Header toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-700 px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Auto-run
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:outline-none"
            title="Refresh progress"
            aria-label="Refresh progress"
            data-testid="refresh-button"
          >
            ↺
          </button>
          <button
            type="button"
            onClick={onPause}
            className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:outline-none"
            title="Pause auto-run"
            aria-label="Pause auto-run"
            data-testid="pause-button"
          >
            ⏸ Pause
          </button>
        </div>
      </div>

      {/* Progress tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {milestone === null ? (
          <p className="px-3 py-2 text-xs text-neutral-500" data-testid="no-milestone">
            No active milestone
          </p>
        ) : (
          <MilestoneTree
            milestone={milestone}
            currentSliceId={currentSliceId}
            currentTaskId={currentTaskId}
          />
        )}
      </div>

      {/* Footer: cost + elapsed */}
      <div
        className="flex shrink-0 items-center justify-between border-t border-neutral-700 px-3 py-1 text-[10px] text-neutral-500"
        data-testid="panel-footer"
      >
        <span data-testid="cost-label">{costLabel}</span>
        <span data-testid="elapsed-label">{elapsedLabel}</span>
      </div>
    </div>
  )
}

import type { RpcExtensionUIRequest } from '@shared/types'

// ── Narrowed request types ────────────────────────────────────────────────────

type SetStatusRequest = Extract<RpcExtensionUIRequest, { method: 'setStatus' }>
type SetWidgetRequest = Extract<RpcExtensionUIRequest, { method: 'setWidget' }>
type SetTitleRequest = Extract<RpcExtensionUIRequest, { method: 'setTitle' }>

// Re-export so tests can import them without re-deriving.
export type { SetStatusRequest, SetWidgetRequest, SetTitleRequest }

// ── State model ───────────────────────────────────────────────────────────────

export interface StatusBarState {
  /** Map of statusKey → statusText (undefined means the slot was cleared). */
  statuses: Record<string, string | undefined>
  /** Map of widgetKey → lines (undefined means the widget was cleared). */
  widgets: Record<string, string[] | undefined>
  /** Title set by setTitle, or null if none has been sent this session. */
  title: string | null
}

/** Initial empty state — use as the reset value on session open. */
export const emptyStatusBarState: StatusBarState = {
  statuses: {},
  widgets: {},
  title: null,
}

// ── Pure state-transition helpers (exported for unit tests) ───────────────────

/**
 * Apply a `setStatus` request to current state.
 * A `statusText` of `undefined` clears the slot from the display.
 */
export function applySetStatus(
  state: StatusBarState,
  req: SetStatusRequest,
): StatusBarState {
  return {
    ...state,
    statuses: { ...state.statuses, [req.statusKey]: req.statusText },
  }
}

/**
 * Apply a `setWidget` request to current state.
 * A `widgetLines` of `undefined` removes the widget from the display.
 */
export function applySetWidget(
  state: StatusBarState,
  req: SetWidgetRequest,
): StatusBarState {
  return {
    ...state,
    widgets: { ...state.widgets, [req.widgetKey]: req.widgetLines },
  }
}

/**
 * Apply a `setTitle` request to current state.
 */
export function applySetTitle(
  state: StatusBarState,
  req: SetTitleRequest,
): StatusBarState {
  return { ...state, title: req.title }
}

// ── Component ─────────────────────────────────────────────────────────────────

export type StatusBarProps = StatusBarState

/**
 * Persistent status region rendered below the session header.
 *
 * Shows:
 *  - setTitle:  display-name override for the session
 *  - setStatus: per-key text slots (empty / undefined keys are hidden)
 *  - setWidget: per-key line-array widgets (empty / undefined widgets are hidden)
 *
 * Returns null when there is nothing to display so it takes up no space.
 */
export function StatusBar({ statuses, widgets, title }: StatusBarProps): JSX.Element | null {
  const statusEntries = Object.entries(statuses).filter(
    ([, text]) => text !== undefined && text !== '',
  ) as [string, string][]

  const widgetEntries = Object.entries(widgets).filter(
    ([, lines]) => lines !== undefined && lines.length > 0,
  ) as [string, string[]][]

  const hasContent =
    statusEntries.length > 0 || widgetEntries.length > 0 || title !== null

  if (!hasContent) return null

  return (
    <div
      className="shrink-0 border-b border-neutral-700 bg-neutral-900/80 px-4 py-1.5 text-xs"
      aria-label="Status bar"
      data-testid="status-bar"
    >
      {/* Title slot */}
      {title !== null && (
        <div
          className="font-medium text-neutral-300"
          data-testid="status-bar-title"
        >
          {title}
        </div>
      )}

      {/* Status text slots — one row per key */}
      {statusEntries.map(([key, text]) => (
        <div
          key={key}
          className="text-neutral-400"
          data-testid={`status-${key}`}
        >
          {text}
        </div>
      ))}

      {/* Widget slots — per-key line arrays */}
      {widgetEntries.map(([key, lines]) => (
        <div key={key} className="mt-0.5" data-testid={`widget-${key}`}>
          {lines.map((line, i) => (
            // Index key is correct here: lines are positional within a widget
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className="text-neutral-400">
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

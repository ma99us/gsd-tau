import { Tray, Menu, app, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { SessionId } from '../../shared/types'
import type { SessionState } from '../session/state-machine'

// ── Icon colour palette ────────────────────────────────────────────────────────

/**
 * Aggregate tray state derived from all open sessions.
 * Priority: Waiting > Stopped > Working > Idle (empty = Idle).
 */
export type TrayAggregateState = 'idle' | 'working' | 'waiting' | 'stopped'

/** RGBA triplets for each aggregate tray state. */
const ICON_COLOURS: Record<TrayAggregateState, { r: number; g: number; b: number }> = {
  idle:    { r: 128, g: 128, b: 128 }, // grey
  working: { r:  59, g: 130, b: 246 }, // blue-500
  waiting: { r: 239, g:  68, b:  68 }, // red-500
  stopped: { r: 245, g: 158, b:  11 }, // amber-500
}

/** Unicode prefix shown beside each session in the right-click context menu. */
const STATE_EMOJI: Record<SessionState, string> = {
  Waiting: '●',
  Working: '◌',
  Stopped: '✕',
  Idle:    '–',
}

// ── Icon helper ───────────────────────────────────────────────────────────────

/**
 * Create a 16×16 solid-colour NativeImage from raw RGBA bytes.
 *
 * Uses `nativeImage.createFromBuffer()` with explicit `{ width, height }` so
 * no PNG header is required — the buffer is raw RGBA bytes only.
 */
function makeIcon(r: number, g: number, b: number) {
  const buf = Buffer.alloc(16 * 16 * 4)
  for (let i = 0; i < 16 * 16; i++) {
    buf[i * 4 + 0] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = 255
  }
  return nativeImage.createFromBuffer(buf, { width: 16, height: 16 })
}

// ── TrayManager ───────────────────────────────────────────────────────────────

export interface TrayManagerOptions {
  /**
   * Schedule function for batching rapid `update()` calls.
   * Defaults to `setImmediate`. Tests inject `(fn) => fn()` for synchronous
   * execution.
   */
  schedule?: (fn: () => void) => void
}

/**
 * Manages the Windows system tray icon for gsd-tau.
 *
 * The icon colour and tooltip reflect the aggregate state of all open sessions:
 * Waiting (red) > Stopped (amber) > Working (blue) > Idle (grey).
 *
 * Right-click shows each session as a labelled menu item; clicking any item
 * calls `onFocusWindow` to bring the main window to the foreground. A Quit
 * item is always present at the bottom.
 *
 * Lifecycle:
 * 1. Construct with `new TrayManager(() => focusMainWindow())`
 * 2. Call `init()` after `app.whenReady()` — creating a Tray before then throws
 * 3. Call `update(sessionMap)` on every session state change or open/close
 * 4. Call `destroy()` on `app.on('will-quit')`
 *
 * Rapid `update()` calls are coalesced: only the last map passed before the
 * scheduled tick is applied, so startup restore does not trigger many Tray
 * redraws.
 */
export class TrayManager {
  private _tray: Tray | null = null
  private _pendingUpdate: Map<SessionId, SessionState> | null = null
  private _updateScheduled = false

  private readonly _onFocusWindow: () => void
  private readonly _schedule: (fn: () => void) => void

  constructor(onFocusWindow: () => void, opts?: TrayManagerOptions) {
    this._onFocusWindow = onFocusWindow
    this._schedule = opts?.schedule ?? ((fn) => setImmediate(fn))
  }

  /**
   * Create the `Tray` instance. Must be called after `app.whenReady()`.
   * Creating a `Tray` before the app is ready throws `"Cannot create Tray"`.
   */
  init(): void {
    const { r, g, b } = ICON_COLOURS.idle
    this._tray = new Tray(makeIcon(r, g, b))
    this._tray.setToolTip('gsd-tau')
    // Render an initial empty-session menu so right-click is never undefined.
    this._applyUpdate(new Map())
    console.log('[tray] init')
  }

  /**
   * Update the tray to reflect the current session states.
   *
   * Map keys are used as display labels in the context menu — pass
   * `basename(cwd)` rather than raw UUIDs for human-readable labels.
   *
   * Calls are batched: rapid back-to-back invocations coalesce into a single
   * `setContextMenu` / `setImage` / `setToolTip` round-trip per scheduled tick.
   *
   * Safe to call before `init()` — the pending update is silently consumed
   * when the deferred callback fires; if the tray was not yet created by then
   * the update is a no-op.
   */
  update(sessions: Map<SessionId, SessionState>): void {
    this._pendingUpdate = new Map(sessions)
    if (!this._updateScheduled) {
      this._updateScheduled = true
      this._schedule(() => {
        this._updateScheduled = false
        if (this._pendingUpdate !== null) {
          this._applyUpdate(this._pendingUpdate)
          this._pendingUpdate = null
        }
      })
    }
  }

  /**
   * Destroy the tray icon. Call from `app.on('will-quit')`.
   * Safe to call even if `init()` was never called or `destroy()` was already
   * called — subsequent calls are no-ops.
   */
  destroy(): void {
    if (this._tray) {
      this._tray.destroy()
      this._tray = null
      console.log('[tray] destroy')
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _applyUpdate(sessions: Map<SessionId, SessionState>): void {
    if (!this._tray) return

    const aggregate = computeAggregate(sessions)
    const waitingCount = countByState(sessions, 'Waiting')
    const tooltip = buildTooltip(sessions.size, waitingCount)

    const { r, g, b } = ICON_COLOURS[aggregate]
    this._tray.setImage(makeIcon(r, g, b))
    this._tray.setToolTip(tooltip)
    this._tray.setContextMenu(buildContextMenu(sessions, this._onFocusWindow))

    console.log(
      `[tray] state=${aggregate} sessions=${sessions.size} waiting=${waitingCount} tooltip="${tooltip}"`,
    )
  }
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Derive the aggregate tray state from a map of session states.
 *
 * Priority order: Waiting > Stopped > Working > Idle (empty = Idle).
 * Short-circuits on the first Waiting session for O(n) best case.
 */
export function computeAggregate(sessions: Map<SessionId, SessionState>): TrayAggregateState {
  let hasWorking = false
  let hasStopped = false

  for (const state of sessions.values()) {
    if (state === 'Waiting') return 'waiting'
    if (state === 'Stopped') hasStopped = true
    else if (state === 'Working') hasWorking = true
  }

  if (hasStopped) return 'stopped'
  if (hasWorking) return 'working'
  return 'idle'
}

/**
 * Count sessions in a specific state within the map.
 */
export function countByState(
  sessions: Map<SessionId, SessionState>,
  target: SessionState,
): number {
  let n = 0
  for (const state of sessions.values()) {
    if (state === target) n++
  }
  return n
}

/**
 * Build the human-readable tooltip string shown when hovering the tray icon.
 *
 * Examples:
 * - 0 sessions          → `"gsd-tau"`
 * - 1 session, 0 waiting → `"gsd-tau — 1 session"`
 * - 2 sessions, 0 waiting → `"gsd-tau — 2 sessions"`
 * - 2 sessions, 1 waiting → `"gsd-tau — 2 sessions (1 waiting)"`
 */
export function buildTooltip(sessionCount: number, waitingCount: number): string {
  if (sessionCount === 0) return 'gsd-tau'
  const sessionWord = sessionCount === 1 ? 'session' : 'sessions'
  const base = `gsd-tau — ${sessionCount} ${sessionWord}`
  return waitingCount > 0 ? `${base} (${waitingCount} waiting)` : base
}

/**
 * Build the right-click context menu from current sessions.
 *
 * Each session produces a labelled item: `"<emoji> <id> (<state>)"`.
 * A separator precedes the always-present Quit item. When there are no
 * sessions, only the Quit item is present (no separator needed).
 */
export function buildContextMenu(
  sessions: Map<SessionId, SessionState>,
  onFocusWindow: () => void,
) {
  const items: MenuItemConstructorOptions[] = []

  for (const [id, state] of sessions) {
    const emoji = STATE_EMOJI[state]
    items.push({
      label: `${emoji} ${id} (${state})`,
      click: () => onFocusWindow(),
    })
  }

  if (items.length > 0) {
    items.push({ type: 'separator' })
  }

  items.push({
    label: 'Quit',
    click: () => app.quit(),
  })

  return Menu.buildFromTemplate(items)
}

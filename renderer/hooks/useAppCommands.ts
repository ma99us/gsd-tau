/**
 * useAppCommands.ts — command registry for the command palette.
 *
 * Exports:
 *   - `AppCommand`        — typed command descriptor (id, label, sessionId?, execute)
 *   - `buildAppCommands`  — pure factory; testable without React
 *   - `useAppCommands`    — React hook wrapper (memoised)
 *
 * All seven required palette entries are present.  `show-tray` and
 * `toggle-auto-run-panel` are console.warn stubs pending S04+.
 */

import { useMemo } from 'react'
import type { GsdApi, SessionId } from '@shared/types'

// ── GSD API accessor ──────────────────────────────────────────────────────────
// Matches the pattern in sessions-store.ts so vi.stubGlobal('gsd', mock) works
// in vitest node env without jsdom.
function gsd(): GsdApi {
  return (globalThis as unknown as { gsd: GsdApi }).gsd
}

// ── AppCommand interface ──────────────────────────────────────────────────────

export interface AppCommand {
  /** Stable identifier used by the MRU store and keyboard dispatch. */
  id: string
  /** Human-readable palette label. */
  label: string
  /**
   * Present when the command is scoped to a specific session.
   * Undefined for session-agnostic commands (new-session, open-project,
   * show-tray, toggle-auto-run-panel).
   */
  sessionId?: SessionId
  /**
   * Source badge displayed in the palette list (e.g. 'skill', 'built-in').
   * Absent on built-in app commands; set on pi slash commands.
   */
  badge?: string
  /**
   * Optional description shown below the command label in the palette list.
   * Absent on built-in app commands; set on pi slash commands.
   */
  description?: string
  /**
   * When true, the command palette enters argument-input mode when this command
   * is selected instead of executing immediately.  The user types arguments,
   * then presses Enter to send `<label> <args>` as a prompt.
   * Absent (falsy) on app commands; set on pi slash commands.
   */
  acceptsArgs?: boolean
  /** Invoke the command. May return a Promise; errors propagate to the caller. */
  execute: () => void | Promise<void>
}

// ── Pure factory ──────────────────────────────────────────────────────────────

/**
 * Build the full array of 7 `AppCommand` objects.
 *
 * Pure function — no React dependency.  Called by `useAppCommands` inside
 * `useMemo`, and called directly by tests to avoid needing `renderHook`.
 *
 * @param sessionId      Active session id or `null` when no tab is open.
 * @param getLastTurnText Optional callback injected by the caller (S03) to
 *                        supply the last assistant turn text for copy-last-turn.
 *                        Returns an empty string when omitted.
 */
export function buildAppCommands(
  sessionId: SessionId | null,
  getLastTurnText?: () => string,
): AppCommand[] {
  const sessionScope = sessionId != null ? { sessionId } : {}

  return [
    // ── Session-agnostic commands ─────────────────────────────────────────────
    {
      id: 'new-session',
      label: 'New session',
      execute: async () => {
        const cwd = await gsd().showFolderPicker()
        if (cwd != null) await gsd().openProject(cwd)
      },
    },
    {
      id: 'open-project',
      label: 'Open project',
      execute: async () => {
        const cwd = await gsd().showFolderPicker()
        if (cwd != null) await gsd().openProject(cwd)
      },
    },

    // ── Session-scoped commands (no-ops when sessionId is null) ───────────────
    {
      id: 'close-tab',
      label: 'Close tab',
      ...sessionScope,
      execute: async () => {
        if (sessionId == null) return
        await gsd().closeSession(sessionId)
      },
    },
    {
      id: 'compact-context',
      label: 'Compact context',
      ...sessionScope,
      execute: async () => {
        if (sessionId == null) return
        await gsd().compact(sessionId)
      },
    },
    {
      id: 'copy-last-turn',
      label: 'Copy last turn',
      ...sessionScope,
      execute: async () => {
        const text = getLastTurnText?.() ?? ''
        await navigator.clipboard.writeText(text)
      },
    },

    // ── Stub commands — wired in S04+ ─────────────────────────────────────────
    {
      id: 'show-tray',
      label: 'Show tray',
      execute: () => {
        console.warn('show-tray: not yet wired')
      },
    },
    {
      id: 'toggle-auto-run-panel',
      label: 'Toggle auto-run panel',
      execute: () => {
        console.warn('toggle-auto-run-panel: not yet wired')
      },
    },
  ]
}

// ── React hook ────────────────────────────────────────────────────────────────

/**
 * React hook that returns a memoised array of `AppCommand` objects for the
 * command palette.
 *
 * @param sessionId       Active session id or `null` when no tab is open.
 * @param getLastTurnText Callback that returns the last assistant turn text.
 *                        Pass a stable reference (e.g. `useCallback`) to avoid
 *                        unnecessary recomputation.
 */
export function useAppCommands(
  sessionId: SessionId | null,
  getLastTurnText?: () => string,
): AppCommand[] {
  return useMemo(
    () => buildAppCommands(sessionId, getLastTurnText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, getLastTurnText],
  )
}

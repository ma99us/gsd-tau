/**
 * MissingSessionBanner — shown inside SessionView when a restored session's
 * project directory no longer exists on disk.
 *
 * Offers three actions:
 *  • Locate   — opens a native folder picker, reassigns the cwd, and replaces
 *               this phantom tab with a real live session.
 *  • Remove   — removes the phantom tab entirely (calls closeSession via the store).
 *  • Dismiss  — hides the banner for the current app session without removing
 *               the tab (useful when the drive is temporarily disconnected).
 */

import { useState } from 'react'
import { useSessionsStore } from '../state/sessions-store'
import type { SessionId } from '../../shared/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MissingSessionBannerProps {
  /** The phantom session id (from the registry, no live pi process). */
  sessionId: SessionId
  /** The project directory path that no longer exists. */
  cwd: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MissingSessionBanner({ sessionId, cwd }: MissingSessionBannerProps): JSX.Element | null {
  const { closeTab, replaceMissingTab } = useSessionsStore()
  const [dismissed, setDismissed] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  // ── Locate ─────────────────────────────────────────────────────────────────
  const handleLocate = async (): Promise<void> => {
    setLocating(true)
    setError(null)
    try {
      const newCwd = await window.gsd.showFolderPicker()
      if (!newCwd) return // user cancelled the picker
      const { newSessionId } = await window.gsd.reassignSessionCwd(sessionId, newCwd)
      // Replace the phantom tab with a live one at the same tab position.
      replaceMissingTab(sessionId, newSessionId, newCwd)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLocating(false)
    }
  }

  // ── Remove ─────────────────────────────────────────────────────────────────
  // closeTab calls gsd().closeSession() which short-circuits in manager.close()
  // for missing-path ids (no live pi process to shut down).
  const handleRemove = (): void => {
    void closeTab(sessionId)
  }

  // ── Dismiss ────────────────────────────────────────────────────────────────
  const handleDismiss = (): void => {
    setDismissed(true)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-col gap-3 border-b border-yellow-800/50 bg-yellow-950/60 px-4 py-3"
      data-testid="missing-session-banner"
    >
      {/* Header row: warning message + dismiss button */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-yellow-300">
            ⚠ Project directory not found
          </span>
          <span
            className="max-w-lg truncate font-mono text-xs text-yellow-500"
            title={cwd}
          >
            {cwd}
          </span>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 text-lg leading-none text-yellow-600 transition-colors hover:text-yellow-300"
          aria-label="Dismiss banner"
          title="Dismiss (keeps tab open)"
        >
          ×
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleLocate()}
          disabled={locating}
          className="rounded bg-yellow-700 px-3 py-1.5 text-xs font-medium text-yellow-100
                     transition-colors hover:bg-yellow-600
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {locating ? 'Locating…' : 'Locate…'}
        </button>
        <button
          type="button"
          onClick={handleRemove}
          className="rounded px-3 py-1.5 text-xs font-medium text-yellow-600
                     transition-colors hover:bg-yellow-900/60 hover:text-yellow-400"
        >
          Remove
        </button>
      </div>

      {/* Error feedback */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}

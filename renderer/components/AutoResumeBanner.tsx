/**
 * AutoResumeBanner — prompt shown after a session restores with
 * `wasAutoRunning: true` (docs/05-onboarding.md §6.4).
 *
 * Purely presentational — SessionView owns the visibility logic (only
 * mounted while `wasAutoRunning` is true for this tab) and the two callbacks.
 */

export interface AutoResumeBannerProps {
  /** Called when the user clicks "Resume auto". */
  onResume: () => void
  /** Called when the user clicks "Dismiss". */
  onDismiss: () => void
}

export function AutoResumeBanner({ onResume, onDismiss }: AutoResumeBannerProps): JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-800 bg-amber-950/60 px-4 py-2 text-xs text-amber-200"
      role="status"
      data-testid="auto-resume-banner"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true">↺</span>
        Auto-mode was running when gsd-tau last closed. Resume from where it left off?
      </span>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-2 py-1 font-medium text-amber-300 transition-colors hover:bg-amber-900/60 hover:text-amber-100"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onResume}
          className="rounded bg-amber-700 px-2 py-1 font-medium text-white transition-colors hover:bg-amber-600"
        >
          Resume auto
        </button>
      </span>
    </div>
  )
}

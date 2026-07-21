/**
 * ClosingOverlay
 *
 * Full-screen blocking overlay shown while a pi session (or the whole app) is
 * shutting down. Renders on top of everything else so the user can't interact
 * with stale UI while the async teardown is in progress.
 */
export interface ClosingOverlayProps {
  /** Short message shown below the spinner, e.g. "Closing session…" */
  message: string
}

export function ClosingOverlay({ message }: ClosingOverlayProps): JSX.Element {
  return (
    <div
      role="status"
      aria-label={message}
      aria-live="assertive"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center
                 gap-5 bg-neutral-900/85 backdrop-blur-sm"
    >
      {/* Three-dot pulse ring */}
      <div className="relative flex h-14 w-14 items-center justify-center">
        {/* Outer ring */}
        <span
          className="absolute inset-0 rounded-full border-2 border-blue-500/30
                     animate-ping"
          style={{ animationDuration: '1.4s' }}
        />
        {/* Spinning arc */}
        <svg
          className="h-14 w-14 animate-spin text-blue-400"
          viewBox="0 0 56 56"
          fill="none"
          aria-hidden="true"
          style={{ animationDuration: '0.9s' }}
        >
          <circle
            cx="28"
            cy="28"
            r="22"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="100 38"
          />
        </svg>
      </div>

      <p className="text-sm font-medium tracking-wide text-neutral-300">{message}</p>
    </div>
  )
}

export default ClosingOverlay

/**
 * CopilotLoginModal — specialised, non-blocking overlay shown when we detect
 * the GitHub Copilot device-code shape inside a `notify` extension-UI request.
 *
 * See docs/70-auth-github-copilot.md "Special renderer for the device-code
 * notify". The underlying `notify` request is informational (already
 * auto-acked by SessionView before this modal is even shown — pi does not
 * block waiting for a response to `notify`), so this component owns its own
 * open/closed lifecycle entirely in local state; it does not participate in
 * the blocking modal queue used by select/confirm/input/editor.
 *
 * Lifecycle (driven by SessionView via props, see the `status` prop):
 *   'pending' → code + Open browser / Copy URL / Copy code / Cancel
 *   'success' → brief confirmation, auto-closes
 *   'failure' → error message + Retry (re-sends `/login github-copilot`) / Close
 */

import { useEffect, useState } from 'react'

export interface CopilotLoginModalProps {
  /** Verification URL the user should visit (e.g. "https://github.com/login/device"). */
  url: string
  /** Short user code to enter at `url` (e.g. "ABCD-1234"). */
  code: string
  /** Current flow status — drives which footer/body variant is shown. */
  status: 'pending' | 'success' | 'failure'
  /** Latest polling/status message from pi (e.g. "Waiting for authorization…"). */
  statusMessage?: string
  /** Called when the user clicks "Open browser". */
  onOpenBrowser: () => void
  /** Called when the user clicks "Retry" after a failure. */
  onRetry: () => void
  /** Called when the user closes the modal (Cancel, Escape, backdrop, or after success). */
  onClose: () => void
}

/** How long the success state stays visible before auto-closing (ms). */
export const SUCCESS_AUTOCLOSE_MS = 2_500

/**
 * Copy `text` to the clipboard. Swallows errors — clipboard access can fail
 * in sandboxed contexts; the buttons remain visually responsive either way.
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    console.warn('[CopilotLoginModal] clipboard write failed:', err)
  }
}

export function CopilotLoginModal({
  url,
  code,
  status,
  statusMessage,
  onOpenBrowser,
  onRetry,
  onClose,
}: CopilotLoginModalProps): JSX.Element {
  const [codeCopied, setCodeCopied] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)

  // Auto-close a short while after success — matches the design's "brief
  // confirmation" behaviour without requiring the user to dismiss manually.
  useEffect(() => {
    if (status !== 'success') return
    const t = setTimeout(onClose, SUCCESS_AUTOCLOSE_MS)
    return () => clearTimeout(t)
  }, [status, onClose])

  // Escape closes (cancels) the modal, matching every other modal in the app.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleCopyCode = (): void => {
    void copyToClipboard(code)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 1_500)
  }

  const handleCopyUrl = (): void => {
    void copyToClipboard(url)
    setUrlCopied(true)
    setTimeout(() => setUrlCopied(false), 1_500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
      aria-hidden="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="copilot-login-title"
        className={[
          'relative w-full max-w-sm',
          'rounded-xl border border-neutral-700 bg-neutral-800',
          'shadow-2xl outline-none',
        ].join(' ')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-6">
          <h2
            id="copilot-login-title"
            className="text-sm font-semibold leading-relaxed text-neutral-100"
          >
            {status === 'failure' ? 'GitHub Copilot sign-in failed' : 'Sign in to GitHub Copilot'}
          </h2>

          {status === 'success' ? (
            <p className="mt-3 text-sm text-green-400" data-testid="copilot-login-success">
              ✓ Signed in to GitHub Copilot
            </p>
          ) : status === 'failure' ? (
            <p className="mt-3 text-sm text-red-400" data-testid="copilot-login-failure">
              {statusMessage ?? 'Something went wrong. You can try again.'}
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm text-neutral-300">Enter this code at:</p>
              <p className="mt-1 truncate text-sm text-blue-400">{url}</p>

              <div className="mt-3 flex items-center gap-2">
                <span
                  className="flex-1 rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-center font-mono text-lg tracking-widest text-neutral-100"
                  data-testid="copilot-login-code"
                >
                  {code}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
                >
                  {codeCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              {statusMessage && (
                <p className="mt-3 text-xs text-neutral-500" data-testid="copilot-login-status">
                  {statusMessage}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-700 px-5 py-4">
          {status === 'pending' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
              >
                {urlCopied ? 'URL copied!' : 'Copy URL'}
              </button>
              <button
                type="button"
                onClick={onOpenBrowser}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 active:bg-blue-700"
              >
                Open browser
              </button>
            </>
          )}

          {status === 'failure' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 active:bg-blue-700"
              >
                Retry
              </button>
            </>
          )}

          {status === 'success' && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


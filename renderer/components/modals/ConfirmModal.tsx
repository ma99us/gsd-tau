import { useEffect, useRef } from 'react'
import type { UiResponseInput, RpcExtensionUIRequest } from '@shared/types'

type ConfirmRequest = Extract<RpcExtensionUIRequest, { method: 'confirm' }>

interface ConfirmModalProps {
  request: ConfirmRequest
  onRespond: (response: UiResponseInput) => void
}

// ── Pure helper (exported for unit tests) ─────────────────────────────────────

/**
 * Build the UiResponseInput payload for a confirmed or denied response.
 * Always returns a valid response — confirm modals never return null.
 */
export function buildConfirmResponse(confirmed: boolean): UiResponseInput {
  return { confirmed }
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Modal for pi's `confirm` extension UI request.
 *
 * Renders Yes / No buttons.
 * - Yes  → { confirmed: true }
 * - No   → { confirmed: false }
 * - Cancel button / Escape / backdrop → { cancelled: true }
 *
 * Focus is trapped inside the dialog; Escape or backdrop-click cancels.
 */
export function ConfirmModal({ request, onRespond }: ConfirmModalProps): JSX.Element {
  const { title } = request
  const dialogRef = useRef<HTMLDivElement>(null)

  // ── Focus trap + keyboard handling ────────────────────────────────────────
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return

    el.focus()

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onRespond({ cancelled: true })
        return
      }

      if (e.key !== 'Tab') return

      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === el) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    el.addEventListener('keydown', handleKeyDown)
    return () => {
      el.removeEventListener('keydown', handleKeyDown)
    }
  }, [onRespond])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={() => onRespond({ cancelled: true })}
      aria-hidden="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        tabIndex={-1}
        className={[
          'relative w-full max-w-sm',
          'rounded-xl border border-neutral-700 bg-neutral-800',
          'shadow-2xl outline-none',
        ].join(' ')}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* ── Body ── */}
        <div className="px-5 py-6">
          <h2
            id="confirm-modal-title"
            className="text-sm font-semibold leading-relaxed text-neutral-100"
          >
            {title}
          </h2>
        </div>

        {/* ── Footer ── */}
        <div className="flex justify-end gap-2 border-t border-neutral-700 px-5 py-4">
          <button
            type="button"
            onClick={() => onRespond({ cancelled: true })}
            className={[
              'rounded-lg px-4 py-2',
              'text-sm font-medium text-neutral-400',
              'transition-colors hover:bg-neutral-700 hover:text-neutral-100',
            ].join(' ')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onRespond(buildConfirmResponse(false))}
            className={[
              'rounded-lg px-4 py-2',
              'text-sm font-medium text-neutral-300',
              'transition-colors hover:bg-neutral-700 hover:text-neutral-100',
            ].join(' ')}
          >
            No
          </button>
          <button
            type="button"
            onClick={() => onRespond(buildConfirmResponse(true))}
            className={[
              'rounded-lg px-4 py-2',
              'text-sm font-medium',
              'bg-blue-600 text-white',
              'transition-colors hover:bg-blue-500 active:bg-blue-700',
            ].join(' ')}
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import type { UiResponseInput, RpcExtensionUIRequest } from '@shared/types'

// ── Pure helper (exported for unit tests) ─────────────────────────────────────

/**
 * Build the UiResponseInput payload for a fallback modal submission.
 * An empty string is valid — the user may intend a blank acknowledgement
 * for a notify-like unknown request type.
 */
export function buildFallbackResponse(value: string): UiResponseInput {
  return { value }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface FallbackModalProps {
  request: RpcExtensionUIRequest
  onRespond: (response: UiResponseInput) => void
}

/**
 * Catch-all modal for any pi UI-request method this app does not recognise.
 *
 * Shows:
 * - The unknown method name in the header.
 * - The raw request JSON in a read-only code block so the user understands
 *   what pi is asking for.
 * - A plain text input for a free-form response value.
 * - Cancel → { cancelled: true }
 * - Send   → { value: text }
 *
 * Focus trap and Escape handling follow the same pattern as other modals.
 * An empty string IS a valid response value (the user may want to ack without
 * a meaningful payload), so Send is never disabled.
 */
export function FallbackModal({ request, onRespond }: FallbackModalProps): JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // ── Initial focus ─────────────────────────────────────────────────────────
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ── Focus trap + keyboard handling ────────────────────────────────────────
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onRespond({ cancelled: true })
        return
      }

      if (e.key !== 'Tab') return

      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  // ── Event handlers ────────────────────────────────────────────────────────
  const handleSend = (): void => {
    onRespond(buildFallbackResponse(value))
  }

  const handleCancel = (): void => {
    onRespond({ cancelled: true })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={handleCancel}
      aria-hidden="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fallback-modal-title"
        tabIndex={-1}
        className={[
          'relative w-full max-w-md',
          'rounded-xl border border-neutral-700 bg-neutral-800',
          'shadow-2xl outline-none',
        ].join(' ')}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="border-b border-neutral-700 px-5 py-4">
          <h2
            id="fallback-modal-title"
            className="text-sm font-semibold text-neutral-100"
          >
            Unknown request:{' '}
            <code className="rounded bg-neutral-700 px-1 py-0.5 font-mono text-xs text-amber-400">
              {request.method}
            </code>
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            pi sent a request type this version of gsd-tau does not recognise.
          </p>
        </div>

        {/* ── Raw payload ── */}
        <div className="px-5 py-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            Raw request payload
          </p>
          <pre
            className={[
              'max-h-48 overflow-y-auto rounded-lg',
              'border border-neutral-700 bg-neutral-900',
              'px-3 py-2 font-mono text-xs text-neutral-300',
            ].join(' ')}
          >
            {JSON.stringify(request, null, 2)}
          </pre>
        </div>

        {/* ── Response input ── */}
        <div className="px-5 pb-3">
          <label
            htmlFor="fallback-response-input"
            className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-neutral-500"
          >
            Response value
          </label>
          <input
            ref={inputRef}
            id="fallback-response-input"
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Enter a response value (or leave blank)…"
            className={[
              'w-full rounded-lg',
              'border border-neutral-600 bg-neutral-900',
              'px-3 py-2 text-sm text-neutral-200',
              'placeholder-neutral-600 outline-none',
              'transition-colors focus:border-blue-500',
            ].join(' ')}
          />
        </div>

        {/* ── Footer ── */}
        <div className="flex justify-end gap-2 border-t border-neutral-700 px-5 py-4">
          <button
            type="button"
            onClick={handleCancel}
            className={[
              'rounded-lg px-4 py-2',
              'text-sm font-medium text-neutral-300',
              'transition-colors hover:bg-neutral-700 hover:text-neutral-100',
            ].join(' ')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            className={[
              'rounded-lg px-4 py-2',
              'text-sm font-medium',
              'bg-blue-600 text-white',
              'transition-colors hover:bg-blue-500 active:bg-blue-700',
            ].join(' ')}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

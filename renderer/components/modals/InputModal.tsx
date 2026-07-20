import { useState, useEffect, useRef } from 'react'
import type { UiResponseInput, RpcExtensionUIRequest } from '@shared/types'

type InputRequest = Extract<RpcExtensionUIRequest, { method: 'input' }>

interface InputModalProps {
  request: InputRequest
  onRespond: (response: UiResponseInput) => void
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Build the UiResponseInput payload for a submitted text input.
 * Returns null when the value is empty (Submit should be disabled).
 * Does NOT trim — the user may intend leading/trailing whitespace (especially
 * in secure inputs such as passwords).
 */
export function buildInputResponse(value: string): UiResponseInput | null {
  if (value.length === 0) return null
  return { value }
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Modal for pi's `input` extension UI request.
 *
 * Renders a single-line text field.
 * - Submit button / Enter key → { value: text } (disabled when empty)
 * - Cancel / Escape / backdrop → { cancelled: true }
 * - secure: true → type="password" (value is never logged)
 *
 * Focus is placed on the text field immediately; Escape cancels.
 */
export function InputModal({ request, onRespond }: InputModalProps): JSX.Element {
  const { title, secure = false } = request as InputRequest & { secure?: boolean }

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
  const handleSubmit = (): void => {
    const response = buildInputResponse(value)
    if (response) onRespond(response)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  const canSubmit = value.length > 0

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
        aria-labelledby="input-modal-title"
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
            id="input-modal-title"
            className="text-sm font-semibold text-neutral-100"
          >
            {title}
          </h2>
        </div>

        {/* ── Input field ── */}
        <div className="px-5 py-4">
          <input
            ref={inputRef}
            type={secure ? 'password' : 'text'}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={title}
            autoComplete={secure ? 'current-password' : 'off'}
            spellCheck={!secure}
            className={[
              'w-full rounded-lg px-3 py-2',
              'border border-neutral-600 bg-neutral-900',
              'text-sm text-neutral-100 placeholder-neutral-500',
              'outline-none',
              'focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
              'transition-colors',
            ].join(' ')}
          />
        </div>

        {/* ── Footer ── */}
        <div className="flex justify-end gap-2 border-t border-neutral-700 px-5 py-4">
          <button
            type="button"
            onClick={() => onRespond({ cancelled: true })}
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
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={[
              'rounded-lg px-4 py-2',
              'text-sm font-medium',
              'bg-blue-600 text-white',
              'transition-colors hover:bg-blue-500 active:bg-blue-700',
              'disabled:cursor-not-allowed disabled:opacity-50',
            ].join(' ')}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import type { UiResponseInput, RpcExtensionUIRequest } from '@shared/types'

type EditorRequest = Extract<RpcExtensionUIRequest, { method: 'editor' }>

interface EditorModalProps {
  request: EditorRequest
  onRespond: (response: UiResponseInput) => void
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Build the UiResponseInput payload for a submitted editor value.
 * Returns null when the value is empty (Submit should be disabled).
 * Newline-only content IS considered valid — the user may intend to submit
 * blank lines in a multi-line context.  Only a completely empty string is
 * rejected.
 */
export function buildEditorResponse(value: string): UiResponseInput | null {
  if (value.length === 0) return null
  return { value }
}

/**
 * Return true when the keyboard event is the Ctrl+Enter submit combo.
 * Exported for unit tests.  Accepts the minimal event shape needed.
 */
export function isEditorSubmitCombo(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey'>,
): boolean {
  return e.key === 'Enter' && e.ctrlKey
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Modal for pi's `editor` extension UI request.
 *
 * Renders a monospace multi-line textarea.
 * - Ctrl+Enter  → { value: text } (disabled when empty)
 * - Enter       → inserts newline (default textarea behaviour)
 * - Cancel / Escape / backdrop → { cancelled: true }
 *
 * Focus is placed on the textarea immediately; Escape cancels.
 */
export function EditorModal({ request, onRespond }: EditorModalProps): JSX.Element {
  const { title } = request

  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // ── Initial focus ─────────────────────────────────────────────────────────
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // ── Focus trap + Escape handling ──────────────────────────────────────────
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
          'textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    const response = buildEditorResponse(value)
    if (response) onRespond(response)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isEditorSubmitCombo(e as unknown as KeyboardEvent)) {
      e.preventDefault()
      handleSubmit()
    }
    // Plain Enter falls through to default textarea behaviour (inserts newline).
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
        aria-labelledby="editor-modal-title"
        tabIndex={-1}
        className={[
          'relative w-full max-w-xl',
          'rounded-xl border border-neutral-700 bg-neutral-800',
          'shadow-2xl outline-none',
        ].join(' ')}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="border-b border-neutral-700 px-5 py-4">
          <h2
            id="editor-modal-title"
            className="text-sm font-semibold text-neutral-100"
          >
            {title}
          </h2>
        </div>

        {/* ── Textarea ── */}
        <div className="px-5 py-4">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={title}
            rows={10}
            spellCheck={false}
            className={[
              'w-full resize-y rounded-lg px-3 py-2',
              'border border-neutral-600 bg-neutral-900',
              'font-mono text-sm text-neutral-100',
              'outline-none',
              'focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
              'transition-colors',
            ].join(' ')}
          />
          <p className="mt-1.5 text-right text-xs text-neutral-500">
            Ctrl+Enter to submit
          </p>
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

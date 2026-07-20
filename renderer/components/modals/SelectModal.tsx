import { useState, useEffect, useRef } from 'react'
import type { UiResponseInput, RpcExtensionUIRequest } from '@shared/types'

type SelectRequest = Extract<RpcExtensionUIRequest, { method: 'select' }>

interface SelectModalProps {
  request: SelectRequest
  onRespond: (response: UiResponseInput) => void
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Build the UiResponseInput payload for a confirmed selection.
 * Returns null when nothing is selected (Confirm should be disabled).
 */
export function buildSelectResponse(
  selected: ReadonlySet<string>,
  allowMultiple: boolean,
): UiResponseInput | null {
  if (selected.size === 0) return null
  if (allowMultiple) {
    return { values: [...selected] }
  }
  const [value] = selected
  // `value` is always defined because size > 0
  return { value: value as string }
}

/**
 * Toggle an option in a selection set, respecting single- vs multi-select semantics.
 * Single-select: always replaces the selection with the new option.
 * Multi-select: toggles — adds if absent, removes if present.
 * Never mutates `current`.
 */
export function toggleOption(
  current: ReadonlySet<string>,
  option: string,
  allowMultiple: boolean,
): Set<string> {
  if (!allowMultiple) {
    return new Set([option])
  }
  const next = new Set(current)
  if (next.has(option)) {
    next.delete(option)
  } else {
    next.add(option)
  }
  return next
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Modal for pi's `select` extension UI request.
 *
 * Renders radio buttons (single-select) or checkboxes (multi-select).
 * Focus is trapped inside the dialog; Escape or backdrop-click cancels.
 *
 * Note: the RPC contract defines `options` as `string[]` — the "preview field"
 * mentioned in the original slice plan is not present in `rpc.d.ts` and is
 * therefore not implemented here.
 */
export function SelectModal({ request, onRespond }: SelectModalProps): JSX.Element {
  const { title, options, allowMultiple = false } = request

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const dialogRef = useRef<HTMLDivElement>(null)

  // ── Focus trap + keyboard handling ────────────────────────────────────────
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return

    // Move initial focus into the dialog container so keyboard navigation
    // immediately works without the user having to tab into it.
    el.focus()

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onRespond({ cancelled: true })
        return
      }

      if (e.key !== 'Tab') return

      // Collect all focusable children — excluding disabled buttons.
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
  const handleToggle = (option: string): void => {
    setSelected(prev => toggleOption(prev, option, allowMultiple))
  }

  const handleConfirm = (): void => {
    const response = buildSelectResponse(selected, allowMultiple)
    if (response) onRespond(response)
  }

  const handleCancel = (): void => {
    onRespond({ cancelled: true })
  }

  const canConfirm = selected.size > 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    // Backdrop — mousedown (not click) to cancel so that a drag-release outside
    // after starting inside doesn't accidentally dismiss the modal.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={handleCancel}
      aria-hidden="true"
    >
      {/* Dialog — stop propagation so backdrop handler never fires for inside clicks */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="select-modal-title"
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
            id="select-modal-title"
            className="text-sm font-semibold text-neutral-100"
          >
            {title}
          </h2>
        </div>

        {/* ── Options list ── */}
        <div
          className="flex max-h-72 flex-col gap-1 overflow-y-auto px-5 py-3"
          role={allowMultiple ? 'group' : 'radiogroup'}
          aria-label={title}
        >
          {options.length === 0 ? (
            <p className="py-2 text-sm text-neutral-500">No options available.</p>
          ) : (
            options.map(option => (
              <label
                key={option}
                className={[
                  'flex cursor-pointer items-center gap-3',
                  'rounded-lg px-3 py-2',
                  'transition-colors hover:bg-neutral-700/60',
                  selected.has(option) ? 'bg-neutral-700/40' : '',
                ].join(' ')}
              >
                <input
                  type={allowMultiple ? 'checkbox' : 'radio'}
                  name="select-modal-option"
                  value={option}
                  checked={selected.has(option)}
                  onChange={() => handleToggle(option)}
                  className="h-4 w-4 cursor-pointer accent-blue-500"
                />
                <span className="text-sm text-neutral-200">{option}</span>
              </label>
            ))
          )}
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
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={[
              'rounded-lg px-4 py-2',
              'text-sm font-medium',
              'bg-blue-600 text-white',
              'transition-colors hover:bg-blue-500 active:bg-blue-700',
              'disabled:cursor-not-allowed disabled:opacity-50',
            ].join(' ')}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

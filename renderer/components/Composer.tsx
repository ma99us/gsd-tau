import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

interface ComposerProps {
  onSend: (text: string) => void
  /** When true the textarea is greyed out and send is blocked. */
  disabled?: boolean
}

/**
 * Chat composer: auto-growing textarea, Enter=send, Shift+Enter=newline.
 * Uncontrolled — value is read on submit and the element is cleared immediately,
 * which avoids a React re-render cycle between keydown and the native char insert.
 */
export function Composer({ onSend, disabled = false }: ComposerProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  const submit = (): void => {
    const el = ref.current
    if (!el) return
    const text = el.value.trim()
    if (!text || disabled) return
    onSend(text)
    el.value = ''
    el.style.height = 'auto'
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  // Resize the textarea to fit its content (up to the max-h cap set in CSS).
  const handleInput = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <div className="shrink-0 border-t border-neutral-700 bg-neutral-900 p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          disabled={disabled}
          placeholder={
            disabled
              ? 'Working…'
              : 'Message pi… (Enter to send, Shift+Enter for newline)'
          }
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          className={[
            'flex-1 resize-none rounded-lg',
            'bg-neutral-800 px-3 py-2',
            'text-sm text-neutral-100 placeholder-neutral-500',
            'border border-neutral-700 outline-none',
            'focus:border-neutral-500',
            'max-h-40 overflow-y-auto leading-5',
            disabled ? 'cursor-not-allowed opacity-50' : '',
          ].join(' ')}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className={[
            'shrink-0 rounded-lg px-3 py-2',
            'text-sm font-medium',
            'bg-blue-600 text-white',
            'hover:bg-blue-500 active:bg-blue-700',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors',
          ].join(' ')}
        >
          Send
        </button>
      </div>
    </div>
  )
}

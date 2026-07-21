import { useRef, useState, useEffect, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import type { SessionId, RpcSlashCommand, ModelInfo } from '../../shared/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlashPicker {
  visible: boolean
  query: string            // text after the "/"
  commands: RpcSlashCommand[]
  models: ModelInfo[]
  selectedIdx: number
}

const EMPTY_PICKER: SlashPicker = {
  visible: false,
  query: '',
  commands: [],
  models: [],
  selectedIdx: 0,
}

interface ComposerProps {
  onSend: (text: string) => void
  /** Session ID — needed to fetch available commands and models. */
  sessionId: SessionId | null
  /** When true the textarea is greyed out and send is blocked. */
  disabled?: boolean
}

// ── Slash command routing ─────────────────────────────────────────────────────

/**
 * Returns true for slash commands that must be routed to a dedicated RPC
 * method instead of being sent as a plain prompt.
 */
function isModelCommand(text: string): { match: true; query: string } | { match: false } {
  const m = text.match(/^\/model(?:\s+(.*))?$/i)
  if (m) return { match: true, query: (m[1] ?? '').trim() }
  return { match: false }
}

// ── Picker item list ──────────────────────────────────────────────────────────

interface PickerItem {
  label: string
  description?: string
  kind: 'command' | 'model'
  /** Full command text to insert into the textarea */
  fillText: string
  /** Model metadata (for model items) */
  model?: ModelInfo
}

function buildItems(picker: SlashPicker): PickerItem[] {
  const q = picker.query.toLowerCase()

  const modelPrefix = q.startsWith('model') || q === ''
  const modelQuery = q.startsWith('model') ? q.slice(5).trim() : q

  const modelItems: PickerItem[] = picker.models
    .filter(m => {
      if (!modelPrefix && q !== '') return false
      if (!modelQuery) return true
      return (
        m.id.toLowerCase().includes(modelQuery) ||
        m.provider.toLowerCase().includes(modelQuery)
      )
    })
    .map(m => ({
      label: `/model ${m.id}`,
      description: m.provider,
      kind: 'model',
      fillText: `/model ${m.id}`,
      model: m,
    }))

  const commandItems: PickerItem[] = picker.commands
    .filter(c => {
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q)
      )
    })
    .map(c => ({
      label: `/${c.name}`,
      description: c.description,
      kind: 'command',
      fillText: `/${c.name}`,
    }))

  return [...modelItems, ...commandItems]
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Chat composer: auto-growing textarea, Enter=send, Shift+Enter=newline.
 *
 * Slash command behaviour:
 * - Typing "/" opens a picker showing all available commands + /model <id> variants.
 * - Arrow keys navigate; Enter or click selects; Escape closes.
 * - On submit, "/model <id>" is routed to window.gsd.setModel() instead of prompt().
 * - All other "/…" text is forwarded to pi as a plain prompt (pi's session layer
 *   processes skills and extension commands).
 */
export function Composer({ onSend, sessionId, disabled = false }: ComposerProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLUListElement>(null)
  const [picker, setPicker] = useState<SlashPicker>(EMPTY_PICKER)
  // Cache loaded data per session so we only fetch once.
  const cachedCommands = useRef<RpcSlashCommand[]>([])
  const cachedModels = useRef<ModelInfo[]>([])
  const loaded = useRef(false)

  // Reset cache when session changes.
  useEffect(() => {
    cachedCommands.current = []
    cachedModels.current = []
    loaded.current = false
  }, [sessionId])

  // ── Fetch commands + models (once, lazily on first "/") ───────────────────
  const ensureLoaded = useCallback(async (): Promise<void> => {
    if (loaded.current || !sessionId) return
    loaded.current = true
    try {
      const [cmds, models] = await Promise.all([
        window.gsd.getCommands(sessionId),
        window.gsd.getAvailableModels(sessionId),
      ])
      cachedCommands.current = cmds
      cachedModels.current = models
    } catch {
      // Gracefully degrade — commands will be empty but picker still works.
      loaded.current = false
    }
  }, [sessionId])

  // ── Picker logic ──────────────────────────────────────────────────────────
  const openPicker = useCallback(
    async (query: string): Promise<void> => {
      await ensureLoaded()
      setPicker({
        visible: true,
        query,
        commands: cachedCommands.current,
        models: cachedModels.current,
        selectedIdx: 0,
      })
    },
    [ensureLoaded],
  )

  const closePicker = useCallback((): void => {
    setPicker(EMPTY_PICKER)
  }, [])

  const selectItem = useCallback(
    (item: PickerItem): void => {
      const el = ref.current
      if (!el) return
      el.value = item.fillText + ' '
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
      el.focus()
      closePicker()
    },
    [closePicker],
  )

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = useCallback(async (): Promise<void> => {
    const el = ref.current
    if (!el) return
    const text = el.value.trim()
    if (!text || disabled) return

    // Route /model <id> to the dedicated RPC method.
    if (sessionId && text.startsWith('/')) {
      const modelCmd = isModelCommand(text)
      if (modelCmd.match) {
        // Find model in cache to get provider.
        const modelId = modelCmd.query
        if (modelId) {
          const found = cachedModels.current.find(
            m => m.id.toLowerCase() === modelId.toLowerCase(),
          )
          el.value = ''
          el.style.height = 'auto'
          closePicker()
          if (found) {
            await window.gsd.setModel(sessionId, found.provider, found.id)
          } else {
            // Unknown model: try best-guess (pass empty provider, let pi decide).
            // In practice getAvailableModels should have been loaded already.
            console.warn(`[Composer] /model: unknown model "${modelId}", passing as-is`)
            onSend(text)
          }
          return
        }
        // "/model" with no argument: just close.
        el.value = ''
        el.style.height = 'auto'
        closePicker()
        return
      }
    }

    onSend(text)
    el.value = ''
    el.style.height = 'auto'
    closePicker()
  }, [disabled, sessionId, onSend, closePicker])

  // ── Input handler (drives picker open/close) ──────────────────────────────
  const handleInput = useCallback((): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`

    const val = el.value
    if (val.startsWith('/')) {
      void openPicker(val.slice(1))
    } else {
      closePicker()
    }
  }, [openPicker, closePicker])

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (picker.visible) {
        const items = buildItems(picker)
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setPicker(p => ({ ...p, selectedIdx: Math.min(p.selectedIdx + 1, items.length - 1) }))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setPicker(p => ({ ...p, selectedIdx: Math.max(p.selectedIdx - 1, 0) }))
          return
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && items.length > 0)) {
          e.preventDefault()
          const item = items[picker.selectedIdx]
          if (item) selectItem(item)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          closePicker()
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void submit()
      }
    },
    [picker, submit, selectItem, closePicker],
  )

  // Scroll selected item into view.
  useEffect(() => {
    if (!picker.visible || !pickerRef.current) return
    const li = pickerRef.current.children[picker.selectedIdx] as HTMLElement | undefined
    li?.scrollIntoView({ block: 'nearest' })
  }, [picker.selectedIdx, picker.visible])

  const items = buildItems(picker)

  return (
    <div className="shrink-0 border-t border-neutral-700 bg-neutral-900 p-3">
      {/* Slash command picker */}
      {picker.visible && items.length > 0 && (
        <div className="mb-2 rounded-lg border border-neutral-700 bg-neutral-800 shadow-lg overflow-hidden">
          <ul
            ref={pickerRef}
            className="max-h-52 overflow-y-auto"
            role="listbox"
            aria-label="Available commands"
          >
            {items.map((item, idx) => (
              <li
                key={item.fillText}
                role="option"
                aria-selected={idx === picker.selectedIdx}
                onMouseDown={(e): void => {
                  e.preventDefault() // prevent textarea blur
                  selectItem(item)
                }}
                className={[
                  'flex items-baseline gap-3 px-3 py-2 cursor-pointer text-sm',
                  idx === picker.selectedIdx
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-200 hover:bg-neutral-700',
                ].join(' ')}
              >
                <span className="font-mono font-medium shrink-0">{item.label}</span>
                {item.description && (
                  <span
                    className={[
                      'text-xs truncate',
                      idx === picker.selectedIdx ? 'text-blue-200' : 'text-neutral-500',
                    ].join(' ')}
                  >
                    {item.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="px-3 py-1 text-xs text-neutral-600 border-t border-neutral-700 select-none">
            ↑↓ navigate · Tab/Enter select · Esc close
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          disabled={disabled}
          placeholder={
            disabled
              ? 'Working…'
              : 'Message pi… (Enter to send, / for commands)'
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
          onClick={(): void => { void submit() }}
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

import { useEffect, useRef } from 'react'
import type { Turn, AssistantItem } from '../hooks/useSession'

interface TurnListProps {
  turns: Turn[]
}

/**
 * Scrollable list of conversation turns.
 * Auto-scrolls to the bottom as new content arrives.
 * Suspends auto-scroll when the user has scrolled up.
 */
export function TurnList({ turns }: TurnListProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  // Track whether the user has scrolled up to disable auto-scroll.
  const handleScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    autoScrollRef.current = distanceFromBottom < 40
  }

  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [turns])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      aria-label="Conversation"
    >
      {turns.length === 0 && (
        <p className="mt-8 text-center text-sm text-neutral-600 select-none">
          Send a message to get started.
        </p>
      )}

      {turns.map(turn => (
        <TurnRow key={turn.id} turn={turn} />
      ))}

      {/* Invisible anchor used to scroll to the bottom */}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  )
}

// ── Turn row ──────────────────────────────────────────────────────────────────

function TurnRow({ turn }: { turn: Turn }): JSX.Element {
  if (turn.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2
                     text-sm text-white whitespace-pre-wrap"
        >
          {turn.text}
        </div>
      </div>
    )
  }

  // Assistant turn
  return (
    <div className="flex max-w-[90%] flex-col gap-1.5">
      {turn.items.length === 0 && (
        <span className="animate-pulse select-none text-xs text-neutral-500">
          Thinking…
        </span>
      )}
      {turn.items.map(item => (
        <AssistantItemView key={item.id} item={item} />
      ))}
    </div>
  )
}

// ── Assistant item view ───────────────────────────────────────────────────────

function AssistantItemView({ item }: { item: AssistantItem }): JSX.Element {
  if (item.kind === 'text') {
    return (
      <p className="text-sm text-neutral-100 whitespace-pre-wrap leading-relaxed">
        {item.content}
      </p>
    )
  }

  // Tool card — basic version.  T10 will replace this with the full ToolCard
  // component that includes expand/collapse and result display.
  const inputSummary = (() => {
    try {
      return JSON.stringify(item.input).slice(0, 80)
    } catch {
      return String(item.input).slice(0, 80)
    }
  })()

  return (
    <div
      data-tool-use-id={item.toolUseId}
      className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-blue-400">{item.name}</span>
        {item.pending ? (
          <span className="animate-pulse text-neutral-500">running…</span>
        ) : (
          <span className="text-green-500">✓</span>
        )}
      </div>
      {inputSummary && (
        <div className="mt-1 truncate font-mono text-neutral-500">{inputSummary}</div>
      )}
    </div>
  )
}

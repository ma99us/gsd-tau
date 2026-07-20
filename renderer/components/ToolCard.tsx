import { useState } from 'react'
import type { ToolItem } from '../hooks/useSession'

// ── Helpers (exported for unit tests) ────────────────────────────────────────

/**
 * Returns the first 80 characters of JSON.stringify(input).
 * Handles non-serialisable values gracefully by falling back to String().
 */
export function formatInputSummary(input: unknown): string {
  if (input === undefined || input === null) return ''
  try {
    return JSON.stringify(input).slice(0, 80)
  } catch {
    return String(input).slice(0, 80)
  }
}

/**
 * Formats a tool result for display.
 * Strings are returned verbatim; objects/arrays are pretty-printed JSON.
 * Returns empty string for null / undefined.
 */
export function formatResult(result: unknown): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

/**
 * Full stringification of the input object for the expanded view.
 * Same safety contract as formatInputSummary but without the 80-char cap.
 */
function formatInputFull(input: unknown): string {
  if (input === undefined || input === null) return ''
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ToolCardProps {
  item: ToolItem
}

/**
 * Renders a collapsible card for a single tool invocation.
 *
 * Collapsed (default): name + status badge + 80-char input summary + chevron.
 * Expanded: full input JSON + result (once available).
 *
 * The `data-tool-use-id` attribute mirrors the underlying toolUseId so callers
 * can locate the card by ID (e.g. in Playwright tests).
 */
export function ToolCard({ item }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const inputSummary = formatInputSummary(item.input)
  const resultText = !item.pending && item.result !== undefined ? formatResult(item.result) : null
  const hasExpandableContent = Boolean(inputSummary || resultText !== null)

  const toggle = (): void => {
    if (hasExpandableContent || item.pending) setExpanded(prev => !prev)
  }

  return (
    <div
      data-tool-use-id={item.toolUseId}
      className="rounded-lg border border-neutral-700 bg-neutral-800 text-xs"
    >
      {/* ── Header row — always visible, click to expand ── */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {/* Tool name */}
        <span className="shrink-0 font-mono text-blue-400">{item.name}</span>

        {/* Status badge */}
        {item.pending ? (
          <span className="shrink-0 animate-pulse text-neutral-500">running…</span>
        ) : (
          <span className="shrink-0 text-green-500" aria-label="completed">
            ✓
          </span>
        )}

        {/* Truncated input summary */}
        {inputSummary && (
          <span className="min-w-0 flex-1 truncate font-mono text-neutral-500">
            {inputSummary}
          </span>
        )}

        {/* Expand/collapse chevron */}
        {(hasExpandableContent || item.pending) && (
          <span className="ml-auto shrink-0 text-neutral-600" aria-hidden="true">
            {expanded ? '▲' : '▾'}
          </span>
        )}
      </button>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-neutral-700 px-3 py-2 space-y-3">
          {/* Input section */}
          {inputSummary && (
            <section>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                Input
              </div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-neutral-400 text-xs leading-relaxed">
                {formatInputFull(item.input)}
              </pre>
            </section>
          )}

          {/* Result section — only once result arrives */}
          {resultText !== null && resultText !== '' && (
            <section>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                Result
              </div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-neutral-400 text-xs leading-relaxed">
                {resultText}
              </pre>
            </section>
          )}

          {/* Pending placeholder in expanded view */}
          {item.pending && (
            <span className="animate-pulse text-neutral-500">Waiting for result…</span>
          )}
        </div>
      )}
    </div>
  )
}

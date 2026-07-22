/**
 * CommandPalette — keyboard-navigable, focus-trapped overlay for the app
 * command palette.
 *
 * Composes:
 *   - fuzzyScore  (renderer/hooks/fuzzyMatch.ts)  — substring scoring
 *   - useMRU      (renderer/hooks/useMRU.ts)       — recently-used ordering
 *   - useAppCommands (renderer/hooks/useAppCommands.ts) — full command registry
 *   - @radix-ui/react-dialog — accessible focus trap, Escape, aria-modal,
 *                               portal rendering
 *
 * Exports:
 *   filterAndSortCommands — pure helper (tested in node env by .test.ts)
 *   CommandPalette        — React component (consumed by S04 keyboard wiring)
 */

import { useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { fuzzyScore } from '../hooks/fuzzyMatch'
import { useAppCommands } from '../hooks/useAppCommands'
import { useMRU } from '../hooks/useMRU'
import type { AppCommand } from '../hooks/useAppCommands'
import type { SessionId } from '../../shared/types'

export type { AppCommand }

// ── Pure helper — exported for node-env tests ─────────────────────────────────

/**
 * Filter `commands` to those matching `query` and sort by relevance.
 *
 * Empty query:
 *   Returns all commands sorted by MRU position (lower index = more recent).
 *   Commands absent from `mruIds` are appended in their original order.
 *
 * Non-empty query:
 *   Filters to commands whose label passes fuzzyScore (not -Infinity).
 *   Sorts by:
 *     1. MRU position ascending (in-MRU floats above non-MRU regardless of score)
 *     2. fuzzyScore descending (higher = better within the same MRU tier)
 *
 * Does not mutate the input arrays.
 */
export function filterAndSortCommands(
  query: string,
  commands: AppCommand[],
  mruIds: string[],
): AppCommand[] {
  if (query === '') {
    // Sort by MRU position; commands absent from mruIds go to end in their
    // original relative order (stable via originalIndex tiebreaker).
    return [...commands].sort((a, b) => {
      const ai = mruIds.indexOf(a.id)
      const bi = mruIds.indexOf(b.id)
      const aPos = ai === -1 ? mruIds.length + commands.indexOf(a) : ai
      const bPos = bi === -1 ? mruIds.length + commands.indexOf(b) : bi
      return aPos - bPos
    })
  }

  // Score every command; drop those that are not a fuzzy subsequence.
  const scored = commands
    .map((cmd) => ({ cmd, score: fuzzyScore(query, cmd.label) }))
    .filter(({ score }) => score !== -Infinity)

  // Primary: MRU position (in-MRU before non-MRU; lower index = more recent).
  // Secondary: fuzzyScore descending.
  scored.sort((a, b) => {
    const ai = mruIds.indexOf(a.cmd.id)
    const bi = mruIds.indexOf(b.cmd.id)
    const aPos = ai === -1 ? Infinity : ai
    const bPos = bi === -1 ? Infinity : bi
    if (aPos !== bPos) return aPos - bPos
    return b.score - a.score
  })

  return scored.map(({ cmd }) => cmd)
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  /** Whether the palette overlay is visible. */
  open: boolean
  /** Called when the palette should close (Escape, overlay click, or command run). */
  onClose: () => void
  /** Active session id — passed to useAppCommands for session-scoped commands. */
  sessionId: SessionId | null
  /** Optional callback returning the last assistant turn text for copy-last-turn. */
  getLastTurnText?: () => string
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * CommandPalette overlay.
 *
 * Keyboard handling:
 *   ArrowDown / ArrowUp — move selection (wraps)
 *   Enter               — execute selected command, record in MRU, close
 *   Escape              — handled by Radix Dialog (onOpenChange → false)
 *
 * State resets automatically when the overlay closes because Radix Dialog
 * unmounts Dialog.Content when open=false, so useState initialises fresh on
 * the next open.
 */
export function CommandPalette({
  open,
  onClose,
  sessionId,
  getLastTurnText,
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const commands = useAppCommands(sessionId, getLastTurnText)
  const [mruIds, record] = useMRU('gsd-tau:mru-commands')

  const filtered = filterAndSortCommands(query, commands, mruIds)

  // Radix calls this with false on Escape and overlay click.
  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      setQuery('')
      setSelectedIndex(0)
      onClose()
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const len = filtered.length
    if (len === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => (i + 1) % len)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => (i - 1 + len) % len)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = filtered[selectedIndex]
      if (selected != null) {
        record(selected.id)
        void selected.execute()
        setQuery('')
        setSelectedIndex(0)
        onClose()
      }
    }
  }

  function handleQueryChange(e: ChangeEvent<HTMLInputElement>): void {
    setQuery(e.target.value)
    setSelectedIndex(0) // reset selection whenever the query changes
  }

  function handleItemClick(cmd: AppCommand): void {
    record(cmd.id)
    void cmd.execute()
    setQuery('')
    setSelectedIndex(0)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/4 z-50 w-full max-w-lg -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl focus:outline-none"
          aria-label="Command palette"
          onKeyDown={handleKeyDown}
        >
          {/* Visually hidden title satisfies Radix Dialog's a11y requirement. */}
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>

          {/* Search input */}
          <div className="border-b border-neutral-700 px-4 py-3">
            <input
              className="w-full bg-transparent text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none"
              placeholder="Type a command…"
              value={query}
              onChange={handleQueryChange}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              aria-autocomplete="list"
              aria-controls="command-palette-list"
            />
          </div>

          {/* Results list */}
          <ul
            id="command-palette-list"
            className="max-h-72 overflow-y-auto py-1"
            role="listbox"
            aria-label="Commands"
          >
            {filtered.length === 0 ? (
              <li className="px-4 py-2 text-sm text-neutral-500" role="option" aria-selected={false}>
                No commands found
              </li>
            ) : (
              filtered.map((cmd, i) => (
                <li
                  key={cmd.id}
                  role="option"
                  aria-selected={i === selectedIndex}
                  className={[
                    'cursor-pointer px-4 py-2 text-sm select-none',
                    i === selectedIndex
                      ? 'bg-neutral-700 text-neutral-100'
                      : 'text-neutral-300 hover:bg-neutral-800',
                  ].join(' ')}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onClick={() => handleItemClick(cmd)}
                  data-testid={`palette-item-${cmd.id}`}
                >
                  {cmd.label}
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

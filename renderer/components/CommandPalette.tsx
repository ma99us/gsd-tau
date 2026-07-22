/**
 * CommandPalette — keyboard-navigable, focus-trapped overlay for the app
 * command palette.
 *
 * Composes:
 *   - fuzzyScore  (renderer/hooks/fuzzyMatch.ts)       — substring scoring
 *   - useMRU      (renderer/hooks/useMRU.ts)            — recently-used ordering
 *   - useAppCommands (renderer/hooks/useAppCommands.ts) — full command registry
 *   - usePiCommands  (renderer/hooks/usePiCommands.ts)  — pi slash commands
 *   - @radix-ui/react-dialog — accessible focus trap, Escape, aria-modal,
 *                               portal rendering
 *
 * Exports:
 *   filterAndSortCommands — pure helper (tested in node env by .test.ts)
 *   CommandPalette        — React component (consumed by S04 keyboard wiring)
 */

import { useState, useEffect, useRef } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { fuzzyScore } from '../hooks/fuzzyMatch'
import { useAppCommands } from '../hooks/useAppCommands'
import { usePiCommands } from '../hooks/usePiCommands'
import { useMRU } from '../hooks/useMRU'
import type { AppCommand } from '../hooks/useAppCommands'
import type { GsdApi, SessionId } from '../../shared/types'

export type { AppCommand }

// ── GSD API accessor ──────────────────────────────────────────────────────────
// Matches the globalThis pattern in useAppCommands.ts so vi.stubGlobal works.
function gsd(): GsdApi {
  return (globalThis as unknown as { gsd: GsdApi }).gsd
}

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
// ── ArgMode state ────────────────────────────────────────────────────────────

interface ArgMode {
  /** The pi command that was selected. */
  command: AppCommand
  /** The prefix string to prepend to user-typed args (e.g. "/gsd"). */
  prefix: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandPalette({
  open,
  onClose,
  sessionId,
  getLastTurnText,
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  /** Non-null when the palette is in argument-input mode for a pi command. */
  const [argMode, setArgMode] = useState<ArgMode | null>(null)
  const [argInput, setArgInput] = useState('')
  const argInputRef = useRef<HTMLInputElement>(null)

  const commands = useAppCommands(sessionId, getLastTurnText)
  const piCommands = usePiCommands(sessionId)
  const [mruIds, record] = useMRU('gsd-tau:mru-commands')

  // Trigger pi-command fetch when the palette opens (respects 60 s TTL cache).
  useEffect(() => {
    if (open) piCommands.fetch()
    // piCommands.fetch is stable within the same sessionId — dep excluded intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Map pi RPC commands to the AppCommand shape for unified filtering.
  const piAppCommands: AppCommand[] = piCommands.commands.map(cmd => {
    // RpcSlashCommand is opaque from the contracts package — cast to access
    // runtime fields (name, description, type) without bundling the contracts.
    const c = cmd as unknown as { name: string; description?: string; type?: string }
    return {
      id: `pi:${c.name}`,
      label: c.name,
      badge: c.type,
      description: c.description,
      acceptsArgs: true,
      execute: async () => {
        if (sessionId != null) await gsd().prompt(sessionId, c.name)
      },
    }
  })

  const allCommands = [...commands, ...piAppCommands]
  const filtered = filterAndSortCommands(query, allCommands, mruIds)

  // Radix calls this with false on Escape and overlay click.
  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      setQuery('')
      setSelectedIndex(0)
      setArgMode(null)
      setArgInput('')
      onClose()
    }
  }

  // Called when a command is activated (Enter or click).
  // Commands with acceptsArgs enter arg mode; others execute immediately.
  function activateCommand(cmd: AppCommand): void {
    if (cmd.acceptsArgs) {
      setArgMode({ command: cmd, prefix: cmd.label })
      setArgInput('')
      setQuery('')
      setSelectedIndex(0)
      // Focus the arg input on the next paint.
      setTimeout(() => argInputRef.current?.focus(), 0)
    } else {
      record(cmd.id)
      void cmd.execute()
      setQuery('')
      setSelectedIndex(0)
      onClose()
    }
  }

  // Submits the current arg input against the active pi command.
  function submitArgMode(): void {
    if (argMode == null || sessionId == null) return
    const args = argInput.trim()
    const text = args.length > 0 ? `${argMode.prefix} ${args}` : argMode.prefix
    record(argMode.command.id)
    void gsd().prompt(sessionId, text)
    setArgMode(null)
    setArgInput('')
    setQuery('')
    setSelectedIndex(0)
    onClose()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    // Arg mode — only Enter is handled here; Escape is handled by onEscapeKeyDown.
    if (argMode != null) {
      if (e.key === 'Enter') {
        e.preventDefault()
        submitArgMode()
      }
      return
    }

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
      if (selected != null) activateCommand(selected)
    }
  }

  function handleQueryChange(e: ChangeEvent<HTMLInputElement>): void {
    setQuery(e.target.value)
    setSelectedIndex(0) // reset selection whenever the query changes
  }

  function handleItemClick(cmd: AppCommand): void {
    activateCommand(cmd)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/4 z-50 w-full max-w-lg -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl focus:outline-none"
          aria-label="Command palette"
          onKeyDown={handleKeyDown}
          onEscapeKeyDown={(e) => {
            // In arg mode, Escape returns to command browsing instead of closing.
            if (argMode != null) {
              e.preventDefault()
              setArgMode(null)
              setArgInput('')
            }
          }}
        >
          {/* Visually hidden title satisfies Radix Dialog's a11y requirement. */}
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>

          {argMode != null ? (
            // ── Argument-input mode ──────────────────────────────────────────
            <>
              {/* Prefix chip + args input */}
              <div className="flex items-center gap-2 border-b border-neutral-700 px-4 py-3">
                <span
                  className="shrink-0 rounded bg-neutral-700 px-2 py-0.5 font-mono text-sm text-neutral-100"
                  aria-label="Command"
                >
                  {argMode.prefix}
                </span>
                <input
                  ref={argInputRef}
                  className="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none"
                  placeholder="arguments… (Enter to send, Escape to go back)"
                  value={argInput}
                  onChange={(e) => setArgInput(e.target.value)}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  aria-label="Command arguments"
                />
              </div>
              {/* Description / hint row */}
              <div className="px-4 py-2 text-xs text-neutral-500">
                {argMode.command.description != null
                  ? argMode.command.description
                  : `Send ${argMode.prefix} with optional arguments`}
              </div>
            </>
          ) : (
            // ── Normal command-browse mode ───────────────────────────────────
            <>
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
                      <div className="flex items-center justify-between gap-2">
                        <span>{cmd.label}</span>
                        {cmd.badge != null && (
                          <span className="shrink-0 rounded bg-neutral-600 px-1.5 py-0.5 text-xs text-neutral-300">
                            {cmd.badge}
                          </span>
                        )}
                        {cmd.acceptsArgs === true && (
                          <span className="shrink-0 text-xs text-neutral-600" aria-label="accepts arguments">
                            …
                          </span>
                        )}
                      </div>
                      {cmd.description != null && (
                        <p className="mt-0.5 truncate text-xs text-neutral-500">{cmd.description}</p>
                      )}
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

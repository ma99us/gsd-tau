/**
 * ThinkingLevelChip — clickable chip showing the active thinking level.
 *
 * Renders as a 💡 {level} button styled to match the model chip in
 * SessionHeaderBar.  On click opens a Radix DropdownMenu with all 7 thinking
 * levels; the current level is indicated with a check mark.  Ctrl+Shift+T
 * cycles forward through levels without opening the dropdown.
 *
 * Returns null when isReasoningModel is false — the chip is completely absent
 * for non-reasoning models.
 *
 * Props:
 *   currentLevel     — active thinking level; null renders '—'
 *   isReasoningModel — when false the chip is not rendered at all
 *   onLevelSelected  — called with the chosen level; parent owns IPC + rollback
 */

import { useState, useEffect } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { RPC_THINKING_LEVELS } from '../../shared/types'
import type { ThinkingLevel } from '../../shared/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ThinkingLevelChipProps {
  /** Currently active thinking level; null renders '—' in the chip. */
  currentLevel: ThinkingLevel | null
  /** When false the chip is not rendered (non-reasoning model). */
  isReasoningModel: boolean
  /** Called when the user selects a level from the dropdown or Ctrl+Shift+T cycles. */
  onLevelSelected: (level: ThinkingLevel) => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Human-readable labels shown in the picker dropdown. */
const LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
  max: 'Max',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ThinkingLevelChip({
  currentLevel,
  isReasoningModel,
  onLevelSelected,
}: ThinkingLevelChipProps): JSX.Element | null {
  const [open, setOpen] = useState(false)

  /**
   * Ctrl+Shift+T cycles forward through all levels when the chip is visible.
   * Effect dependencies include `currentLevel` and `onLevelSelected` so the
   * handler always closes over the latest values; reinstalling on change is
   * intentional and cheap.
   */
  useEffect(() => {
    if (!isReasoningModel) return

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        const idx =
          currentLevel !== null ? RPC_THINKING_LEVELS.indexOf(currentLevel) : -1
        const nextIdx = (idx + 1) % RPC_THINKING_LEVELS.length
        onLevelSelected(RPC_THINKING_LEVELS[nextIdx])
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isReasoningModel, currentLevel, onLevelSelected])

  // Hidden entirely for non-reasoning models.
  if (!isReasoningModel) return null

  const triggerLabel = `💡 ${currentLevel ?? '—'}`

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        {/*
         * Styled to match the model chip: font-mono text-xs text-neutral-400.
         * Using a <button> so keyboard users can open the menu with Space/Enter.
         */}
        <button
          className="font-mono text-xs text-neutral-400 hover:text-neutral-200 focus:outline-none"
          title={`Thinking level: ${currentLevel ?? 'unknown'} (Ctrl+Shift+T to cycle)`}
          aria-label="Pick thinking level"
          aria-haspopup="listbox"
          data-testid="thinking-level-chip"
        >
          {triggerLabel}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-36 rounded border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-xl"
          align="start"
          sideOffset={4}
          data-testid="thinking-level-content"
        >
          {RPC_THINKING_LEVELS.map((level) => (
            <DropdownMenu.Item
              key={level}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-neutral-300 outline-none hover:bg-neutral-800 focus:bg-neutral-800 data-[highlighted]:bg-neutral-800"
              onSelect={() => onLevelSelected(level)}
              data-testid={`thinking-level-item-${level}`}
            >
              {/* Check indicator for the currently selected level */}
              <span className="w-3 shrink-0 text-amber-400">
                {level === currentLevel ? '✓' : ''}
              </span>
              <span className="font-mono">{LEVEL_LABELS[level]}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

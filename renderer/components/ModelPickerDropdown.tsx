/**
 * ModelPickerDropdown — clickable model chip that opens a grouped model list.
 *
 * Renders as a button (styled to match the existing model `<span>` in
 * SessionHeaderBar).  On open it triggers `useAvailableModels.fetch()`, which
 * respects the 60 s TTL cache so multiple rapid opens do not hammer IPC.
 *
 * Models are grouped by provider (sorted alphabetically) and within each
 * group sorted by id.  Each item shows the model id, an optional context
 * window badge ("200k ctx"), and an optional "reasoning" badge.
 *
 * Props:
 *   sessionId       — passed to the cache hook for IPC calls
 *   currentModel    — displayed in the trigger; null renders '—'
 *   onModelSelected — called with the chosen ModelInfo; Radix closes the
 *                     menu automatically after onSelect fires
 */

import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useAvailableModels } from '../hooks/useAvailableModels'
import type { ModelInfo, SessionId } from '../../shared/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ModelPickerDropdownProps {
  /** Stable RPC session id used for IPC calls via the cache hook. */
  sessionId: SessionId
  /** Currently active model — shown in the trigger chip. */
  currentModel: { provider: string; id: string } | null
  /** Called when the user selects a model from the list. */
  onModelSelected: (model: ModelInfo) => void
  /**
   * Externally controlled open state.  When provided the component operates
   * in controlled mode — the caller is responsible for toggling open/close.
   * Omit to use the default uncontrolled behaviour (internal state).
   */
  open?: boolean
  /**
   * Called when the dropdown requests an open-state change.  In controlled
   * mode the caller must update `open` in response to receive the new state.
   */
  onOpenChange?: (open: boolean) => void
}

// ── Exported helpers (tested in isolation) ────────────────────────────────────

/**
 * Format a context-window token count as a compact string.
 * Values ≥ 1 000 are rounded to the nearest thousand and suffixed with "k".
 *
 * @example formatContextWindow(200000) → "200k ctx"
 * @example formatContextWindow(8192)   → "8k ctx"
 * @example formatContextWindow(512)    → "512 ctx"
 */
export function formatContextWindow(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k ctx`
  return `${n} ctx`
}

export interface ModelGroup {
  provider: string
  models: ModelInfo[]
}

/**
 * Group `models` by provider, sort groups alphabetically, and sort models
 * within each group by id.  Returns a new array — does not mutate the input.
 *
 * An empty input returns an empty array.
 */
export function groupAndSortModels(models: ModelInfo[]): ModelGroup[] {
  const map = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const list = map.get(m.provider) ?? []
    list.push(m)
    map.set(m.provider, list)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, group]) => ({
      provider,
      models: [...group].sort((a, b) => a.id.localeCompare(b.id)),
    }))
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModelPickerDropdown({
  sessionId,
  currentModel,
  onModelSelected,
  open: controlledOpen,
  onOpenChange: onControlledOpenChange,
}: ModelPickerDropdownProps): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false)
  // Controlled mode when the caller provides `open`; uncontrolled otherwise.
  const isControlled = controlledOpen !== undefined
  const effectiveOpen = isControlled ? controlledOpen : internalOpen
  const { models, loading, fetch } = useAvailableModels(sessionId)

  const triggerLabel =
    currentModel !== null ? `${currentModel.provider}/${currentModel.id}` : '—'

  function handleOpenChange(nextOpen: boolean): void {
    if (isControlled) {
      // Delegate state ownership back to the caller.
      onControlledOpenChange?.(nextOpen)
    } else {
      setInternalOpen(nextOpen)
    }
    if (nextOpen) {
      // Fetch on first open; subsequent opens within 60 s return cached data.
      fetch()
    }
  }

  const groups = groupAndSortModels(models)

  return (
    <DropdownMenu.Root open={effectiveOpen} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        {/*
         * Styled to match the existing plain <span> chip in SessionHeaderBar:
         * font-mono text-xs text-neutral-400 truncate
         * Using a <button> so keyboard users can open the menu with Space/Enter.
         */}
        <button
          className="truncate font-mono text-xs text-neutral-400 hover:text-neutral-200 focus:outline-none"
          title={currentModel !== null ? `Model: ${triggerLabel}` : 'Model loading…'}
          aria-label="Pick model"
          aria-haspopup="listbox"
        >
          {triggerLabel}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-52 rounded border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-xl"
          align="start"
          sideOffset={4}
          data-testid="model-picker-content"
        >
          {/* Loading state */}
          {loading && (
            <div className="px-3 py-2 text-neutral-500">Loading models…</div>
          )}

          {/* Empty state (not loading) */}
          {!loading && groups.length === 0 && (
            <div className="px-3 py-2 text-neutral-500">No models available</div>
          )}

          {/* Grouped model list */}
          {groups.map(({ provider, models: providerModels }, groupIndex) => (
            <DropdownMenu.Group key={provider}>
              {groupIndex > 0 && (
                <DropdownMenu.Separator className="my-1 border-t border-neutral-700" />
              )}
              <DropdownMenu.Label className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                {provider}
              </DropdownMenu.Label>
              {providerModels.map((m) => (
                <DropdownMenu.Item
                  key={`${m.provider}/${m.id}`}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-neutral-300 outline-none hover:bg-neutral-800 focus:bg-neutral-800 data-[highlighted]:bg-neutral-800"
                  onSelect={() => onModelSelected(m)}
                  data-testid={`model-item-${m.provider}-${m.id}`}
                >
                  <span className="font-mono">{m.id}</span>
                  {/* Metadata badges — pushed to the right */}
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {m.contextWindow !== undefined && (
                      <span className="rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-500">
                        {formatContextWindow(m.contextWindow)}
                      </span>
                    )}
                    {m.reasoning === true && (
                      <span className="rounded bg-amber-900/40 px-1 py-0.5 text-[10px] text-amber-400">
                        reasoning
                      </span>
                    )}
                  </span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

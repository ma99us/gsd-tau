import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type MouseEvent,
  type DragEvent,
} from 'react'
import type { SessionState } from '../../shared/types'
import { OpenProjectFlyout } from './OpenProjectFlyout'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_DISPLAY_CHARS = 24

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TabEntry {
  id: string
  /** Human-readable project / session name. Truncated to 24 chars in the tab. */
  displayName: string
  state: SessionState | null
  /** Count of pending extension_ui_request blockers — shown as a red badge when >0. */
  blockerCount: number
}

export interface TabBarProps {
  tabs: TabEntry[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  /** Called when the user picks a project to open (from flyout, browse, or drag-drop). */
  onOpenProject: (cwd: string) => void
  onRename: (id: string, newName: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Exported for unit tests. */
export function truncateDisplayName(s: string, max = MAX_DISPLAY_CHARS): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

// ── State indicator dot ───────────────────────────────────────────────────────

function StateDot({ state }: { state: SessionState | null }): JSX.Element | null {
  // Plan spec: Working=yellow pulse, Waiting=orange pulse, Idle=green, Stopped=red
  if (!state || state === 'Idle') {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-green-500 opacity-70"
        aria-hidden="true"
      />
    )
  }
  if (state === 'Working') {
    return (
      <span
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-yellow-400"
        aria-hidden="true"
      />
    )
  }
  if (state === 'Waiting') {
    return (
      <span
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-orange-400"
        aria-hidden="true"
      />
    )
  }
  if (state === 'Stopped') {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-red-500"
        aria-hidden="true"
      />
    )
  }
  return null
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuState {
  tabId: string
  x: number
  y: number
}

interface ContextMenuProps {
  menu: ContextMenuState
  onClose: () => void
  onCloseTab: (id: string) => void
  onRenameTab: (id: string) => void
}

function ContextMenu({ menu, onClose, onCloseTab, onRenameTab }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleOutsideClick = (e: Event): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKey, { capture: true })
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKey, { capture: true })
    }
  }, [onClose])

  const items: Array<{ label: string; deferred?: boolean; action: () => void }> = [
    {
      label: 'Rename',
      action: () => { onRenameTab(menu.tabId); onClose() },
    },
    {
      label: 'Close',
      action: () => { onCloseTab(menu.tabId); onClose() },
    },
    {
      label: 'Move to new window',
      deferred: true,
      // Deferred to Phase 6 (ADR-006). Closes the menu on click.
      action: onClose,
    },
  ]

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Tab options"
      style={{ left: menu.x, top: menu.y }}
      className="fixed z-[100] min-w-[11rem] overflow-hidden rounded-lg
                 border border-neutral-700 bg-neutral-800 py-1 shadow-xl"
    >
      {items.map(item => (
        <button
          key={item.label}
          role="menuitem"
          type="button"
          disabled={item.deferred === true}
          onClick={item.action}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left
                     text-sm text-neutral-200 transition-colors
                     hover:bg-neutral-700
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          {item.label}
          {item.deferred === true && (
            <span className="ml-auto text-[10px] tracking-wide text-neutral-500">
              Phase 6
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Inline rename input ───────────────────────────────────────────────────────

interface RenameInputProps {
  initialValue: string
  onCommit: (value: string) => void
  onCancel: () => void
}

function RenameInput({ initialValue, onCommit, onCancel }: RenameInputProps): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const trimmed = value.trim()
      if (trimmed) onCommit(trimmed)
      else onCancel()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      aria-label="Rename tab"
      onChange={e => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        const trimmed = value.trim()
        if (trimmed) onCommit(trimmed)
        else onCancel()
      }}
      onClick={e => e.stopPropagation()}
      className="w-full rounded bg-neutral-700 px-1 py-0.5 text-xs text-neutral-100
                 outline-none ring-1 ring-blue-500"
    />
  )
}

// ── Single tab item ───────────────────────────────────────────────────────────

interface TabItemProps {
  tab: TabEntry
  index: number
  isActive: boolean
  isRenaming: boolean
  isDragSource: boolean
  isDragTarget: boolean
  onSelect: () => void
  onClose: () => void
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onRenameCommit: (value: string) => void
  onRenameCancel: () => void
}

function TabItem({
  tab,
  isActive,
  isRenaming,
  isDragSource,
  isDragTarget,
  onSelect,
  onClose,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onRenameCommit,
  onRenameCancel,
}: TabItemProps): JSX.Element {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onAuxClick={(e: MouseEvent<HTMLDivElement>) => {
        // Middle-click closes the tab (button === 1)
        if (e.button === 1) { e.preventDefault(); onClose() }
      }}
      onContextMenu={onContextMenu}
      title={tab.displayName}
      className={[
        'group relative flex min-w-0 max-w-[12rem] cursor-pointer select-none',
        'items-center gap-1.5 border-r border-neutral-700/60 px-3 transition-colors',
        isActive
          ? 'bg-neutral-800 text-neutral-100'
          : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200',
        isDragTarget ? 'ring-inset ring-2 ring-blue-500' : '',
        isDragSource ? 'opacity-50' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <StateDot state={tab.state} />

      <span className="min-w-0 flex-1 truncate text-xs">
        {isRenaming ? (
          <RenameInput
            initialValue={tab.displayName}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : (
          truncateDisplayName(tab.displayName)
        )}
      </span>

      {tab.blockerCount > 0 && !isRenaming && (
        <span
          aria-label={`${tab.blockerCount} pending requests`}
          className="flex min-w-[1rem] shrink-0 items-center justify-center
                     rounded-full bg-red-600 px-1 py-0.5
                     text-[9px] font-bold tabular-nums text-white"
        >
          {tab.blockerCount}
        </span>
      )}

      {!isRenaming && (
        <button
          type="button"
          aria-label={`Close ${tab.displayName}`}
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); onClose() }}
          className={[
            'ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center',
            'rounded text-sm text-neutral-500 transition-colors',
            'hover:bg-neutral-700 hover:text-neutral-200',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          ].join(' ')}
        >
          ×
        </button>
      )}

      {/* Active-tab underline indicator */}
      {isActive && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
      )}
    </div>
  )
}

// ── TabBar ────────────────────────────────────────────────────────────────────

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onOpenProject,
  onRename,
}: TabBarProps): JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [flyoutPos, setFlyoutPos] = useState<{ x: number; y: number } | null>(null)

  /** Ref for the [+] button — used to anchor the Open Project flyout. */
  const plusBtnRef = useRef<HTMLButtonElement>(null)

  // ── Flyout open/close ─────────────────────────────────────────────────────

  /** Opens the flyout anchored below the [+] button (or falls back to a fixed position). */
  const openFlyout = useCallback((): void => {
    if (plusBtnRef.current) {
      const rect = plusBtnRef.current.getBoundingClientRect()
      setFlyoutPos({ x: rect.left, y: rect.bottom + 4 })
    } else {
      setFlyoutPos({ x: Math.max(0, window.innerWidth - 340), y: 40 })
    }
  }, [])

  /**
   * Called when the flyout resolves to a project path.
   * Closes the flyout immediately, then delegates to the parent.
   */
  const handleFlyoutOpen = useCallback(
    (cwd: string): void => {
      onOpenProject(cwd)
      setFlyoutPos(null)
    },
    [onOpenProject],
  )

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent): void => {
      // Don't hijack shortcuts while a rename input is focused.
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.ctrlKey && !e.shiftKey && e.key === 't') {
        e.preventDefault()
        openFlyout()
        return
      }

      if (e.ctrlKey && !e.shiftKey && e.key === 'w') {
        e.preventDefault()
        if (activeId) onClose(activeId)
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle through tabs
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        if (tabs.length < 2) return
        const idx = tabs.findIndex(t => t.id === activeId)
        if (e.shiftKey) {
          const prev = (idx - 1 + tabs.length) % tabs.length
          onSelect(tabs[prev].id)
        } else {
          const next = (idx + 1) % tabs.length
          onSelect(tabs[next].id)
        }
        return
      }

      // Ctrl+1..9 — focus tab by 1-based position
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const n = parseInt(e.key, 10)
        if (!isNaN(n) && n >= 1 && n <= 9) {
          const entry = tabs[n - 1]
          if (entry) {
            e.preventDefault()
            onSelect(entry.id)
          }
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [tabs, activeId, onSelect, onClose, openFlyout])

  // ── Context menu ──────────────────────────────────────────────────────────
  const openContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, tabId: string): void => {
      e.preventDefault()
      setContextMenu({ tabId, x: e.clientX, y: e.clientY })
    },
    [],
  )

  // ── HTML5 drag-and-drop reorder ───────────────────────────────────────────
  const handleDragStart = (e: DragEvent<HTMLDivElement>, index: number): void => {
    setDragFromIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>, toIndex: number): void => {
    e.preventDefault()
    if (dragFromIndex !== null && dragFromIndex !== toIndex) {
      onReorder(dragFromIndex, toIndex)
    }
    setDragFromIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = (): void => {
    setDragFromIndex(null)
    setDragOverIndex(null)
  }

  // ── Rename helpers ────────────────────────────────────────────────────────
  const startRename = useCallback((tabId: string): void => {
    setRenamingId(tabId)
  }, [])

  const commitRename = useCallback(
    (tabId: string, newName: string): void => {
      onRename(tabId, newName)
      setRenamingId(null)
    },
    [onRename],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        role="tablist"
        aria-label="Project tabs"
        className="flex h-9 shrink-0 items-stretch overflow-x-auto
                   border-b border-neutral-700 bg-neutral-900"
      >
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={tab}
            index={index}
            isActive={tab.id === activeId}
            isRenaming={renamingId === tab.id}
            isDragSource={dragFromIndex === index}
            isDragTarget={dragOverIndex === index && dragFromIndex !== index}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
            onContextMenu={e => openContextMenu(e, tab.id)}
            onDragStart={e => handleDragStart(e, index)}
            onDragOver={e => handleDragOver(e, index)}
            onDrop={e => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onRenameCommit={v => commitRename(tab.id, v)}
            onRenameCancel={() => setRenamingId(null)}
          />
        ))}

        {/* New-tab / plus button */}
        <button
          ref={plusBtnRef}
          type="button"
          aria-label="New tab (Ctrl+T)"
          title="New tab (Ctrl+T)"
          onClick={openFlyout}
          className="flex h-full w-9 shrink-0 items-center justify-center
                     text-neutral-500 transition-colors
                     hover:bg-neutral-800 hover:text-neutral-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
          </svg>
        </button>
      </div>

      {/* Context menu — portalled outside the tablist to escape overflow:hidden */}
      {contextMenu !== null && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCloseTab={id => onClose(id)}
          onRenameTab={id => startRename(id)}
        />
      )}

      {/* Open Project flyout — anchored below the [+] button */}
      {flyoutPos !== null && (
        <OpenProjectFlyout
          position={flyoutPos}
          onOpen={handleFlyoutOpen}
          onClose={() => setFlyoutPos(null)}
        />
      )}
    </>
  )
}

export default TabBar

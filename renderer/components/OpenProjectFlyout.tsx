import { useState, useEffect, useRef, useCallback } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

/** localStorage key shared with App.tsx for the MRU project list. */
const RECENTS_KEY = 'gsd-tau:recent-projects'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecentEntry {
  cwd: string
  /** ISO-8601 date string of last open. */
  lastOpened: string
}

export interface OpenProjectFlyoutProps {
  /**
   * Anchor position in viewport coordinates (px).
   * The flyout renders below this point, clamped within the viewport width.
   */
  position: { x: number; y: number }
  /** Called when the user selects a project (recent click, browse, or drop). */
  onOpen: (cwd: string) => void
  /** Called when the flyout should close (Escape or click-outside). */
  onClose: () => void
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Returns the last path segment, handling both forward-slash and backslash
 * separators. Matches the same helper used in App.tsx so display names are
 * consistent throughout the app.
 */
export function projectName(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd
}

/**
 * Returns a human-readable relative-time string for the recents list.
 * Returns an empty string for invalid or future dates.
 *
 * @example
 *   relativeTime(new Date(Date.now() - 5 * 60_000).toISOString()) // "5m ago"
 */
export function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  if (isNaN(diffMs) || diffMs < 0) return ''
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

// ── localStorage helpers ──────────────────────────────────────────────────────

/** Reads the MRU list from localStorage. Returns [] on parse failure. */
export function loadRecents(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as RecentEntry[]
  } catch {
    return []
  }
}

/** Removes a single entry from the MRU list and writes back to localStorage. */
function removeRecent(cwd: string): void {
  const entries = loadRecents().filter(e => e.cwd !== cwd)
  localStorage.setItem(RECENTS_KEY, JSON.stringify(entries))
}

// ── OpenProjectFlyout ─────────────────────────────────────────────────────────

/**
 * Dropdown flyout for opening a project. Anchored below the [+] tab-bar button.
 *
 * Interactions:
 * - Recent-projects list (MRU from localStorage, max 10) with dismiss ×
 * - "Browse for folder…" button → native folder picker via `window.gsd.showFolderPicker()`
 * - Drag-and-drop zone accepting folders dragged from Windows Explorer
 * - Keyboard: ↑↓ navigate recents, Enter opens focused entry, Escape closes
 * - Click-outside closes
 *
 * Failure modes:
 * - `showFolderPicker` cancelled → flyout stays open (no action taken)
 * - `showFolderPicker` throws (IPC error) → caught; flyout stays open; error
 *   surfaces to the caller via `onOpen` which calls `doOpen` in App.tsx
 * - Drag drop with no `file.path` (non-Electron context) → silently ignored
 * - Corrupt localStorage → `loadRecents` returns [] (no crash)
 */
export function OpenProjectFlyout({
  position,
  onOpen,
  onClose,
}: OpenProjectFlyoutProps): JSX.Element {
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [isDragOver, setIsDragOver] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // ── Auto-focus on mount so keyboard nav works immediately ─────────────────
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // ── Click-outside closes ──────────────────────────────────────────────────
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          if (recents.length > 0) {
            setFocusIndex(i => (i + 1) % recents.length)
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (recents.length > 0) {
            setFocusIndex(i => (i - 1 + recents.length) % recents.length)
          }
          break
        case 'Enter':
          if (focusIndex >= 0 && focusIndex < recents.length) {
            e.preventDefault()
            onOpen(recents[focusIndex].cwd)
          }
          break
        default:
          break
      }
    }
    document.addEventListener('keydown', handleKey, { capture: true })
    return () => document.removeEventListener('keydown', handleKey, { capture: true })
  }, [recents, focusIndex, onOpen, onClose])

  // ── Browse via native folder dialog ──────────────────────────────────────
  const handleBrowse = useCallback(async (): Promise<void> => {
    setBrowsing(true)
    try {
      const picked = await window.gsd.showFolderPicker()
      if (picked) onOpen(picked)
    } finally {
      setBrowsing(false)
    }
  }, [onOpen])

  // ── Dismiss a single recent entry ─────────────────────────────────────────
  const handleDismiss = useCallback(
    (cwd: string, e: React.MouseEvent): void => {
      e.stopPropagation()
      removeRecent(cwd)
      const updated = loadRecents()
      setRecents(updated)
      // Clamp focus index to the new list bounds.
      setFocusIndex(i => Math.min(i, updated.length - 1))
    },
    [],
  )

  // ── Drag-and-drop from Windows Explorer ───────────────────────────────────
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setIsDragOver(true)
      }
    },
    [],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      // Only clear when the pointer truly leaves the zone (not when crossing
      // a child element boundary).
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setIsDragOver(false)
      }
    },
    [],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault()
      setIsDragOver(false)
      const [first] = Array.from(e.dataTransfer.files)
      if (first) {
        // Electron extends the standard File interface with a non-standard
        // `path` property that resolves to the full local filesystem path.
        const electronFile = first as File & { path?: string }
        if (electronFile.path) {
          onOpen(electronFile.path)
        }
      }
    },
    [onOpen],
  )

  // ── Viewport clamping — prevent right-edge overflow ───────────────────────
  const FLYOUT_WIDTH = 320 // w-80 = 20rem at 16px base
  const clampedLeft = Math.min(position.x, window.innerWidth - FLYOUT_WIDTH - 8)

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Open project"
      style={{ left: clampedLeft, top: position.y }}
      className="fixed z-[200] flex w-80 flex-col overflow-hidden rounded-xl
                 border border-neutral-700 bg-neutral-900 shadow-2xl outline-none"
    >
      {/* ── Section header ───────────────────────────────────────────────── */}
      <div className="px-3 pb-1 pt-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Recent Projects
        </span>
      </div>

      {/* ── Recents list or empty state ───────────────────────────────────── */}
      {recents.length === 0 ? (
        <p className="px-4 py-2 pb-3 text-xs text-neutral-600">
          No recent projects.
        </p>
      ) : (
        <ul
          role="listbox"
          aria-label="Recent projects"
          className="max-h-64 overflow-y-auto"
        >
          {recents.map((entry, i) => (
            <li key={entry.cwd} className="flex items-stretch">
              {/*
               * Row button — the main click target.
               * The dismiss × is a sibling <button> (not nested) to comply
               * with the HTML spec which forbids nesting interactive elements.
               */}
              <button
                type="button"
                role="option"
                aria-selected={i === focusIndex}
                onClick={() => onOpen(entry.cwd)}
                onMouseEnter={() => setFocusIndex(i)}
                className={[
                  'flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left',
                  'transition-colors',
                  i === focusIndex
                    ? 'bg-neutral-700 text-neutral-100'
                    : 'text-neutral-300 hover:bg-neutral-800',
                ].join(' ')}
              >
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate text-sm font-medium leading-tight">
                    {projectName(entry.cwd)}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-neutral-500">
                    {entry.cwd}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-neutral-500">
                  {relativeTime(entry.lastOpened)}
                </span>
              </button>

              {/* Dismiss × — sibling to the row button, not nested inside */}
              <button
                type="button"
                aria-label={`Remove ${projectName(entry.cwd)} from recents`}
                tabIndex={-1}
                onClick={e => handleDismiss(entry.cwd, e)}
                onMouseEnter={() => setFocusIndex(i)}
                className={[
                  'flex shrink-0 items-center justify-center px-2',
                  'text-sm text-neutral-600 transition-colors hover:text-neutral-200',
                  i === focusIndex ? 'bg-neutral-700' : 'hover:bg-neutral-800',
                ].join(' ')}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div className="border-t border-neutral-700" />

      {/* ── Browse for folder button ──────────────────────────────────────── */}
      <div className="p-2">
        <button
          type="button"
          disabled={browsing}
          onClick={() => void handleBrowse()}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2
                     text-sm text-neutral-400 transition-colors
                     hover:bg-neutral-800 hover:text-neutral-200
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* Folder icon (Heroicons solid 16) */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-4 w-4 shrink-0"
            aria-hidden="true"
          >
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H12.5A1.5 1.5 0 0 1 14 5.5v1H2v-3ZM2 8.5A1.5 1.5 0 0 1 3.5 7h9A1.5 1.5 0 0 1 14 8.5V12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V8.5Z" />
          </svg>
          {browsing ? 'Opening…' : 'Browse for folder…'}
        </button>
      </div>

      {/* ── Drag-and-drop zone ────────────────────────────────────────────── */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label="Drop a folder here to open it"
        className={[
          'mx-2 mb-2 flex items-center justify-center gap-2 rounded-lg',
          'border-2 border-dashed py-3 text-xs transition-colors',
          isDragOver
            ? 'border-blue-500 bg-blue-500/10 text-blue-300'
            : 'border-neutral-800 text-neutral-600',
        ].join(' ')}
      >
        {/* Upload / drop icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-4 w-4 shrink-0"
          aria-hidden="true"
        >
          <path d="M7.25 10.25a.75.75 0 0 0 1.5 0V4.56l2.22 2.22a.75.75 0 1 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v5.69Z" />
          <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
        </svg>
        Drop a folder here
      </div>
    </div>
  )
}

export default OpenProjectFlyout

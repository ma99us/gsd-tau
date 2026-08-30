import { useState, useEffect, useRef } from 'react'
import { useSessionsStore } from './state/sessions-store'
import { TabBar } from './components/TabBar'
import { SessionView } from './components/SessionView'
import { ClosingOverlay } from './components/ClosingOverlay'
import type { TabEntry as TabBarEntry } from './components/TabBar'
import type { ComposerHandle } from './components/Composer'
import { CommandPalette } from './components/CommandPalette'

// ── Recent sessions persistence ───────────────────────────────────────────────

const RECENTS_KEY = 'gsd-tau:recent-projects'
const MAX_RECENTS = 10

interface RecentEntry {
  cwd: string
  lastOpened: string // ISO date string
}

function loadRecents(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as RecentEntry[]
  } catch {
    return []
  }
}

function saveRecent(cwd: string): void {
  const entries = loadRecents().filter((e) => e.cwd !== cwd)
  entries.unshift({ cwd, lastOpened: new Date().toISOString() })
  localStorage.setItem(RECENTS_KEY, JSON.stringify(entries.slice(0, MAX_RECENTS)))
}

/** Returns the last path segment, handling both / and \ separators. */
function projectName(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd
}

/** Relative timestamp string, e.g. "2 days ago". */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d ago`
}

// ── App ───────────────────────────────────────────────────────────────────────

function App(): JSX.Element {
  const { sessions, tabOrder, activeTabId, openTab, closeTab, setActiveTab, reorderTabs, renameTab } =
    useSessionsStore()

  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents)
  /** Non-null while a single tab is shutting down — shows the closing overlay. */
  const [closingTabName, setClosingTabName] = useState<string | null>(null)
  /** True when the window-close sequence has been initiated. */
  const [isAppClosing, setIsAppClosing] = useState(false)
  const closingOverlayMsg = isAppClosing
    ? 'Closing gsd-tau…'
    : closingTabName
      ? `Closing ${closingTabName}…`
      : null

  // ── Keyboard-shortcut wiring state ────────────────────────────────────────
  /** True while the command palette overlay is visible. */
  const [paletteOpen, setPaletteOpen] = useState(false)
  /**
   * When true, tells the active SessionHeaderBar to open the model picker.
   * Reset to false after one tick so subsequent Ctrl+. presses can re-trigger
   * (a stable `true` value won't re-fire the SessionHeaderBar useEffect).
   */
  const [forcePickerOpen, setForcePickerOpen] = useState(false)
  /**
   * Ref pointing to the active session's Composer imperative handle.
   * Only forwarded to the currently-active SessionView; inactive views
   * receive null so the ref always targets the visible composer.
   */
  const composerRef = useRef<ComposerHandle>(null)

  // ── Initialise the sessions store once on mount ───────────────────────────
  useEffect(() => {
    let cleanup: (() => void) | null = null
    void useSessionsStore.getState().init().then((fn) => {
      cleanup = fn
    })
    return () => {
      cleanup?.()
    }
  }, [])

  // Subscribe to window-close signal from main process.
  useEffect(() => {
    const unsub = window.gsd.onAppClosing(() => {
      setIsAppClosing(true)
    })
    return unsub
  }, [])

  // Keep recents in sync when the window regains focus.
  useEffect(() => {
    const sync = (): void => setRecents(loadRecents())
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  // Ctrl+Shift+P → open command palette
  // Ctrl+K       → focus composer in the active session
  // Ctrl+.       → open model picker in the active session
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        composerRef.current?.focus()
        return
      }
      if (e.ctrlKey && e.key === '.') {
        e.preventDefault()
        setForcePickerOpen(true)
        // Reset after SessionHeaderBar's useEffect fires so the same shortcut
        // can re-trigger on subsequent keypresses (duplicate `true` won't
        // re-fire the effect).
        setTimeout(() => { setForcePickerOpen(false) }, 0)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, []) // composerRef is stable (useRef); setState setters are stable

  // ── Open project helper ───────────────────────────────────────────────────

  const doOpen = async (path: string): Promise<void> => {
    setOpening(true)
    setOpenError(null)
    try {
      await openTab(path)
      saveRecent(path)
      setRecents(loadRecents())
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpening(false)
    }
  }

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.gsd.showFolderPicker()
    if (picked) await doOpen(picked)
  }

  const handleResumeAll = async (): Promise<void> => {
    if (recents.length > 0) await doOpen(recents[0].cwd)
  }

  const dismissRecent = (cwd: string): void => {
    const next = recents.filter((e) => e.cwd !== cwd)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
    setRecents(next)
  }

  // ── No sessions: landing screen ───────────────────────────────────────────
  if (tabOrder.length === 0) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-8 bg-neutral-900">
        {/* Blocking overlay for app-close sequence (even on the empty screen) */}
        {closingOverlayMsg !== null && <ClosingOverlay message={closingOverlayMsg} />}
        {/* Wordmark */}
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">gsd-tau</h1>
          <p className="text-sm text-neutral-400">Open a directory to start a project</p>
        </div>

        {/* Browse button */}
        <button
          type="button"
          onClick={() => void handleBrowse()}
          disabled={opening}
          className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white
                     shadow-lg transition-colors hover:bg-blue-500
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {opening ? 'Opening…' : 'Browse…'}
        </button>

        {/* Error */}
        {openError && (
          <p className="w-80 rounded-lg bg-red-950 px-3 py-2 text-xs text-red-400">
            {openError}
          </p>
        )}

        {/* Recent sessions */}
        {recents.length > 0 && (
          <div className="flex w-80 flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                Recent
              </span>
              <button
                type="button"
                onClick={() => void handleResumeAll()}
                disabled={opening}
                className="text-xs text-blue-400 transition-colors hover:text-blue-300
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                Resume All
              </button>
            </div>

            <ul className="flex flex-col gap-1">
              {recents.map((entry) => (
                <li key={entry.cwd} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void doOpen(entry.cwd)}
                    disabled={opening}
                    className="group flex min-w-0 flex-1 flex-col rounded-lg px-3 py-2
                               text-left transition-colors hover:bg-neutral-800
                               disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-neutral-200 group-hover:text-white">
                      {projectName(entry.cwd)}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-neutral-500">
                      <span className="truncate">{entry.cwd}</span>
                      <span className="shrink-0">· {relativeTime(entry.lastOpened)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissRecent(entry.cwd)}
                    className="shrink-0 rounded px-1.5 py-1 text-xs text-neutral-600
                               transition-colors hover:bg-neutral-800 hover:text-neutral-400"
                    title="Remove from recents"
                    aria-label={`Remove ${projectName(entry.cwd)} from recents`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  // ── Sessions open: tab bar + per-session views ────────────────────────────

  // Build the TabBar-compatible tab entries from store state.
  const tabBarTabs: TabBarEntry[] = tabOrder.map((id) => {
    const tab = sessions[id]
    return {
      id,
      displayName: tab?.displayName ?? id,
      state: tab?.state ?? null,
      blockerCount: tab ? Object.keys(tab.uiRequests).length : 0,
    }
  })

  const handleTabClose = (id: string): void => {
    const tab = sessions[id]
    if (tab?.state === 'Working') {
      const ok = window.confirm('A task is in progress. Close tab anyway?')
      if (!ok) return
    }
    const label = tab?.displayName ?? 'session'
    setClosingTabName(label)
    void closeTab(id).finally(() => {
      setClosingTabName(null)
    })
  }

  const handleTabReorder = (fromIndex: number, toIndex: number): void => {
    const next = [...tabOrder]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    reorderTabs(next)
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-900">
      {/* Blocking overlay while a tab or the whole app is shutting down */}
      {closingOverlayMsg !== null && <ClosingOverlay message={closingOverlayMsg} />}
      {/* Tab bar */}
      <TabBar
        tabs={tabBarTabs}
        activeId={activeTabId}
        onSelect={setActiveTab}
        onClose={handleTabClose}
        onReorder={handleTabReorder}
        onOpenProject={(cwd) => void doOpen(cwd)}
        onRename={(id, name) => void renameTab(id, name)}
      />

      {/*
       * Render ALL open SessionViews.
       * Active one is visible; inactive ones are hidden via display:none
       * inside SessionView — this preserves scroll position and React state
       * across tab switches without unmounting the components.
       */}
      {tabOrder.map((id) => {
        const tab = sessions[id]
        if (!tab) return null
        return (
          <SessionView
            key={id}
            sessionId={id}
            cwd={tab.cwd}
            isActive={id === activeTabId}
            isMissingPath={tab.isMissingPath}
            wasAutoRunning={tab.wasAutoRunning}
            composerRef={id === activeTabId ? composerRef : null}
            forcePickerOpen={id === activeTabId ? forcePickerOpen : undefined}
          />
        )
      })}

      {/* Command palette — Radix portal-renders to document.body; mounted at App
          level so it is reachable regardless of which session is active. */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false) }}
        sessionId={activeTabId}
      />
    </div>
  )
}

export default App

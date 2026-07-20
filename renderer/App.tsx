import { useState, useEffect } from 'react'
import { TurnList } from './components/TurnList'
import { Composer } from './components/Composer'
import { useSession } from './hooks/useSession'
import type { SessionState } from '../shared/types'

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
  const entries = loadRecents().filter(e => e.cwd !== cwd)
  entries.unshift({ cwd, lastOpened: new Date().toISOString() })
  localStorage.setItem(RECENTS_KEY, JSON.stringify(entries.slice(0, MAX_RECENTS)))
}

/** Returns the last path segment, handling both / and \ separators. */
function projectName(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd
}

// ── App ───────────────────────────────────────────────────────────────────────

function App(): JSX.Element {
  const { isOpen, cwd, sessionState, turns, openProject, send, abort } = useSession()

  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents)

  // Keep recents in sync when the app regains focus (other windows may have updated).
  useEffect(() => {
    const sync = (): void => setRecents(loadRecents())
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  const doOpen = async (path: string): Promise<void> => {
    setOpening(true)
    setOpenError(null)
    try {
      await openProject(path)
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
    // Phase 1: single-session — open the most recent project.
    // Phase 3 will open all sessions in separate tabs.
    if (recents.length > 0) await doOpen(recents[0].cwd)
  }

  // ── No session: landing screen ────────────────────────────────────────────
  if (!isOpen) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-8 bg-neutral-900">
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
              {recents.map(entry => (
                <li key={entry.cwd}>
                  <button
                    type="button"
                    onClick={() => void doOpen(entry.cwd)}
                    disabled={opening}
                    className="group flex w-full flex-col rounded-lg px-3 py-2
                               text-left transition-colors hover:bg-neutral-800
                               disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-neutral-200 group-hover:text-white">
                      {projectName(entry.cwd)}
                    </span>
                    <span className="truncate text-xs text-neutral-500">
                      {entry.cwd}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  // ── Session open: chat view ───────────────────────────────────────────────
  const isWorking = sessionState === 'Working'
  const isStopped = sessionState === 'Stopped'

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-900">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-700 px-4 py-2">
        <span
          className="max-w-[60%] truncate text-sm font-medium text-neutral-200"
          title={cwd ?? ''}
        >
          {cwd}
        </span>
        <div className="flex items-center gap-3">
          {isWorking && (
            <button
              type="button"
              onClick={() => void abort()}
              className="text-xs text-neutral-400 transition-colors hover:text-red-400"
              title="Abort current turn"
            >
              Abort
            </button>
          )}
          <StateIndicator state={sessionState} />
        </div>
      </header>

      {/* Stopped banner */}
      {isStopped && (
        <div className="shrink-0 bg-red-950 px-4 py-2 text-xs text-red-400">
          ⚠ Session stopped — the pi process exited. New messages will not be sent.
        </div>
      )}

      {/* Chat area fills remaining space */}
      <TurnList turns={turns} />

      {/* Composer pinned to bottom */}
      <Composer onSend={text => void send(text)} disabled={isWorking || isStopped} />
    </div>
  )
}

// ── Session state indicator ───────────────────────────────────────────────────

function StateIndicator({ state }: { state: SessionState | null }): JSX.Element | null {
  if (!state || state === 'Idle') return null

  if (state === 'Working') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-400">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        Working
      </span>
    )
  }

  if (state === 'Stopped') {
    return <span className="text-xs text-red-400">Stopped</span>
  }

  return null
}

export default App

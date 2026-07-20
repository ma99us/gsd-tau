import { useState } from 'react'
import { TurnList } from './components/TurnList'
import { Composer } from './components/Composer'
import { useSession } from './hooks/useSession'
import type { SessionState } from '../shared/types'

function App(): JSX.Element {
  const { isOpen, cwd, sessionState, turns, openProject, send, abort } = useSession()

  const [pathInput, setPathInput] = useState('')
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  const handleOpen = async (): Promise<void> => {
    const p = pathInput.trim()
    if (!p) return
    setOpening(true)
    setOpenError(null)
    try {
      await openProject(p)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpening(false)
    }
  }

  // ── No session: folder picker ─────────────────────────────────────────────
  if (!isOpen) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-900">
        <div className="flex w-80 flex-col gap-4">
          <h1 className="text-center text-xl font-semibold text-neutral-100">gsd-tau</h1>
          <p className="text-center text-sm text-neutral-400">
            Open a project folder to start a session
          </p>

          <div className="flex gap-2">
            <input
              type="text"
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleOpen()
              }}
              placeholder="D:/Projects/my-app"
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-800
                         px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500
                         outline-none focus:border-neutral-500"
            />
            <button
              type="button"
              onClick={() => void handleOpen()}
              disabled={opening || !pathInput.trim()}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium
                         text-white transition-colors hover:bg-blue-500
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              {opening ? '…' : 'Open'}
            </button>
          </div>

          {openError && (
            <p className="rounded-lg bg-red-950 px-3 py-2 text-xs text-red-400">
              {openError}
            </p>
          )}
        </div>
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

import { useState, useEffect, useRef } from 'react'
import { TurnList } from './components/TurnList'
import { Composer } from './components/Composer'
import { useSession } from './hooks/useSession'
import {
  StatusBar,
  applySetStatus,
  applySetWidget,
  applySetTitle,
  emptyStatusBarState,
} from './components/StatusBar'
import {
  InlineToast,
  buildToastEntry,
  addToastCapped,
  TOAST_TTL_MS,
} from './components/InlineToast'
import { enqueueModal, dequeueModal, removeFromQueue } from './state/modal-queue'
import { SelectModal } from './components/modals/SelectModal'
import { ConfirmModal } from './components/modals/ConfirmModal'
import { InputModal } from './components/modals/InputModal'
import { EditorModal } from './components/modals/EditorModal'
import { FallbackModal } from './components/modals/FallbackModal'
import type { StatusBarState } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import type { ToastEntry } from './components/InlineToast'
import type { ModalQueue } from './state/modal-queue'
import type { SessionState, RpcExtensionUIRequest, UiResponseInput } from '../shared/types'

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
  const { isOpen, cwd, sessionId, sessionState, turns, openProject, send, abort } = useSession()

  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents)

  // ── Non-modal UI-request state ─────────────────────────────────────────────
  const [statusBarState, setStatusBarState] = useState<StatusBarState>(emptyStatusBarState)
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  // ── Modal queue — blocking requests (select/confirm/input/editor/unknown) ──
  const [modalQueue, setModalQueue] = useState<ModalQueue>([])
  // Tab display name — editable via tab rename; synced to cwd on project open.
  const [displayName, setDisplayName] = useState(() => projectName(cwd ?? ''))
  /**
   * Buffered set_editor_text value — T09's EditorModal reads this ref on open
   * and clears it after consuming the prefill value.
   */
  const editorPrefillRef = useRef<string | null>(null)

  // Keep recents in sync when the app regains focus (other windows may have updated).
  useEffect(() => {
    const sync = (): void => setRecents(loadRecents())
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  // Sync display name when a new project is opened (cwd changes).
  useEffect(() => {
    if (cwd) setDisplayName(projectName(cwd))
  }, [cwd])

  // ── Non-modal UI-request subscription ─────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return

    // Reset all transient display state for the incoming session.
    setStatusBarState(emptyStatusBarState)
    setToasts([])
    setModalQueue([])
    editorPrefillRef.current = null

    const handleRequest = (request: RpcExtensionUIRequest): void => {
      switch (request.method) {
        case 'notify': {
          const entry = buildToastEntry(request)
          setToasts(prev => addToastCapped(prev, entry))
          // Schedule auto-dismiss. capturedId is stable in this closure — safe
          // even if React batches the corresponding setToasts update.
          const capturedId = request.id
          setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== capturedId))
          }, TOAST_TTL_MS)
          // Auto-respond — notify is informational, no user action required.
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        case 'setStatus': {
          setStatusBarState(prev => applySetStatus(prev, request))
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        case 'setWidget': {
          setStatusBarState(prev => applySetWidget(prev, request))
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        case 'setTitle': {
          setStatusBarState(prev => applySetTitle(prev, request))
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        case 'set_editor_text': {
          // Buffer the latest prefill text for T09's EditorModal.
          // If an EditorModal is already open, T09 will apply this immediately;
          // otherwise it is consumed when the next editor blocker arrives.
          editorPrefillRef.current = request.text
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        // Any method not handled above is a blocking request that needs a
        // modal response.  Known blockers: select, confirm, input, editor.
        // Unknown future methods are handled by FallbackModal.
        default:
          setModalQueue(prev => enqueueModal(prev, request))
          break
      }
    }

    const unsub = window.gsd.onUiRequestAdded(sessionId, handleRequest)

    // When pi cancels a blocker externally (timeout, abort) before the user
    // answers, remove it from the queue so the next queued modal shows.
    const unsubRemoved = window.gsd.onUiRequestRemoved(sessionId, (requestId: string) => {
      setModalQueue(prev => removeFromQueue(prev, requestId))
    })

    return () => {
      unsub()
      unsubRemoved()
    }
  }, [sessionId])

  const dismissToast = (id: string): void => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  /**
   * Called when the user responds to the active (front-of-queue) modal.
   * Shifts the queue immediately so the next modal is shown without waiting
   * for the IPC round-trip, then sends the response to pi.
   */
  const handleModalRespond = (
    request: RpcExtensionUIRequest,
    response: UiResponseInput,
  ): void => {
    setModalQueue(prev => dequeueModal(prev))
    if (sessionId) {
      void window.gsd.respondUI(sessionId, request.id, response)
    }
  }

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
  const activeModal = modalQueue[0]
  const queueDepth = modalQueue.length

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-900">
      {/* Tab bar — single-session scaffold; T09 expands to multi-tab */}
      <TabBar
        tabs={[{
          id: sessionId ?? 'current',
          displayName,
          state: sessionState,
          blockerCount: modalQueue.length,
        }]}
        activeId={sessionId}
        onSelect={() => { /* single-tab: no-op */ }}
        onClose={() => {
          // T09 implements full close via sessions-store closeTab action.
          // Pre-T09: confirm on Working then abort; no way to return to landing yet.
          if (sessionState === 'Working') {
            const ok = window.confirm('A task is in progress. Close tab anyway?')
            if (!ok) return
            void abort()
          }
        }}
        onReorder={() => { /* single-tab: no-op */ }}
        onNewTab={() => { void handleBrowse() }}
        onRename={(_, name) => { setDisplayName(name) }}
      />
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
          {/* Queue depth badge — shown when >1 blocking request is pending */}
          {queueDepth > 1 && (
            <span
              className="flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
              title={`${queueDepth} requests queued`}
              aria-label={`${queueDepth} requests queued`}
            >
              {queueDepth}
            </span>
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

      {/* Status bar — non-modal setStatus / setWidget / setTitle rendering */}
      <StatusBar {...statusBarState} />

      {/* Chat area fills remaining space */}
      <TurnList turns={turns} />

      {/* Composer pinned to bottom */}
      <Composer onSend={text => void send(text)} sessionId={sessionId} disabled={isWorking || isStopped} />

      {/* Inline toasts — fixed position, overlaid above composer */}
      <InlineToast toasts={toasts} onDismiss={dismissToast} />

      {/* Active blocking modal from the queue (select/confirm/input/editor/fallback) */}
      {activeModal !== undefined && (
        <ActiveModalRouter
          key={activeModal.id}
          request={activeModal}
          editorPrefillRef={editorPrefillRef}
          onRespond={response => { handleModalRespond(activeModal, response) }}
        />
      )}
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

  if (state === 'Waiting') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-400">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
        Waiting
      </span>
    )
  }

  if (state === 'Stopped') {
    return <span className="text-xs text-red-400">Stopped</span>
  }

  return null
}

export default App

// ── Active modal router ───────────────────────────────────────────────────────

type ActiveModalRouterProps = {
  request: RpcExtensionUIRequest
  editorPrefillRef: { current: string | null }
  onRespond: (response: UiResponseInput) => void
}

/**
 * Mounts the correct modal component for the front-of-queue blocking request.
 * Keyed by request.id in the parent so React remounts the component (resetting
 * internal state) whenever a new request becomes active.
 *
 * Editor prefill: reads editorPrefillRef.current on mount and passes it as
 * `initialValue` to EditorModal, then clears the ref so the next editor
 * request starts with a clean textarea unless pi sends another set_editor_text.
 */
function ActiveModalRouter({
  request,
  editorPrefillRef,
  onRespond,
}: ActiveModalRouterProps): JSX.Element {
  // Read prefill synchronously — refs are mutable and safe to read during render.
  const editorPrefill = request.method === 'editor' ? (editorPrefillRef.current ?? '') : ''

  // Clear the prefill after mount so it is consumed only once.
  useEffect(() => {
    if (request.method === 'editor') {
      editorPrefillRef.current = null
    }
  }, [request.id, request.method, editorPrefillRef])

  switch (request.method) {
    case 'select':
      return (
        <SelectModal
          request={request as Extract<RpcExtensionUIRequest, { method: 'select' }>}
          onRespond={onRespond}
        />
      )
    case 'confirm':
      return (
        <ConfirmModal
          request={request as Extract<RpcExtensionUIRequest, { method: 'confirm' }>}
          onRespond={onRespond}
        />
      )
    case 'input':
      return (
        <InputModal
          request={request as Extract<RpcExtensionUIRequest, { method: 'input' }>}
          onRespond={onRespond}
        />
      )
    case 'editor':
      return (
        <EditorModal
          request={request as Extract<RpcExtensionUIRequest, { method: 'editor' }>}
          initialValue={editorPrefill}
          onRespond={onRespond}
        />
      )
    default:
      return <FallbackModal request={request} onRespond={onRespond} />
  }
}

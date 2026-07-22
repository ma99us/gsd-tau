/**
 * SessionView — per-session chat panel.
 *
 * Renders the full chat UI (TurnList, Composer, StatusBar, modals, toasts)
 * scoped to a single sessionId.  All per-session state lives inside this
 * component; the Zustand sessions-store supplies only the live SessionState
 * (already subscribed globally).
 *
 * Visibility strategy
 * -------------------
 * The parent renders ALL open SessionViews, but only the active one is visible.
 * Inactive views are hidden via `display:none` (`aria-hidden` too) instead of
 * being unmounted so that:
 *   • React local state (turn history, modals, status bar) is preserved.
 *   • The DOM node (and therefore scroll position) survives a tab switch.
 *
 * IPC subscriptions
 * -----------------
 * Each SessionView holds its own `onEvent`, `onUiRequestAdded`, and
 * `onUiRequestRemoved` subscriptions wired on mount and cleaned up on unmount.
 * `onStateChange` is handled by the sessions-store and read via the selector
 * below; SessionView does not duplicate it.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  type Ref,
} from 'react'
import { SessionHeaderBar } from './SessionHeaderBar'
import { TurnList } from './TurnList'
import { Composer, type ComposerHandle } from './Composer'
import {
  StatusBar,
  applySetStatus,
  applySetWidget,
  applySetTitle,
  emptyStatusBarState,
} from './StatusBar'
import {
  InlineToast,
  buildToastEntry,
  addToastCapped,
  TOAST_TTL_MS,
} from './InlineToast'
import { enqueueModal, dequeueModal, removeFromQueue } from '../state/modal-queue'
import { SelectModal } from './modals/SelectModal'
import { ConfirmModal } from './modals/ConfirmModal'
import { InputModal } from './modals/InputModal'
import { EditorModal } from './modals/EditorModal'
import { FallbackModal } from './modals/FallbackModal'
import { MissingSessionBanner } from './MissingSessionBanner'
import { useSessionsStore } from '../state/sessions-store'
import { turnsReducer } from '../hooks/turnsReducer'
import type { ToolItem } from '../hooks/turnsReducer'
import type {
  SessionId,
  SessionEvent,
  RpcExtensionUIRequest,
  UiResponseInput,
} from '../../shared/types'
import type { StatusBarState } from './StatusBar'
import type { ToastEntry } from './InlineToast'
import type { ModalQueue } from '../state/modal-queue'

// ── ID generation ─────────────────────────────────────────────────────────────
// Module-level counter shared across all mounted SessionViews — IDs only need
// to be unique within a single session's turn list, but cross-session uniqueness
// doesn't hurt and avoids any bookkeeping per-instance.
let _idSeq = 0
function nextId(prefix: string): string {
  return `${prefix}-${++_idSeq}`
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SessionViewProps {
  /** Stable pi session id — used to scope all IPC calls and subscriptions. */
  sessionId: SessionId
  /** Absolute path to the project directory. Displayed in the session header. */
  cwd: string
  /** Whether this view is the currently focused tab. Controls visibility. */
  isActive: boolean
  /**
   * True when this tab is a phantom entry for a session whose project directory
   * was not found at restore time.  `MissingSessionBanner` replaces the stopped
   * banner, and the Composer is disabled.
   */
  isMissingPath?: boolean
  /**
   * Ref forwarded to the active Composer's imperative handle.
   * Passed as `composerRef` only to the currently active tab (null for hidden
   * tabs) so `composerRef.current` always points to the visible composer.
   * Used by the Ctrl+K keyboard shortcut in App.tsx.
   */
  composerRef?: Ref<ComposerHandle>
  /**
   * When true, forces the model picker dropdown open via SessionHeaderBar.
   * Set by the Ctrl+. handler in App.tsx. SessionHeaderBar opens the dropdown
   * and Radix fires `onOpenChange(false)` to clear it when the user closes it.
   */
  forcePickerOpen?: boolean
}

// ── SessionView ───────────────────────────────────────────────────────────────

export function SessionView({ sessionId, cwd, isActive, isMissingPath, composerRef, forcePickerOpen }: SessionViewProps): JSX.Element {
  // ── Session state (from the global store — already subscribed) ─────────────
  const sessionState = useSessionsStore((s) => s.sessions[sessionId]?.state ?? 'Idle')

  // ── Turn history — pure local state, preserved by hidden-VDOM ─────────────
  const [turns, dispatch] = useReducer(turnsReducer, [])

  // ── Non-modal UI state ─────────────────────────────────────────────────────
  const [statusBarState, setStatusBarState] = useState<StatusBarState>(emptyStatusBarState)
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  // ── Modal blocking queue ───────────────────────────────────────────────────
  const [modalQueue, setModalQueue] = useState<ModalQueue>([])

  // ── Editor prefill buffer (set_editor_text → consumed by EditorModal) ─────
  const editorPrefillRef = useRef<string | null>(null)

  /**
   * Tracks which assistant turn id is currently being built.
   * Updated synchronously inside the event handler so multi-event sequences
   * that arrive in the same microtask stay coherent.
   */
  const currentAssistantId = useRef<string | null>(null)

  /**
   * Handler ref — reassigned on every render so the IPC subscription
   * (created once per sessionId mount) always calls the latest closure
   * without stale-capture issues.
   */
  const handleEventRef = useRef<(event: SessionEvent) => void>(() => undefined)

  handleEventRef.current = (event: SessionEvent): void => {
    switch (event.type) {
      // ── Turn lifecycle ─────────────────────────────────────────────────────
      case 'agent_start':
      case 'turn_start': {
        // Only open a new assistant turn if one isn't already open.
        // Both agent_start and turn_start fire for the same logical turn;
        // creating a turn on the second event would duplicate the placeholder.
        if (currentAssistantId.current === null) {
          const id = nextId('turn')
          currentAssistantId.current = id
          dispatch({ type: 'AGENT_START', id })
        }
        break
      }

      case 'agent_end':
      case 'turn_end':
      case 'execution_complete': {
        currentAssistantId.current = null
        break
      }

      // ── Streaming text ─────────────────────────────────────────────────────
      case 'text_delta':
      case 'message_update': {
        const assistantEvt = (event as Record<string, unknown>).assistantMessageEvent as
          | Record<string, unknown>
          | undefined
        // text_start fires before the first delta and would double the first token;
        // text_end carries no new content — skip both.
        if (assistantEvt && assistantEvt.type !== 'text_delta') break

        const delta = assistantEvt
          ? String(assistantEvt.delta ?? '')
          : String(
              (event as Record<string, unknown>).text ??
              (event as Record<string, unknown>).delta ??
              (event as Record<string, unknown>).content ??
              '',
            )

        const cid = currentAssistantId.current
        if (!cid) {
          const newTurnId = nextId('turn')
          currentAssistantId.current = newTurnId
          dispatch({
            type: 'TEXT_DELTA',
            currentAssistantId: null,
            delta,
            newTurnId,
            newItemId: nextId('item'),
          })
        } else {
          dispatch({
            type: 'TEXT_DELTA',
            currentAssistantId: cid,
            delta,
            newTurnId: nextId('turn'),
            newItemId: nextId('item'),
          })
        }
        break
      }

      // ── Tool events ────────────────────────────────────────────────────────
      case 'tool_use': {
        const toolUseId = String(event.id ?? nextId('tool'))
        const name = String(event.name ?? 'unknown')
        const input: unknown = event.input ?? {}
        const item: ToolItem = {
          kind: 'tool',
          id: toolUseId,
          toolUseId,
          name,
          input,
          pending: true,
        }
        const cid = currentAssistantId.current
        if (!cid) {
          const newTurnId = nextId('turn')
          currentAssistantId.current = newTurnId
          dispatch({ type: 'TOOL_USE', currentAssistantId: null, item, newTurnId })
        } else {
          dispatch({ type: 'TOOL_USE', currentAssistantId: cid, item, newTurnId: nextId('turn') })
        }
        break
      }

      case 'tool_result': {
        dispatch({
          type: 'TOOL_RESULT',
          toolUseId: String(event.tool_use_id ?? ''),
          content: event.content,
        })
        break
      }

      default:
        break
    }
  }

  // ── Subscribe to pi event stream ───────────────────────────────────────────
  useEffect(() => {
    const unsub = window.gsd.onEvent(sessionId, (ev) => {
      handleEventRef.current(ev)
    })
    return () => unsub()
  }, [sessionId])

  // ── Subscribe to UI-request channels (status / toasts / modal queue) ───────
  useEffect(() => {
    // Reset all transient display state for this session on (re)mount.
    setStatusBarState(emptyStatusBarState)
    setToasts([])
    setModalQueue([])
    editorPrefillRef.current = null

    const handleRequest = (request: RpcExtensionUIRequest): void => {
      switch (request.method) {
        case 'notify': {
          const entry = buildToastEntry(request as Extract<RpcExtensionUIRequest, { method: 'notify' }>)
          setToasts((prev) => addToastCapped(prev, entry))
          const capturedId = request.id
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== capturedId))
          }, TOAST_TTL_MS)
          // notify is informational — auto-acknowledge.
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        case 'setStatus': {
          setStatusBarState((prev) => applySetStatus(prev, request as Extract<RpcExtensionUIRequest, { method: 'setStatus' }>))
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        case 'setWidget': {
          setStatusBarState((prev) => applySetWidget(prev, request as Extract<RpcExtensionUIRequest, { method: 'setWidget' }>))
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        case 'setTitle': {
          setStatusBarState((prev) => applySetTitle(prev, request as Extract<RpcExtensionUIRequest, { method: 'setTitle' }>))
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        case 'set_editor_text': {
          // Buffer the prefill text. If an EditorModal is already open it
          // consumes it on mount; otherwise the next EditorModal reads it.
          editorPrefillRef.current = (request as Record<string, unknown>).text as string ?? ''
          void window.gsd.respondUI(sessionId, request.id, { value: '' })
          break
        }

        default:
          // All remaining methods are blocking requests that need a modal.
          setModalQueue((prev) => enqueueModal(prev, request))
          break
      }
    }

    const unsub = window.gsd.onUiRequestAdded(sessionId, handleRequest)
    const unsubRemoved = window.gsd.onUiRequestRemoved(sessionId, (requestId: string) => {
      setModalQueue((prev) => removeFromQueue(prev, requestId))
    })

    return () => {
      unsub()
      unsubRemoved()
    }
  }, [sessionId])

  // ── Actions ────────────────────────────────────────────────────────────────

  const send = useCallback(
    async (text: string): Promise<void> => {
      // Add user turn immediately before the async IPC call so it appears
      // in the list right away (no flicker waiting for a round-trip).
      currentAssistantId.current = null
      dispatch({ type: 'USER_TURN', id: nextId('turn'), text })
      await window.gsd.prompt(sessionId, text)
    },
    [sessionId],
  )

  const abort = useCallback(async (): Promise<void> => {
    await window.gsd.abort(sessionId)
  }, [sessionId])

  const dismissToast = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  /**
   * Respond to the active (front-of-queue) modal.
   * Shifts the queue immediately so the next modal shows without waiting for
   * the IPC round-trip.
   */
  const handleModalRespond = useCallback(
    (request: RpcExtensionUIRequest, response: UiResponseInput): void => {
      setModalQueue((prev) => dequeueModal(prev))
      void window.gsd.respondUI(sessionId, request.id, response)
    },
    [sessionId],
  )

  // ── Derived values ─────────────────────────────────────────────────────────

  const isWorking = sessionState === 'Working'
  const isStopped = sessionState === 'Stopped'
  const activeModal = modalQueue[0]
  const queueDepth = modalQueue.length

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    // Keep the node in the VDOM even when inactive — only toggle visibility.
    // This preserves scroll position and all React local state across tab switches.
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={{ display: isActive ? undefined : 'none' }}
      aria-hidden={!isActive}
      data-session-id={sessionId}
    >
      {/* Session header */}
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-700 px-4 py-2">
        <span
          className="max-w-[60%] truncate text-sm font-medium text-neutral-200"
          title={cwd}
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
        </div>
      </header>

      {/* Model chip + cost display — live RPC state and cost_update events */}
      <SessionHeaderBar sessionId={sessionId} forcePickerOpen={forcePickerOpen} />

      {/* Missing-path banner replaces the stopped banner when the project dir is gone */}
      {isMissingPath ? (
        <MissingSessionBanner sessionId={sessionId} cwd={cwd} />
      ) : isStopped ? (
        <div className="shrink-0 bg-red-950 px-4 py-2 text-xs text-red-400">
          ⚠ Session stopped — the pi process exited. New messages will not be sent.
        </div>
      ) : null}

      {/* Status bar — non-modal setStatus / setWidget / setTitle */}
      <StatusBar {...statusBarState} />

      {/* Turn history fills remaining space */}
      <TurnList turns={turns} />

      {/* Composer pinned to bottom */}
      <Composer
        ref={composerRef}
        onSend={(text) => void send(text)}
        sessionId={sessionId}
        disabled={isWorking || isStopped || !!isMissingPath}
      />

      {/* Inline toasts — fixed position, overlaid above composer */}
      <InlineToast toasts={toasts} onDismiss={dismissToast} />

      {/* Active blocking modal from the queue */}
      {activeModal !== undefined && (
        <SessionActiveModalRouter
          key={activeModal.id}
          request={activeModal}
          editorPrefillRef={editorPrefillRef}
          onRespond={(response) => { handleModalRespond(activeModal, response) }}
        />
      )}
    </div>
  )
}

// ── Session active modal router ───────────────────────────────────────────────

type SessionActiveModalRouterProps = {
  request: RpcExtensionUIRequest
  editorPrefillRef: { current: string | null }
  onRespond: (response: UiResponseInput) => void
}

/**
 * Mounts the correct modal component for the front-of-queue blocking request.
 * Keyed by request.id in the parent so React remounts the component
 * (resetting internal state) whenever a new request becomes active.
 *
 * Editor prefill: reads editorPrefillRef.current on mount and passes it as
 * `initialValue` to EditorModal, then clears the ref so the next editor
 * request starts fresh unless pi sends another set_editor_text.
 */
function SessionActiveModalRouter({
  request,
  editorPrefillRef,
  onRespond,
}: SessionActiveModalRouterProps): JSX.Element {
  const editorPrefill =
    request.method === 'editor' ? (editorPrefillRef.current ?? '') : ''

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

import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import type { SessionId, SessionEvent, SessionState } from '../../shared/types'
import { turnsReducer } from './turnsReducer'
import type { Turn, ToolItem } from './turnsReducer'

// Re-export turn types so importers can reference them from a single path.
export type { Turn, AssistantItem, TextItem, ToolItem, UserTurn, AssistantTurn } from './turnsReducer'

// ── ID generation ─────────────────────────────────────────────────────────────
// Module-level counter — unique across all mounted hook instances, no collisions.
let idSeq = 0

function nextId(prefix: string): string {
  return `${prefix}-${++idSeq}`
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface UseSessionReturn {
  sessionId: SessionId | null
  cwd: string | null
  turns: Turn[]
  sessionState: SessionState | null
  /** True once a project has been opened and a session assigned. */
  isOpen: boolean
  /** Open a project by absolute path.  Resolves with void; throws on failure. */
  openProject: (cwd: string) => Promise<void>
  /** Send a prompt to the active session. No-op when no session is open. */
  send: (text: string) => Promise<void>
  /** Abort the currently running turn.  No-op when no session is open. */
  abort: () => Promise<void>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSession(): UseSessionReturn {
  const [sessionId, setSessionId] = useState<SessionId | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [turns, dispatch] = useReducer(turnsReducer, [])

  /**
   * Tracks which assistant turn is currently being built.
   * Updated synchronously inside the event handler so multi-event sequences
   * that arrive in the same microtask tick stay coherent.
   */
  const currentAssistantId = useRef<string | null>(null)

  /**
   * Handler ref — reassigned on every render so the IPC subscription
   * (created once, keyed to sessionId) always calls the latest closure
   * without any stale-capture issues.
   */
  const handleEventRef = useRef<(event: SessionEvent) => void>(() => undefined)

  // Re-assign on every render. All captured values are either refs (always
  // current) or `dispatch` (stable across renders from useReducer).
  handleEventRef.current = (event: SessionEvent): void => {
    switch (event.type) {
      // ── turn lifecycle ─────────────────────────────────────────────────────
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
        if (currentAssistantId.current !== null) {
          dispatch({ type: 'TURN_COMPLETE', id: currentAssistantId.current })
        }
        currentAssistantId.current = null
        break
      }

      // ── streaming text ─────────────────────────────────────────────────────
      case 'text_delta':
      case 'message_update': {
        // message_update wraps pi's internal assistant message event.
        // The actual text delta lives at event.assistantMessageEvent.delta.
        // text_delta (legacy) carries it directly on event.text.
        if (event.type === 'message_update') {
          console.debug('[useSession] message_update payload:', JSON.stringify(event).slice(0, 200))
        }
        const assistantEvt = (event as Record<string, unknown>).assistantMessageEvent as
          | Record<string, unknown>
          | undefined
        // text_start fires before the first text_delta and would duplicate the first token.
        // text_end carries no new delta. Skip both; only process text_delta sub-events.
        if (assistantEvt && assistantEvt.type !== 'text_delta') break
        const delta = assistantEvt
          ? String(assistantEvt.delta ?? '')
          : String(
              (event as Record<string, unknown>).text ??
              (event as Record<string, unknown>).delta ??
              (event as Record<string, unknown>).content ??
              ''
            )
        const cid = currentAssistantId.current

        if (!cid) {
          // No agent_start received yet — create an implicit assistant turn.
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
            // newTurnId unused when cid is non-null, but the type requires it.
            newTurnId: nextId('turn'),
            // May be used when last item is a tool card and we need a new text item.
            newItemId: nextId('item'),
          })
        }
        break
      }

      // ── tool events ────────────────────────────────────────────────────────
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
        const toolUseId = String(event.tool_use_id ?? '')
        dispatch({ type: 'TOOL_RESULT', toolUseId, content: event.content })
        break
      }

      default:
        break
    }
  }

  // ── IPC subscriptions ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return

    const unsubEvent = window.gsd.onEvent(sessionId, ev => {
      handleEventRef.current(ev)
    })
    const unsubState = window.gsd.onStateChange(sessionId, state => {
      setSessionState(state)
    })

    return () => {
      unsubEvent()
      unsubState()
    }
  }, [sessionId])

  // ── Public methods ─────────────────────────────────────────────────────────

  const openProject = useCallback(async (projectCwd: string): Promise<void> => {
    const id = await window.gsd.openProject(projectCwd)
    // Fetch initial state before applying to React so both updates batch.
    const initialState = await window.gsd.getState(id)
    // Reset mutable tracking ref before the new subscription fires.
    currentAssistantId.current = null
    dispatch({ type: 'RESET' })
    setCwd(projectCwd)
    setSessionId(id)
    setSessionState(initialState)
  }, [])

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (!sessionId) return
      // Add user turn before the async call so it appears immediately.
      currentAssistantId.current = null
      dispatch({ type: 'USER_TURN', id: nextId('turn'), text })
      await window.gsd.prompt(sessionId, text)
    },
    [sessionId],
  )

  const abort = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    await window.gsd.abort(sessionId)
  }, [sessionId])

  return {
    sessionId,
    cwd,
    turns,
    sessionState,
    isOpen: !!sessionId,
    openProject,
    send,
    abort,
  }
}

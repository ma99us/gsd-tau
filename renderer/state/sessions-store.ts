/**
 * Zustand store for renderer-side session/tab state.
 *
 * Single source of truth for:
 * - Which sessions are open (`sessions` record)
 * - Which tab is active (`activeTabId`)
 * - Tab display order (`tabOrder`)
 *
 * Stays in sync with the main process via IPC push channels exposed through
 * the contextBridge GSD API:
 * - `session:state-change`        → updates per-tab `SessionState`
 * - `session:ui-request-added`    → adds to per-tab `uiRequests`
 * - `session:ui-request-removed`  → removes from per-tab `uiRequests`
 * - `session:restore-complete`    → re-populates after relaunch restore
 *
 * Usage:
 * ```ts
 * // In app entry point (after renderer is ready):
 * const cleanup = await useSessionsStore.getState().init()
 * // On teardown:
 * cleanup()
 * ```
 */

import { create } from 'zustand'
import type {
  SessionId,
  SessionState,
  SessionRecord,
  UiRequestState,
  RpcExtensionUIRequest,
  Unsubscribe,
  RestoreResult,
  GsdApi,
} from '@shared/types'

// ── GSD API accessor ───────────────────────────────────────────────────────────
// Uses `globalThis` rather than `window` for compatibility with the Vitest
// Node.js test environment.  In the Electron renderer process window === globalThis
// so behaviour is identical.  In tests, `vi.stubGlobal('gsd', mock)` sets
// `globalThis.gsd` which is what this accessor returns.
function gsd(): GsdApi {
  return (globalThis as unknown as { gsd: GsdApi }).gsd
}

// ── Per-tab state ──────────────────────────────────────────────────────────────

/**
 * All renderer-side state for one session tab.
 * Richer than {@link SessionRecord}: adds live `SessionState` and pending
 * UI-request blockers so the tab bar and session view can render without
 * extra IPC calls.
 */
export interface TabEntry {
  /** Stable session id — matches the pi RPC session id. */
  id: SessionId
  /** Absolute path to the project directory. */
  cwd: string
  /** Human-readable tab label (user-editable via `renameTab`). */
  displayName: string
  /** Live session state pushed from the main-process state machine. */
  state: SessionState
  /**
   * Pending UI-request blockers keyed by request id.
   * Non-empty only while the session is in `Waiting` state.
   */
  uiRequests: UiRequestState
  /** True when the session was in auto-mode at last checkpoint. */
  wasAutoRunning: boolean
}

// ── Store interface ────────────────────────────────────────────────────────────

export interface SessionsStore {
  /** All open sessions keyed by session id. */
  sessions: Record<SessionId, TabEntry>
  /** Session id of the focused tab, or `null` when no tab is open. */
  activeTabId: SessionId | null
  /** Session ids in tab bar display order. */
  tabOrder: SessionId[]

  // ── Actions ─────────────────────────────────────────────────────────────────

  /** Open a project folder as a new tab and focus it. Returns the new session id. */
  openTab(cwd: string): Promise<SessionId>
  /** Close a tab: calls IPC, removes from store, focuses a neighbour tab. */
  closeTab(id: SessionId): Promise<void>
  /** Focus a tab without triggering IPC side effects. */
  setActiveTab(id: SessionId): void
  /** Replace the tab order (e.g. after drag-to-reorder in the tab bar). */
  reorderTabs(ids: SessionId[]): void
  /** Rename a tab: calls IPC and updates the `displayName` in the store. */
  renameTab(id: SessionId, name: string): Promise<void>

  // ── Initialisation ───────────────────────────────────────────────────────────

  /**
   * Populate the store from the session registry and wire all IPC subscriptions.
   *
   * Clears any existing subscriptions before repopulating, making it safe to
   * call multiple times (e.g. in tests or on hot-reload).
   *
   * @returns A cleanup function that removes all IPC subscriptions.
   */
  init(): Promise<Unsubscribe>
}

// ── TabEntry factory ────────────────────────────────────────────────────────────

/** Build a TabEntry from a registry record with sensible renderer defaults. */
function tabFromRecord(rec: SessionRecord): TabEntry {
  return {
    id: rec.id,
    cwd: rec.cwd,
    displayName: rec.displayName,
    state: 'Idle',
    uiRequests: {},
    wasAutoRunning: rec.wasAutoRunning,
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useSessionsStore = create<SessionsStore>()((set, get) => {
  /**
   * Per-session cleanup functions — one entry = three IPC unsubscribers
   * (onStateChange, onUiRequestAdded, onUiRequestRemoved).
   *
   * Lives inside the `create()` closure so the `set` function captured by the
   * subscription callbacks is always the correct Zustand setter without
   * requiring a forward reference to `useSessionsStore`.
   */
  const _subs = new Map<SessionId, () => void>()
  let _restoreSub: (() => void) | null = null

  // ── Subscription helpers ───────────────────────────────────────────────────

  function subscribeToSession(id: SessionId): void {
    if (_subs.has(id)) return

    const unsubs: Unsubscribe[] = [
      gsd().onStateChange(id, (state: SessionState) => {
        set((s) => {
          const tab = s.sessions[id]
          if (!tab) return {}
          return { sessions: { ...s.sessions, [id]: { ...tab, state } } }
        })
      }),

      gsd().onUiRequestAdded(id, (request: RpcExtensionUIRequest) => {
        set((s) => {
          const tab = s.sessions[id]
          if (!tab) return {}
          return {
            sessions: {
              ...s.sessions,
              [id]: {
                ...tab,
                uiRequests: { ...tab.uiRequests, [request.id]: request },
              },
            },
          }
        })
      }),

      gsd().onUiRequestRemoved(id, (requestId: string) => {
        set((s) => {
          const tab = s.sessions[id]
          if (!tab) return {}
          const uiRequests = Object.fromEntries(
            Object.entries(tab.uiRequests).filter(([k]) => k !== requestId),
          ) as UiRequestState
          return { sessions: { ...s.sessions, [id]: { ...tab, uiRequests } } }
        })
      }),
    ]

    _subs.set(id, () => unsubs.forEach((u) => u()))
  }

  function unsubscribeSession(id: SessionId): void {
    _subs.get(id)?.()
    _subs.delete(id)
  }

  function clearAllSubs(): void {
    for (const cleanup of _subs.values()) cleanup()
    _subs.clear()
    _restoreSub?.()
    _restoreSub = null
  }

  // ── Store implementation ───────────────────────────────────────────────────

  return {
    sessions: {},
    activeTabId: null,
    tabOrder: [],

    openTab: async (cwd: string): Promise<SessionId> => {
      const id = await gsd().openProject(cwd)
      const entry: TabEntry = {
        id,
        cwd,
        // Derive display name from the last path component (works on both / and \ separators)
        displayName: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd,
        state: 'Idle',
        uiRequests: {},
        wasAutoRunning: false,
      }
      set((s) => ({
        sessions: { ...s.sessions, [id]: entry },
        tabOrder: [...s.tabOrder, id],
        activeTabId: id,
      }))
      subscribeToSession(id)
      return id
    },

    closeTab: async (id: SessionId): Promise<void> => {
      await gsd().closeSession(id)
      unsubscribeSession(id)
      set((s) => {
        const sessions = Object.fromEntries(
          Object.entries(s.sessions).filter(([k]) => k !== id),
        ) as Record<SessionId, TabEntry>
        const tabOrder = s.tabOrder.filter((t) => t !== id)
        const oldIdx = s.tabOrder.indexOf(id)

        let activeTabId = s.activeTabId
        if (activeTabId === id) {
          // Prefer the tab that was to the right (now at oldIdx in the filtered array);
          // fall back to the one that was to the left; then null.
          activeTabId = tabOrder[oldIdx] ?? tabOrder[oldIdx - 1] ?? null
        }

        return { sessions, tabOrder, activeTabId }
      })
    },

    setActiveTab: (id: SessionId): void => {
      set({ activeTabId: id })
    },

    reorderTabs: (ids: SessionId[]): void => {
      set({ tabOrder: ids })
    },

    renameTab: async (id: SessionId, name: string): Promise<void> => {
      await gsd().renameSession(id, name)
      set((s) => {
        const tab = s.sessions[id]
        if (!tab) return {}
        return { sessions: { ...s.sessions, [id]: { ...tab, displayName: name } } }
      })
    },

    init: async (): Promise<Unsubscribe> => {
      // Clear any pre-existing subscriptions (makes init() safe to call multiple times).
      clearAllSubs()

      // 1. Fetch all sessions the main process currently has open.
      const records = await gsd().listSessions()

      // 2. Build a fresh sessions snapshot and wire per-session subscriptions.
      const sessions: Record<SessionId, TabEntry> = {}
      const tabOrder: SessionId[] = []

      for (const rec of records) {
        sessions[rec.id] = tabFromRecord(rec)
        tabOrder.push(rec.id)
        subscribeToSession(rec.id)
      }

      // Preserve an existing activeTabId if it is still present in the new snapshot;
      // otherwise default to the first tab.
      const existing = get().activeTabId
      const activeTabId =
        existing !== null && sessions[existing] !== undefined
          ? existing
          : tabOrder[0] ?? null

      set({ sessions, tabOrder, activeTabId })

      // 3. Subscribe to restore-complete so any sessions that finish restoring
      //    after our initial snapshot are added automatically.
      _restoreSub = gsd().onRestoreComplete(async (_result: RestoreResult) => {
        const fresh = await gsd().listSessions()

        // Only add sessions not already tracked — avoids overwriting live state.
        const currentIds = new Set(Object.keys(get().sessions))
        const newRecords = fresh.filter((r) => !currentIds.has(r.id))

        if (newRecords.length === 0) return

        set((s) => {
          const sessions = { ...s.sessions }
          const tabOrder = [...s.tabOrder]
          for (const rec of newRecords) {
            sessions[rec.id] = tabFromRecord(rec)
            tabOrder.push(rec.id)
          }
          const activeTabId = s.activeTabId ?? tabOrder[0] ?? null
          return { sessions, tabOrder, activeTabId }
        })

        for (const rec of newRecords) {
          subscribeToSession(rec.id)
        }
      })

      // 4. Return cleanup that tears down all subscriptions.
      return (): void => {
        clearAllSubs()
      }
    },
  }
})

/**
 * Reset Zustand state to the initial empty value.
 *
 * For tests that only exercise actions (no IPC sync), call this in `beforeEach`.
 * For IPC sync tests, call `init()` instead — it clears subscriptions and
 * establishes a fresh subscription baseline automatically.
 *
 * @internal Test-only; do not use in production renderer code.
 */
export function _resetStoreStateForTest(): void {
  useSessionsStore.setState({ sessions: {}, activeTabId: null, tabOrder: [] })
}

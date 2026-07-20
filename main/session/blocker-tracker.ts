import { EventEmitter } from 'node:events'
import type { RpcExtensionUIRequest } from '../../shared/types'

// ── Events ─────────────────────────────────────────────────────────────────────

export interface BlockerTrackerEvents {
  'ui-request-added': (req: RpcExtensionUIRequest) => void
  'ui-request-removed': (requestId: string) => void
}

// Typed overloads so callers get full type-safety on on() / emit().
declare interface BlockerTracker {
  on(event: 'ui-request-added', listener: (req: RpcExtensionUIRequest) => void): this
  on(event: 'ui-request-removed', listener: (requestId: string) => void): this
  emit(event: 'ui-request-added', req: RpcExtensionUIRequest): boolean
  emit(event: 'ui-request-removed', requestId: string): boolean
}

// ── BlockerTracker ─────────────────────────────────────────────────────────────

/**
 * Tracks open `extension_ui_request` blockers for a single session.
 *
 * - Keeps a `Map<requestId, RpcExtensionUIRequest>` in insertion order.
 * - Emits `ui-request-added` when a new blocker is registered.
 * - Emits `ui-request-removed` when a blocker is cleared (no-op for unknown ids).
 *
 * Callers (e.g. {@link SessionHandle}) wire these events into the state
 * machine so the session transitions to "Waiting on you" while at least one
 * blocker is open.
 *
 * Usage
 * -----
 * ```ts
 * const tracker = new BlockerTracker()
 *
 * tracker.on('ui-request-added',   (req) => sm.blockerAdded())
 * tracker.on('ui-request-removed', (id)  => sm.blockerRemoved(tracker.size()))
 *
 * // When a request arrives from the RPC stream:
 * tracker.add(req)          // emits 'ui-request-added'
 *
 * // When a response is sent (or the session is cancelled):
 * tracker.remove(req.id)    // emits 'ui-request-removed'
 *
 * // Snapshot for IPC serialisation (Record, not Map — JSON-safe):
 * const snapshot = tracker.getAll()
 * ```
 */
class BlockerTracker extends EventEmitter {
  private readonly _blockers = new Map<string, RpcExtensionUIRequest>()

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register an open UI-request blocker.
   * If a request with the same id is already tracked it is overwritten
   * (idempotent for retry/re-delivery scenarios).
   * Emits `ui-request-added`.
   */
  add(req: RpcExtensionUIRequest): void {
    this._blockers.set(req.id, req)
    this.emit('ui-request-added', req)
  }

  /**
   * Remove a blocker by its request id.
   * No-op when `requestId` is not tracked (safe to call after a duplicate
   * `remove` or a spurious cancellation).
   * Emits `ui-request-removed` only when the id was present.
   */
  remove(requestId: string): void {
    if (!this._blockers.has(requestId)) return
    this._blockers.delete(requestId)
    this.emit('ui-request-removed', requestId)
  }

  /**
   * Snapshot of all currently open blockers as a plain JSON-serialisable
   * `Record`.  Suitable for passing over the Electron IPC boundary.
   */
  getAll(): Record<string, RpcExtensionUIRequest> {
    return Object.fromEntries(this._blockers)
  }

  /** Number of open blockers. */
  get size(): number {
    return this._blockers.size
  }
}

export { BlockerTracker }

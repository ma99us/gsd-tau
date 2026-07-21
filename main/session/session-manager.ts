import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { RpcClient } from '@opengsd/rpc-client'
import type { SessionId, SessionRecord, RegistryV1 } from '../../shared/types'
import { SessionHandle } from './session-handle'
import { createClient } from '../pi/client-factory'
import type { CreateClientOptions } from '../pi/client-factory'

// ── constants ─────────────────────────────────────────────────────────────────

/** Time (ms) we wait for a graceful pi shutdown before force-stopping the process. */
const SHUTDOWN_TIMEOUT_MS = 3_000

// ── types ─────────────────────────────────────────────────────────────────────

/**
 * Injectable factory matching {@link createClient}'s signature.
 * Swapped out in unit tests to avoid spawning real pi processes.
 */
export type ClientFactory = (opts: CreateClientOptions) => Promise<RpcClient>

/**
 * Minimal interface for registry persistence.
 * Lets tests inject a stub without requiring a real filesystem.
 */
export interface RegistryStoreLike {
  save(registry: RegistryV1): void
}

interface ActiveSession {
  handle: SessionHandle
  client: RpcClient
  cwd: string
  displayName: string
  wasAutoRunning: boolean
  lastOpenedAt: string
  sessionFile?: string
  /**
   * Optional hook called immediately before close() stops the event pump.
   * Registered by the IPC layer to cancel open UI-request blockers so pi
   * does not hang waiting for a response after the session closes.
   */
  preShutdownHook?: () => Promise<void>
  /**
   * Removes state-change event listeners wired up during open().
   * Called during close() to avoid memory leaks.
   */
  _removeStateListeners: () => void
}

// ── SessionManager ────────────────────────────────────────────────────────────

/**
 * Owns the lifecycle of all pi sessions in the main process.
 *
 * Phase-4 upgrade: supports N concurrent sessions.
 * Each session receives a stable id (`s_` + 12-char base64url).
 * Every open/close/rename/state-change triggers a debounced registry save
 * via the optional injected {@link RegistryStoreLike}.
 *
 * Usage
 * -----
 * ```ts
 * const mgr = new SessionManager({ registryStore })
 *
 * const h1 = await mgr.open('D:/project-a')
 * const h2 = await mgr.open('D:/project-b')
 * mgr.list()                          // [SessionRecord, SessionRecord]
 * mgr.rename(h1.sessionId, 'My App')
 * mgr.getRegistry()                   // RegistryV1 snapshot
 * await mgr.close(h1.sessionId)
 * ```
 */
export class SessionManager {
  private readonly _createClient: ClientFactory
  private readonly _registryStore: RegistryStoreLike | null
  private readonly _sessions = new Map<SessionId, ActiveSession>()

  constructor(opts?: { createClient?: ClientFactory; registryStore?: RegistryStoreLike }) {
    this._createClient = opts?.createClient ?? createClient
    this._registryStore = opts?.registryStore ?? null
  }

  // ── public API ──────────────────────────────────────────────────────────────

  /**
   * Open a new pi session for the given working directory.
   *
   * Sequence:
   * 1. Call the client factory to spawn + initialise pi.
   * 2. Assign a stable session ID (`s_` + 12-char base64url).
   * 3. Construct a {@link SessionHandle} and start its event pump.
   * 4. Wire state-change listeners for `wasAutoRunning` tracking.
   * 5. Register the session, persist registry, and return the handle.
   *
   * @param cwd  Working directory for the pi session.
   * @returns    A started {@link SessionHandle} with a stable session ID.
   * @throws     `ResolvePiError`   gsd binary not found.
   * @throws     `ClientInitError`  pi handshake failed.
   */
  async open(cwd: string): Promise<SessionHandle> {
    const client = await this._createClient({ cwd })

    // 9 random bytes → 12-char base64url (same entropy as nanoid(12), no extra dep).
    const id: SessionId = 's_' + randomBytes(9).toString('base64url')
    const displayName = path.basename(cwd) || cwd

    const handle = new SessionHandle(client, id)

    // Closure reference so listeners can mutate entry before it's inserted.
    const entry: ActiveSession = {
      handle,
      client,
      cwd,
      displayName,
      wasAutoRunning: false,
      lastOpenedAt: new Date().toISOString(),
      _removeStateListeners: () => { /* replaced below */ },
    }

    // Track auto-run state: agent_start → running, agent_end/execution_complete → stopped.
    const onAgentStart = () => {
      entry.wasAutoRunning = true
      this._scheduleRegistrySave()
    }
    const onSessionEnd = () => {
      entry.wasAutoRunning = false
      this._scheduleRegistrySave()
    }

    handle.on('agent_start', onAgentStart)
    handle.on('agent_end', onSessionEnd)
    handle.on('execution_complete', onSessionEnd)

    entry._removeStateListeners = () => {
      handle.off('agent_start', onAgentStart)
      handle.off('agent_end', onSessionEnd)
      handle.off('execution_complete', onSessionEnd)
    }

    this._sessions.set(id, entry)
    handle.start()

    console.log(`[SessionManager] opened session ${id} for "${cwd}" (total: ${this._sessions.size})`)
    this._scheduleRegistrySave()

    return handle
  }

  /**
   * Look up an active session by its stable ID.
   *
   * @returns The {@link SessionHandle}, or `undefined` if the ID is unknown.
   */
  get(id: SessionId): SessionHandle | undefined {
    return this._sessions.get(id)?.handle
  }

  /**
   * Return a snapshot of all active sessions as {@link SessionRecord} objects.
   * The array order matches insertion order (Map iteration order).
   */
  list(): SessionRecord[] {
    return [...this._sessions.values()].map((entry) => this._toRecord(entry))
  }

  /**
   * Rename a session's display label.
   *
   * No-op when `id` is unknown (safe to call speculatively).
   * Triggers a debounced registry save on success.
   *
   * @param id    Stable session identifier.
   * @param name  New human-readable display name.
   */
  rename(id: SessionId, name: string): void {
    const entry = this._sessions.get(id)
    if (!entry) return

    const prev = entry.displayName
    entry.displayName = name

    console.log(`[SessionManager] session ${id} renamed "${prev}" → "${name}"`)
    this._scheduleRegistrySave()
  }

  /**
   * Build a {@link RegistryV1} snapshot from the current live session state.
   *
   * - `sessions` reflects all open sessions with their latest metadata.
   * - `windows` is left empty — managed by the renderer/IPC window layer.
   * - `mruOrder` lists session ids in insertion order (most-recently-opened last
   *   is not tracked here; callers may reorder as needed).
   */
  getRegistry(): RegistryV1 {
    const sessions = this.list()
    return {
      version: 1,
      sessions,
      windows: [],
      mruOrder: sessions.map((s) => s.id),
    }
  }

  /**
   * Send a prompt to an active session's pi process.
   *
   * Routes the message from the renderer-initiated IPC call to the underlying
   * {@link RpcClient}. Fire-and-forget on the client side; callers receive
   * streamed events via the session handle's event emitter.
   *
   * @throws `Error` if no session with `id` is registered.
   */
  async prompt(id: SessionId, message: string): Promise<void> {
    const entry = this._sessions.get(id)
    if (!entry) {
      throw new Error(`SessionManager.prompt(): unknown session '${id}'`)
    }
    await entry.client.prompt(message)
  }

  /**
   * Register a callback invoked immediately before {@link close} stops the
   * event pump.  Intended to cancel open UI-request blockers so pi does not
   * hang waiting for responses after app quit or tab close.
   *
   * The hook runs with a 2 s hard timeout; any error is caught and logged.
   * No-op when `id` is unknown (safe to call before or after session open).
   */
  registerPreShutdownHook(id: SessionId, hook: () => Promise<void>): void {
    const entry = this._sessions.get(id)
    if (entry) {
      entry.preShutdownHook = hook
    }
  }

  /**
   * Abort the current pi operation for an active session.
   *
   * @throws `Error` if no session with `id` is registered.
   */
  async abort(id: SessionId): Promise<void> {
    const entry = this._sessions.get(id)
    if (!entry) {
      throw new Error(`SessionManager.abort(): unknown session '${id}'`)
    }
    await entry.client.abort()
  }

  /**
   * Fetch available slash commands for a session.
   * @throws `Error` if no session with `id` is registered.
   */
  async getCommands(id: SessionId): Promise<import('@opengsd/rpc-client').RpcSlashCommand[]> {
    const entry = this._sessions.get(id)
    if (!entry) throw new Error(`SessionManager.getCommands(): unknown session '${id}'`)
    return entry.client.getCommands()
  }

  /**
   * Fetch available models for a session.
   * @throws `Error` if no session with `id` is registered.
   */
  async getAvailableModels(id: SessionId): Promise<import('@opengsd/rpc-client').ModelInfo[]> {
    const entry = this._sessions.get(id)
    if (!entry) throw new Error(`SessionManager.getAvailableModels(): unknown session '${id}'`)
    return entry.client.getAvailableModels()
  }

  /**
   * Switch model for a session.
   * @throws `Error` if no session with `id` is registered.
   */
  async setModel(id: SessionId, provider: string, modelId: string): Promise<{ provider: string; id: string }> {
    const entry = this._sessions.get(id)
    if (!entry) throw new Error(`SessionManager.setModel(): unknown session '${id}'`)
    return entry.client.setModel(provider, modelId)
  }

  /**
   * Close an active session by its stable ID.
   *
   * Sequence:
   * 1. Remove from the internal map (prevents re-entrant double-close).
   * 2. Remove state-change event listeners.
   * 3. Run the pre-shutdown hook (cancel open UI-request blockers).
   * 4. Call `client.shutdown()` with a 3 s timeout — pi receives a clean signal
   *    while the transport is still live.
   * 5. Call `handle.stop()` to drain the event pump and stop the transport.
   * 6. Persist the updated registry.
   *
   * Idempotent for unknown IDs — resolves immediately if `id` is not found.
   */
  async close(id: SessionId): Promise<void> {
    const entry = this._sessions.get(id)
    if (!entry) return

    // Remove before async ops so re-entrant calls don't double-close.
    this._sessions.delete(id)

    const { handle, client } = entry
    const closeStart = Date.now()
    console.log(`[SessionManager] closing session ${id} (remaining: ${this._sessions.size})`)

    // Remove state-change listeners — session is leaving.
    entry._removeStateListeners()

    // Step 1: cancel open blockers before the pipe closes so pi can receive them.
    if (entry.preShutdownHook) {
      const hookStart = Date.now()
      try {
        await Promise.race([
          entry.preShutdownHook(),
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ])
        console.log(
          `[SessionManager] pre-shutdown hook done for session ${id} in ${Date.now() - hookStart}ms`,
        )
      } catch (err) {
        console.warn(
          `[SessionManager] pre-shutdown hook error for session ${id} after ${Date.now() - hookStart}ms:`,
          err,
        )
      }
    }

    // Step 2: request a graceful pi shutdown BEFORE stopping the event pump.
    // client.stop() (called inside handle.stop()) kills the transport; if we
    // call shutdown() after that the client is already gone and throws
    // "Client not started". Shutdown first so pi receives the signal cleanly.
    const verdict = await Promise.race([
      client.shutdown().then(() => 'ok' as const),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS),
      ),
    ])

    if (verdict === 'timeout') {
      console.warn(
        `[SessionManager] shutdown timed out for session ${id} after ${Date.now() - closeStart}ms — falling back to stop()`,
      )
    } else {
      console.log(
        `[SessionManager] session ${id} pi shutdown ack in ${Date.now() - closeStart}ms`,
      )
    }

    // Step 3: stop the event pump and underlying transport regardless of verdict.
    await handle.stop()

    console.log(
      `[SessionManager] session ${id} closed in ${Date.now() - closeStart}ms`,
    )

    // Step 4: persist updated registry now that the session has been removed.
    this._scheduleRegistrySave()
  }

  // ── diagnostics ─────────────────────────────────────────────────────────────

  /**
   * IDs of all currently active sessions.
   * Useful for health checks and graceful app shutdown.
   */
  get activeSessions(): SessionId[] {
    return [...this._sessions.keys()]
  }

  // ── private ──────────────────────────────────────────────────────────────────

  /** Convert an internal ActiveSession entry to the serialisable SessionRecord shape. */
  private _toRecord(entry: ActiveSession): SessionRecord {
    return {
      id: entry.handle.sessionId,
      cwd: entry.cwd,
      displayName: entry.displayName,
      sessionFile: entry.sessionFile,
      lastOpenedAt: entry.lastOpenedAt,
      wasAutoRunning: entry.wasAutoRunning,
    }
  }

  /**
   * Snapshot the current session state and hand it to the registry store.
   * The store itself debounces at 500 ms, so rapid mutations coalesce into
   * a single disk write.
   */
  private _scheduleRegistrySave(): void {
    if (this._registryStore) {
      this._registryStore.save(this.getRegistry())
    }
  }
}

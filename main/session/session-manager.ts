import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { RpcClient } from '@opengsd/rpc-client'
import type { SessionId, SessionRecord, RegistryV1, MissingPathInfo } from '../../shared/types'
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

/**
 * Result of a {@link SessionManager.restore} call.
 * Every record either produces a restored session id, a failure entry, or a
 * missing-path entry (cwd not found on disk).  Missing-path entries are never
 * opened as pi sessions; they are tracked separately so the renderer can show
 * a banner and let the user locate or remove them.
 */
export interface RestoreResult {
  /** Stable IDs of sessions that were successfully opened. */
  restored: SessionId[]
  /** Records that failed to open, along with the causal error. */
  failed: Array<{ record: SessionRecord; error: unknown }>
  /**
   * Records whose project directories were not found on disk.
   * No pi session is started for these — they are phantom tabs.
   */
  missingPath: MissingPathInfo[]
}

interface ActiveSession {
  handle: SessionHandle
  client: RpcClient
  cwd: string
  displayName: string
  wasAutoRunning: boolean
  lastOpenedAt: string
  sessionFile?: string
  /** True when this session was reopened from the registry on relaunch. */
  isRestored?: boolean
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
  /**
   * Persistent map from project CWD → last known pi session file.
   * Updated on every `execution_complete` event and preserved through tab
   * close so the "open recent" flow can resume the prior conversation.
   * Seeded from `RegistryV1.sessionHistory` on app startup.
   */
  private readonly _sessionHistory = new Map<string, string>()
  /**
   * Sessions whose project directories were not found during the most recent
   * restore().  No pi process is running for these ids; they are tracked so the
   * renderer can show a MissingSessionBanner and call reassignMissingPath() or
   * close() to resolve them.
   */
  private readonly _missingPaths = new Map<SessionId, SessionRecord>()

  constructor(opts?: { createClient?: ClientFactory; registryStore?: RegistryStoreLike }) {
    this._createClient = opts?.createClient ?? createClient
    this._registryStore = opts?.registryStore ?? null
  }

  // ── public API ──────────────────────────────────────────────────────────────

  /**
   * Seed the session history from the persisted registry.
   * Called once on app startup after loading the registry.
   */
  initHistory(history: Record<string, string>): void {
    const entries = Object.entries(history)
    for (const [cwd, sessionFile] of entries) {
      this._sessionHistory.set(cwd, sessionFile)
    }
    if (entries.length > 0) {
      console.log(
        `[SessionManager] initHistory: loaded ${entries.length} cwd→file mapping(s):`,
        entries.map(([cwd, f]) => `  "${cwd}" → "${f}"`).join('\n'),
      )
    } else {
      console.log('[SessionManager] initHistory: no prior session history in registry')
    }
  }

  /**
   * Return the last known pi session file for a project CWD, or `undefined`
   * if this project has never completed a turn in this app.
   */
  getHistorySessionFile(cwd: string): string | undefined {
    return this._sessionHistory.get(cwd)
  }

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
   * Restore sessions from a persisted registry snapshot.
   *
   * For each record:
   * - Opens a new pi session at the record's `cwd`.
   * - If the record has a `sessionFile`, calls `client.switchSession()` so pi
   *   attaches to the previous conversation file.
   * - Marks the internal `ActiveSession` entry as `isRestored = true`.
   *
   * All opens are attempted in parallel; per-record failures are captured in
   * `RestoreResult.failed` rather than thrown, so other records still restore.
   * A `switchSession` failure is non-fatal: the session is live (just not at
   * the previous conversation) and is still added to `RestoreResult.restored`.
   *
   * @param records  Session records from {@link RegistryStore.load()}.  An
   *                 empty array resolves immediately with empty result arrays.
   */
  async restore(records: SessionRecord[]): Promise<RestoreResult> {
    const restored: SessionId[] = []
    const failed: Array<{ record: SessionRecord; error: unknown }> = []
    const missingPath: MissingPathInfo[] = []

    console.log(`[SessionManager] restoring ${records.length} session(s) from registry`)

    await Promise.all(
      records.map(async (record) => {
        // Fast-path: skip open() if the project directory no longer exists.
        // The session stays in _missingPaths so the renderer can show a banner.
        if (!existsSync(record.cwd)) {
          console.warn(
            `[SessionManager] restore skipped "${record.cwd}": directory not found`,
          )
          const info: MissingPathInfo = {
            sessionId: record.id,
            cwd: record.cwd,
            displayName: record.displayName,
          }
          missingPath.push(info)
          this._missingPaths.set(record.id, record)
          return
        }

        try {
          const handle = await this.open(record.cwd)
          const entry = this._sessions.get(handle.sessionId)
          if (entry) {
            entry.isRestored = true
            if (record.sessionFile) {
              try {
                // switchSession is part of the stable RPC contract (switch_session
                // in RPC_COMMAND_TYPES) but not in the local mock surface — cast.
                await (entry.client as unknown as {
                  switchSession(opts: { sessionPath: string }): Promise<void>
                }).switchSession({ sessionPath: record.sessionFile })
                console.log(
                  `[SessionManager] switch_session ok for session ${
                    handle.sessionId
                  } → "${record.sessionFile}"`,
                )
              } catch (switchErr) {
                console.warn(
                  `[SessionManager] switch_session failed for session ${
                    handle.sessionId
                  } (file: "${record.sessionFile}"):`,
                  switchErr,
                )
                // Non-fatal: session is live; conversation may be at a fresh start.
              }
            }
          }
          restored.push(handle.sessionId)
        } catch (err) {
          console.error(`[SessionManager] restore failed for "${record.cwd}":`, err)
          failed.push({ record, error: err })
        }
      }),
    )

    console.log(
      `[SessionManager] restore complete: ${restored.length} restored, ${
        failed.length
      } failed, ${missingPath.length} missing-path`,
    )
    return { restored, failed, missingPath }
  }

  // ── Missing-path session management ──────────────────────────────────────

  /**
   * All sessions whose project directories were not found during restore.
   * Returned as {@link MissingPathInfo} so callers need only what the UI uses.
   */
  listMissingPaths(): MissingPathInfo[] {
    return [...this._missingPaths.values()].map((r) => ({
      sessionId: r.id,
      cwd: r.cwd,
      displayName: r.displayName,
    }))
  }

  /**
   * Remove a missing-path session from the in-memory tracker.
   *
   * Called by the IPC layer just before opening the session at a new cwd
   * (reassign flow).  Also called by close() if the id is a missing-path.
   *
   * @returns The original {@link MissingPathInfo} if found, `undefined` otherwise.
   */
  removeMissingPath(id: SessionId): MissingPathInfo | undefined {
    const record = this._missingPaths.get(id)
    if (!record) return undefined
    this._missingPaths.delete(id)
    this._scheduleRegistrySave()
    return { sessionId: record.id, cwd: record.cwd, displayName: record.displayName }
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
  /**
   * Attach an already-open session to a prior conversation file.
   *
   * Called by the IPC layer after `open()` when a prior session file is known
   * (the "open recent" restore flow).  Failure is non-fatal: the session stays
   * live and the conversation starts fresh.
   */
  async resume(_id: SessionId, _sessionFile: string): Promise<void> {
    // No-op: session resume is now handled by spawning pi with --continue.
    // Kept for interface compatibility; callers can be cleaned up later.
  }

  /**
   * Update the session file path for an active session.
   *
   * Called by the IPC layer when `execution_complete` fires, which carries
   * the path of the JSONL file pi wrote to.  Persisting this allows the session
   * to be resumed via `switchSession` on the next open.
   *
   * No-op when `id` is unknown.
   */
  updateSessionFile(id: SessionId, sessionFile: string): void {
    const entry = this._sessions.get(id)
    if (!entry) {
      console.warn(`[SessionManager] updateSessionFile: session ${id} not found — ignoring`)
      return
    }
    entry.sessionFile = sessionFile
    this._sessionHistory.set(entry.cwd, sessionFile)
    console.log(
      `[SessionManager] updateSessionFile: session ${id} cwd="${entry.cwd}"`,
      `\n  sessionFile="${sessionFile}"`,
      `\n  history size=${this._sessionHistory.size}`,
    )
    this._scheduleRegistrySave()
  }

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
      sessionHistory: Object.fromEntries(this._sessionHistory),
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
    // Short-circuit for missing-path sessions — no live pi process to shut down.
    if (this._missingPaths.has(id)) {
      this._missingPaths.delete(id)
      this._scheduleRegistrySave()
      return
    }

    const entry = this._sessions.get(id)
    if (!entry) return

    // Remove before async ops so re-entrant calls don't double-close.
    // Capture sessionFile first so it survives the deletion.
    if (entry.sessionFile) {
      this._sessionHistory.set(entry.cwd, entry.sessionFile)
      console.log(
        `[SessionManager] close: captured sessionFile for cwd="${entry.cwd}"`,
        `\n  sessionFile="${entry.sessionFile}"`,
        `\n  history size=${this._sessionHistory.size}`,
      )
    } else {
      console.log(
        `[SessionManager] close: session ${id} has no sessionFile — history not updated`,
        `(cwd="${entry.cwd}" — no execution_complete received this session)`,
      )
    }
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
      const historyKeys = [...this._sessionHistory.keys()]
      console.log(
        `[SessionManager] registry save scheduled: ${this._sessions.size} session(s),`,
        `history=[${historyKeys.map(k => `"${k}"`).join(', ')}]`,
      )
      this._registryStore.save(this.getRegistry())
    }
  }
}

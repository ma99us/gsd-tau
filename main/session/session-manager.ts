import { randomBytes } from 'node:crypto'
import type { RpcClient } from '@opengsd/rpc-client'
import type { SessionId } from '../../shared/types'
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

interface ActiveSession {
  handle: SessionHandle
  client: RpcClient
  /**
   * Optional hook called immediately before close() stops the event pump.
   * Registered by the IPC layer to cancel open UI-request blockers so pi
   * does not hang waiting for a response after the session closes.
   */
  preShutdownHook?: () => Promise<void>
}

// ── SessionManager ────────────────────────────────────────────────────────────

/**
 * Owns the lifecycle of all pi sessions in the main process.
 *
 * Phase-1 restriction: only one session may be open at a time.
 * Calling `open()` while a session is already active throws immediately.
 *
 * Usage
 * -----
 * ```ts
 * const mgr = new SessionManager()
 *
 * const handle = await mgr.open('D:/my-project')
 * const same   = mgr.get(handle.sessionId)   // same reference
 * await mgr.close(handle.sessionId)           // graceful teardown
 * ```
 */
export class SessionManager {
  private readonly _createClient: ClientFactory
  private readonly _sessions = new Map<SessionId, ActiveSession>()

  constructor(opts?: { createClient?: ClientFactory }) {
    this._createClient = opts?.createClient ?? createClient
  }

  // ── public API ──────────────────────────────────────────────────────────────

  /**
   * Open a new pi session for the given working directory.
   *
   * Sequence:
   * 1. Enforce the Phase-1 single-session limit.
   * 2. Call the client factory to spawn + initialise pi.
   * 3. Assign a stable session ID (`s_` + 12-char base64url).
   * 4. Construct a {@link SessionHandle} and start its event pump.
   * 5. Register the session and return the handle.
   *
   * @param cwd  Working directory for the pi session.
   * @returns    A started {@link SessionHandle} with a stable session ID.
   * @throws     `Error`                  Phase-1 limit: a session is already active.
   * @throws     `ResolvePiError`         gsd binary not found.
   * @throws     `ClientInitError`        pi handshake failed.
   */
  async open(cwd: string): Promise<SessionHandle> {
    if (this._sessions.size > 0) {
      throw new Error(
        'SessionManager.open(): Phase-1 restriction — only one session at a time. ' +
          'Close the active session before opening a new one.',
      )
    }

    const client = await this._createClient({ cwd })

    // 9 random bytes → 12-char base64url (same entropy as nanoid(12), no extra dep).
    const id: SessionId = 's_' + randomBytes(9).toString('base64url')

    const handle = new SessionHandle(client, id)
    this._sessions.set(id, { handle, client })

    handle.start()

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
   * 2. Run the pre-shutdown hook (cancel open UI-request blockers).
   * 3. Call `client.shutdown()` with a 3 s timeout — pi receives a clean signal
   *    while the transport is still live.
   * 4. Call `handle.stop()` to drain the event pump and stop the transport.
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
    console.log(`[SessionManager] closing session ${id}`)

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
  }

  // ── diagnostics ─────────────────────────────────────────────────────────────

  /**
   * IDs of all currently active sessions.
   * Useful for health checks and graceful app shutdown.
   */
  get activeSessions(): SessionId[] {
    return [...this._sessions.keys()]
  }
}

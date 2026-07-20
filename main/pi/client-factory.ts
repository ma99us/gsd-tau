import { RpcClient } from '@opengsd/rpc-client'
import type { RpcInitResult } from '@opengsd/rpc-client'
import { resolvePiBinary } from './resolve-pi'

/**
 * Thrown when the RPC client fails the v2 init handshake, or when the
 * negotiated protocol version is incompatible with gsd-tau.
 *
 * The message is user-facing and includes the binary path plus an upgrade hint.
 */
export class ClientInitError extends Error {
  /** Absolute path to the gsd binary that failed. */
  readonly piPath: string

  constructor(message: string, piPath: string) {
    super(message)
    this.name = 'ClientInitError'
    this.piPath = piPath
  }
}

/** Options accepted by {@link createClient}. */
export interface CreateClientOptions {
  /**
   * Working directory for the pi session.
   * pi will resolve relative paths (project files, sessions) against this.
   */
  cwd: string

  /**
   * Explicit path to the gsd binary (e.g. `C:\nvm4w\nodejs\gsd.cmd`).
   * When omitted, {@link resolvePiBinary} is called to locate the binary.
   */
  binary?: string
}

/**
 * Create a started, initialised {@link RpcClient} ready for use.
 *
 * Sequence:
 *   1. Resolve the gsd binary (parameter → `resolvePiBinary()`).
 *   2. Construct `RpcClient` with `cliPath` + `cwd`.
 *   3. `client.start()` — spawns the gsd process in `--mode rpc`.
 *   4. `client.init({ clientId: 'gsd-tau' })` — v2 handshake.
 *   5. Validate `protocolVersion === 2`.
 *   6. Log `protocolVersion` and return the ready client.
 *
 * Caller is responsible for `client.stop()` / `client.shutdown()` on teardown.
 *
 * @throws {ResolvePiError}   When the binary cannot be found and `binary` was not provided.
 * @throws {ClientInitError}  When `init()` rejects or returns an incompatible protocol version.
 */
export async function createClient(opts: CreateClientOptions): Promise<RpcClient> {
  const cliPath = opts.binary ?? resolvePiBinary()

  const client = new RpcClient({ cliPath, cwd: opts.cwd })

  // Phase 1: spawn the process.
  // start() failures (bad binary, permission denied, etc.) propagate as-is so
  // the caller sees the raw OS error alongside the piPath it attempted to use.
  await client.start()

  // Phase 2: v2 handshake.
  let initResult: RpcInitResult
  try {
    initResult = await client.init({ clientId: 'gsd-tau' })
  } catch (err) {
    // Best-effort cleanup before re-throwing.
    await client.stop().catch(() => undefined)
    throw new ClientInitError(
      `pi init handshake failed at "${cliPath}".\n` +
        `Cause: ${err instanceof Error ? err.message : String(err)}\n` +
        'Ensure pi is at least v1.11.0: npm install -g @opengsd/gsd-pi',
      cliPath
    )
  }

  // Phase 3: protocol version guard — gsd-tau requires v2.
  if (initResult.protocolVersion !== 2) {
    await client.stop().catch(() => undefined)
    throw new ClientInitError(
      `pi returned protocol version ${initResult.protocolVersion} but gsd-tau requires v2.\n` +
        `Binary: "${cliPath}"\n` +
        'Upgrade pi to v1.11.0+: npm install -g @opengsd/gsd-pi',
      cliPath
    )
  }

  console.log(
    `[client-factory] init ok — protocolVersion=${initResult.protocolVersion}` +
      ` sessionId=${initResult.sessionId}`
  )

  return client
}

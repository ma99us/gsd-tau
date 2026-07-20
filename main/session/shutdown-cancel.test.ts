import { describe, it, expect, vi, afterEach } from 'vitest'
import type { RpcClient, SdkAgentEvent } from '@opengsd/rpc-client'
import { SessionManager } from './session-manager'
import { BlockerTracker } from './blocker-tracker'
import type { RpcExtensionUIRequest } from '../../shared/types'

// ── mock helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal RpcClient mock that includes sendUIResponse.
 *
 * Returns both the `client` (typed as RpcClient for passing to SessionManager)
 * and the raw `mocks` record (typed as MockInstances for assertions).
 *
 * The events() generator hangs indefinitely so the SessionHandle event pump
 * stays in 'running' during tests, matching real behaviour.
 */
function makeMockClient() {
  const events = async function* (): AsyncGenerator<SdkAgentEvent, void, undefined> {
    await new Promise<void>(() => {
      /* intentionally hangs */
    })
    yield undefined as never
  }

  const mocks = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue({
      protocolVersion: 2,
      sessionId: 'pi-sid-1',
      capabilities: { events: [], commands: [] },
    }),
    events,
    shutdown: vi.fn().mockResolvedValue(undefined),
    sendUIResponse: vi.fn(),
  }

  return {
    client: mocks as unknown as RpcClient,
    mocks,
  }
}

/** Minimal RpcExtensionUIRequest fixture. */
function makeRequest(id: string, method = 'confirm'): RpcExtensionUIRequest {
  return { id, method } as unknown as RpcExtensionUIRequest
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('shutdown cancellation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // ── core ordering guarantee ───────────────────────────────────────────────

  it('sends cancelled:true for each open blocker before calling client.shutdown()', async () => {
    const { client, mocks } = makeMockClient()
    const callOrder: string[] = []

    mocks.sendUIResponse.mockImplementation((...args: unknown[]) => {
      callOrder.push(`cancel:${String(args[0])}`)
    })
    mocks.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown')
    })

    const mgr = new SessionManager({ createClient: vi.fn().mockResolvedValue(client) })
    const handle = await mgr.open('/proj/a')
    const id = handle.sessionId

    // Two open blockers in the tracker.
    const tracker = new BlockerTracker()
    tracker.add(makeRequest('req-1'))
    tracker.add(makeRequest('req-2'))

    mgr.registerPreShutdownHook(id, async () => {
      const all = tracker.getAll()
      for (const requestId of Object.keys(all)) {
        handle.sendUIResponse(requestId, { cancelled: true })
        tracker.remove(requestId)
      }
    })

    await mgr.close(id)

    // Both cancellations must precede 'shutdown' in the call order.
    expect(callOrder).toEqual(['cancel:req-1', 'cancel:req-2', 'shutdown'])
    expect(mocks.sendUIResponse).toHaveBeenCalledTimes(2)
    expect(mocks.sendUIResponse).toHaveBeenNthCalledWith(1, 'req-1', { cancelled: true })
    expect(mocks.sendUIResponse).toHaveBeenNthCalledWith(2, 'req-2', { cancelled: true })
  })

  // ── empty tracker — no cancellations, shutdown still called ──────────────

  it('calls client.shutdown() even when no blockers are open', async () => {
    const { client, mocks } = makeMockClient()

    const mgr = new SessionManager({ createClient: vi.fn().mockResolvedValue(client) })
    const handle = await mgr.open('/proj/b')
    const id = handle.sessionId

    const tracker = new BlockerTracker() // empty

    mgr.registerPreShutdownHook(id, async () => {
      const all = tracker.getAll()
      for (const requestId of Object.keys(all)) {
        handle.sendUIResponse(requestId, { cancelled: true })
        tracker.remove(requestId)
      }
    })

    await mgr.close(id)

    expect(mocks.sendUIResponse).not.toHaveBeenCalled()
    expect(mocks.shutdown).toHaveBeenCalledOnce()
  })

  // ── hook throws — close() must still complete ─────────────────────────────

  it('calls client.shutdown() even when the pre-shutdown hook throws', async () => {
    const { client, mocks } = makeMockClient()

    const mgr = new SessionManager({ createClient: vi.fn().mockResolvedValue(client) })
    const handle = await mgr.open('/proj/c')
    const id = handle.sessionId

    mgr.registerPreShutdownHook(id, async () => {
      throw new Error('cancellation failed')
    })

    await mgr.close(id)

    expect(mocks.shutdown).toHaveBeenCalledOnce()
  })

  // ── no hook registered — unaffected close() path ─────────────────────────

  it('calls client.shutdown() when no hook is registered', async () => {
    const { client, mocks } = makeMockClient()

    const mgr = new SessionManager({ createClient: vi.fn().mockResolvedValue(client) })
    const handle = await mgr.open('/proj/d')

    await mgr.close(handle.sessionId)

    expect(mocks.sendUIResponse).not.toHaveBeenCalled()
    expect(mocks.shutdown).toHaveBeenCalledOnce()
  })

  // ── 2 s timeout — stuck hook must not block shutdown ─────────────────────

  it('hook times out after 2 s and close() still proceeds to shutdown()', async () => {
    vi.useFakeTimers()

    const { client, mocks } = makeMockClient()

    const mgr = new SessionManager({ createClient: vi.fn().mockResolvedValue(client) })
    const handle = await mgr.open('/proj/e')
    const id = handle.sessionId

    // Hook that never resolves — simulates a stuck cancellation round.
    mgr.registerPreShutdownHook(id, () => new Promise<void>(() => {}))

    const closePromise = mgr.close(id)

    // Advance past the 2 s hook timeout; microtasks drain automatically.
    await vi.advanceTimersByTimeAsync(2_001)
    await closePromise

    // Despite the stuck hook, shutdown must still be called.
    expect(mocks.shutdown).toHaveBeenCalledOnce()
  })
})

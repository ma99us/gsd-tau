import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RpcClient, SdkAgentEvent } from '@opengsd/rpc-client'
import { SessionManager } from './session-manager'
import { SessionHandle } from './session-handle'

// ── mock helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal RpcClient mock.
 *
 * The `events()` generator blocks indefinitely so the SessionHandle event pump
 * stays in `'running'` state during tests (matches real behaviour where a live
 * pi process streams events until stopped).
 *
 * When `stop()` is called, `_stoppedResolve` fires so callers can await pump
 * termination if needed — but SessionHandle.stop() doesn't await the pump, so
 * most tests just need `stop()` to resolve quickly.
 *
 * @param shutdownDelay  Optional ms before `shutdown()` resolves (0 = immediate).
 *                       Pass `Infinity` for a never-resolving shutdown promise.
 */
function makeMockClient(opts?: { shutdownDelay?: number }): RpcClient {
  const { shutdownDelay = 0 } = opts ?? {}

  // Never-ending async generator — pump stays blocked until stop() is called.
  const events = async function* (): AsyncGenerator<SdkAgentEvent, void, undefined> {
    await new Promise<void>(() => {
      /* intentionally hangs — test teardown is fast enough */
    })
    yield undefined as never
  }

  const shutdownFn =
    shutdownDelay === Infinity
      ? vi.fn().mockReturnValue(new Promise<void>(() => {})) // never resolves
      : shutdownDelay === 0
        ? vi.fn().mockResolvedValue(undefined)
        : vi.fn().mockReturnValue(
            new Promise<void>((resolve) => setTimeout(resolve, shutdownDelay)),
          )

  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue({ protocolVersion: 2, sessionId: 'pi-sid-1', capabilities: { events: [], commands: [] } }),
    events,
    shutdown: shutdownFn,
  } as unknown as RpcClient
}

/** Return a vi.fn() createClient factory that resolves with the given client. */
function makeFactory(client: RpcClient) {
  return vi.fn<(opts: { cwd: string }) => Promise<RpcClient>>().mockResolvedValue(client)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SessionManager', () => {
  let client: RpcClient
  let factory: ReturnType<typeof makeFactory>
  let mgr: SessionManager

  beforeEach(() => {
    client = makeMockClient()
    factory = makeFactory(client)
    mgr = new SessionManager({ createClient: factory })
  })

  // ── open() ────────────────────────────────────────────────────────────────

  describe('open()', () => {
    it('returns a SessionHandle', async () => {
      const handle = await mgr.open('/proj/a')
      expect(handle).toBeInstanceOf(SessionHandle)
    })

    it('passes cwd to the client factory', async () => {
      await mgr.open('/proj/a')
      expect(factory).toHaveBeenCalledWith({ cwd: '/proj/a' })
    })

    it('assigns a session id prefixed with "s_"', async () => {
      const handle = await mgr.open('/proj/a')
      expect(handle.sessionId).toMatch(/^s_/)
    })

    it('session id has sufficient length (s_ + 12 chars of base64url)', async () => {
      const handle = await mgr.open('/proj/a')
      // s_ (2) + base64url(9 bytes) = 2 + 12 = 14
      expect(handle.sessionId.length).toBeGreaterThanOrEqual(14)
    })

    it('generates a unique id on each successive open', async () => {
      const h1 = await mgr.open('/proj/a')
      await mgr.close(h1.sessionId)

      const h2 = await mgr.open('/proj/b')
      await mgr.close(h2.sessionId)

      expect(h1.sessionId).not.toBe(h2.sessionId)
    })

    it('starts the handle so clientState is "running"', async () => {
      const handle = await mgr.open('/proj/a')
      // start() sets _state = 'running' synchronously before the pump starts.
      expect(handle.clientState).toBe('running')
    })

    it('registers the session so get(id) immediately returns the handle', async () => {
      const handle = await mgr.open('/proj/a')
      expect(mgr.get(handle.sessionId)).toBe(handle)
    })

    it('throws (Phase-1 limit) when a session is already active', async () => {
      await mgr.open('/proj/a')
      await expect(mgr.open('/proj/b')).rejects.toThrow('Phase-1 restriction')
    })

    it('allows a second open after the first session is closed', async () => {
      const h1 = await mgr.open('/proj/a')
      await mgr.close(h1.sessionId)
      const h2 = await mgr.open('/proj/b')
      expect(h2).toBeInstanceOf(SessionHandle)
    })

    it('propagates a factory rejection', async () => {
      const failFactory = vi.fn().mockRejectedValue(new Error('binary not found'))
      const mgr2 = new SessionManager({ createClient: failFactory })
      await expect(mgr2.open('/proj/x')).rejects.toThrow('binary not found')
    })

    it('does not register a session when the factory rejects', async () => {
      const failFactory = vi.fn().mockRejectedValue(new Error('spawn failed'))
      const mgr2 = new SessionManager({ createClient: failFactory })
      await mgr2.open('/proj/x').catch(() => {})
      expect(mgr2.activeSessions).toHaveLength(0)
    })
  })

  // ── get() ─────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns undefined for an unknown id', () => {
      expect(mgr.get('s_unknown')).toBeUndefined()
    })

    it('returns the handle for a known id', async () => {
      const handle = await mgr.open('/proj/a')
      expect(mgr.get(handle.sessionId)).toBe(handle)
    })

    it('returns undefined after the session is closed', async () => {
      const handle = await mgr.open('/proj/a')
      await mgr.close(handle.sessionId)
      expect(mgr.get(handle.sessionId)).toBeUndefined()
    })
  })

  // ── close() ───────────────────────────────────────────────────────────────

  describe('close()', () => {
    it('resolves without error for an unknown id (no-op)', async () => {
      await expect(mgr.close('s_unknown')).resolves.toBeUndefined()
    })

    it('calls handle.stop()', async () => {
      const handle = await mgr.open('/proj/a')
      const stopSpy = vi.spyOn(handle, 'stop')
      await mgr.close(handle.sessionId)
      expect(stopSpy).toHaveBeenCalledOnce()
    })

    it('calls client.shutdown()', async () => {
      const handle = await mgr.open('/proj/a')
      await mgr.close(handle.sessionId)
      expect(client.shutdown).toHaveBeenCalledOnce()
    })

    it('full lifecycle — open → get → close removes the session', async () => {
      const handle = await mgr.open('/proj/a')
      const id = handle.sessionId

      expect(mgr.get(id)).toBe(handle)
      await mgr.close(id)
      expect(mgr.get(id)).toBeUndefined()
    })

    it('is idempotent — second close on the same id is a silent no-op', async () => {
      const handle = await mgr.open('/proj/a')
      await mgr.close(handle.sessionId)
      await expect(mgr.close(handle.sessionId)).resolves.toBeUndefined()
    })

    it('does not call client.stop() as a fallback when shutdown resolves normally', async () => {
      const handle = await mgr.open('/proj/a')
      await mgr.close(handle.sessionId)
      // stop() is called exactly once — by handle.stop() internally.
      // The fallback path must NOT add a second call.
      expect(vi.mocked(client.stop)).toHaveBeenCalledTimes(1)
    })
  })

  // ── close() — shutdown timeout fallback ────────────────────────────────────

  describe('close() — shutdown timeout fallback', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('falls back to client.stop() when shutdown never resolves (past 3 s)', async () => {
      vi.useFakeTimers()

      const slowClient = makeMockClient({ shutdownDelay: Infinity })
      const mgr2 = new SessionManager({ createClient: vi.fn().mockResolvedValue(slowClient) })

      const handle = await mgr2.open('/proj/slow')
      const closePromise = mgr2.close(handle.sessionId)

      // Advance fake clock past the 3 s hard timeout.
      await vi.advanceTimersByTimeAsync(3_001)
      await closePromise

      // stop() is called twice: once by handle.stop() and once by the fallback.
      expect(vi.mocked(slowClient.stop)).toHaveBeenCalledTimes(2)
    })

    it('does NOT invoke the fallback stop() when shutdown resolves within 3 s', async () => {
      vi.useFakeTimers()

      const fastClient = makeMockClient({ shutdownDelay: 0 })
      const mgr2 = new SessionManager({ createClient: vi.fn().mockResolvedValue(fastClient) })

      const handle = await mgr2.open('/proj/fast')
      const closePromise = mgr2.close(handle.sessionId)

      // Give microtasks a chance to run — no real time needs to pass.
      await vi.advanceTimersByTimeAsync(0)
      await closePromise

      // stop() called once only (from handle.stop()), not twice.
      expect(vi.mocked(fastClient.stop)).toHaveBeenCalledTimes(1)
    })
  })

  // ── activeSessions ─────────────────────────────────────────────────────────

  describe('activeSessions', () => {
    it('is empty on a fresh manager', () => {
      expect(mgr.activeSessions).toHaveLength(0)
    })

    it('contains the session id after open()', async () => {
      const handle = await mgr.open('/proj/a')
      expect(mgr.activeSessions).toContain(handle.sessionId)
    })

    it('is empty after close()', async () => {
      const handle = await mgr.open('/proj/a')
      await mgr.close(handle.sessionId)
      expect(mgr.activeSessions).toHaveLength(0)
    })

    it('reflects the current active session count (at most 1 in Phase 1)', async () => {
      expect(mgr.activeSessions).toHaveLength(0)
      const handle = await mgr.open('/proj/a')
      expect(mgr.activeSessions).toHaveLength(1)
      await mgr.close(handle.sessionId)
      expect(mgr.activeSessions).toHaveLength(0)
    })
  })

  // ── Negative / edge cases ─────────────────────────────────────────────────

  describe('negative cases', () => {
    it('open() with empty string cwd still forwards to factory', async () => {
      await mgr.open('')
      expect(factory).toHaveBeenCalledWith({ cwd: '' })
    })

    it('close() on an already-removed id after double-close does not throw', async () => {
      const handle = await mgr.open('/proj/a')
      await mgr.close(handle.sessionId)
      // Second close is silent no-op — must not throw.
      await expect(mgr.close(handle.sessionId)).resolves.toBeUndefined()
      // And also must not call shutdown a second time.
      expect(client.shutdown).toHaveBeenCalledTimes(1)
    })

    it('open() after a factory failure still allows a subsequent successful open', async () => {
      const failOnce = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(client)
      const mgr2 = new SessionManager({ createClient: failOnce })

      await expect(mgr2.open('/proj/fail')).rejects.toThrow('transient')
      // No active sessions left after the failure.
      expect(mgr2.activeSessions).toHaveLength(0)

      // Second call succeeds — Phase-1 slot is not consumed by failed open.
      const handle = await mgr2.open('/proj/ok')
      expect(handle).toBeInstanceOf(SessionHandle)
    })
  })
})

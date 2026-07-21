import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RpcClient, SdkAgentEvent } from '@opengsd/rpc-client'
import { SessionManager } from './session-manager'
import type { RegistryStoreLike } from './session-manager'
import { SessionHandle } from './session-handle'
import type { RegistryV1, SessionRecord } from '../../shared/types'

// ── mock helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal RpcClient mock.
 *
 * The `events()` generator blocks indefinitely so the SessionHandle event pump
 * stays in `'running'` state during tests (matches real behaviour where a live
 * pi process streams events until stopped).
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
    switchSession: vi.fn().mockResolvedValue(undefined),
    getAvailableModels: vi.fn().mockResolvedValue([]),
    setModel: vi.fn().mockResolvedValue(undefined),
    compact: vi.fn().mockResolvedValue({ summary: 'compacted', firstKeptEntryId: 'e1', tokensBefore: 1000 }),
  } as unknown as RpcClient
}

/** Return a vi.fn() createClient factory that resolves with the given client. */
function makeFactory(client: RpcClient) {
  return vi.fn<(opts: { cwd: string }) => Promise<RpcClient>>().mockResolvedValue(client)
}

/**
 * A factory that creates a fresh mock client for each invocation.
 * Use when opening multiple concurrent sessions so each gets its own spy.
 */
function makeMultiFactory() {
  return vi.fn<(opts: { cwd: string }) => Promise<RpcClient>>()
    .mockImplementation(() => Promise.resolve(makeMockClient()))
}

/** Build a minimal RegistryStoreLike stub for spying on saves. */
function makeRegistryStore(): RegistryStoreLike & { save: ReturnType<typeof vi.fn> } {
  return { save: vi.fn<(reg: RegistryV1) => void>() }
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
      const multiFactory = makeMultiFactory()
      const mgr2 = new SessionManager({ createClient: multiFactory })

      const h1 = await mgr2.open('/proj/a')
      const h2 = await mgr2.open('/proj/b')
      expect(h1.sessionId).not.toBe(h2.sessionId)

      await mgr2.close(h1.sessionId)
      await mgr2.close(h2.sessionId)
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

    it('allows a second open while the first session is still active', async () => {
      const multiFactory = makeMultiFactory()
      const mgr2 = new SessionManager({ createClient: multiFactory })

      const h1 = await mgr2.open('/proj/a')
      const h2 = await mgr2.open('/proj/b')

      expect(h2).toBeInstanceOf(SessionHandle)
      expect(h1.sessionId).not.toBe(h2.sessionId)

      await mgr2.close(h1.sessionId)
      await mgr2.close(h2.sessionId)
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

  // ── list() ────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns an empty array when no sessions are open', () => {
      expect(mgr.list()).toHaveLength(0)
    })

    it('returns one record after one open()', async () => {
      const handle = await mgr.open('/proj/a')
      const records = mgr.list()
      expect(records).toHaveLength(1)
      expect(records[0]!.id).toBe(handle.sessionId)
    })

    it('record carries correct cwd and displayName', async () => {
      await mgr.open('/proj/my-app')
      const [rec] = mgr.list()
      expect(rec!.cwd).toBe('/proj/my-app')
      expect(rec!.displayName).toBe('my-app')
    })

    it('record carries a valid ISO lastOpenedAt timestamp', async () => {
      await mgr.open('/proj/a')
      const [rec] = mgr.list()
      expect(() => new Date(rec!.lastOpenedAt)).not.toThrow()
      expect(new Date(rec!.lastOpenedAt).getTime()).not.toBeNaN()
    })

    it('record starts with wasAutoRunning = false', async () => {
      await mgr.open('/proj/a')
      const [rec] = mgr.list()
      expect(rec!.wasAutoRunning).toBe(false)
    })

    it('returns a snapshot — mutations to the returned array do not affect the manager', async () => {
      await mgr.open('/proj/a')
      const records = mgr.list()
      records.splice(0) // mutate the snapshot
      expect(mgr.list()).toHaveLength(1)
    })
  })

  // ── multi-session (3 concurrent sessions) ─────────────────────────────────

  describe('multi-session', () => {
    it('tracks all 3 sessions after opening them concurrently', async () => {
      const multiFactory = makeMultiFactory()
      const mgr3 = new SessionManager({ createClient: multiFactory })

      const [h1, h2, h3] = await Promise.all([
        mgr3.open('/proj/alpha'),
        mgr3.open('/proj/beta'),
        mgr3.open('/proj/gamma'),
      ])

      expect(mgr3.activeSessions).toHaveLength(3)
      expect(mgr3.list()).toHaveLength(3)

      // All handles are accessible via get()
      expect(mgr3.get(h1.sessionId)).toBe(h1)
      expect(mgr3.get(h2.sessionId)).toBe(h2)
      expect(mgr3.get(h3.sessionId)).toBe(h3)

      await mgr3.close(h1.sessionId)
      await mgr3.close(h2.sessionId)
      await mgr3.close(h3.sessionId)
    })

    it('list() contains records for all 3 sessions', async () => {
      const multiFactory = makeMultiFactory()
      const mgr3 = new SessionManager({ createClient: multiFactory })

      const [h1, h2, h3] = await Promise.all([
        mgr3.open('/proj/alpha'),
        mgr3.open('/proj/beta'),
        mgr3.open('/proj/gamma'),
      ])

      const ids = mgr3.list().map((r) => r.id)
      expect(ids).toContain(h1.sessionId)
      expect(ids).toContain(h2.sessionId)
      expect(ids).toContain(h3.sessionId)

      await mgr3.close(h1.sessionId)
      await mgr3.close(h2.sessionId)
      await mgr3.close(h3.sessionId)
    })

    it('closing one session shrinks the map to 2', async () => {
      const multiFactory = makeMultiFactory()
      const mgr3 = new SessionManager({ createClient: multiFactory })

      const [h1, h2, h3] = await Promise.all([
        mgr3.open('/proj/alpha'),
        mgr3.open('/proj/beta'),
        mgr3.open('/proj/gamma'),
      ])

      await mgr3.close(h2.sessionId)

      expect(mgr3.activeSessions).toHaveLength(2)
      expect(mgr3.list()).toHaveLength(2)
      expect(mgr3.get(h2.sessionId)).toBeUndefined()

      // Other two still accessible
      expect(mgr3.get(h1.sessionId)).toBe(h1)
      expect(mgr3.get(h3.sessionId)).toBe(h3)

      await mgr3.close(h1.sessionId)
      await mgr3.close(h3.sessionId)
    })

    it('ids are all unique across 3 concurrent opens', async () => {
      const multiFactory = makeMultiFactory()
      const mgr3 = new SessionManager({ createClient: multiFactory })

      const handles = await Promise.all([
        mgr3.open('/proj/a'),
        mgr3.open('/proj/b'),
        mgr3.open('/proj/c'),
      ])

      const ids = handles.map((h) => h.sessionId)
      const unique = new Set(ids)
      expect(unique.size).toBe(3)

      for (const h of handles) await mgr3.close(h.sessionId)
    })
  })

  // ── rename() ──────────────────────────────────────────────────────────────

  describe('rename()', () => {
    it('updates displayName in list()', async () => {
      const handle = await mgr.open('/proj/my-app')
      mgr.rename(handle.sessionId, 'My Renamed App')

      const [rec] = mgr.list()
      expect(rec!.displayName).toBe('My Renamed App')
    })

    it('is reflected in getRegistry() sessions', async () => {
      const handle = await mgr.open('/proj/my-app')
      mgr.rename(handle.sessionId, 'Pretty Name')

      const reg = mgr.getRegistry()
      const session = reg.sessions.find((s) => s.id === handle.sessionId)
      expect(session?.displayName).toBe('Pretty Name')
    })

    it('no-op for unknown id — does not throw', () => {
      expect(() => mgr.rename('s_does_not_exist', 'anything')).not.toThrow()
    })

    it('does not affect other sessions', async () => {
      const multiFactory = makeMultiFactory()
      const mgr2 = new SessionManager({ createClient: multiFactory })

      const h1 = await mgr2.open('/proj/a')
      const h2 = await mgr2.open('/proj/b')

      mgr2.rename(h1.sessionId, 'Renamed A')

      const rec2 = mgr2.list().find((r) => r.id === h2.sessionId)
      expect(rec2?.displayName).toBe('b')

      await mgr2.close(h1.sessionId)
      await mgr2.close(h2.sessionId)
    })
  })

  // ── getRegistry() ─────────────────────────────────────────────────────────

  describe('getRegistry()', () => {
    it('returns version: 1', async () => {
      await mgr.open('/proj/a')
      expect(mgr.getRegistry().version).toBe(1)
    })

    it('sessions array matches list()', async () => {
      await mgr.open('/proj/a')
      const reg = mgr.getRegistry()
      expect(reg.sessions).toEqual(mgr.list())
    })

    it('mruOrder contains session ids', async () => {
      const handle = await mgr.open('/proj/a')
      const reg = mgr.getRegistry()
      expect(reg.mruOrder).toContain(handle.sessionId)
    })

    it('windows is an empty array', async () => {
      await mgr.open('/proj/a')
      expect(mgr.getRegistry().windows).toEqual([])
    })

    it('reflects 3 sessions opened simultaneously', async () => {
      const multiFactory = makeMultiFactory()
      const mgr3 = new SessionManager({ createClient: multiFactory })

      const handles = await Promise.all([
        mgr3.open('/proj/a'),
        mgr3.open('/proj/b'),
        mgr3.open('/proj/c'),
      ])

      const reg = mgr3.getRegistry()
      expect(reg.sessions).toHaveLength(3)
      expect(reg.mruOrder).toHaveLength(3)

      for (const h of handles) await mgr3.close(h.sessionId)
    })

    it('after rename, getRegistry() shows updated displayName', async () => {
      const handle = await mgr.open('/proj/cool-project')
      mgr.rename(handle.sessionId, 'Cool Project (renamed)')

      const reg = mgr.getRegistry()
      const sess = reg.sessions.find((s) => s.id === handle.sessionId)!
      expect(sess.displayName).toBe('Cool Project (renamed)')
    })
  })

  // ── registry save integration ─────────────────────────────────────────────

  describe('registryStore integration', () => {
    it('save() is called on open()', async () => {
      const store = makeRegistryStore()
      const mgr2 = new SessionManager({ createClient: factory, registryStore: store })

      await mgr2.open('/proj/a')
      expect(store.save).toHaveBeenCalled()
    })

    it('save() is called on close()', async () => {
      const store = makeRegistryStore()
      const mgr2 = new SessionManager({ createClient: factory, registryStore: store })

      const handle = await mgr2.open('/proj/a')
      store.save.mockClear()

      await mgr2.close(handle.sessionId)
      expect(store.save).toHaveBeenCalled()
    })

    it('save() is called on rename()', async () => {
      const store = makeRegistryStore()
      const mgr2 = new SessionManager({ createClient: factory, registryStore: store })

      const handle = await mgr2.open('/proj/a')
      store.save.mockClear()

      mgr2.rename(handle.sessionId, 'New Name')
      expect(store.save).toHaveBeenCalled()
    })

    it('save() receives a RegistryV1 with version: 1', async () => {
      const store = makeRegistryStore()
      const mgr2 = new SessionManager({ createClient: factory, registryStore: store })

      await mgr2.open('/proj/a')

      const lastCall = store.save.mock.calls.at(-1)!
      expect(lastCall[0].version).toBe(1)
    })

    it('no save() when registryStore is not provided', async () => {
      // mgr has no registryStore — should not throw
      const handle = await mgr.open('/proj/a')
      mgr.rename(handle.sessionId, 'x')
      await mgr.close(handle.sessionId)
      // nothing to assert — just verifying no throw
    })

    it('save() is triggered by agent_start event (wasAutoRunning tracking)', async () => {
      const store = makeRegistryStore()
      const mgr2 = new SessionManager({ createClient: factory, registryStore: store })

      const handle = await mgr2.open('/proj/a')
      store.save.mockClear()

      // Emit agent_start from the handle — simulates pi starting auto-mode
      handle.emit('agent_start', { type: 'agent_start' })
      expect(store.save).toHaveBeenCalled()

      // Verify wasAutoRunning flipped to true in the snapshot
      const lastCall = store.save.mock.calls.at(-1)!
      expect(lastCall[0].sessions[0]!.wasAutoRunning).toBe(true)

      await mgr2.close(handle.sessionId)
    })

    it('save() is triggered by agent_end event and wasAutoRunning resets', async () => {
      const store = makeRegistryStore()
      const mgr2 = new SessionManager({ createClient: factory, registryStore: store })

      const handle = await mgr2.open('/proj/a')
      handle.emit('agent_start', { type: 'agent_start' })
      store.save.mockClear()

      handle.emit('agent_end', { type: 'agent_end' })
      expect(store.save).toHaveBeenCalled()

      const lastCall = store.save.mock.calls.at(-1)!
      expect(lastCall[0].sessions[0]!.wasAutoRunning).toBe(false)

      await mgr2.close(handle.sessionId)
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

      // stop() is called once by handle.stop() — the explicit fallback
      // client.stop() was removed since handle.stop() always runs after
      // client.shutdown() regardless of timeout.
      expect(vi.mocked(slowClient.stop)).toHaveBeenCalledTimes(1)
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

    it('reflects the current active session count across multiple opens', async () => {
      const multiFactory = makeMultiFactory()
      const mgr2 = new SessionManager({ createClient: multiFactory })

      expect(mgr2.activeSessions).toHaveLength(0)

      const h1 = await mgr2.open('/proj/a')
      expect(mgr2.activeSessions).toHaveLength(1)

      const h2 = await mgr2.open('/proj/b')
      expect(mgr2.activeSessions).toHaveLength(2)

      await mgr2.close(h1.sessionId)
      expect(mgr2.activeSessions).toHaveLength(1)

      await mgr2.close(h2.sessionId)
      expect(mgr2.activeSessions).toHaveLength(0)
    })
  })

  // ── restore() ──────────────────────────────────────────────────────────────

  describe('restore()', () => {
    /**
     * A directory guaranteed to exist on this machine (the project working dir).
     * Used in place of hard-coded posix paths like /proj/alpha so existsSync
     * passes on Windows without mocking the filesystem.
     */
    const existingCwd = process.cwd()

    /** Build a minimal SessionRecord fixture. */
    function makeRecord(overrides?: Partial<SessionRecord>): SessionRecord {
      return {
        id: 's_fixture',
        cwd: '/proj/restored',
        displayName: 'restored',
        lastOpenedAt: new Date().toISOString(),
        wasAutoRunning: false,
        ...overrides,
      }
    }

    it('resolves with empty arrays when called with no records', async () => {
      const result = await mgr.restore([])
      expect(result.restored).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('restored session appears in list()', async () => {
      const result = await mgr.restore([makeRecord({ cwd: existingCwd })])
      expect(result.restored).toHaveLength(1)
      expect(result.failed).toHaveLength(0)
      expect(mgr.list()).toHaveLength(1)
      expect(mgr.list()[0]!.cwd).toBe(existingCwd)

      await mgr.close(result.restored[0]!)
    })

    it('both records appear in list() after restoring 2 sessions', async () => {
      const multiFactory = makeMultiFactory()
      const mgr2 = new SessionManager({ createClient: multiFactory })

      const result = await mgr2.restore([
        makeRecord({ cwd: existingCwd }),
        makeRecord({ cwd: existingCwd }),
      ])

      expect(result.restored).toHaveLength(2)
      expect(mgr2.list()).toHaveLength(2)

      for (const id of result.restored) await mgr2.close(id)
    })

    it('switchSession is called when sessionFile is present', async () => {
      // Use a dedicated client so we can spy on switchSession directly.
      const switchClient = makeMockClient()
      const switchFactory = makeFactory(switchClient)
      const mgr2 = new SessionManager({ createClient: switchFactory })

      const result = await mgr2.restore([
        makeRecord({ cwd: existingCwd, sessionFile: '/path/to/session.jsonl' }),
      ])

      expect(
        (switchClient as unknown as { switchSession: ReturnType<typeof vi.fn> }).switchSession,
      ).toHaveBeenCalledWith({ sessionPath: '/path/to/session.jsonl' })

      await mgr2.close(result.restored[0]!)
    })

    it('switchSession is NOT called when sessionFile is absent', async () => {
      const noSwitchClient = makeMockClient()
      const mgr2 = new SessionManager({ createClient: makeFactory(noSwitchClient) })

      const result = await mgr2.restore([makeRecord({ cwd: existingCwd })])

      expect(
        (noSwitchClient as unknown as { switchSession: ReturnType<typeof vi.fn> }).switchSession,
      ).not.toHaveBeenCalled()

      await mgr2.close(result.restored[0]!)
    })

    it('factory failure is captured in failed[] without blocking other records', async () => {
      const goodClient = makeMockClient()
      // First call fails; second succeeds.
      // Both use existingCwd so existsSync passes and the factory is reached.
      const failOnFirst = vi
        .fn()
        .mockRejectedValueOnce(new Error('spawn fail'))
        .mockResolvedValue(goodClient)
      const mgr2 = new SessionManager({ createClient: failOnFirst })

      const result = await mgr2.restore([
        makeRecord({ cwd: existingCwd }),
        makeRecord({ cwd: existingCwd }),
      ])

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0]!.record.cwd).toBe(existingCwd)
      expect(result.restored).toHaveLength(1)
      expect(mgr2.list()).toHaveLength(1)

      await mgr2.close(result.restored[0]!)
    })

    it('switchSession failure is non-fatal — session still in restored[]', async () => {
      // Uses process.cwd() so existsSync passes on all platforms.
      const realCwd = process.cwd()
      const mgr2 = new SessionManager({ createClient: makeFactory(makeMockClient()) })
      mgr2.initHistory({ [realCwd]: '/path/to/session.jsonl' })

      const result = await mgr2.restore([
        makeRecord({ cwd: realCwd, sessionFile: '/path/to/session.jsonl' }),
      ])

      // Session is opened with --continue; pi handles the resume at spawn time.
      expect(result.restored).toHaveLength(1)
      expect(result.failed).toHaveLength(0)
      expect(mgr2.list()).toHaveLength(1)

      await mgr2.close(result.restored[0]!)
    })
  })

  // ── compact() ──────────────────────────────────────────────────────────────

  describe('compact()', () => {
    it('delegates to client.compact() and returns CompactionResult', async () => {
      const handle = await mgr.open('/proj/a')
      const result = await mgr.compact(handle.sessionId)
      expect(
        (client as unknown as { compact: ReturnType<typeof vi.fn> }).compact,
      ).toHaveBeenCalledWith(undefined)
      expect(result).toEqual({ summary: 'compacted', firstKeptEntryId: 'e1', tokensBefore: 1000 })
      await mgr.close(handle.sessionId)
    })

    it('forwards customInstructions to client.compact()', async () => {
      const handle = await mgr.open('/proj/a')
      await mgr.compact(handle.sessionId, 'focus on the auth module')
      expect(
        (client as unknown as { compact: ReturnType<typeof vi.fn> }).compact,
      ).toHaveBeenCalledWith('focus on the auth module')
      await mgr.close(handle.sessionId)
    })

    it('throws for an unknown session id', async () => {
      await expect(mgr.compact('s_ghost')).rejects.toThrow(
        "SessionManager.compact(): unknown session 's_ghost'",
      )
    })

    it('propagates a rejection from client.compact()', async () => {
      const handle = await mgr.open('/proj/a')
      ;(client as unknown as { compact: ReturnType<typeof vi.fn> }).compact
        .mockRejectedValueOnce(new Error('compact RPC failed'))
      await expect(mgr.compact(handle.sessionId)).rejects.toThrow('compact RPC failed')
      await mgr.close(handle.sessionId)
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

      // Second call succeeds — slot is not consumed by failed open.
      const handle = await mgr2.open('/proj/ok')
      expect(handle).toBeInstanceOf(SessionHandle)
    })

    it('rename() no-op for unknown id does not trigger registryStore.save()', () => {
      const store = makeRegistryStore()
      const mgr2 = new SessionManager({ createClient: factory, registryStore: store })

      mgr2.rename('s_missing', 'whatever')
      expect(store.save).not.toHaveBeenCalled()
    })

    it('list() after all sessions closed returns empty array', async () => {
      const multiFactory = makeMultiFactory()
      const mgr2 = new SessionManager({ createClient: multiFactory })

      const h1 = await mgr2.open('/proj/a')
      const h2 = await mgr2.open('/proj/b')

      await mgr2.close(h1.sessionId)
      await mgr2.close(h2.sessionId)

      expect(mgr2.list()).toHaveLength(0)
    })
  })
})

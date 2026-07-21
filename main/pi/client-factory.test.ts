import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient, ClientInitError } from './client-factory'

// ── Hoisted mock factories ─────────────────────────────────────────────────────
//
// vi.hoisted() runs before any module import, so the mock objects are ready when
// the vi.mock() factory closures execute below. This is the safe pattern for
// mocking constructors and ES-module dependencies in Vitest.

const { mockResolvePiBinary, mockResolveSystemNode, mockStart, mockStop, mockInit, MockRpcClient } =
  vi.hoisted(() => {
    const mockResolvePiBinary = vi.fn<() => string>()
    const mockResolveSystemNode = vi.fn<() => string | null>().mockReturnValue(null)
    const mockStart = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const mockStop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const mockInit = vi.fn<(opts?: { clientId?: string }) => Promise<unknown>>()
    const MockRpcClient = vi.fn().mockImplementation(() => ({
      start: mockStart,
      stop: mockStop,
      init: mockInit,
    }))
    return { mockResolvePiBinary, mockResolveSystemNode, mockStart, mockStop, mockInit, MockRpcClient }
  })

// Mock the SDK module — RpcClient constructor is replaced by MockRpcClient.
vi.mock('@opengsd/rpc-client', () => ({ RpcClient: MockRpcClient }))

// Mock the resolver — isolates factory from filesystem + OS.
vi.mock('./resolve-pi', () => ({ resolvePiBinary: mockResolvePiBinary, resolveSystemNode: mockResolveSystemNode }))

// ── Test fixtures ──────────────────────────────────────────────────────────────

const FAKE_BIN = 'C:\\nvm4w\\nodejs\\gsd.cmd'
const FAKE_CWD = 'D:\\projects\\test-project'
const FAKE_SESSION_ID = 'ses_abc123'

/**
 * Build a realistic RpcInitResult.
 * Pass overrides to inject bad values for negative-path tests.
 */
function makeInitResult(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 2 as 2,
    sessionId: FAKE_SESSION_ID,
    capabilities: { events: ['*'], commands: ['prompt', 'init', 'subscribe'] },
    ...overrides,
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('createClient', () => {
  beforeEach(() => {
    // Re-establish MockRpcClient's constructor implementation every time.
    // vi.clearAllMocks() (below) clears call history but NOT implementations, so
    // this is belt-and-suspenders against any test that overrides the constructor.
    MockRpcClient.mockImplementation(() => ({
      start: mockStart,
      stop: mockStop,
      init: mockInit,
    }))
    // Default happy-path wiring for every test.
    mockResolvePiBinary.mockReturnValue(FAKE_BIN)
    mockStart.mockResolvedValue(undefined)
    mockStop.mockResolvedValue(undefined)
    mockInit.mockResolvedValue(makeInitResult())
  })

  afterEach(() => {
    // clearAllMocks clears call history but preserves implementations so the
    // MockRpcClient constructor stays wired for the next test's beforeEach.
    vi.clearAllMocks()
  })

  // ── Ordering invariant ─────────────────────────────────────────────────────

  it('calls start() then init() in that strict order', async () => {
    const callOrder: string[] = []
    mockStart.mockImplementation(async () => { callOrder.push('start') })
    mockInit.mockImplementation(async () => { callOrder.push('init'); return makeInitResult() })

    await createClient({ cwd: FAKE_CWD, binary: FAKE_BIN })

    expect(callOrder).toEqual(['start', 'init'])
  })

  // ── Binary resolution ──────────────────────────────────────────────────────

  it('uses the provided binary path and does NOT call resolvePiBinary()', async () => {
    await createClient({ cwd: FAKE_CWD, binary: FAKE_BIN })

    expect(mockResolvePiBinary).not.toHaveBeenCalled()
    expect(MockRpcClient).toHaveBeenCalledWith(
      expect.objectContaining({ cliPath: FAKE_BIN })
    )
  })

  it('calls resolvePiBinary() when binary is omitted, and passes its result to RpcClient', async () => {
    await createClient({ cwd: FAKE_CWD })

    expect(mockResolvePiBinary).toHaveBeenCalledOnce()
    expect(MockRpcClient).toHaveBeenCalledWith(
      expect.objectContaining({ cliPath: FAKE_BIN }) // resolver returned FAKE_BIN
    )
  })

  it('passes cwd to RpcClient constructor', async () => {
    await createClient({ cwd: FAKE_CWD, binary: FAKE_BIN })

    expect(MockRpcClient).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: FAKE_CWD })
    )
  })

  // ── Init handshake details ─────────────────────────────────────────────────

  it('sends clientId "gsd-tau" in the init call', async () => {
    await createClient({ cwd: FAKE_CWD, binary: FAKE_BIN })

    expect(mockInit).toHaveBeenCalledWith({ clientId: 'gsd-tau' })
  })

  it('returns the RpcClient instance on the happy path', async () => {
    const client = await createClient({ cwd: FAKE_CWD, binary: FAKE_BIN })

    expect(client).toBeDefined()
    // The returned value is the mock instance built by MockRpcClient
    expect(MockRpcClient).toHaveBeenCalledOnce()
  })

  // ── Failure modes (Q5) — init() rejects ───────────────────────────────────

  it('throws ClientInitError when init() rejects', async () => {
    mockInit.mockRejectedValue(new Error('timeout waiting for RPC response'))

    await expect(createClient({ cwd: FAKE_CWD, binary: FAKE_BIN }))
      .rejects.toBeInstanceOf(ClientInitError)
  })

  it('includes the binary path in ClientInitError.piPath when init() rejects', async () => {
    mockInit.mockRejectedValue(new Error('ECONNRESET'))

    let err: unknown
    try { await createClient({ cwd: FAKE_CWD, binary: FAKE_BIN }) } catch (e) { err = e }

    expect((err as ClientInitError).piPath).toBe(FAKE_BIN)
    expect((err as ClientInitError).name).toBe('ClientInitError')
  })

  it('includes an upgrade hint in the ClientInitError message when init() rejects', async () => {
    mockInit.mockRejectedValue(new Error('ECONNRESET'))

    let err: unknown
    try { await createClient({ cwd: FAKE_CWD, binary: FAKE_BIN }) } catch (e) { err = e }

    expect((err as ClientInitError).message).toMatch(/npm install|upgrade/i)
    expect((err as ClientInitError).message).toContain(FAKE_BIN)
  })

  it('calls stop() to clean up before throwing when init() rejects', async () => {
    mockInit.mockRejectedValue(new Error('handshake failed'))

    await expect(createClient({ cwd: FAKE_CWD, binary: FAKE_BIN }))
      .rejects.toBeInstanceOf(ClientInitError)
    expect(mockStop).toHaveBeenCalledOnce()
  })

  it('still throws ClientInitError even when stop() itself rejects during cleanup', async () => {
    mockInit.mockRejectedValue(new Error('handshake failed'))
    mockStop.mockRejectedValue(new Error('stop also failed'))

    await expect(createClient({ cwd: FAKE_CWD, binary: FAKE_BIN }))
      .rejects.toBeInstanceOf(ClientInitError)
  })

  // ── Negative tests (Q7) — incompatible protocol version ───────────────────

  it('throws ClientInitError when init() returns protocolVersion !== 2', async () => {
    mockInit.mockResolvedValue(makeInitResult({ protocolVersion: 1 }))

    await expect(createClient({ cwd: FAKE_CWD, binary: FAKE_BIN }))
      .rejects.toBeInstanceOf(ClientInitError)
  })

  it('mentions "requires v2" in the error when protocol version is wrong', async () => {
    mockInit.mockResolvedValue(makeInitResult({ protocolVersion: 1 }))

    let err: unknown
    try { await createClient({ cwd: FAKE_CWD, binary: FAKE_BIN }) } catch (e) { err = e }

    expect((err as ClientInitError).message).toContain('gsd-tau requires v2')
    expect((err as ClientInitError).piPath).toBe(FAKE_BIN)
  })

  it('calls stop() to clean up before throwing on wrong protocol version', async () => {
    mockInit.mockResolvedValue(makeInitResult({ protocolVersion: 1 }))

    await expect(createClient({ cwd: FAKE_CWD, binary: FAKE_BIN }))
      .rejects.toBeInstanceOf(ClientInitError)
    expect(mockStop).toHaveBeenCalledOnce()
  })

  // ── Q7: boundary / edge inputs ─────────────────────────────────────────────

  it('does not call resolvePiBinary() when binary is an empty string — uses the literal path', async () => {
    // Edge: explicitly passing '' still bypasses the resolver (caller error, not factory error)
    await createClient({ cwd: FAKE_CWD, binary: '' })

    expect(mockResolvePiBinary).not.toHaveBeenCalled()
    expect(MockRpcClient).toHaveBeenCalledWith(expect.objectContaining({ cliPath: '' }))
  })
})

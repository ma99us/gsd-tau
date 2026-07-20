import { describe, it, expect, vi, afterEach } from 'vitest'
import type { RpcClient, SdkAgentEvent } from '@opengsd/rpc-client'
import { SessionHandle } from './session-handle'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Flush N sequential microtask ticks so async generators drain completely.
 * Each yield in an async generator creates one microtask suspension; 20 ticks
 * covers generators with up to ~18 sequential events plus pump overhead.
 */
const flushMicrotasks = async (depth = 20): Promise<void> => {
  for (let i = 0; i < depth; i++) await Promise.resolve()
}

/**
 * Build a mock RpcClient whose events() yields a static array.
 * The generator terminates after the last event, simulating natural pump exit.
 */
function makeClient(
  events: SdkAgentEvent[],
  stopFn: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined)
): RpcClient {
  return {
    events: vi.fn().mockReturnValue(
      (async function* () {
        for (const ev of events) yield ev
      })()
    ),
    stop: stopFn,
  } as unknown as RpcClient
}

/**
 * Build a mock client whose events() generator throws immediately on the first
 * next() call — simulates a transport failure at pump startup.
 */
function makeThrowingClient(err: unknown): RpcClient {
  return {
    events: vi.fn().mockReturnValue(
      (async function* () {
        throw err
        /* istanbul ignore next */
        yield { type: '__unreachable__' } as SdkAgentEvent
      })()
    ),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as RpcClient
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SESSION = 'ses_test_001'

const EV_AGENT_START  = { type: 'agent_start',  runId: 'r1' }            as SdkAgentEvent
const EV_AGENT_END    = { type: 'agent_end',    runId: 'r1' }            as SdkAgentEvent
const EV_MESSAGE      = { type: 'message',      role: 'assistant' }      as SdkAgentEvent
const EV_TOOL_USE     = { type: 'tool_use',     id: 'tu1', name: 'read' } as SdkAgentEvent
const EV_TOOL_RESULT  = { type: 'tool_result',  tool_use_id: 'tu1' }     as SdkAgentEvent
const EV_DELTA_1      = { type: 'text_delta',   delta: 'Hello' }         as SdkAgentEvent
const EV_DELTA_2      = { type: 'text_delta',   delta: ', ' }            as SdkAgentEvent
const EV_DELTA_3      = { type: 'text_delta',   delta: 'world' }         as SdkAgentEvent
const EV_UNKNOWN      = { type: 'future_event', payload: 42 }            as SdkAgentEvent

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('SessionHandle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Lifecycle / clientState ────────────────────────────────────────────────

  it('starts in "idle" state', () => {
    const handle = new SessionHandle(makeClient([]), SESSION)
    expect(handle.clientState).toBe('idle')
  })

  it('transitions to "running" synchronously after start()', () => {
    // Check state right after start(), before any microtasks flush.
    const handle = new SessionHandle(makeClient([]), SESSION)
    handle.start()
    expect(handle.clientState).toBe('running')
  })

  it('transitions back to "idle" when the generator exhausts normally', async () => {
    const handle = new SessionHandle(makeClient([]), SESSION)
    handle.start()
    await flushMicrotasks()
    expect(handle.clientState).toBe('idle')
  })

  it('transitions to "stopped" after stop()', async () => {
    const handle = new SessionHandle(makeClient([]), SESSION)
    handle.start()
    await handle.stop()
    expect(handle.clientState).toBe('stopped')
  })

  it('throws if start() is called a second time (state "running")', () => {
    // State is "running" synchronously — second start() should throw immediately.
    const handle = new SessionHandle(makeClient([]), SESSION)
    handle.start()
    expect(() => handle.start()).toThrow(/running/)
  })

  it('throws if start() is called after stop()', async () => {
    const handle = new SessionHandle(makeClient([]), SESSION)
    await handle.stop()
    expect(() => handle.start()).toThrow(/stopped/)
  })

  it('stop() is idempotent — second call resolves without error', async () => {
    const handle = new SessionHandle(makeClient([]), SESSION)
    handle.start()
    await handle.stop()
    await expect(handle.stop()).resolves.toBeUndefined()
    expect(handle.clientState).toBe('stopped')
  })

  it('stop() is safe before start()', async () => {
    const handle = new SessionHandle(makeClient([]), SESSION)
    await expect(handle.stop()).resolves.toBeUndefined()
    expect(handle.clientState).toBe('stopped')
  })

  // ── sessionId ─────────────────────────────────────────────────────────────

  it('exposes the sessionId supplied at construction', () => {
    const handle = new SessionHandle(makeClient([]), 'my-session-id')
    expect(handle.sessionId).toBe('my-session-id')
  })

  // ── Known typed event channels ─────────────────────────────────────────────

  it.each([
    ['agent_start',  EV_AGENT_START],
    ['agent_end',    EV_AGENT_END],
    ['message',      EV_MESSAGE],
    ['tool_use',     EV_TOOL_USE],
    ['tool_result',  EV_TOOL_RESULT],
  ] as const)(
    'emits %s on its named channel with the raw event payload',
    async (type, ev) => {
      const handle = new SessionHandle(makeClient([ev]), SESSION)
      const received: SdkAgentEvent[] = []
      handle.on(type, (e: SdkAgentEvent) => received.push(e))
      handle.start()
      await flushMicrotasks()
      expect(received).toHaveLength(1)
      expect(received[0]).toBe(ev)
    }
  )

  it('emits all non-text_delta known types on the generic "event" channel', async () => {
    const events = [EV_AGENT_START, EV_AGENT_END, EV_MESSAGE, EV_TOOL_USE, EV_TOOL_RESULT]
    const handle = new SessionHandle(makeClient(events), SESSION)
    const received: SdkAgentEvent[] = []
    handle.on('event', (e: SdkAgentEvent) => received.push(e))
    handle.start()
    await flushMicrotasks()
    expect(received).toHaveLength(5)
  })

  // ── Unknown events ─────────────────────────────────────────────────────────

  it('emits "unknown-event" for unrecognised event types, wrapping the raw event', async () => {
    const handle = new SessionHandle(makeClient([EV_UNKNOWN]), SESSION)
    const received: Array<{ event: SdkAgentEvent }> = []
    handle.on('unknown-event', (e: { event: SdkAgentEvent }) => received.push(e))
    handle.start()
    await flushMicrotasks()
    expect(received).toHaveLength(1)
    expect(received[0].event).toBe(EV_UNKNOWN)
  })

  it('emits unknown event types on the generic "event" channel', async () => {
    const handle = new SessionHandle(makeClient([EV_UNKNOWN]), SESSION)
    const received: SdkAgentEvent[] = []
    handle.on('event', (e: SdkAgentEvent) => received.push(e))
    handle.start()
    await flushMicrotasks()
    expect(received).toHaveLength(1)
    expect(received[0]).toBe(EV_UNKNOWN)
  })

  it('calls console.debug for unknown event types', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const handle = new SessionHandle(makeClient([EV_UNKNOWN]), SESSION)
    handle.start()
    await flushMicrotasks()
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('future_event')
    )
  })

  // ── Transport error ────────────────────────────────────────────────────────

  it('emits "transport-error" with the thrown error when the generator throws', async () => {
    const cause = new Error('EPIPE: broken pipe')
    const handle = new SessionHandle(makeThrowingClient(cause), SESSION)
    const errors: Array<{ error: unknown }> = []
    handle.on('transport-error', (e: { error: unknown }) => errors.push(e))
    handle.start()
    await flushMicrotasks()
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toBe(cause)
  })

  it('suppresses "transport-error" when stop() is called before the pump processes the throw', async () => {
    // stop() sets _stopped = true synchronously — before any microtask runs.
    // The pump's catch block checks _stopped and skips emit.
    const cause = new Error('EPIPE')
    const handle = new SessionHandle(makeThrowingClient(cause), SESSION)
    const errors: unknown[] = []
    handle.on('transport-error', (e: unknown) => errors.push(e))
    handle.start()
    void handle.stop()  // synchronously sets _stopped = true; no await
    await flushMicrotasks()
    expect(errors).toHaveLength(0)
  })

  // ── text_delta throttle ────────────────────────────────────────────────────

  it('emits a single text_delta immediately (leading edge, no suppression)', async () => {
    const handle = new SessionHandle(makeClient([EV_DELTA_1]), SESSION)
    const received: SdkAgentEvent[] = []
    handle.on('text_delta', (e: SdkAgentEvent) => received.push(e))
    handle.start()
    await flushMicrotasks()
    expect(received).toHaveLength(1)
    expect(received[0]).toBe(EV_DELTA_1)
  })

  it('throttles rapid text_delta bursts — emits leading edge + latest, drops middle', async () => {
    // All three deltas arrive in the same microtask burst (static array generator).
    // Leading edge → EV_DELTA_1 emitted immediately.
    // EV_DELTA_2 updates pending (timer running, no emit).
    // EV_DELTA_3 updates pending (timer running, no emit).
    // Generator exhausts; pump finally block flushes EV_DELTA_3.
    // Timer fires 16 ms later but pending is null → no-op.
    const handle = new SessionHandle(
      makeClient([EV_DELTA_1, EV_DELTA_2, EV_DELTA_3]),
      SESSION
    )
    const received: SdkAgentEvent[] = []
    handle.on('text_delta', (e: SdkAgentEvent) => received.push(e))
    handle.start()
    await flushMicrotasks()

    expect(received).toHaveLength(2)
    expect(received[0]).toBe(EV_DELTA_1)  // leading edge
    expect(received[1]).toBe(EV_DELTA_3)  // latest, flushed on generator exhaustion
  })

  it('text_delta is also emitted on the generic "event" channel (post-throttle only)', async () => {
    const handle = new SessionHandle(
      makeClient([EV_DELTA_1, EV_DELTA_2, EV_DELTA_3]),
      SESSION
    )
    const allEvents: SdkAgentEvent[] = []
    handle.on('event', (e: SdkAgentEvent) => allEvents.push(e))
    handle.start()
    await flushMicrotasks()

    const deltaEvents = allEvents.filter(e => e.type === 'text_delta')
    // Same count as the throttled text_delta channel: 2 (not 3)
    expect(deltaEvents).toHaveLength(2)
  })

  it('suppressed text_delta events are NOT emitted on "unknown-event"', async () => {
    const handle = new SessionHandle(
      makeClient([EV_DELTA_1, EV_DELTA_2, EV_DELTA_3]),
      SESSION
    )
    const unknown: unknown[] = []
    handle.on('unknown-event', (e: unknown) => unknown.push(e))
    handle.start()
    await flushMicrotasks()
    expect(unknown).toHaveLength(0)
  })

  // ── stop() — cleanup ───────────────────────────────────────────────────────

  it('stop() calls client.stop() exactly once', async () => {
    const mockStop = vi.fn().mockResolvedValue(undefined)
    const handle = new SessionHandle(makeClient([], mockStop), SESSION)
    handle.start()
    await handle.stop()
    expect(mockStop).toHaveBeenCalledOnce()
  })

  it('stop() resolves even if client.stop() rejects', async () => {
    const mockStop = vi.fn().mockRejectedValue(new Error('cleanup failure'))
    const handle = new SessionHandle(makeClient([], mockStop), SESSION)
    handle.start()
    await expect(handle.stop()).resolves.toBeUndefined()
    expect(handle.clientState).toBe('stopped')
  })
})

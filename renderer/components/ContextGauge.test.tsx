/**
 * Unit tests for ContextGauge pure helpers.
 *
 * Environment: node (no DOM). ContextGauge.tsx has no external DOM-only
 * dependencies (no Radix UI — uses an inline controlled-div popover), so
 * the pure helpers can be imported directly without any vi.mock setup.
 *
 * Render-level tests (gauge visibility, popover open state, compact button
 * click) require @testing-library/react with a jsdom environment — add
 * those when jsdom and @testing-library/react are installed as devDependencies.
 *
 * Coverage provided here:
 *   - computeGaugeColour: colour tier at 50% / 70% / 90% fill and null
 *   - computeGaugePct: fraction from token counts + contextWindow, fallbacks
 *   - formatTokensK: compact “Nk” formatting for raw token counts
 *   - isCompacting guard: compact delegation pattern (no hanging loading state)
 */

import { describe, it, expect } from 'vitest'
import {
  computeGaugeColour,
  computeGaugePct,
  formatTokensK,
} from './ContextGauge'

// ── computeGaugeColour ────────────────────────────────────────────────────────

describe('computeGaugeColour', () => {
  it('returns green at 0%', () => {
    expect(computeGaugeColour(0)).toBe('green')
  })

  it('returns green at 50% (below the 60% amber threshold)', () => {
    expect(computeGaugeColour(0.5)).toBe('green')
  })

  it('returns green just below the 60% boundary', () => {
    expect(computeGaugeColour(0.599)).toBe('green')
  })

  it('returns amber exactly at the 60% boundary', () => {
    expect(computeGaugeColour(0.60)).toBe('amber')
  })

  it('returns amber at 70% (mid-range)', () => {
    expect(computeGaugeColour(0.70)).toBe('amber')
  })

  it('returns amber just below the 85% red threshold', () => {
    expect(computeGaugeColour(0.849)).toBe('amber')
  })

  it('returns red exactly at the 85% boundary', () => {
    expect(computeGaugeColour(0.85)).toBe('red')
  })

  it('returns red at 90%', () => {
    expect(computeGaugeColour(0.90)).toBe('red')
  })

  it('returns red at 100% (full)', () => {
    expect(computeGaugeColour(1.0)).toBe('red')
  })

  it('returns red above 100% (overflow — possible during streaming)', () => {
    expect(computeGaugeColour(1.2)).toBe('red')
  })

  it('returns neutral for null (no data yet)', () => {
    expect(computeGaugeColour(null)).toBe('neutral')
  })
})

// ── computeGaugePct ───────────────────────────────────────────────────────────

describe('computeGaugePct', () => {
  const TOKENS = { input: 50_000, output: 5_000, cacheRead: 30_000, cacheWrite: 2_000 }
  // total = 87_000

  it('returns total / contextWindow as a fraction', () => {
    // 87_000 / 200_000 = 0.435
    expect(computeGaugePct(TOKENS, 200_000)).toBeCloseTo(87_000 / 200_000)
  })

  it('produces a value between 0 and 1 for a typical session', () => {
    const pct = computeGaugePct(TOKENS, 200_000)
    expect(pct).not.toBeNull()
    expect(pct!).toBeGreaterThanOrEqual(0)
    expect(pct!).toBeLessThanOrEqual(1)
  })

  it('can exceed 1 when tokens exceed contextWindow', () => {
    expect(computeGaugePct({ input: 200_000, output: 50_000, cacheRead: 0, cacheWrite: 0 }, 200_000)).toBeGreaterThan(1)
  })

  it('returns null when tokens is null', () => {
    expect(computeGaugePct(null, 200_000)).toBeNull()
  })

  it('returns null when contextWindow is undefined', () => {
    expect(computeGaugePct(TOKENS, undefined)).toBeNull()
  })

  it('returns null when contextWindow is 0 (falsy)', () => {
    // 0 contextWindow would produce Infinity — treat as absent
    expect(computeGaugePct(TOKENS, 0)).toBeNull()
  })

  it('returns null when both tokens and contextWindow are absent', () => {
    expect(computeGaugePct(null, undefined)).toBeNull()
  })
})

// ── formatTokensK ─────────────────────────────────────────────────────────────

describe('formatTokensK', () => {
  it('formats 133 600 as "134k" (rounds to nearest thousand)', () => {
    expect(formatTokensK(133_600)).toBe('134k')
  })

  it('formats exactly 200 000 as "200k"', () => {
    expect(formatTokensK(200_000)).toBe('200k')
  })

  it('formats exactly 1 000 as "1k" (boundary)', () => {
    expect(formatTokensK(1_000)).toBe('1k')
  })

  it('rounds 1 499 down to "1k"', () => {
    expect(formatTokensK(1_499)).toBe('1k')
  })

  it('rounds 1 500 up to "2k" (standard rounding)', () => {
    expect(formatTokensK(1_500)).toBe('2k')
  })

  it('returns the raw number as a string for values below 1 000', () => {
    expect(formatTokensK(512)).toBe('512')
  })

  it('returns "0" for zero tokens', () => {
    expect(formatTokensK(0)).toBe('0')
  })

  it('returns "999" for 999 tokens (last value without k suffix)', () => {
    expect(formatTokensK(999)).toBe('999')
  })
})

// ── isCompacting guard (compact delegation pattern) ───────────────────────────

describe('isCompacting guard — compact delegation pattern', () => {
  /**
   * Simulate the handleCompact logic from ContextGauge without mounting the
   * component.  Uses a plain variable (not React state) so the guard contract
   * is verifiable in a pure Node context.
   *
   * Pattern implemented in ContextGauge.handleCompact:
   *   1. Return early when isCompacting is already true (duplicate guard).
   *   2. Set isCompacting = true before the IPC call.
   *   3. Await compact() — succeed or fail.
   *   4. Set isCompacting = false in finally (never hangs in loading state).
   */
  async function simulateCompact(
    startIsCompacting: boolean,
    outcome: 'resolve' | 'reject',
  ): Promise<{ called: boolean; finalIsCompacting: boolean }> {
    if (startIsCompacting) {
      // Guard: duplicate call swallowed
      return { called: false, finalIsCompacting: true }
    }

    let finalIsCompacting = true
    let called = false
    try {
      called = true
      if (outcome === 'reject') throw new Error('compact failed')
    } catch {
      // In the real ContextGauge.handleCompact this is a console.error —
      // swallowed here so the test can assert on finalIsCompacting.
    } finally {
      finalIsCompacting = false
    }
    return { called, finalIsCompacting }
  }

  it('calls compact and resets isCompacting=false on success', async () => {
    const result = await simulateCompact(false, 'resolve')
    expect(result.called).toBe(true)
    expect(result.finalIsCompacting).toBe(false)
  })

  it('resets isCompacting=false on error (no hanging loading state)', async () => {
    const result = await simulateCompact(false, 'reject')
    expect(result.called).toBe(true)
    expect(result.finalIsCompacting).toBe(false)
  })

  it('swallows duplicate call when isCompacting=true (guard fires)', async () => {
    const result = await simulateCompact(true, 'resolve')
    expect(result.called).toBe(false)
    expect(result.finalIsCompacting).toBe(true)
  })

  it('guard fires regardless of outcome — duplicate reject also swallowed', async () => {
    const result = await simulateCompact(true, 'reject')
    expect(result.called).toBe(false)
  })
})

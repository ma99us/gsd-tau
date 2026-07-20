/**
 * Unit tests for ConfirmModal pure helper functions.
 *
 * Tests cover only the exported pure function — no React rendering is needed
 * because the helper contains zero JSX or side-effects.
 *
 * Negative-test coverage:
 *   - buildConfirmResponse: both boolean branches, return shape, value identity
 */
import { describe, expect, it } from 'vitest'
import { buildConfirmResponse } from './ConfirmModal'

// ── buildConfirmResponse ──────────────────────────────────────────────────────

describe('buildConfirmResponse', () => {
  // ── Confirmed (Yes) ────────────────────────────────────────────────────────

  it('returns { confirmed: true } when called with true', () => {
    expect(buildConfirmResponse(true)).toEqual({ confirmed: true })
  })

  it('result.confirmed is exactly true (not truthy)', () => {
    const result = buildConfirmResponse(true)
    expect('confirmed' in result).toBe(true)
    if (!('confirmed' in result)) return
    expect((result as { confirmed: boolean }).confirmed).toBe(true)
  })

  // ── Denied (No) ────────────────────────────────────────────────────────────

  it('returns { confirmed: false } when called with false', () => {
    expect(buildConfirmResponse(false)).toEqual({ confirmed: false })
  })

  it('result.confirmed is exactly false (not falsy — distinguishable from null/0)', () => {
    const result = buildConfirmResponse(false)
    expect('confirmed' in result).toBe(true)
    if (!('confirmed' in result)) return
    expect((result as { confirmed: boolean }).confirmed).toBe(false)
  })

  // ── Discriminability ───────────────────────────────────────────────────────

  it('true and false produce distinct responses', () => {
    const yes = buildConfirmResponse(true)
    const no = buildConfirmResponse(false)
    expect(yes).not.toEqual(no)
  })

  it('the response key is "confirmed", not "value" or "cancelled"', () => {
    const result = buildConfirmResponse(true)
    expect(result).not.toHaveProperty('value')
    expect(result).not.toHaveProperty('cancelled')
    expect(result).toHaveProperty('confirmed')
  })

  // ── Purity ────────────────────────────────────────────────────────────────

  it('calling twice with the same argument returns equal values (pure)', () => {
    expect(buildConfirmResponse(true)).toEqual(buildConfirmResponse(true))
    expect(buildConfirmResponse(false)).toEqual(buildConfirmResponse(false))
  })

  it('never returns null (confirm always produces a definite answer)', () => {
    expect(buildConfirmResponse(true)).not.toBeNull()
    expect(buildConfirmResponse(false)).not.toBeNull()
  })
})

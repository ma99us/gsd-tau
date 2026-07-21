/**
 * Unit tests for QuotaWidget pure helper functions.
 *
 * Environment: node (no DOM). All helpers are pure functions that require no
 * React, Radix UI, or IPC — they run in the vitest Node environment directly.
 *
 * Coverage:
 *   - verdictIcon  — emoji mapping for all 5 verdict values
 *   - formatPercent — null safety, rounding, string format
 *   - formatResetDate — null safety, ISO-8601 parsing, malformed input
 *   - formatBurnRate — null safety, one decimal place
 */

import { describe, it, expect } from 'vitest'
import { verdictIcon, formatPercent, formatResetDate, formatBurnRate } from './QuotaWidget'
import type { QuotaVerdict } from '../../shared/types'

// ── verdictIcon ───────────────────────────────────────────────────────────────

describe('verdictIcon', () => {
  it('returns ✅ for safe', () => {
    expect(verdictIcon('safe')).toBe('✅')
  })

  it('returns ⚠️ for tight', () => {
    expect(verdictIcon('tight')).toBe('⚠️')
  })

  it('returns 🔴 for overage', () => {
    expect(verdictIcon('overage')).toBe('🔴')
  })

  it('returns ❌ for runout', () => {
    expect(verdictIcon('runout')).toBe('❌')
  })

  it('returns — for unknown', () => {
    expect(verdictIcon('unknown')).toBe('—')
  })

  it('covers all QuotaVerdict values', () => {
    const verdicts: QuotaVerdict[] = ['safe', 'tight', 'overage', 'runout', 'unknown']
    for (const v of verdicts) {
      expect(verdictIcon(v)).toBeTruthy()
    }
  })
})

// ── formatPercent ─────────────────────────────────────────────────────────────

describe('formatPercent', () => {
  it('returns — for null', () => {
    expect(formatPercent(null)).toBe('—')
  })

  it('formats an integer percentage correctly', () => {
    expect(formatPercent(78)).toBe('78%')
  })

  it('formats zero as 0%', () => {
    expect(formatPercent(0)).toBe('0%')
  })

  it('formats 100 as 100%', () => {
    expect(formatPercent(100)).toBe('100%')
  })

  it('rounds fractional percentages to nearest integer', () => {
    expect(formatPercent(78.4)).toBe('78%')
    expect(formatPercent(78.6)).toBe('79%')
  })

  it('rounds 0.5 up', () => {
    expect(formatPercent(50.5)).toBe('51%')
  })

  it('always suffixes with %', () => {
    expect(formatPercent(10)).toMatch(/%$/)
    expect(formatPercent(99)).toMatch(/%$/)
  })
})

// ── formatResetDate ───────────────────────────────────────────────────────────

describe('formatResetDate', () => {
  it('returns — for null', () => {
    expect(formatResetDate(null)).toBe('—')
  })

  it('returns — for empty string', () => {
    expect(formatResetDate('')).toBe('—')
  })

  it('produces a non-empty string for a valid ISO-8601 date', () => {
    // Use a fixed date; toLocaleDateString varies by locale so we only
    // assert the result is a non-empty string without null/undefined.
    const result = formatResetDate('2025-08-01T00:00:00Z')
    expect(result).toBeTruthy()
    expect(result).not.toBe('—')
  })

  it('does not throw for a malformed date string', () => {
    // Invalid dates return NaN from Date ctor — the implementation returns
    // the raw string as a fallback rather than throwing.
    expect(() => formatResetDate('not-a-date')).not.toThrow()
  })

  it('returns a string for any non-null, non-empty input', () => {
    const result = formatResetDate('2026-01-15')
    expect(typeof result).toBe('string')
  })
})

// ── formatBurnRate ────────────────────────────────────────────────────────────

describe('formatBurnRate', () => {
  it('returns — for null', () => {
    expect(formatBurnRate(null)).toBe('—')
  })

  it('formats an integer to one decimal place', () => {
    expect(formatBurnRate(42)).toBe('42.0')
  })

  it('formats zero as 0.0', () => {
    expect(formatBurnRate(0)).toBe('0.0')
  })

  it('formats a fractional value to one decimal place', () => {
    expect(formatBurnRate(12.56)).toBe('12.6')
  })

  it('rounds at the first decimal place', () => {
    expect(formatBurnRate(3.14159)).toBe('3.1')
    expect(formatBurnRate(3.95)).toBe('4.0')
  })

  it('handles large values', () => {
    expect(formatBurnRate(1000.0)).toBe('1000.0')
  })

  it('always produces exactly one decimal place', () => {
    const result = formatBurnRate(7)
    const parts = result.split('.')
    expect(parts).toHaveLength(2)
    expect(parts[1]).toHaveLength(1)
  })
})

/**
 * Unit tests for TabBar pure helpers.
 *
 * These tests cover the exported `truncateDisplayName` helper and
 * boundary / negative scenarios that don't require a DOM.
 */
import { describe, it, expect } from 'vitest'
import { truncateDisplayName } from './TabBar'

describe('truncateDisplayName', () => {
  it('returns the string unchanged when at or below 24 chars', () => {
    expect(truncateDisplayName('')).toBe('')
    expect(truncateDisplayName('abc')).toBe('abc')
    expect(truncateDisplayName('a'.repeat(24))).toBe('a'.repeat(24))
  })

  it('truncates to 24 chars with an ellipsis when over the limit', () => {
    const result = truncateDisplayName('a'.repeat(25))
    // 23 chars + '…' = length 24
    expect(result).toHaveLength(24)
    expect(result.endsWith('…')).toBe(true)
  })

  it('truncates exactly at the boundary', () => {
    const input = 'x'.repeat(30)
    const result = truncateDisplayName(input)
    expect(result).toHaveLength(24)
    expect(result).toBe('x'.repeat(23) + '…')
  })

  it('respects a custom max parameter', () => {
    const result = truncateDisplayName('hello world', 8)
    expect(result).toHaveLength(8)
    expect(result).toBe('hello w…')
  })

  it('does not truncate when length equals custom max', () => {
    expect(truncateDisplayName('hello', 5)).toBe('hello')
  })

  it('handles a max of 1 (edge case)', () => {
    const result = truncateDisplayName('ab', 1)
    // length > 1, so slice(0, 0) + '…' = '…'
    expect(result).toBe('…')
    expect(result).toHaveLength(1)
  })

  // ── Negative / malformed inputs ──────────────────────────────────────────

  it('handles unicode multibyte characters without mangling', () => {
    // 12 emoji × 2 code units each = 24 code units — no truncation expected.
    const emoji24 = '😀'.repeat(12)
    expect(truncateDisplayName(emoji24)).toBe(emoji24)
  })

  it('truncates a string with emoji over the limit', () => {
    const long = '😀'.repeat(13) // 26 code units > 24
    const result = truncateDisplayName(long)
    expect(result).toHaveLength(24)
    expect(result.endsWith('…')).toBe(true)
  })

  it('handles a string consisting only of spaces', () => {
    expect(truncateDisplayName(' '.repeat(24))).toBe(' '.repeat(24))
    const result = truncateDisplayName(' '.repeat(25))
    expect(result).toHaveLength(24)
  })

  it('handles a very long display name (1000 chars)', () => {
    const result = truncateDisplayName('a'.repeat(1000))
    expect(result).toHaveLength(24)
    expect(result.endsWith('…')).toBe(true)
  })
})

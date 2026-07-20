/**
 * Unit tests for InputModal pure helper functions.
 *
 * Tests cover only the exported pure function — no React rendering is needed
 * because the helper contains zero JSX or side-effects.
 *
 * Negative-test coverage:
 *   - buildInputResponse: empty string guard, non-empty passthrough,
 *     whitespace-is-valid, special characters, long strings
 */
import { describe, expect, it } from 'vitest'
import { buildInputResponse } from './InputModal'

// ── buildInputResponse ────────────────────────────────────────────────────────

describe('buildInputResponse', () => {
  // ── Empty / null guard ─────────────────────────────────────────────────────

  it('returns null for an empty string (Submit should be disabled)', () => {
    expect(buildInputResponse('')).toBeNull()
  })

  it('does NOT return null for a string of spaces (not trimmed)', () => {
    // Passwords and other secure inputs may intentionally begin/end with spaces.
    expect(buildInputResponse('   ')).toEqual({ value: '   ' })
  })

  it('does NOT return null for a single space', () => {
    expect(buildInputResponse(' ')).toEqual({ value: ' ' })
  })

  // ── Non-empty passthrough ──────────────────────────────────────────────────

  it('returns { value } for a typical text input', () => {
    expect(buildInputResponse('hello')).toEqual({ value: 'hello' })
  })

  it('returns { value } for a single character', () => {
    expect(buildInputResponse('a')).toEqual({ value: 'a' })
  })

  it('returns { value } for a string with special characters', () => {
    const special = 'p@$$w0rd!#'
    expect(buildInputResponse(special)).toEqual({ value: special })
  })

  it('returns { value } for a string with unicode characters', () => {
    const unicode = '日本語テスト'
    expect(buildInputResponse(unicode)).toEqual({ value: unicode })
  })

  it('returns { value } preserving embedded newlines (edge case for multiline paste)', () => {
    const multiline = 'line1\nline2'
    expect(buildInputResponse(multiline)).toEqual({ value: multiline })
  })

  it('returns { value } for a very long string without truncation', () => {
    const long = 'x'.repeat(10_000)
    const result = buildInputResponse(long)
    expect(result).toEqual({ value: long })
  })

  // ── Response shape ────────────────────────────────────────────────────────

  it('the response key is "value", not "values" or "confirmed"', () => {
    const result = buildInputResponse('test')
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('values')
    expect(result).not.toHaveProperty('confirmed')
    expect(result).toHaveProperty('value')
  })

  // ── Purity ────────────────────────────────────────────────────────────────

  it('calling twice with the same argument returns equal values (pure)', () => {
    expect(buildInputResponse('hello')).toEqual(buildInputResponse('hello'))
  })

  it('the returned value string is referentially identical to the input', () => {
    const input = 'test-string'
    const result = buildInputResponse(input)
    expect(result).not.toBeNull()
    if (result && 'value' in result) {
      expect(result.value).toBe(input)
    }
  })
})

/**
 * Unit tests for FallbackModal pure helper function.
 *
 * FallbackModal is a catch-all component for unknown pi UI-request methods.
 * `buildFallbackResponse` is the only exported pure function — component
 * rendering is not tested here (no React rendering required for pure helpers).
 *
 * Negative-test coverage:
 *   - buildFallbackResponse: empty string is valid (blank ack), whitespace is
 *     preserved (not trimmed), multiline strings pass through unchanged.
 */
import { describe, expect, it } from 'vitest'
import { buildFallbackResponse } from './FallbackModal'

describe('buildFallbackResponse', () => {
  it('wraps a non-empty string in { value }', () => {
    expect(buildFallbackResponse('hello')).toEqual({ value: 'hello' })
  })

  it('wraps an empty string in { value: "" } — empty IS a valid response', () => {
    // Contrast with buildInputResponse / buildEditorResponse which return null
    // for empty. FallbackModal does not disable the Send button.
    expect(buildFallbackResponse('')).toEqual({ value: '' })
  })

  it('preserves leading and trailing whitespace (not trimmed)', () => {
    expect(buildFallbackResponse('  hello  ')).toEqual({ value: '  hello  ' })
  })

  it('preserves newlines in a multiline string', () => {
    expect(buildFallbackResponse('line1\nline2')).toEqual({ value: 'line1\nline2' })
  })

  it('handles a string of only whitespace', () => {
    expect(buildFallbackResponse('   ')).toEqual({ value: '   ' })
  })

  it('handles a string with special characters', () => {
    expect(buildFallbackResponse('{"key":"value"}')).toEqual({
      value: '{"key":"value"}',
    })
  })

  it('always returns an object with exactly the value key', () => {
    const result = buildFallbackResponse('test')
    expect(Object.keys(result)).toEqual(['value'])
  })
})

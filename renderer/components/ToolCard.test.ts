/**
 * Unit tests for ToolCard helper functions.
 *
 * These tests cover pure formatting logic only — no React rendering is needed
 * because the helpers are exported as plain functions.
 */
import { describe, expect, it } from 'vitest'
import { formatInputSummary, formatResult } from './ToolCard'

// ── formatInputSummary ────────────────────────────────────────────────────────

describe('formatInputSummary', () => {
  it('returns empty string for null input', () => {
    expect(formatInputSummary(null)).toBe('')
  })

  it('returns empty string for undefined input', () => {
    expect(formatInputSummary(undefined)).toBe('')
  })

  it('serialises a plain object to JSON', () => {
    expect(formatInputSummary({ path: 'src/index.ts' })).toBe('{"path":"src/index.ts"}')
  })

  it('serialises a string value wrapped in an object', () => {
    expect(formatInputSummary({ text: 'hello world' })).toBe('{"text":"hello world"}')
  })

  it('truncates at exactly 80 characters', () => {
    const input = { key: 'x'.repeat(200) }
    const result = formatInputSummary(input)
    expect(result.length).toBe(80)
  })

  it('does not truncate output shorter than 80 chars', () => {
    const input = { a: 1 }
    const result = formatInputSummary(input)
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result).toBe('{"a":1}')
  })

  it('serialises arrays', () => {
    expect(formatInputSummary([1, 2, 3])).toBe('[1,2,3]')
  })

  it('serialises primitive numbers', () => {
    expect(formatInputSummary(42)).toBe('42')
  })

  it('serialises primitive booleans', () => {
    expect(formatInputSummary(true)).toBe('true')
  })

  it('handles empty object', () => {
    expect(formatInputSummary({})).toBe('{}')
  })

  it('handles empty array', () => {
    expect(formatInputSummary([])).toBe('[]')
  })

  it('falls back to String() for non-serialisable values (circular ref)', () => {
    const obj: Record<string, unknown> = {}
    obj.self = obj // circular — JSON.stringify will throw
    const result = formatInputSummary(obj)
    // Should not throw; result is a non-empty string
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ── formatResult ──────────────────────────────────────────────────────────────

describe('formatResult', () => {
  it('returns empty string for null', () => {
    expect(formatResult(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatResult(undefined)).toBe('')
  })

  it('returns string values verbatim', () => {
    expect(formatResult('some output text')).toBe('some output text')
  })

  it('returns multi-line strings verbatim', () => {
    const ml = 'line one\nline two\nline three'
    expect(formatResult(ml)).toBe(ml)
  })

  it('pretty-prints plain objects', () => {
    const result = formatResult({ status: 'ok', count: 3 })
    expect(result).toBe(JSON.stringify({ status: 'ok', count: 3 }, null, 2))
  })

  it('pretty-prints arrays', () => {
    const result = formatResult([1, 2, 3])
    expect(result).toBe(JSON.stringify([1, 2, 3], null, 2))
  })

  it('pretty-prints nested objects', () => {
    const obj = { a: { b: { c: 'deep' } } }
    expect(formatResult(obj)).toBe(JSON.stringify(obj, null, 2))
  })

  it('handles number results', () => {
    expect(formatResult(0)).toBe('0')
    expect(formatResult(3.14)).toBe('3.14')
  })

  it('handles boolean results', () => {
    expect(formatResult(true)).toBe('true')
    expect(formatResult(false)).toBe('false')
  })

  it('falls back to String() for non-serialisable results (circular ref)', () => {
    const obj: Record<string, unknown> = {}
    obj.self = obj
    const result = formatResult(obj)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles empty object', () => {
    expect(formatResult({})).toBe('{}')
  })

  it('handles empty array', () => {
    expect(formatResult([])).toBe('[]')
  })
})

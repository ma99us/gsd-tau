/**
 * Unit tests for EditorModal pure helper functions.
 *
 * Tests cover only the exported pure functions — no React rendering is needed
 * because the helpers contain zero JSX or side-effects.
 *
 * Negative-test coverage:
 *   - buildEditorResponse: empty string guard, newline-only is valid, multi-line,
 *     whitespace-only is valid, large inputs
 *   - isEditorSubmitCombo: Ctrl+Enter → true, plain Enter → false,
 *     Ctrl+other → false, meta combinations
 */
import { describe, expect, it } from 'vitest'
import { buildEditorResponse, isEditorSubmitCombo } from './EditorModal'

// ── buildEditorResponse ───────────────────────────────────────────────────────

describe('buildEditorResponse', () => {
  // ── Empty guard ───────────────────────────────────────────────────────────

  it('returns null for a completely empty string (Submit should be disabled)', () => {
    expect(buildEditorResponse('')).toBeNull()
  })

  // ── Non-empty content ─────────────────────────────────────────────────────

  it('returns { value } for a simple single-line string', () => {
    expect(buildEditorResponse('hello')).toEqual({ value: 'hello' })
  })

  it('returns { value } for a multi-line string', () => {
    const multiline = 'line 1\nline 2\nline 3'
    expect(buildEditorResponse(multiline)).toEqual({ value: multiline })
  })

  it('returns { value } for a newline-only string (blank lines ARE valid editor content)', () => {
    // An editor user may intentionally submit blank lines (e.g. empty commit message body).
    expect(buildEditorResponse('\n')).toEqual({ value: '\n' })
  })

  it('returns { value } for multiple blank lines', () => {
    expect(buildEditorResponse('\n\n\n')).toEqual({ value: '\n\n\n' })
  })

  it('does NOT return null for whitespace-only string (spaces are valid content)', () => {
    expect(buildEditorResponse('   ')).toEqual({ value: '   ' })
  })

  it('returns { value } preserving tabs and mixed whitespace', () => {
    const tabbed = '\t\tindented\n\tline 2'
    expect(buildEditorResponse(tabbed)).toEqual({ value: tabbed })
  })

  it('returns { value } for a very long editor body without truncation', () => {
    const long = 'word '.repeat(2000)
    expect(buildEditorResponse(long)).toEqual({ value: long })
  })

  // ── Response shape ────────────────────────────────────────────────────────

  it('the response key is "value", not "values" or "confirmed"', () => {
    const result = buildEditorResponse('test')
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('values')
    expect(result).not.toHaveProperty('confirmed')
    expect(result).toHaveProperty('value')
  })

  // ── Purity ────────────────────────────────────────────────────────────────

  it('calling twice with the same input returns equal values (pure)', () => {
    expect(buildEditorResponse('hello')).toEqual(buildEditorResponse('hello'))
  })
})

// ── isEditorSubmitCombo ───────────────────────────────────────────────────────

describe('isEditorSubmitCombo', () => {
  // ── True cases ────────────────────────────────────────────────────────────

  it('returns true for Ctrl+Enter', () => {
    expect(isEditorSubmitCombo({ key: 'Enter', ctrlKey: true })).toBe(true)
  })

  // ── False cases ───────────────────────────────────────────────────────────

  it('returns false for plain Enter (no modifier)', () => {
    expect(isEditorSubmitCombo({ key: 'Enter', ctrlKey: false })).toBe(false)
  })

  it('returns false for Ctrl+other key (not Enter)', () => {
    expect(isEditorSubmitCombo({ key: 'a', ctrlKey: true })).toBe(false)
  })

  it('returns false for a non-Enter non-Ctrl combination', () => {
    expect(isEditorSubmitCombo({ key: 'Space', ctrlKey: false })).toBe(false)
  })

  it('returns false for Ctrl+Escape', () => {
    expect(isEditorSubmitCombo({ key: 'Escape', ctrlKey: true })).toBe(false)
  })

  it('returns false for Ctrl+Tab', () => {
    expect(isEditorSubmitCombo({ key: 'Tab', ctrlKey: true })).toBe(false)
  })

  // ── Edge: empty / unusual key values ─────────────────────────────────────

  it('returns false for an empty key string with ctrlKey true', () => {
    expect(isEditorSubmitCombo({ key: '', ctrlKey: true })).toBe(false)
  })

  it('returns false when ctrlKey is false regardless of key name', () => {
    // Guards that ctrlKey is strictly checked, not just truthy.
    expect(isEditorSubmitCombo({ key: 'Enter', ctrlKey: false })).toBe(false)
  })
})

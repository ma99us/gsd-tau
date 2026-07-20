/**
 * Unit tests for SelectModal pure helper functions.
 *
 * These tests cover only the exported pure functions — no React rendering is
 * needed because the helpers contain zero JSX or side-effects.
 *
 * Negative-test coverage:
 *   - buildSelectResponse: empty set (no selection), single vs multi discriminant
 *   - toggleOption: single replaces; multi adds/removes; immutability; edge boundaries
 */
import { describe, expect, it } from 'vitest'
import { buildSelectResponse, toggleOption } from './SelectModal'

// ── buildSelectResponse ───────────────────────────────────────────────────────

describe('buildSelectResponse', () => {
  // ── Single-select ──────────────────────────────────────────────────────────

  it('returns null when nothing is selected (single)', () => {
    expect(buildSelectResponse(new Set(), false)).toBeNull()
  })

  it('returns { value } for single-select with one item selected', () => {
    const result = buildSelectResponse(new Set(['Option A']), false)
    expect(result).toEqual({ value: 'Option A' })
  })

  it('single-select: uses the first Set entry when set unexpectedly contains multiple items', () => {
    // In practice the UI enforces single selection, but this guards the helper.
    const result = buildSelectResponse(new Set(['Alpha', 'Beta']), false)
    expect(result).toEqual({ value: 'Alpha' })
  })

  it('single-select: option with special characters round-trips correctly', () => {
    const result = buildSelectResponse(new Set(['Option "quoted" value']), false)
    expect(result).toEqual({ value: 'Option "quoted" value' })
  })

  // ── Multi-select ───────────────────────────────────────────────────────────

  it('returns null when nothing is selected (multi)', () => {
    expect(buildSelectResponse(new Set(), true)).toBeNull()
  })

  it('returns { values } for multi-select with one item selected', () => {
    const result = buildSelectResponse(new Set(['Alpha']), true)
    expect(result).toEqual({ values: ['Alpha'] })
  })

  it('returns { values } for multi-select with multiple items selected', () => {
    const result = buildSelectResponse(new Set(['A', 'B', 'C']), true)
    expect(result).toEqual({ values: ['A', 'B', 'C'] })
  })

  it('multi-select: preserves insertion order from the Set', () => {
    // Set iteration order is insertion order in JS.
    const result = buildSelectResponse(new Set(['Z', 'A', 'M']), true)
    expect(result).toEqual({ values: ['Z', 'A', 'M'] })
  })
})

// ── toggleOption ──────────────────────────────────────────────────────────────

describe('toggleOption', () => {
  // ── Single-select: always replaces ────────────────────────────────────────

  it('single-select: selects a new option, replacing the previous one', () => {
    const result = toggleOption(new Set(['old']), 'new', false)
    expect(result).toEqual(new Set(['new']))
  })

  it('single-select: re-selecting the same option keeps it selected', () => {
    const result = toggleOption(new Set(['same']), 'same', false)
    expect(result).toEqual(new Set(['same']))
  })

  it('single-select: selecting from an empty set produces a singleton', () => {
    const result = toggleOption(new Set(), 'Option A', false)
    expect(result).toEqual(new Set(['Option A']))
  })

  it('single-select: collapses a multi-item set to just the chosen option', () => {
    // Guards against state corruption where set had multiple items.
    const result = toggleOption(new Set(['A', 'B', 'C']), 'B', false)
    expect(result).toEqual(new Set(['B']))
  })

  // ── Multi-select: toggles ──────────────────────────────────────────────────

  it('multi-select: adds option when not present', () => {
    const result = toggleOption(new Set(['A']), 'B', true)
    expect(result).toEqual(new Set(['A', 'B']))
  })

  it('multi-select: removes option when already present', () => {
    const result = toggleOption(new Set(['A', 'B']), 'A', true)
    expect(result).toEqual(new Set(['B']))
  })

  it('multi-select: adding to an empty set works', () => {
    const result = toggleOption(new Set(), 'X', true)
    expect(result).toEqual(new Set(['X']))
  })

  it('multi-select: removing the last item results in an empty set', () => {
    const result = toggleOption(new Set(['only']), 'only', true)
    expect(result).toEqual(new Set())
  })

  it('multi-select: toggling an absent option does not affect other items', () => {
    const result = toggleOption(new Set(['A', 'B']), 'C', true)
    expect(result).toEqual(new Set(['A', 'B', 'C']))
  })

  // ── Immutability ───────────────────────────────────────────────────────────

  it('never mutates the original set (single-select)', () => {
    const original = new Set(['A'])
    toggleOption(original, 'B', false)
    expect(original).toEqual(new Set(['A']))
  })

  it('never mutates the original set (multi-select add)', () => {
    const original = new Set(['A', 'B'])
    toggleOption(original, 'C', true)
    expect(original).toEqual(new Set(['A', 'B']))
  })

  it('never mutates the original set (multi-select remove)', () => {
    const original = new Set(['A', 'B'])
    toggleOption(original, 'A', true)
    expect(original).toEqual(new Set(['A', 'B']))
  })
})

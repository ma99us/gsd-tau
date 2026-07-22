import { describe, it, expect } from 'vitest'
import { fuzzyScore } from './fuzzyMatch'

describe('fuzzyScore', () => {
  // ── Roadmap assertion ──────────────────────────────────────────────────────

  it('scores cp:compact-context higher than cp:open-project (roadmap assertion)', () => {
    // 'cp' is a subsequence of 'compact context' (c@0, p@3)
    // 'cp' is NOT a subsequence of 'open project' (c comes after the only p) → -Infinity
    expect(fuzzyScore('cp', 'compact context')).toBeGreaterThan(
      fuzzyScore('cp', 'open project'),
    )
  })

  // ── Non-match / empty edge cases ──────────────────────────────────────────

  it('returns -Infinity when query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'abc')).toBe(-Infinity)
    expect(fuzzyScore('ba', 'abc')).toBe(-Infinity) // wrong order
    expect(fuzzyScore('cp', 'open project')).toBe(-Infinity)
  })

  it('returns 0 for an empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
    expect(fuzzyScore('', '')).toBe(0)
  })

  it('returns -Infinity for non-empty query on empty candidate', () => {
    expect(fuzzyScore('a', '')).toBe(-Infinity)
    expect(fuzzyScore('abc', '')).toBe(-Infinity)
  })

  it('returns -Infinity when query is longer than candidate and cannot match', () => {
    expect(fuzzyScore('abcde', 'ab')).toBe(-Infinity)
  })

  // ── Case-insensitivity ────────────────────────────────────────────────────

  it('is case-insensitive for query', () => {
    expect(fuzzyScore('CP', 'compact context')).toBe(
      fuzzyScore('cp', 'compact context'),
    )
  })

  it('is case-insensitive for candidate', () => {
    expect(fuzzyScore('cp', 'Compact Context')).toBe(
      fuzzyScore('cp', 'compact context'),
    )
  })

  // ── Word-boundary bonus ───────────────────────────────────────────────────

  it('scores a match at the start of the string higher than mid-word', () => {
    // 'a' at position 0 (boundary) vs 'a' at position 1 (mid-word in 'banana')
    const atStart   = fuzzyScore('a', 'apple')   // +1 +3 boundary
    const midWord   = fuzzyScore('a', 'banana')  // +1, no boundary
    expect(atStart).toBeGreaterThan(midWord)
  })

  it('scores a match after a space higher than mid-word', () => {
    // 'c' at word boundary (after space) in 'open context' vs mid-word in 'optics'
    const afterSpace = fuzzyScore('c', 'open context') // c at index 5, after ' '
    const midWordC   = fuzzyScore('c', 'optics')       // c at index 4, after 't'
    expect(afterSpace).toBeGreaterThan(midWordC)
  })

  it('treats hyphen and underscore as word separators', () => {
    const afterHyphen     = fuzzyScore('b', 'a-b')   // b after '-'
    const afterUnderscore = fuzzyScore('b', 'a_b')   // b after '_'
    const midWordB        = fuzzyScore('b', 'abc')   // b at index 1, after 'a'
    expect(afterHyphen).toBeGreaterThan(midWordB)
    expect(afterUnderscore).toBeGreaterThan(midWordB)
  })

  // ── Consecutive bonus ─────────────────────────────────────────────────────

  it('scores consecutive matches higher than non-consecutive', () => {
    // 'ab' consecutive in 'abc' vs skipped in 'axb'
    const consecutive    = fuzzyScore('ab', 'abc')  // a@0 b@1 consecutive
    const nonConsecutive = fuzzyScore('ab', 'axb')  // a@0 b@2 non-consecutive
    expect(consecutive).toBeGreaterThan(nonConsecutive)
  })

  // ── Position penalty ──────────────────────────────────────────────────────

  it('prefers earlier matches over later ones', () => {
    // 'a' at index 0 vs 'a' at the end
    const early = fuzzyScore('a', 'abc')   // a@0
    const late  = fuzzyScore('a', 'xxxa')  // a@3
    expect(early).toBeGreaterThan(late)
  })

  // ── Positive match score ──────────────────────────────────────────────────

  it('returns a positive score for any valid subsequence match', () => {
    expect(fuzzyScore('a', 'a')).toBeGreaterThan(0)
    expect(fuzzyScore('abc', 'abc')).toBeGreaterThan(0)
    expect(fuzzyScore('cp', 'compact context')).toBeGreaterThan(0)
  })

  // ── Multi-word queries ────────────────────────────────────────────────────

  it('handles a multi-char query spanning multiple words', () => {
    // 'oc' in 'open context': o@0 (boundary), c@5 (boundary) → two word-boundary bonuses
    const score = fuzzyScore('oc', 'open context')
    expect(score).toBeGreaterThan(0)
  })

  it('multi-char query with both chars at word boundaries scores high', () => {
    // 'oc' both at boundaries in 'open context' vs both mid-word in 'books'
    const bothBoundary = fuzzyScore('oc', 'open context')  // o@0 boundary, c@5 boundary
    const noBoundary   = fuzzyScore('oc', 'locomotive')     // o@1 mid, c@4 mid
    expect(bothBoundary).toBeGreaterThan(noBoundary)
  })
})

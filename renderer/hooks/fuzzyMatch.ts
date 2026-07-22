/**
 * fuzzyMatch.ts — hand-rolled fuzzy scorer for the command palette.
 *
 * Returns a numeric score (higher = better match).
 * Returns -Infinity when `query` is not a subsequence of `candidate`.
 * Returns 0 for an empty query.
 *
 * Scoring rules (greedy, left-to-right):
 *   +1    base for each matched character
 *   +3    word-boundary bonus (match at index 0 or after ' ', '-', '_')
 *   +2    consecutive bonus (match immediately follows the previous match)
 *   -0.01 × position   small position penalty (earlier matches preferred)
 */

const WORD_BOUNDARY_BONUS = 3
const CONSECUTIVE_BONUS   = 2
const BASE_SCORE          = 1
const POSITION_PENALTY    = 0.01

/** Characters that start a new word token. */
function isWordSeparator(ch: string): boolean {
  return ch === ' ' || ch === '-' || ch === '_'
}

/**
 * Compute a fuzzy match score for `query` against `candidate`.
 *
 * Both strings are compared case-insensitively.
 *
 * @returns A numeric score, -Infinity on no-match, 0 on empty query.
 */
export function fuzzyScore(query: string, candidate: string): number {
  if (query.length === 0) return 0
  if (candidate.length === 0) return -Infinity

  const q = query.toLowerCase()
  const c = candidate.toLowerCase()

  // ── 1. Subsequence check ────────────────────────────────────────────────────
  let qi = 0
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (q[qi] === c[ci]) qi++
  }
  if (qi < q.length) return -Infinity

  // ── 2. Greedy scoring pass ──────────────────────────────────────────────────
  let score     = 0
  let lastMatch = -1
  qi = 0

  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (q[qi] !== c[ci]) continue

    const prevCh           = ci > 0 ? c[ci - 1] : ''
    const isWordBoundary   = ci === 0 || isWordSeparator(prevCh)
    const isConsecutive    = lastMatch === ci - 1

    score += BASE_SCORE
    if (isWordBoundary) score += WORD_BOUNDARY_BONUS
    if (isConsecutive)  score += CONSECUTIVE_BONUS
    score -= ci * POSITION_PENALTY

    lastMatch = ci
    qi++
  }

  return score
}

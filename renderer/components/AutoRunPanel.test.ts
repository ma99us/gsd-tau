/**
 * Unit tests for AutoRunPanel pure exported helpers.
 *
 * Runs in the Node vitest environment — no DOM / jsdom required.
 * All four helpers are deterministic and side-effect free; tests pin the
 * optional `nowMs` argument to avoid time-dependence.
 */
import { describe, it, expect } from 'vitest'
import {
  statusIcon,
  formatCost,
  formatElapsed,
  computePanelFooter,
} from './AutoRunPanel'
import type { GsdMilestone, GsdNodeStatus } from '@shared/types'

// ── statusIcon ────────────────────────────────────────────────────────────────

describe('statusIcon', () => {
  it('returns ✓ for complete', () => {
    expect(statusIcon('complete')).toBe('✓')
  })

  it('returns ▶ for in-progress', () => {
    expect(statusIcon('in-progress')).toBe('▶')
  })

  it('returns — for skipped', () => {
    expect(statusIcon('skipped')).toBe('—')
  })

  it('returns ○ for pending', () => {
    expect(statusIcon('pending')).toBe('○')
  })

  // ── Negative: exhaustiveness guard ───────────────────────────────────────
  // An unknown string value that bypasses TypeScript (e.g. a future pi version)
  // must not throw — it falls through to the default branch and returns '?'.
  it('returns ? for an unknown status value (runtime guard)', () => {
    expect(statusIcon('future-status' as GsdNodeStatus)).toBe('?')
  })

  it('returns ? for an empty string (runtime guard)', () => {
    expect(statusIcon('' as GsdNodeStatus)).toBe('?')
  })
})

// ── formatCost ────────────────────────────────────────────────────────────────

describe('formatCost', () => {
  it('formats zero as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  it('formats a whole-dollar amount with two decimal places', () => {
    expect(formatCost(100)).toBe('$100.00')
  })

  it('formats a value with exactly 2 decimal places unchanged', () => {
    expect(formatCost(1.50)).toBe('$1.50')
  })

  it('rounds to 2 decimal places via toFixed semantics', () => {
    // 1.234 → truncates to $1.23
    expect(formatCost(1.234)).toBe('$1.23')
  })

  it('formats a sub-cent amount that rounds down to $0.00', () => {
    expect(formatCost(0.001)).toBe('$0.00')
  })

  it('formats a value that rounds up at the third decimal', () => {
    // 0.006 → toFixed(2) → "0.01"
    expect(formatCost(0.006)).toBe('$0.01')
  })
})

// ── formatElapsed ─────────────────────────────────────────────────────────────

describe('formatElapsed', () => {
  // Deterministic base: 2024-01-01T00:00:00.000Z
  const BASE = new Date('2024-01-01T00:00:00.000Z').getTime()

  // ── Null / invalid inputs ─────────────────────────────────────────────────

  it('returns — when startedAt is null', () => {
    expect(formatElapsed(null, BASE)).toBe('—')
  })

  it('returns — for an invalid ISO string (NaN timestamp)', () => {
    expect(formatElapsed('not-a-date', BASE)).toBe('—')
  })

  it('returns — for an empty string', () => {
    expect(formatElapsed('', BASE)).toBe('—')
  })

  // ── Negative: future startedAt (clamp to 0s) ─────────────────────────────
  it('returns 0s when startedAt is in the future (negative elapsed is clamped)', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE - 10_000)).toBe('0s')
  })

  // ── Sub-minute: Ns ────────────────────────────────────────────────────────

  it('returns 0s when nowMs equals startedAt exactly', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE)).toBe('0s')
  })

  it('returns Ns for 1 second elapsed', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 1_000)).toBe('1s')
  })

  it('returns Ns for 42 seconds elapsed', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 42_000)).toBe('42s')
  })

  it('returns 59s at exactly one second before 1 minute', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 59_000)).toBe('59s')
  })

  // ── Minute range: Xm Ys ──────────────────────────────────────────────────

  it('returns 1m 0s at exactly 60 seconds', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 60_000)).toBe('1m 0s')
  })

  it('returns 1m 23s for 83 seconds', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 83_000)).toBe('1m 23s')
  })

  it('returns 59m 59s at one second before 1 hour', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 3_599_000)).toBe('59m 59s')
  })

  // ── Hour range: Xh Ym ────────────────────────────────────────────────────

  it('returns 1h 0m at exactly 1 hour', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 3_600_000)).toBe('1h 0m')
  })

  it('returns 1h 2m for 3723 seconds (1h 2m 3s — seconds are dropped)', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 3_723_000)).toBe('1h 2m')
  })

  it('returns 2h 30m for 9000 seconds', () => {
    expect(formatElapsed('2024-01-01T00:00:00.000Z', BASE + 9_000_000)).toBe('2h 30m')
  })

  // ── Default nowMs ─────────────────────────────────────────────────────────
  // Exercises the default parameter branch without pinning time — just checks
  // the return value is a non-empty string that does not throw.
  it('uses Date.now() as default nowMs and does not throw', () => {
    const result = formatElapsed(new Date(Date.now() - 5_000).toISOString())
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ── computePanelFooter ────────────────────────────────────────────────────────

describe('computePanelFooter', () => {
  const BASE = new Date('2024-06-15T12:00:00.000Z').getTime()

  // ── Null milestone ────────────────────────────────────────────────────────

  it('returns placeholder labels when milestone is null', () => {
    expect(computePanelFooter(null, BASE)).toEqual({
      costLabel: '$0.00',
      elapsedLabel: '—',
    })
  })

  it('returns placeholder labels when called without nowMs and milestone is null', () => {
    const result = computePanelFooter(null)
    expect(result.costLabel).toBe('$0.00')
    expect(result.elapsedLabel).toBe('—')
  })

  // ── Live milestone ────────────────────────────────────────────────────────

  it('delegates costLabel to formatCost and elapsedLabel to formatElapsed', () => {
    const milestone: GsdMilestone = {
      id: 'M007',
      title: 'Auto-Run Panel',
      status: 'in-progress',
      slices: [],
      cumulativeCostUsd: 2.50,
      autoStartedAt: '2024-06-15T12:00:00.000Z',
    }
    // nowMs = BASE + 90_000 → 1m 30s elapsed
    const result = computePanelFooter(milestone, BASE + 90_000)
    expect(result.costLabel).toBe('$2.50')
    expect(result.elapsedLabel).toBe('1m 30s')
  })

  it('returns — for elapsedLabel when autoStartedAt is null', () => {
    const milestone: GsdMilestone = {
      id: 'M007',
      title: 'Test',
      status: 'pending',
      slices: [],
      cumulativeCostUsd: 0,
      autoStartedAt: null,
    }
    const result = computePanelFooter(milestone, BASE)
    expect(result.costLabel).toBe('$0.00')
    expect(result.elapsedLabel).toBe('—')
  })

  it('reflects non-zero cost accurately', () => {
    const milestone: GsdMilestone = {
      id: 'M001',
      title: 'Expensive Run',
      status: 'complete',
      slices: [],
      cumulativeCostUsd: 12.34,
      autoStartedAt: null,
    }
    expect(computePanelFooter(milestone, BASE).costLabel).toBe('$12.34')
  })

  it('uses Date.now() as default nowMs and does not throw', () => {
    const milestone: GsdMilestone = {
      id: 'M001',
      title: 'T',
      status: 'complete',
      slices: [],
      cumulativeCostUsd: 1.50,
      autoStartedAt: new Date(Date.now() - 5_000).toISOString(),
    }
    const result = computePanelFooter(milestone)
    expect(result.costLabel).toBe('$1.50')
    // elapsed ≈ 5s — just confirm it's a non-empty, non-placeholder string
    expect(result.elapsedLabel).not.toBe('—')
    expect(result.elapsedLabel).toMatch(/\d/)
  })

  // ── Negative: invalid autoStartedAt propagates — from formatElapsed ───────
  it('returns — for elapsedLabel when autoStartedAt is an invalid timestamp', () => {
    const milestone: GsdMilestone = {
      id: 'M001',
      title: 'T',
      status: 'in-progress',
      slices: [],
      cumulativeCostUsd: 0.50,
      autoStartedAt: 'INVALID_DATE',
    }
    const result = computePanelFooter(milestone, BASE)
    expect(result.costLabel).toBe('$0.50')
    expect(result.elapsedLabel).toBe('—')
  })
})

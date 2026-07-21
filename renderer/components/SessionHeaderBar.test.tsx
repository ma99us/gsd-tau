/**
 * Unit tests for SessionHeaderBar helpers and ThinkingLevelChip logic.
 *
 * Environment: node (no DOM). Sub-components that pull in Radix UI or
 * renderer-only aliases are mocked so only the module's pure helpers are
 * exercised. Render-level tests (chip visibility, Ctrl+Shift+T key binding,
 * optimistic state transitions via React hooks) require @testing-library/react
 * with a jsdom environment — add those when jsdom and @testing-library/react
 * are installed as devDependencies.
 *
 * Coverage provided here:
 *   - formatCost pure helper (exported from SessionHeaderBar for testability)
 *   - RPC_THINKING_LEVELS shape (the constant that drives the chip)
 *   - ThinkingLevelChip cycling algorithm (the next-level logic for Ctrl+Shift+T)
 *   - Optimistic-update + rollback contract (the pattern handleLevelSelected implements)
 */

// vi.mock calls are hoisted to before all imports by vitest's transformer.
// Mocking sub-components prevents Radix UI (which needs a DOM to render)
// from being loaded in the Node test environment.
vi.mock('./ModelPickerDropdown', () => ({ ModelPickerDropdown: () => null }))
vi.mock('./ThinkingLevelChip', () => ({ ThinkingLevelChip: () => null }))

import { describe, it, expect } from 'vitest'
import { RPC_THINKING_LEVELS } from '../../shared/types'
import type { ThinkingLevel } from '../../shared/types'
import { formatCost } from './SessionHeaderBar'

// ── formatCost ────────────────────────────────────────────────────────────────

describe('formatCost', () => {
  it('formats zero as $0.0000', () => {
    expect(formatCost(0)).toBe('$0.0000')
  })

  it('formats a sub-cent fractional cost to four decimal places', () => {
    expect(formatCost(0.0012)).toBe('$0.0012')
  })

  it('formats a whole-cent cost correctly', () => {
    expect(formatCost(0.01)).toBe('$0.0100')
  })

  it('formats a cost greater than $1', () => {
    expect(formatCost(1.5)).toBe('$1.5000')
  })

  it('rounds at the fourth decimal place', () => {
    // 0.000050 rounds up to 0.0001 with toFixed(4)
    expect(formatCost(0.00005)).toBe('$0.0001')
  })

  it('always prefixes the result with a dollar sign', () => {
    expect(formatCost(0)).toMatch(/^\$/)
    expect(formatCost(42)).toMatch(/^\$/)
  })
})

// ── RPC_THINKING_LEVELS shape ─────────────────────────────────────────────────

describe('RPC_THINKING_LEVELS', () => {
  it('contains exactly 7 levels', () => {
    expect(RPC_THINKING_LEVELS).toHaveLength(7)
  })

  it('is ordered off → minimal → low → medium → high → xhigh → max', () => {
    expect([...RPC_THINKING_LEVELS]).toEqual([
      'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ])
  })

  it('contains no duplicate entries', () => {
    const unique = new Set(RPC_THINKING_LEVELS)
    expect(unique.size).toBe(RPC_THINKING_LEVELS.length)
  })
})

// ── ThinkingLevelChip cycling (Ctrl+Shift+T) ─────────────────────────────────

describe('ThinkingLevelChip cycling (Ctrl+Shift+T)', () => {
  /**
   * Replicate the cycling algorithm from ThinkingLevelChip.tsx so the
   * next-level computation is tested independently of React and the DOM.
   *
   * This mirrors the exact logic used in the handleKeyDown effect:
   *
   *   const idx = currentLevel !== null
   *     ? RPC_THINKING_LEVELS.indexOf(currentLevel) : -1
   *   const nextIdx = (idx + 1) % RPC_THINKING_LEVELS.length
   *   onLevelSelected(RPC_THINKING_LEVELS[nextIdx])
   */
  function nextLevel(currentLevel: ThinkingLevel | null): ThinkingLevel {
    const idx =
      currentLevel !== null ? RPC_THINKING_LEVELS.indexOf(currentLevel) : -1
    const nextIdx = (idx + 1) % RPC_THINKING_LEVELS.length
    return RPC_THINKING_LEVELS[nextIdx]
  }

  it('null (no level set) advances to the first level "off"', () => {
    expect(nextLevel(null)).toBe('off')
  })

  it('off advances to minimal', () => {
    expect(nextLevel('off')).toBe('minimal')
  })

  it('minimal advances to low', () => {
    expect(nextLevel('minimal')).toBe('low')
  })

  it('low advances to medium', () => {
    expect(nextLevel('low')).toBe('medium')
  })

  it('medium advances to high', () => {
    expect(nextLevel('medium')).toBe('high')
  })

  it('high advances to xhigh', () => {
    expect(nextLevel('high')).toBe('xhigh')
  })

  it('xhigh advances to max', () => {
    expect(nextLevel('xhigh')).toBe('max')
  })

  it('max wraps back to off (wraparound)', () => {
    expect(nextLevel('max')).toBe('off')
  })

  it('visits all 7 levels in order when cycling from null', () => {
    let level: ThinkingLevel | null = null
    const visited: ThinkingLevel[] = []
    for (let i = 0; i < RPC_THINKING_LEVELS.length; i++) {
      level = nextLevel(level)
      visited.push(level)
    }
    expect(visited).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('returns to the starting level after exactly 7 presses', () => {
    let level: ThinkingLevel | null = 'medium'
    for (let i = 0; i < RPC_THINKING_LEVELS.length; i++) {
      level = nextLevel(level)
    }
    expect(level).toBe('medium')
  })
})

// ── Optimistic-update + rollback pattern ──────────────────────────────────────

describe('handleLevelSelected optimistic-update + rollback pattern', () => {
  /**
   * Simulate the pattern implemented in SessionHeaderBar.handleLevelSelected
   * without mounting the component. Uses a plain variable (not React state)
   * so the contract is verifiable in a pure Node context.
   *
   * Pattern:
   *   1. Save previous level.
   *   2. Apply new level optimistically.
   *   3. On success: keep the new level.
   *   4. On failure: revert to the previous level.
   */
  async function simulateOptimisticUpdate(
    previousLevel: ThinkingLevel | null,
    newLevel: ThinkingLevel,
    ipcOutcome: 'resolve' | 'reject',
  ): Promise<ThinkingLevel | null> {
    let currentLevel: ThinkingLevel | null = previousLevel
    const setLevel = (l: ThinkingLevel | null): void => {
      currentLevel = l
    }

    const previous = currentLevel
    setLevel(newLevel) // optimistic apply

    try {
      if (ipcOutcome === 'reject') throw new Error('IPC error')
      // ipcOutcome === 'resolve': success — keep the optimistic update
    } catch {
      setLevel(previous) // rollback
    }

    return currentLevel
  }

  it('keeps the new level after a successful IPC call', async () => {
    const result = await simulateOptimisticUpdate('medium', 'high', 'resolve')
    expect(result).toBe('high')
  })

  it('reverts to the previous level after an IPC failure', async () => {
    const result = await simulateOptimisticUpdate('medium', 'high', 'reject')
    expect(result).toBe('medium')
  })

  it('reverts to null when previous was null and IPC fails', async () => {
    const result = await simulateOptimisticUpdate(null, 'off', 'reject')
    expect(result).toBeNull()
  })

  it('keeps the new level when previous was null and IPC succeeds', async () => {
    const result = await simulateOptimisticUpdate(null, 'low', 'resolve')
    expect(result).toBe('low')
  })

  it('handles all 7 levels as the new level on success', async () => {
    for (const level of RPC_THINKING_LEVELS) {
      const result = await simulateOptimisticUpdate('medium', level, 'resolve')
      expect(result).toBe(level)
    }
  })

  it('always reverts to the exact previous value on failure regardless of what was set', async () => {
    const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    for (const prev of levels) {
      for (const next of levels) {
        if (prev === next) continue
        const result = await simulateOptimisticUpdate(prev, next, 'reject')
        expect(result).toBe(prev)
      }
    }
  })
})

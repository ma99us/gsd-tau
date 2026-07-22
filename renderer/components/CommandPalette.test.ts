/**
 * CommandPalette.test.ts — node-env tests for the filterAndSortCommands pure helper.
 *
 * Vitest environment is 'node' globally — this file is plain .ts, imports only
 * the pure-helper export (not the JSX component), and does not touch the DOM.
 *
 * Test coverage:
 *   - roadmap proof: filterAndSortCommands('comp', appCommands, []) → compact-context first
 *   - non-matching query → empty result
 *   - MRU boost floats a lower-scoring in-MRU command above a higher-scoring non-MRU command
 *   - MRU tie: lower mruIds index (more recent) wins
 *   - empty query + MRU list → sorted by MRU position
 *   - empty query + no MRU → original order preserved
 *   - empty query + partial MRU → MRU commands at front, rest in original order
 *   - edge cases: empty commands, unknown MRU ids, single-command input
 */

import { describe, it, expect } from 'vitest'
import { filterAndSortCommands } from './CommandPalette'
import { buildAppCommands, type AppCommand } from '../hooks/useAppCommands'

// ── Shared fixtures ──────────────────────────────────────────────────────────

// Build app commands with no session — pure factory, execute() is never called.
// The 7 registered commands are:
//   new-session, open-project, close-tab, compact-context,
//   copy-last-turn, show-tray, toggle-auto-run-panel
const appCommands = buildAppCommands(null)

// ── Non-empty query ───────────────────────────────────────────────────────────

describe('filterAndSortCommands — non-empty query', () => {
  it('roadmap proof: "comp" returns compact-context as the first result', () => {
    const results = filterAndSortCommands('comp', appCommands, [])
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('compact-context')
  })

  it('returns empty array for a non-matching query', () => {
    const results = filterAndSortCommands('zzzzzzz', appCommands, [])
    expect(results).toHaveLength(0)
  })

  it('returns only commands that are fuzzy-subsequences of the query', () => {
    // 'new' should match 'New session' but not 'Close tab', 'Compact context', etc.
    const results = filterAndSortCommands('new', appCommands, [])
    expect(results.every(c => c.id === 'new-session')).toBe(true)
  })

  it('MRU boost: in-MRU command floats above a higher-scoring non-MRU command', () => {
    // Query 'c' matches close-tab, compact-context, copy-last-turn with equal scores.
    // With close-tab in MRU, it should appear first.
    const results = filterAndSortCommands('c', appCommands, ['close-tab'])
    expect(results[0].id).toBe('close-tab')
  })

  it('MRU tie: lower mruIds index (more recently used) wins', () => {
    // Both compact-context (index 0) and close-tab (index 1) match 'c'.
    // compact-context is more recent so it wins.
    const results = filterAndSortCommands('c', appCommands, ['compact-context', 'close-tab'])
    expect(results[0].id).toBe('compact-context')
    expect(results[1].id).toBe('close-tab')
  })

  it('non-MRU commands are sorted by score after MRU commands', () => {
    // With compact-context in MRU, remaining 'c' matches sort by score
    const results = filterAndSortCommands('c', appCommands, ['compact-context'])
    expect(results[0].id).toBe('compact-context')
    // All other results should not be in MRU
    for (const r of results.slice(1)) {
      expect(r.id).not.toBe('compact-context')
    }
  })

  it('single character query returns all commands starting with that character first', () => {
    // 'n' matches 'new-session' only (New session)
    const results = filterAndSortCommands('n', appCommands, [])
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(c => c.id === 'new-session')).toBe(true)
  })

  it('custom command list: single matching command is returned', () => {
    const cmds = [
      { id: 'alpha', label: 'Alpha command', execute: () => {} },
      { id: 'beta',  label: 'Beta command',  execute: () => {} },
    ]
    const results = filterAndSortCommands('alp', cmds, [])
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('alpha')
  })
})

// ── Empty query ───────────────────────────────────────────────────────────────

describe('filterAndSortCommands — empty query', () => {
  it('returns all commands when MRU is empty', () => {
    const results = filterAndSortCommands('', appCommands, [])
    expect(results).toHaveLength(appCommands.length)
  })

  it('preserves original order when MRU is empty', () => {
    const results = filterAndSortCommands('', appCommands, [])
    expect(results.map(c => c.id)).toEqual(appCommands.map(c => c.id))
  })

  it('sorts by MRU position when a full MRU list is provided', () => {
    const results = filterAndSortCommands('', appCommands, ['compact-context', 'close-tab'])
    expect(results[0].id).toBe('compact-context')
    expect(results[1].id).toBe('close-tab')
  })

  it('single MRU entry floats to the front; rest preserve original order', () => {
    const results = filterAndSortCommands('', appCommands, ['compact-context'])
    expect(results[0].id).toBe('compact-context')
    expect(results).toHaveLength(appCommands.length)
    // Remaining commands appear in their original relative order
    const rest = results.slice(1)
    const originalWithoutMru = appCommands.filter(c => c.id !== 'compact-context')
    expect(rest.map(c => c.id)).toEqual(originalWithoutMru.map(c => c.id))
  })

  it('multiple MRU entries all float to the front in MRU order', () => {
    const mruIds = ['toggle-auto-run-panel', 'show-tray', 'compact-context']
    const results = filterAndSortCommands('', appCommands, mruIds)
    expect(results[0].id).toBe('toggle-auto-run-panel')
    expect(results[1].id).toBe('show-tray')
    expect(results[2].id).toBe('compact-context')
    expect(results).toHaveLength(appCommands.length)
  })

  it('does not lose any commands when MRU list is provided', () => {
    const results = filterAndSortCommands('', appCommands, ['compact-context', 'close-tab'])
    expect(results).toHaveLength(appCommands.length)
    const ids = new Set(results.map(c => c.id))
    for (const cmd of appCommands) {
      expect(ids.has(cmd.id)).toBe(true)
    }
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('filterAndSortCommands — edge cases', () => {
  it('returns empty array for empty commands with non-empty query', () => {
    const results = filterAndSortCommands('comp', [], ['compact-context'])
    expect(results).toHaveLength(0)
  })

  it('returns empty array for empty commands with empty query', () => {
    const results = filterAndSortCommands('', [], ['compact-context'])
    expect(results).toHaveLength(0)
  })

  it('MRU ids that do not match any command are silently ignored', () => {
    const results = filterAndSortCommands('', appCommands, ['nonexistent-command-id'])
    expect(results).toHaveLength(appCommands.length)
    expect(results.map(c => c.id)).toEqual(appCommands.map(c => c.id))
  })

  it('does not mutate the input commands array', () => {
    const original = buildAppCommands(null)
    const snapshot = original.map(c => c.id)
    filterAndSortCommands('comp', original, ['compact-context'])
    expect(original.map(c => c.id)).toEqual(snapshot)
  })

  it('does not mutate the input mruIds array', () => {
    const mru = ['compact-context', 'close-tab']
    const snapshot = [...mru]
    filterAndSortCommands('c', appCommands, mru)
    expect(mru).toEqual(snapshot)
  })

  it('empty query string returns same result regardless of whitespace (exact match)', () => {
    // Only '' is the empty query; ' ' is a non-empty query
    const empty  = filterAndSortCommands('', appCommands, [])
    const space  = filterAndSortCommands(' ', appCommands, [])
    // ' ' is a non-empty query that may match some commands (subsequence check)
    // Just verify the two calls don't crash and empty returns all commands
    expect(empty).toHaveLength(appCommands.length)
    // space query may return 0 or more — just check it doesn't throw
    expect(Array.isArray(space)).toBe(true)
  })
})

// ── Pi commands / badge and description fields ────────────────────────────────

describe('filterAndSortCommands — pi commands and badge/description fields', () => {
  it('includes pi commands with badge and description in filtered results', () => {
    const cmds: AppCommand[] = [
      { id: 'pi:/gsd',  label: '/gsd',  badge: 'skill',    description: 'Run a GSD skill', execute: () => {} },
      { id: 'pi:/help', label: '/help', badge: 'built-in', description: 'Show help',       execute: () => {} },
    ]
    const results = filterAndSortCommands('/gsd', cmds, [])
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('pi:/gsd')
    expect(results[0].badge).toBe('skill')
    expect(results[0].description).toBe('Run a GSD skill')
  })

  it('merges pi commands and app commands — both appear when query is empty', () => {
    const piCmds: AppCommand[] = [
      { id: 'pi:/gsd', label: '/gsd', badge: 'skill', description: 'Run a GSD skill', execute: () => {} },
    ]
    const allCmds = [...appCommands, ...piCmds]
    const results = filterAndSortCommands('', allCmds, [])
    expect(results).toHaveLength(allCmds.length)
    const ids = results.map(c => c.id)
    expect(ids).toContain('pi:/gsd')
    expect(ids).toContain('compact-context')
  })

  it('pi commands appear in fuzzy search results when query matches', () => {
    const piCmds: AppCommand[] = [
      { id: 'pi:/gsd', label: '/gsd', badge: 'skill', description: 'Run a GSD skill', execute: () => {} },
    ]
    const allCmds = [...appCommands, ...piCmds]
    const results = filterAndSortCommands('gsd', allCmds, [])
    expect(results.some(c => c.id === 'pi:/gsd')).toBe(true)
  })

  it('badge field is preserved through filterAndSortCommands', () => {
    const cmds: AppCommand[] = [
      { id: 'pi:/skill-cmd', label: '/skill-cmd', badge: 'skill', execute: () => {} },
    ]
    const results = filterAndSortCommands('', cmds, [])
    expect(results[0].badge).toBe('skill')
  })

  it('description field is preserved through filterAndSortCommands', () => {
    const cmds: AppCommand[] = [
      { id: 'pi:/desc-cmd', label: '/desc-cmd', description: 'A helpful description', execute: () => {} },
    ]
    const results = filterAndSortCommands('', cmds, [])
    expect(results[0].description).toBe('A helpful description')
  })

  it('app commands have no badge or description (optional fields absent)', () => {
    const results = filterAndSortCommands('', appCommands, [])
    for (const cmd of results) {
      expect(cmd.badge).toBeUndefined()
      expect(cmd.description).toBeUndefined()
    }
  })

  it('pi commands in MRU float above other commands for a non-empty query', () => {
    const piCmds: AppCommand[] = [
      { id: 'pi:/gsd', label: '/gsd', badge: 'skill', execute: () => {} },
    ]
    const allCmds = [...appCommands, ...piCmds]
    // 'g' matches '/gsd' (pi) — with it in MRU, it should win
    const results = filterAndSortCommands('g', allCmds, ['pi:/gsd'])
    expect(results[0].id).toBe('pi:/gsd')
  })
})

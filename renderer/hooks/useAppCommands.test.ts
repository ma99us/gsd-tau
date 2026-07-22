/**
 * Tests for renderer/hooks/useAppCommands.ts
 *
 * Exercises `buildAppCommands` — the pure factory extracted from the hook —
 * directly, so tests run in vitest node env without needing renderHook or jsdom.
 *
 * Pattern: vi.stubGlobal('gsd', mock) — matches sessions-store.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildAppCommands, type AppCommand } from './useAppCommands'

// ── Required command ids ───────────────────────────────────────────────────────

const REQUIRED_IDS = [
  'new-session',
  'open-project',
  'close-tab',
  'compact-context',
  'copy-last-turn',
  'show-tray',
  'toggle-auto-run-panel',
] as const

// ── GSD API mock factory ───────────────────────────────────────────────────────

function makeGsdMock(overrides: Record<string, unknown> = {}) {
  return {
    showFolderPicker:  vi.fn().mockResolvedValue('/chosen/path'),
    openProject:       vi.fn().mockResolvedValue('new-session-id'),
    closeSession:      vi.fn().mockResolvedValue(undefined),
    compact:           vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('buildAppCommands', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // ── Shape ──────────────────────────────────────────────────────────────────

  describe('shape', () => {
    it('returns exactly 7 commands', () => {
      const cmds = buildAppCommands(null)
      expect(cmds).toHaveLength(7)
    })

    it('includes all required ids', () => {
      const cmds = buildAppCommands(null)
      const ids = cmds.map((c: AppCommand) => c.id)
      for (const required of REQUIRED_IDS) {
        expect(ids).toContain(required)
      }
    })

    it('every command has a non-empty label', () => {
      const cmds = buildAppCommands(null)
      for (const cmd of cmds) {
        expect(typeof cmd.label).toBe('string')
        expect(cmd.label.length).toBeGreaterThan(0)
      }
    })

    it('every command has a callable execute function', () => {
      vi.stubGlobal('gsd', makeGsdMock())
      vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
      const cmds = buildAppCommands(null)
      for (const cmd of cmds) {
        expect(typeof cmd.execute).toBe('function')
      }
    })
  })

  // ── Session scope ──────────────────────────────────────────────────────────

  describe('sessionId field', () => {
    it('close-tab carries sessionId when one is provided', () => {
      const cmds = buildAppCommands('sess-1')
      const cmd = cmds.find(c => c.id === 'close-tab')!
      expect(cmd.sessionId).toBe('sess-1')
    })

    it('compact-context carries sessionId when one is provided', () => {
      const cmds = buildAppCommands('sess-1')
      const cmd = cmds.find(c => c.id === 'compact-context')!
      expect(cmd.sessionId).toBe('sess-1')
    })

    it('copy-last-turn carries sessionId when one is provided', () => {
      const cmds = buildAppCommands('sess-1')
      const cmd = cmds.find(c => c.id === 'copy-last-turn')!
      expect(cmd.sessionId).toBe('sess-1')
    })

    it('close-tab has no sessionId when sessionId is null', () => {
      const cmds = buildAppCommands(null)
      const cmd = cmds.find(c => c.id === 'close-tab')!
      expect(cmd.sessionId).toBeUndefined()
    })

    it('compact-context has no sessionId when sessionId is null', () => {
      const cmds = buildAppCommands(null)
      const cmd = cmds.find(c => c.id === 'compact-context')!
      expect(cmd.sessionId).toBeUndefined()
    })

    it('new-session never carries a sessionId', () => {
      const cmds = buildAppCommands('sess-x')
      const cmd = cmds.find(c => c.id === 'new-session')!
      expect(cmd.sessionId).toBeUndefined()
    })

    it('open-project never carries a sessionId', () => {
      const cmds = buildAppCommands('sess-x')
      const cmd = cmds.find(c => c.id === 'open-project')!
      expect(cmd.sessionId).toBeUndefined()
    })

    it('show-tray never carries a sessionId', () => {
      const cmds = buildAppCommands('sess-x')
      const cmd = cmds.find(c => c.id === 'show-tray')!
      expect(cmd.sessionId).toBeUndefined()
    })

    it('toggle-auto-run-panel never carries a sessionId', () => {
      const cmds = buildAppCommands('sess-x')
      const cmd = cmds.find(c => c.id === 'toggle-auto-run-panel')!
      expect(cmd.sessionId).toBeUndefined()
    })
  })

  // ── new-session ────────────────────────────────────────────────────────────

  describe('new-session', () => {
    it('calls showFolderPicker() then openProject() when a path is chosen', async () => {
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands(null).find(c => c.id === 'new-session')!
      await cmd.execute()

      expect(gsd.showFolderPicker).toHaveBeenCalledTimes(1)
      expect(gsd.openProject).toHaveBeenCalledWith('/chosen/path')
    })

    it('does NOT call openProject() when showFolderPicker returns null', async () => {
      const gsd = makeGsdMock({ showFolderPicker: vi.fn().mockResolvedValue(null) })
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands(null).find(c => c.id === 'new-session')!
      await cmd.execute()

      expect(gsd.openProject).not.toHaveBeenCalled()
    })
  })

  // ── open-project ───────────────────────────────────────────────────────────

  describe('open-project', () => {
    it('calls showFolderPicker() then openProject() when a path is chosen', async () => {
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands(null).find(c => c.id === 'open-project')!
      await cmd.execute()

      expect(gsd.showFolderPicker).toHaveBeenCalledTimes(1)
      expect(gsd.openProject).toHaveBeenCalledWith('/chosen/path')
    })

    it('does NOT call openProject() when showFolderPicker returns null', async () => {
      const gsd = makeGsdMock({ showFolderPicker: vi.fn().mockResolvedValue(null) })
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands(null).find(c => c.id === 'open-project')!
      await cmd.execute()

      expect(gsd.openProject).not.toHaveBeenCalled()
    })
  })

  // ── close-tab ──────────────────────────────────────────────────────────────

  describe('close-tab', () => {
    it('calls gsd().closeSession(sessionId) when sessionId is provided', async () => {
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands('sess-42').find(c => c.id === 'close-tab')!
      await cmd.execute()

      expect(gsd.closeSession).toHaveBeenCalledWith('sess-42')
    })

    it('is a no-op (does NOT call closeSession) when sessionId is null', async () => {
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands(null).find(c => c.id === 'close-tab')!
      await cmd.execute()

      expect(gsd.closeSession).not.toHaveBeenCalled()
    })
  })

  // ── compact-context ────────────────────────────────────────────────────────

  describe('compact-context', () => {
    it('calls gsd().compact(sessionId) when sessionId is provided', async () => {
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands('sess-99').find(c => c.id === 'compact-context')!
      await cmd.execute()

      expect(gsd.compact).toHaveBeenCalledWith('sess-99')
    })

    it('is a no-op (does NOT call compact) when sessionId is null', async () => {
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands(null).find(c => c.id === 'compact-context')!
      await cmd.execute()

      expect(gsd.compact).not.toHaveBeenCalled()
    })
  })

  // ── copy-last-turn ─────────────────────────────────────────────────────────

  describe('copy-last-turn', () => {
    beforeEach(() => {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      })
    })

    it('calls navigator.clipboard.writeText with injected turn text', async () => {
      const cmd = buildAppCommands('sess-1', () => 'Hello from last turn').find(c => c.id === 'copy-last-turn')!
      await cmd.execute()

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello from last turn')
    })

    it('writes an empty string when getLastTurnText is not provided', async () => {
      const cmd = buildAppCommands('sess-1').find(c => c.id === 'copy-last-turn')!
      await cmd.execute()

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('')
    })

    it('writes an empty string when getLastTurnText callback returns empty string', async () => {
      const cmd = buildAppCommands('sess-1', () => '').find(c => c.id === 'copy-last-turn')!
      await cmd.execute()

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('')
    })

    it('works without a sessionId (session-agnostic context)', async () => {
      const cmd = buildAppCommands(null, () => 'some text').find(c => c.id === 'copy-last-turn')!
      await cmd.execute()

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('some text')
    })
  })

  // ── show-tray ──────────────────────────────────────────────────────────────

  describe('show-tray', () => {
    it('calls console.warn with the expected stub message', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const cmd = buildAppCommands(null).find(c => c.id === 'show-tray')!
      cmd.execute()
      expect(warnSpy).toHaveBeenCalledWith('show-tray: not yet wired')
    })

    it('does NOT call any gsd() IPC method', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands(null).find(c => c.id === 'show-tray')!
      cmd.execute()

      expect(gsd.showFolderPicker).not.toHaveBeenCalled()
      expect(gsd.closeSession).not.toHaveBeenCalled()
    })
  })

  // ── toggle-auto-run-panel ──────────────────────────────────────────────────

  describe('toggle-auto-run-panel', () => {
    it('calls console.warn with the expected stub message', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const cmd = buildAppCommands(null).find(c => c.id === 'toggle-auto-run-panel')!
      cmd.execute()
      expect(warnSpy).toHaveBeenCalledWith('toggle-auto-run-panel: not yet wired')
    })

    it('does NOT call any gsd() IPC method', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmd = buildAppCommands(null).find(c => c.id === 'toggle-auto-run-panel')!
      cmd.execute()

      expect(gsd.showFolderPicker).not.toHaveBeenCalled()
      expect(gsd.closeSession).not.toHaveBeenCalled()
    })
  })

  // ── Negative / boundary ───────────────────────────────────────────────────

  describe('negative and boundary cases', () => {
    it('returns a fresh array on every call (not the same reference)', () => {
      const a = buildAppCommands(null)
      const b = buildAppCommands(null)
      expect(a).not.toBe(b)
    })

    it('close-tab command in null-session build does not throw on execute()', async () => {
      vi.stubGlobal('gsd', makeGsdMock())
      const cmd = buildAppCommands(null).find(c => c.id === 'close-tab')!
      await expect(cmd.execute()).resolves.toBeUndefined()
    })

    it('compact-context command in null-session build does not throw on execute()', async () => {
      vi.stubGlobal('gsd', makeGsdMock())
      const cmd = buildAppCommands(null).find(c => c.id === 'compact-context')!
      await expect(cmd.execute()).resolves.toBeUndefined()
    })

    it('getLastTurnText callback receives no arguments (zero-arity contract)', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      })
      const spy = vi.fn().mockReturnValue('text')
      const cmd = buildAppCommands('s', spy).find(c => c.id === 'copy-last-turn')!
      await cmd.execute()
      expect(spy).toHaveBeenCalledWith()
    })

    it('commands built with different sessionIds close the correct session', async () => {
      const gsd = makeGsdMock()
      vi.stubGlobal('gsd', gsd)

      const cmdA = buildAppCommands('sess-A').find(c => c.id === 'close-tab')!
      const cmdB = buildAppCommands('sess-B').find(c => c.id === 'close-tab')!

      await cmdA.execute()
      expect(gsd.closeSession).toHaveBeenLastCalledWith('sess-A')

      await cmdB.execute()
      expect(gsd.closeSession).toHaveBeenLastCalledWith('sess-B')
    })
  })
})

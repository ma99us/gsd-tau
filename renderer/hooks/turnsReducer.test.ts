import { describe, it, expect } from 'vitest'
import { turnsReducer } from './turnsReducer'
import type { Turn } from './turnsReducer'

describe('turnsReducer', () => {
  // ── RESET ───────────────────────────────────────────────────────────────────
  describe('RESET', () => {
    it('returns an empty array regardless of prior state', () => {
      const state: Turn[] = [{ id: 't1', kind: 'user', text: 'hello' }]
      expect(turnsReducer(state, { type: 'RESET' })).toEqual([])
    })

    it('is a no-op on an already-empty state', () => {
      expect(turnsReducer([], { type: 'RESET' })).toEqual([])
    })
  })

  // ── USER_TURN ───────────────────────────────────────────────────────────────
  describe('USER_TURN', () => {
    it('appends a user turn', () => {
      const result = turnsReducer([], { type: 'USER_TURN', id: 't1', text: 'hello' })
      expect(result).toEqual([{ id: 't1', kind: 'user', text: 'hello' }])
    })

    it('appends after existing turns', () => {
      const state: Turn[] = [{ id: 'a1', kind: 'assistant', items: [] }]
      const result = turnsReducer(state, { type: 'USER_TURN', id: 'u1', text: 'world' })
      expect(result).toHaveLength(2)
      expect(result[1]).toEqual({ id: 'u1', kind: 'user', text: 'world' })
    })

    it('does not mutate the original state array', () => {
      const state: Turn[] = []
      turnsReducer(state, { type: 'USER_TURN', id: 'u1', text: 'hi' })
      expect(state).toHaveLength(0)
    })
  })

  // ── AGENT_START ─────────────────────────────────────────────────────────────
  describe('AGENT_START', () => {
    it('appends an empty assistant turn', () => {
      const result = turnsReducer([], { type: 'AGENT_START', id: 'a1' })
      expect(result).toEqual([{ id: 'a1', kind: 'assistant', items: [] }])
    })
  })

  // ── TEXT_DELTA ──────────────────────────────────────────────────────────────
  describe('TEXT_DELTA', () => {
    it('creates a new assistant turn when currentAssistantId is null', () => {
      const result = turnsReducer([], {
        type: 'TEXT_DELTA',
        currentAssistantId: null,
        delta: 'Hello',
        newTurnId: 'a1',
        newItemId: 'i1',
      })
      expect(result).toEqual([
        {
          id: 'a1',
          kind: 'assistant',
          items: [{ kind: 'text', id: 'i1', content: 'Hello' }],
        },
      ])
    })

    it('appends to the trailing text item in the current assistant turn', () => {
      const state: Turn[] = [
        {
          id: 'a1',
          kind: 'assistant',
          items: [{ kind: 'text', id: 'i1', content: 'Hel' }],
        },
      ]
      const result = turnsReducer(state, {
        type: 'TEXT_DELTA',
        currentAssistantId: 'a1',
        delta: 'lo',
        newTurnId: 'a2',
        newItemId: 'i2',
      })
      const turn = result.find(t => t.id === 'a1')!
      expect(turn.kind).toBe('assistant')
      if (turn.kind === 'assistant') {
        expect(turn.items).toEqual([{ kind: 'text', id: 'i1', content: 'Hello' }])
      }
    })

    it('does not create a second text item when appending to existing text', () => {
      const state: Turn[] = [
        {
          id: 'a1',
          kind: 'assistant',
          items: [{ kind: 'text', id: 'i1', content: 'Hi' }],
        },
      ]
      const result = turnsReducer(state, {
        type: 'TEXT_DELTA',
        currentAssistantId: 'a1',
        delta: ' there',
        newTurnId: 'a2',
        newItemId: 'i2',
      })
      const turn = result.find(t => t.id === 'a1')!
      if (turn.kind === 'assistant') {
        expect(turn.items).toHaveLength(1)
        expect(turn.items[0]).toMatchObject({ content: 'Hi there' })
      }
    })

    it('adds a new text item when the last item is a tool card', () => {
      const state: Turn[] = [
        {
          id: 'a1',
          kind: 'assistant',
          items: [
            {
              kind: 'tool',
              id: 'tool1',
              toolUseId: 'tool1',
              name: 'read',
              input: {},
              pending: false,
            },
          ],
        },
      ]
      const result = turnsReducer(state, {
        type: 'TEXT_DELTA',
        currentAssistantId: 'a1',
        delta: 'Done.',
        newTurnId: 'a2',
        newItemId: 'i2',
      })
      const turn = result.find(t => t.id === 'a1')!
      if (turn.kind === 'assistant') {
        expect(turn.items).toHaveLength(2)
        expect(turn.items[1]).toEqual({ kind: 'text', id: 'i2', content: 'Done.' })
      }
    })

    it('does not modify a turn whose id does not match', () => {
      const state: Turn[] = [
        { id: 'u1', kind: 'user', text: 'hi' },
        { id: 'a1', kind: 'assistant', items: [] },
      ]
      const result = turnsReducer(state, {
        type: 'TEXT_DELTA',
        currentAssistantId: 'a1',
        delta: 'hi',
        newTurnId: 'a2',
        newItemId: 'i1',
      })
      // user turn is the same object reference (not cloned)
      expect(result[0]).toBe(state[0])
    })
  })

  // ── TOOL_USE ────────────────────────────────────────────────────────────────
  describe('TOOL_USE', () => {
    const toolItem = {
      kind: 'tool' as const,
      id: 'tool1',
      toolUseId: 'tool1',
      name: 'read',
      input: { path: 'foo.ts' },
      pending: true,
    }

    it('creates a new assistant turn when currentAssistantId is null', () => {
      const result = turnsReducer([], {
        type: 'TOOL_USE',
        currentAssistantId: null,
        item: toolItem,
        newTurnId: 'a1',
      })
      expect(result).toEqual([{ id: 'a1', kind: 'assistant', items: [toolItem] }])
    })

    it('appends a tool item to the current assistant turn', () => {
      const state: Turn[] = [
        {
          id: 'a1',
          kind: 'assistant',
          items: [{ kind: 'text', id: 'i1', content: 'Calling…' }],
        },
      ]
      const result = turnsReducer(state, {
        type: 'TOOL_USE',
        currentAssistantId: 'a1',
        item: toolItem,
        newTurnId: 'a2',
      })
      const turn = result.find(t => t.id === 'a1')!
      if (turn.kind === 'assistant') {
        expect(turn.items).toHaveLength(2)
        expect(turn.items[1]).toEqual(toolItem)
      }
    })
  })

  // ── TOOL_RESULT ─────────────────────────────────────────────────────────────
  describe('TOOL_RESULT', () => {
    it('fills result and clears pending on the matching tool item', () => {
      const state: Turn[] = [
        {
          id: 'a1',
          kind: 'assistant',
          items: [
            { kind: 'tool', id: 'tool1', toolUseId: 'tool1', name: 'read', input: {}, pending: true },
          ],
        },
      ]
      const result = turnsReducer(state, {
        type: 'TOOL_RESULT',
        toolUseId: 'tool1',
        content: 'file contents',
      })
      const turn = result.find(t => t.id === 'a1')!
      if (turn.kind === 'assistant') {
        const item = turn.items[0]
        expect(item.kind).toBe('tool')
        if (item.kind === 'tool') {
          expect(item.pending).toBe(false)
          expect(item.result).toBe('file contents')
        }
      }
    })

    it('does not touch non-matching tool items', () => {
      const state: Turn[] = [
        {
          id: 'a1',
          kind: 'assistant',
          items: [
            { kind: 'tool', id: 'tool1', toolUseId: 'tool1', name: 'read', input: {}, pending: true },
            { kind: 'tool', id: 'tool2', toolUseId: 'tool2', name: 'write', input: {}, pending: true },
          ],
        },
      ]
      const result = turnsReducer(state, {
        type: 'TOOL_RESULT',
        toolUseId: 'tool1',
        content: 'data',
      })
      const turn = result[0]
      if (turn.kind === 'assistant') {
        const item2 = turn.items[1]
        if (item2.kind === 'tool') {
          expect(item2.pending).toBe(true)
          expect(item2.result).toBeUndefined()
        }
      }
    })

    it('searches across all assistant turns', () => {
      const state: Turn[] = [
        {
          id: 'a1',
          kind: 'assistant',
          items: [
            { kind: 'tool', id: 'tool1', toolUseId: 'tool1', name: 'read', input: {}, pending: true },
          ],
        },
        { id: 'u1', kind: 'user', text: 'ok' },
        {
          id: 'a2',
          kind: 'assistant',
          items: [],
        },
      ]
      const result = turnsReducer(state, {
        type: 'TOOL_RESULT',
        toolUseId: 'tool1',
        content: 'result',
      })
      const turn = result.find(t => t.id === 'a1')!
      if (turn.kind === 'assistant') {
        const item = turn.items[0]
        if (item.kind === 'tool') expect(item.pending).toBe(false)
      }
    })
  })
})

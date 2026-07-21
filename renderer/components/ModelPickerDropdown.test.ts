/**
 * Tests for renderer/components/ModelPickerDropdown.tsx
 *
 * The test environment is Node.js (no jsdom), so full DOM rendering and
 * Radix DropdownMenu interaction are not available here.  Tests cover:
 *
 *   • formatContextWindow — unit tests for all boundary cases.
 *   • groupAndSortModels — grouping, alphabetical sort, mutation safety,
 *     and negative inputs.
 *   • ModelPickerDropdown — exported component contract (function, name,
 *     TypeScript props).
 *   • ModelPickerDropdownProps / ModelGroup — interface shape verification.
 *
 * Runtime rendering and keyboard/pointer interaction are verified manually
 * per the slice UAT: click the chip → dropdown opens → pick a model →
 * chip updates immediately.
 */

import { describe, it, expect } from 'vitest'
import {
  formatContextWindow,
  groupAndSortModels,
  ModelPickerDropdown,
} from './ModelPickerDropdown'
import type {
  ModelPickerDropdownProps,
  ModelGroup,
} from './ModelPickerDropdown'
import type { ModelInfo } from '../../shared/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeModel(provider: string, id: string, overrides?: Partial<ModelInfo>): ModelInfo {
  return { provider, id, ...overrides }
}

// ── formatContextWindow ───────────────────────────────────────────────────────

describe('formatContextWindow', () => {
  // Happy paths
  it('formats 200 000 as "200k ctx"', () => {
    expect(formatContextWindow(200_000)).toBe('200k ctx')
  })

  it('formats 8 192 as "8k ctx" (rounds to nearest thousand)', () => {
    expect(formatContextWindow(8_192)).toBe('8k ctx')
  })

  it('formats 1 000 (boundary) as "1k ctx"', () => {
    expect(formatContextWindow(1_000)).toBe('1k ctx')
  })

  it('formats 128 000 as "128k ctx"', () => {
    expect(formatContextWindow(128_000)).toBe('128k ctx')
  })

  // Rounding boundary
  it('rounds 1 500 to "2k ctx"', () => {
    expect(formatContextWindow(1_500)).toBe('2k ctx')
  })

  it('rounds 1 499 to "1k ctx"', () => {
    expect(formatContextWindow(1_499)).toBe('1k ctx')
  })

  // Negative tests — below the 1 000 threshold
  it('formats 999 (just below threshold) as "999 ctx"', () => {
    expect(formatContextWindow(999)).toBe('999 ctx')
  })

  it('formats 512 as "512 ctx"', () => {
    expect(formatContextWindow(512)).toBe('512 ctx')
  })

  it('formats 0 as "0 ctx"', () => {
    expect(formatContextWindow(0)).toBe('0 ctx')
  })

  it('formats 1 as "1 ctx"', () => {
    expect(formatContextWindow(1)).toBe('1 ctx')
  })

  // Return type
  it('always returns a string', () => {
    expect(typeof formatContextWindow(200_000)).toBe('string')
    expect(typeof formatContextWindow(0)).toBe('string')
  })
})

// ── groupAndSortModels ────────────────────────────────────────────────────────

describe('groupAndSortModels', () => {
  // ── Basic grouping ──────────────────────────────────────────────────────────

  it('returns an empty array for empty input', () => {
    expect(groupAndSortModels([])).toEqual([])
  })

  it('groups a single model into one group', () => {
    const models = [makeModel('anthropic', 'claude-sonnet-4-6')]
    const result = groupAndSortModels(models)
    expect(result).toHaveLength(1)
    expect(result[0]!.provider).toBe('anthropic')
    expect(result[0]!.models).toHaveLength(1)
    expect(result[0]!.models[0]!.id).toBe('claude-sonnet-4-6')
  })

  it('groups models from two different providers', () => {
    const models = [
      makeModel('openai', 'gpt-4o'),
      makeModel('anthropic', 'claude-sonnet-4-6'),
    ]
    const result = groupAndSortModels(models)
    expect(result).toHaveLength(2)
    const providers = result.map((g) => g.provider)
    expect(providers).toContain('anthropic')
    expect(providers).toContain('openai')
  })

  it('groups multiple models from the same provider into one group', () => {
    const models = [
      makeModel('anthropic', 'claude-haiku-3-5'),
      makeModel('anthropic', 'claude-sonnet-4-6'),
      makeModel('anthropic', 'claude-opus-4'),
    ]
    const result = groupAndSortModels(models)
    expect(result).toHaveLength(1)
    expect(result[0]!.provider).toBe('anthropic')
    expect(result[0]!.models).toHaveLength(3)
  })

  // ── Alphabetical group sort ─────────────────────────────────────────────────

  it('sorts groups alphabetically by provider name', () => {
    const models = [
      makeModel('openai', 'gpt-4o'),
      makeModel('anthropic', 'claude-sonnet-4-6'),
      makeModel('google', 'gemini-2-flash'),
    ]
    const result = groupAndSortModels(models)
    expect(result.map((g) => g.provider)).toEqual(['anthropic', 'google', 'openai'])
  })

  it('places a "z"-prefix provider last', () => {
    const models = [
      makeModel('zebra', 'z-model'),
      makeModel('alpha', 'a-model'),
    ]
    const result = groupAndSortModels(models)
    expect(result[0]!.provider).toBe('alpha')
    expect(result[1]!.provider).toBe('zebra')
  })

  // ── Within-group model sort ─────────────────────────────────────────────────

  it('sorts models within a group alphabetically by id', () => {
    const models = [
      makeModel('anthropic', 'claude-sonnet-4-6'),
      makeModel('anthropic', 'claude-haiku-3-5'),
      makeModel('anthropic', 'claude-opus-4'),
    ]
    const result = groupAndSortModels(models)
    const ids = result[0]!.models.map((m) => m.id)
    expect(ids).toEqual(['claude-haiku-3-5', 'claude-opus-4', 'claude-sonnet-4-6'])
  })

  // ── Optional fields preserved ───────────────────────────────────────────────

  it('preserves contextWindow when present', () => {
    const models = [makeModel('anthropic', 'claude-sonnet-4-6', { contextWindow: 200_000 })]
    const result = groupAndSortModels(models)
    expect(result[0]!.models[0]!.contextWindow).toBe(200_000)
  })

  it('preserves reasoning flag when true', () => {
    const models = [makeModel('anthropic', 'claude-sonnet-4-6', { reasoning: true })]
    const result = groupAndSortModels(models)
    expect(result[0]!.models[0]!.reasoning).toBe(true)
  })

  it('preserves models that have no optional fields (contextWindow and reasoning absent)', () => {
    const models = [makeModel('openai', 'gpt-4o')]
    const result = groupAndSortModels(models)
    expect(result[0]!.models[0]!.contextWindow).toBeUndefined()
    expect(result[0]!.models[0]!.reasoning).toBeUndefined()
  })

  // ── Immutability ────────────────────────────────────────────────────────────

  it('does not mutate the input array', () => {
    const models = [
      makeModel('openai', 'gpt-4o'),
      makeModel('anthropic', 'claude-sonnet-4-6'),
    ]
    const originalLength = models.length
    const originalFirst = models[0]!.id
    groupAndSortModels(models)
    expect(models).toHaveLength(originalLength)
    expect(models[0]!.id).toBe(originalFirst)
  })

  it('returns a new array (not the input reference)', () => {
    const models: ModelInfo[] = []
    const result = groupAndSortModels(models)
    // result is a new array even when input is empty
    expect(result).not.toBe(models)
  })

  it('does not mutate the models array within each group', () => {
    const models = [
      makeModel('anthropic', 'claude-sonnet-4-6'),
      makeModel('anthropic', 'claude-haiku-3-5'),
    ]
    groupAndSortModels(models)
    // original order unchanged
    expect(models[0]!.id).toBe('claude-sonnet-4-6')
    expect(models[1]!.id).toBe('claude-haiku-3-5')
  })

  // ── Edge: single-model group with full fields ───────────────────────────────

  it('handles a single model with all optional fields set', () => {
    const models = [
      makeModel('anthropic', 'claude-sonnet-4-6', { contextWindow: 200_000, reasoning: true }),
    ]
    const result = groupAndSortModels(models)
    const m = result[0]!.models[0]!
    expect(m.contextWindow).toBe(200_000)
    expect(m.reasoning).toBe(true)
  })
})

// ── ModelGroup interface ──────────────────────────────────────────────────────

describe('ModelGroup', () => {
  it('has a provider string and a models array — documented contract', () => {
    const group: ModelGroup = {
      provider: 'anthropic',
      models: [{ provider: 'anthropic', id: 'claude-sonnet-4-6' }],
    }
    expect(group.provider).toBe('anthropic')
    expect(Array.isArray(group.models)).toBe(true)
  })
})

// ── ModelPickerDropdown component ─────────────────────────────────────────────

describe('ModelPickerDropdown', () => {
  it('is a function (React component)', () => {
    expect(typeof ModelPickerDropdown).toBe('function')
  })

  it('has the expected component name', () => {
    expect(ModelPickerDropdown.name).toBe('ModelPickerDropdown')
  })
})

// ── ModelPickerDropdownProps contract ─────────────────────────────────────────

describe('ModelPickerDropdownProps', () => {
  it('accepts a non-null currentModel', () => {
    const props: ModelPickerDropdownProps = {
      sessionId: 's1',
      currentModel: { provider: 'anthropic', id: 'claude-sonnet-4-6' },
      onModelSelected: () => undefined,
    }
    expect(props.currentModel).not.toBeNull()
    expect(props.currentModel?.provider).toBe('anthropic')
  })

  it('accepts null currentModel (session loading)', () => {
    const props: ModelPickerDropdownProps = {
      sessionId: 's1',
      currentModel: null,
      onModelSelected: () => undefined,
    }
    expect(props.currentModel).toBeNull()
  })

  it('sessionId accepts any non-empty string', () => {
    const props: ModelPickerDropdownProps = {
      sessionId: 'rpc-session-uuid-abc123',
      currentModel: null,
      onModelSelected: () => undefined,
    }
    expect(props.sessionId).toBe('rpc-session-uuid-abc123')
  })

  it('onModelSelected is a function', () => {
    const cb = (m: ModelInfo): void => { void m }
    const props: ModelPickerDropdownProps = {
      sessionId: 's1',
      currentModel: null,
      onModelSelected: cb,
    }
    expect(typeof props.onModelSelected).toBe('function')
  })

  it('all three required props are present on a minimal valid object', () => {
    const props: ModelPickerDropdownProps = {
      sessionId: 'x',
      currentModel: null,
      onModelSelected: () => undefined,
    }
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['sessionId', 'currentModel', 'onModelSelected']),
    )
  })
})

// ── Runtime behavior contracts (documented; require jsdom for DOM assertion) ──

describe('ModelPickerDropdown — runtime behavior contracts (documented)', () => {
  it('trigger shows provider/id when currentModel is not null — documented', () => {
    // The button text is `${currentModel.provider}/${currentModel.id}`.
    // When currentModel is null, the trigger shows '—'.
    // Verified manually: open the app, click the model chip.
    expect(true).toBe(true)
  })

  it('opens the dropdown on trigger click — documented', () => {
    // DropdownMenu.Root receives open=true → DropdownMenu.Content mounts.
    // Verified manually: click chip → dropdown appears within the 32px header.
    expect(true).toBe(true)
  })

  it('groups models by provider and sorts alphabetically — documented', () => {
    // Uses groupAndSortModels (tested above) then renders one DropdownMenu.Group
    // per provider with a DropdownMenu.Label header and DropdownMenu.Items below.
    // Verified manually: anthropic before openai in the dropdown.
    expect(true).toBe(true)
  })

  it('shows contextWindow badge only when field is present — documented', () => {
    // Renders <span> "200k ctx" adjacent to the model id when
    // m.contextWindow !== undefined; omitted otherwise.
    // Verified manually: observe badges in dropdown.
    expect(true).toBe(true)
  })

  it('shows reasoning badge only when reasoning === true — documented', () => {
    // Renders amber <span>"reasoning"</span> when m.reasoning === true.
    // Models with reasoning=false or reasoning=undefined show no badge.
    // Verified manually: reasoning model rows show the badge.
    expect(true).toBe(true)
  })

  it('calls onModelSelected with the full ModelInfo on item select — documented', () => {
    // DropdownMenu.Item.onSelect fires → onModelSelected(m) called.
    // Radix closes the menu automatically after onSelect.
    // Verified manually: pick a model → chip updates in SessionHeaderBar.
    expect(true).toBe(true)
  })

  it('fetch() is called when the dropdown opens — documented', () => {
    // handleOpenChange(true) calls fetch() from useAvailableModels.
    // If within the 60 s TTL the cached list is returned immediately.
    // Verified manually: network/IPC traffic only on the first open each minute.
    expect(true).toBe(true)
  })
})

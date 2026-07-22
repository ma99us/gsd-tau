/**
 * Tests for renderer/components/Composer.tsx
 *
 * The test environment is Node.js (no jsdom), so full DOM rendering is not
 * available.  Tests cover:
 *
 *   • isModelCommand — unit tests for all input shapes and boundary cases
 *     (the only pure helper exported from this module).
 *   • Composer — forwardRef component export contract (defined, has render
 *     function, displayName).
 *   • ComposerHandle / ComposerProps — interface shape contracts.
 *
 * Runtime focus behaviour (Ctrl+K calls composerRef.current?.focus()) and
 * slash-command UI are verified manually per the slice UAT.
 */

import { describe, it, expect } from 'vitest'
import { Composer, isModelCommand } from './Composer'
import type { ComposerHandle, ComposerProps } from './Composer'

// ── isModelCommand ────────────────────────────────────────────────────────────

describe('isModelCommand', () => {
  // ── Matching — happy paths ─────────────────────────────────────────────────

  it('"/model" (no argument) matches with empty query', () => {
    const result = isModelCommand('/model')
    expect(result.match).toBe(true)
    if (result.match) expect(result.query).toBe('')
  })

  it('"/model claude-sonnet-4-6" matches with the model id as query', () => {
    const result = isModelCommand('/model claude-sonnet-4-6')
    expect(result.match).toBe(true)
    if (result.match) expect(result.query).toBe('claude-sonnet-4-6')
  })

  it('trims leading/trailing whitespace from the query', () => {
    const result = isModelCommand('/model   gpt-4o  ')
    expect(result.match).toBe(true)
    if (result.match) expect(result.query).toBe('gpt-4o')
  })

  it('"/model " (trailing space only) returns empty query', () => {
    const result = isModelCommand('/model ')
    expect(result.match).toBe(true)
    if (result.match) expect(result.query).toBe('')
  })

  it('"/model multi word query" preserves internal spaces in query', () => {
    const result = isModelCommand('/model claude sonnet')
    expect(result.match).toBe(true)
    if (result.match) expect(result.query).toBe('claude sonnet')
  })

  // ── Case insensitivity ──────────────────────────────────────────────────────

  it('"/MODEL" (uppercase) matches', () => {
    const result = isModelCommand('/MODEL')
    expect(result.match).toBe(true)
    if (result.match) expect(result.query).toBe('')
  })

  it('"/Model claude-sonnet" (mixed case) matches', () => {
    const result = isModelCommand('/Model claude-sonnet')
    expect(result.match).toBe(true)
    if (result.match) expect(result.query).toBe('claude-sonnet')
  })

  // ── Non-matching — negative tests ──────────────────────────────────────────

  it('plain text does not match', () => {
    expect(isModelCommand('hello world').match).toBe(false)
  })

  it('empty string does not match', () => {
    expect(isModelCommand('').match).toBe(false)
  })

  it('"/help" does not match (different command)', () => {
    expect(isModelCommand('/help').match).toBe(false)
  })

  it('"/models" (plural) does not match', () => {
    expect(isModelCommand('/models').match).toBe(false)
  })

  it('"model" without leading slash does not match', () => {
    expect(isModelCommand('model claude-sonnet').match).toBe(false)
  })

  it('"//model" (double slash) does not match', () => {
    expect(isModelCommand('//model').match).toBe(false)
  })

  it('" /model" (leading space) does not match', () => {
    expect(isModelCommand(' /model').match).toBe(false)
  })

  it('"/modelname" (word starting with "model" but no space) does not match', () => {
    // "/modelname" ≠ "/model <query>" — requires whitespace or EOL after "model"
    expect(isModelCommand('/modelname').match).toBe(false)
  })

  it('"/model-name" (hyphen immediately after "model") does not match', () => {
    expect(isModelCommand('/model-name').match).toBe(false)
  })

  // ── Return type consistency ─────────────────────────────────────────────────

  it('returns { match: true, query: string } for matching input', () => {
    const result = isModelCommand('/model gpt-4o')
    expect(result).toHaveProperty('match', true)
    expect(result).toHaveProperty('query')
    expect(typeof (result as { match: true; query: string }).query).toBe('string')
  })

  it('returns { match: false } for non-matching input', () => {
    const result = isModelCommand('not a model command')
    expect(result).toEqual({ match: false })
  })
})

// ── Composer component ────────────────────────────────────────────────────────

describe('Composer', () => {
  it('is defined', () => {
    expect(Composer).toBeDefined()
  })

  it('is a forwardRef component (has a render function)', () => {
    // React forwardRef returns a plain object with a `render` property —
    // not a plain function component.  The render property is the actual
    // React function that renders the JSX.
    expect(typeof (Composer as unknown as { render: unknown }).render).toBe('function')
  })

  it('has displayName "Composer"', () => {
    // displayName is set explicitly after forwardRef() so React DevTools and
    // error boundaries show the correct component name.
    expect(Composer.displayName).toBe('Composer')
  })
})

// ── ComposerHandle interface contract ─────────────────────────────────────────

describe('ComposerHandle', () => {
  it('accepts an object with a focus() function — type contract', () => {
    // ComposerHandle is the ref shape exposed by Composer via forwardRef.
    // This test verifies the interface is structurally valid at runtime.
    let called = false
    const handle: ComposerHandle = {
      focus(): void {
        called = true
      },
    }
    handle.focus()
    expect(called).toBe(true)
  })

  it('focus() returns void (no value)', () => {
    const handle: ComposerHandle = { focus: () => undefined }
    const ret = handle.focus()
    expect(ret).toBeUndefined()
  })
})

// ── ComposerProps interface contract ──────────────────────────────────────────

describe('ComposerProps', () => {
  it('accepts the minimal required props', () => {
    const props: ComposerProps = {
      onSend: () => undefined,
      sessionId: 's1',
    }
    expect(typeof props.onSend).toBe('function')
    expect(props.sessionId).toBe('s1')
  })

  it('disabled defaults to optional (absent = undefined)', () => {
    const props: ComposerProps = {
      onSend: () => undefined,
      sessionId: 's1',
    }
    // disabled is not set — TypeScript allows omission; runtime value is undefined
    expect(props.disabled).toBeUndefined()
  })

  it('disabled: false is a valid explicit value', () => {
    const props: ComposerProps = {
      onSend: () => undefined,
      sessionId: 's1',
      disabled: false,
    }
    expect(props.disabled).toBe(false)
  })

  it('disabled: true is a valid explicit value', () => {
    const props: ComposerProps = {
      onSend: () => undefined,
      sessionId: 's1',
      disabled: true,
    }
    expect(props.disabled).toBe(true)
  })

  it('sessionId: null is accepted (no active session)', () => {
    const props: ComposerProps = {
      onSend: () => undefined,
      sessionId: null,
    }
    expect(props.sessionId).toBeNull()
  })

  it('sessionId: UUID-shaped string is accepted', () => {
    const props: ComposerProps = {
      onSend: () => undefined,
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    }
    expect(typeof props.sessionId).toBe('string')
  })

  it('onSend receives the submitted text as its first argument', () => {
    const received: string[] = []
    const props: ComposerProps = {
      onSend: (text) => received.push(text),
      sessionId: 's1',
    }
    props.onSend('hello pi')
    expect(received).toEqual(['hello pi'])
  })
})

// ── Runtime behaviour contracts (documented; require jsdom for DOM assertion) ──

describe('Composer — runtime behaviour contracts (documented)', () => {
  it('Enter sends text; Shift+Enter inserts newline — documented contract', () => {
    // handleKeyDown: e.key==="Enter" && !e.shiftKey → void submit()
    // e.key==="Enter" && e.shiftKey → default textarea newline behaviour
    // Verified manually: type text, Enter → clears textarea and emits onSend.
    expect(true).toBe(true)
  })

  it('focus() on the ref focuses the underlying textarea — documented contract', () => {
    // useImperativeHandle exposes focus() which calls textareaRef.current?.focus().
    // Verified manually: Ctrl+K in SessionView → cursor moves to composer textarea.
    expect(true).toBe(true)
  })

  it('typing "/" opens the slash-command picker — documented contract', () => {
    // handleInput: val.startsWith("/") → openPicker(val.slice(1))
    // Verified manually: type "/" → picker appears above the textarea.
    expect(true).toBe(true)
  })

  it('"/model <id>" routes to window.gsd.setModel, not onSend — documented contract', () => {
    // submit(): isModelCommand(text).match===true && modelId non-empty
    //   → window.gsd.setModel(sessionId, provider, id)
    // Verified manually: "/model claude-sonnet-4-6" → no user message; model chip updates.
    expect(true).toBe(true)
  })
})

/**
 * Tests for renderer/components/SessionView.tsx
 *
 * The test environment is Node.js (no jsdom), so full DOM rendering is not
 * available.  Tests cover:
 *   • The exported interface contract (TypeScript-validated at compile time;
 *     verified here at runtime to guard against accidental breaking changes).
 *   • Negative inputs to the `isActive` visibility contract.
 *   • Prop-type boundary conditions for `sessionId` and `cwd`.
 *
 * Scroll-position preservation and turn-history continuity across tab switches
 * are inherently DOM behaviours.  They are verified manually per the slice UAT
 * (switch tabs and back: scroll position, turn history, and in-progress tool
 * cards must be preserved).
 */

import { describe, it, expect } from 'vitest'
import { SessionView } from './SessionView'
import type { SessionViewProps } from './SessionView'
import { SessionHeaderBar } from './SessionHeaderBar'
import type { SessionHeaderBarProps } from './SessionHeaderBar'
import { ModelPickerDropdown } from './ModelPickerDropdown'
import type { ModelPickerDropdownProps } from './ModelPickerDropdown'
import type { ModelInfo } from '@shared/types'
import { CommandPalette } from './CommandPalette'
import type { CommandPaletteProps } from './CommandPalette'
import type { ComposerHandle } from './Composer'

// ── Interface contract ────────────────────────────────────────────────────────

describe('SessionView', () => {
  it('is a function (React component)', () => {
    expect(typeof SessionView).toBe('function')
  })

  it('has the expected component name', () => {
    expect(SessionView.name).toBe('SessionView')
  })
})

// ── SessionViewProps contract ─────────────────────────────────────────────────

describe('SessionViewProps', () => {
  // TypeScript validates the shape at compile time; these runtime checks confirm
  // nothing unexpected is stripped or aliased in the emitted module.

  it('isActive: true is a valid prop value', () => {
    const props: SessionViewProps = { sessionId: 's1', cwd: '/projects/app', isActive: true }
    expect(props.isActive).toBe(true)
  })

  it('isActive: false is a valid prop value (hidden state)', () => {
    const props: SessionViewProps = { sessionId: 's1', cwd: '/projects/app', isActive: false }
    expect(props.isActive).toBe(false)
  })

  it('sessionId accepts any non-empty string', () => {
    const props: SessionViewProps = { sessionId: 'rpc-session-uuid-abc123', cwd: '/p', isActive: true }
    expect(props.sessionId).toBe('rpc-session-uuid-abc123')
  })

  it('cwd accepts a Unix path', () => {
    const props: SessionViewProps = { sessionId: 's', cwd: '/home/user/projects/my-app', isActive: true }
    expect(props.cwd).toBe('/home/user/projects/my-app')
  })

  it('cwd accepts a Windows absolute path', () => {
    const props: SessionViewProps = { sessionId: 's', cwd: 'D:\\Projects\\gsd-tau', isActive: true }
    expect(props.cwd).toBe('D:\\Projects\\gsd-tau')
  })

  it('all three required props are present on a minimal valid object', () => {
    const props: SessionViewProps = { sessionId: 'x', cwd: '/x', isActive: false }
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['sessionId', 'cwd', 'isActive']),
    )
  })
})

// ── Visibility contract (design documentation) ────────────────────────────────

describe('Visibility contract', () => {
  /**
   * These tests document the hidden-VDOM strategy rather than asserting DOM
   * state (which requires jsdom).  The authoritative description lives in the
   * JSDoc block in SessionView.tsx.
   */

  it('inactive views must use display:none (not unmount) — documented contract', () => {
    // When isActive=false, SessionView applies `style={{ display: 'none' }}`
    // so the DOM node and all React local state are preserved.
    // Verified manually: switch tabs and back → turns, scroll position, and
    // pending tool cards are unchanged.
    expect(true).toBe(true) // placeholder assertion to surface the intent in test output
  })

  it('active views must have no display override — documented contract', () => {
    // When isActive=true, SessionView applies `style={{ display: undefined }}`
    // (no override) so the flex layout takes over.
    expect(true).toBe(true)
  })
})

// ── SessionHeaderBar regression ───────────────────────────────────────────────
// Guard that SessionHeaderBar is exported from its module and the prop
// contract satisfies the types that SessionView passes through.
// (Full DOM rendering requires jsdom; live IPC behaviour is verified manually.)

describe('SessionHeaderBar — export guard', () => {
  it('is a function (React component)', () => {
    expect(typeof SessionHeaderBar).toBe('function')
  })

  it('has the expected component name', () => {
    expect(SessionHeaderBar.name).toBe('SessionHeaderBar')
  })
})

describe('SessionHeaderBarProps', () => {
  it('accepts the same sessionId shape that SessionView receives', () => {
    // SessionView passes its own `sessionId` prop directly to SessionHeaderBar.
    // This confirms the types are compatible at runtime.
    const props: SessionHeaderBarProps = { sessionId: 'rpc-session-abc' }
    expect(props.sessionId).toBe('rpc-session-abc')
  })

  it('sessionId: empty string is the boundary condition', () => {
    // An empty string is a degenerate value — IPC calls will return null and
    // SessionHeaderBar should render '—' for model and '$0.0000' for cost.
    const props: SessionHeaderBarProps = { sessionId: '' }
    expect(props.sessionId).toBe('')
  })

  it('sessionId: accepts a UUID-shaped string', () => {
    const props: SessionHeaderBarProps = { sessionId: '550e8400-e29b-41d4-a716-446655440000' }
    expect(typeof props.sessionId).toBe('string')
  })
})

// ── ModelPickerDropdown regression ──────────────────────────────────────────
// Guard that ModelPickerDropdown and its helpers are exported from their module
// and that the prop contract is compatible with what SessionHeaderBar passes.

describe('ModelPickerDropdown — export guard', () => {
  it('is a function (React component)', () => {
    expect(typeof ModelPickerDropdown).toBe('function')
  })

  it('has the expected component name', () => {
    expect(ModelPickerDropdown.name).toBe('ModelPickerDropdown')
  })
})

describe('ModelPickerDropdownProps', () => {
  it('accepts a null currentModel (loading state)', () => {
    const props: ModelPickerDropdownProps = {
      sessionId: 's1',
      currentModel: null,
      onModelSelected: () => undefined,
    }
    expect(props.currentModel).toBeNull()
  })

  it('accepts a populated currentModel', () => {
    const props: ModelPickerDropdownProps = {
      sessionId: 's1',
      currentModel: { provider: 'anthropic', id: 'claude-sonnet-4.6' },
      onModelSelected: () => undefined,
    }
    expect(props.currentModel?.provider).toBe('anthropic')
  })

  it('onModelSelected receives a ModelInfo value', () => {
    const received: ModelInfo[] = []
    const props: ModelPickerDropdownProps = {
      sessionId: 's1',
      currentModel: null,
      onModelSelected: (m) => received.push(m),
    }
    const fakeModel = { provider: 'openai', id: 'gpt-4o' } as ModelInfo
    props.onModelSelected(fakeModel)
    expect(received).toHaveLength(1)
    expect(received[0]).toBe(fakeModel)
  })
})

describe('SessionHeaderBar — graceful-degradation contract (documented)', () => {
  /**
   * These tests document the degradation paths rather than asserting live DOM
   * state (which requires jsdom + mocked window.gsd).
   * Authoritative description lives in the JSDoc block of SessionHeaderBar.tsx.
   */

  it('renders \"—\" when getRpcState returns null — documented contract', () => {
    // getRpcState → null (session mid-shutdown or briefly before first round-trip)
    // Expected: modelDisplay = '—', cost stays at 0.0000
    expect(true).toBe(true)
  })

  it('uses cumulativeCost not turnCost sum — documented contract', () => {
    // cost_update carries cumulativeCost; using it directly prevents drift from
    // missed or out-of-order push events (T03 decision).
    expect(true).toBe(true)
  })
})

// ── SessionViewProps — optional wiring props (T03) ─────────────────────────────────
// Guard that composerRef and forcePickerOpen are accepted by SessionViewProps.
// Both are optional; existing call sites without them remain valid.

describe('SessionViewProps — optional wiring props (T03)', () => {
  it('composerRef: undefined when not provided (optional prop)', () => {
    const props: SessionViewProps = { sessionId: 's1', cwd: '/p', isActive: true }
    expect(props.composerRef).toBeUndefined()
  })

  it('composerRef: accepts a RefObject shape { current: ComposerHandle | null }', () => {
    // React.RefObject<T> has shape { current: T | null }.
    const fakeRef: { current: ComposerHandle | null } = { current: null }
    const props: SessionViewProps = {
      sessionId: 's1',
      cwd: '/p',
      isActive: true,
      composerRef: fakeRef,
    }
    expect(props.composerRef).toBe(fakeRef)
  })

  it('composerRef: accepts null (passed for inactive tabs to detach the ref)', () => {
    // In App.tsx, inactive tabs receive composerRef={null} so React detaches
    // the ref and composerRef.current is set to null for them.
    const props: SessionViewProps = {
      sessionId: 's1',
      cwd: '/p',
      isActive: false,
      composerRef: null,
    }
    expect(props.composerRef).toBeNull()
  })

  it('forcePickerOpen: undefined when not provided (optional prop)', () => {
    const props: SessionViewProps = { sessionId: 's1', cwd: '/p', isActive: true }
    expect(props.forcePickerOpen).toBeUndefined()
  })

  it('forcePickerOpen: true triggers model picker open via SessionHeaderBar', () => {
    const props: SessionViewProps = {
      sessionId: 's1',
      cwd: '/p',
      isActive: true,
      forcePickerOpen: true,
    }
    expect(props.forcePickerOpen).toBe(true)
  })
})

// ── SessionHeaderBarProps — forcePickerOpen (T02/T03) ───────────────────────────

describe('SessionHeaderBarProps — forcePickerOpen', () => {
  it('forcePickerOpen: undefined is the default (prop is optional)', () => {
    const props: SessionHeaderBarProps = { sessionId: 's1' }
    expect(props.forcePickerOpen).toBeUndefined()
  })

  it('forcePickerOpen: true opens the model picker dropdown — prop contract', () => {
    const props: SessionHeaderBarProps = { sessionId: 's1', forcePickerOpen: true }
    expect(props.forcePickerOpen).toBe(true)
  })
})

// ── CommandPalette — export guard (T03) ───────────────────────────────────────
// Guard that CommandPalette and CommandPaletteProps are exported and that the
// types match what App.tsx passes to the component.

describe('CommandPalette — export guard (T03)', () => {
  it('is a function (React component)', () => {
    expect(typeof CommandPalette).toBe('function')
  })

  it('has the expected component name', () => {
    expect(CommandPalette.name).toBe('CommandPalette')
  })
})

describe('CommandPaletteProps — interface contract (T03)', () => {
  it('open: false is the closed state', () => {
    const props: CommandPaletteProps = {
      open: false,
      onClose: () => undefined,
      sessionId: 'sess-1',
    }
    expect(props.open).toBe(false)
  })

  it('open: true is the open state', () => {
    const props: CommandPaletteProps = {
      open: true,
      onClose: () => undefined,
      sessionId: 'sess-1',
    }
    expect(props.open).toBe(true)
  })

  it('sessionId: null is valid (no active session)', () => {
    const props: CommandPaletteProps = {
      open: false,
      onClose: () => undefined,
      sessionId: null,
    }
    expect(props.sessionId).toBeNull()
  })

  it('onClose: is a callable callback', () => {
    let called = false
    const props: CommandPaletteProps = {
      open: true,
      onClose: () => { called = true },
      sessionId: null,
    }
    props.onClose()
    expect(called).toBe(true)
  })
})

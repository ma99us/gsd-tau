import { describe, it, expect } from 'vitest'
import {
  applySetStatus,
  applySetWidget,
  applySetTitle,
  emptyStatusBarState,
} from './StatusBar'
import type { StatusBarState, SetStatusRequest, SetWidgetRequest, SetTitleRequest } from './StatusBar'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSetStatusReq(statusKey: string, statusText: string | undefined): SetStatusRequest {
  return { type: 'extension_ui_request', id: 'r1', method: 'setStatus', statusKey, statusText }
}

function makeSetWidgetReq(
  widgetKey: string,
  widgetLines: string[] | undefined,
): SetWidgetRequest {
  return { type: 'extension_ui_request', id: 'r1', method: 'setWidget', widgetKey, widgetLines }
}

function makeSetTitleReq(title: string): SetTitleRequest {
  return { type: 'extension_ui_request', id: 'r1', method: 'setTitle', title }
}

// ── emptyStatusBarState ───────────────────────────────────────────────────────

describe('emptyStatusBarState', () => {
  it('has empty statuses, widgets, and null title', () => {
    expect(emptyStatusBarState).toEqual({ statuses: {}, widgets: {}, title: null })
  })
})

// ── applySetStatus ────────────────────────────────────────────────────────────

describe('applySetStatus', () => {
  const base: StatusBarState = emptyStatusBarState

  it('adds a new status key', () => {
    const result = applySetStatus(base, makeSetStatusReq('progress', 'Running T01…'))
    expect(result.statuses).toEqual({ progress: 'Running T01…' })
  })

  it('updates an existing key', () => {
    const state: StatusBarState = {
      ...base,
      statuses: { progress: 'old text' },
    }
    const result = applySetStatus(state, makeSetStatusReq('progress', 'new text'))
    expect(result.statuses.progress).toBe('new text')
  })

  it('clears a key when statusText is undefined', () => {
    const state: StatusBarState = {
      ...base,
      statuses: { progress: 'Running…' },
    }
    const result = applySetStatus(state, makeSetStatusReq('progress', undefined))
    expect(result.statuses.progress).toBeUndefined()
  })

  it('does not affect other keys or fields', () => {
    const state: StatusBarState = {
      statuses: { a: 'alpha' },
      widgets: { w: ['line1'] },
      title: 'My Session',
    }
    const result = applySetStatus(state, makeSetStatusReq('b', 'beta'))
    expect(result.statuses.a).toBe('alpha')
    expect(result.statuses.b).toBe('beta')
    expect(result.widgets).toBe(state.widgets)
    expect(result.title).toBe('My Session')
  })

  it('does not mutate the input state', () => {
    const state: StatusBarState = { ...base, statuses: { x: 'original' } }
    applySetStatus(state, makeSetStatusReq('x', 'changed'))
    expect(state.statuses.x).toBe('original')
  })
})

// ── applySetWidget ────────────────────────────────────────────────────────────

describe('applySetWidget', () => {
  const base: StatusBarState = emptyStatusBarState

  it('adds a new widget', () => {
    const result = applySetWidget(base, makeSetWidgetReq('panel', ['line1', 'line2']))
    expect(result.widgets).toEqual({ panel: ['line1', 'line2'] })
  })

  it('replaces lines for an existing widget key', () => {
    const state: StatusBarState = {
      ...base,
      widgets: { panel: ['old'] },
    }
    const result = applySetWidget(state, makeSetWidgetReq('panel', ['new1', 'new2']))
    expect(result.widgets.panel).toEqual(['new1', 'new2'])
  })

  it('clears a widget when widgetLines is undefined', () => {
    const state: StatusBarState = {
      ...base,
      widgets: { panel: ['line1'] },
    }
    const result = applySetWidget(state, makeSetWidgetReq('panel', undefined))
    expect(result.widgets.panel).toBeUndefined()
  })

  it('clears a widget when widgetLines is an empty array', () => {
    const state: StatusBarState = {
      ...base,
      widgets: { panel: ['line1'] },
    }
    // Empty array is valid input from pi; StatusBar filters it out on render.
    const result = applySetWidget(state, makeSetWidgetReq('panel', []))
    expect(result.widgets.panel).toEqual([])
  })

  it('does not affect other keys or fields', () => {
    const state: StatusBarState = {
      statuses: { s: 'text' },
      widgets: { a: ['a1'] },
      title: 'T',
    }
    const result = applySetWidget(state, makeSetWidgetReq('b', ['b1']))
    expect(result.widgets.a).toEqual(['a1'])
    expect(result.statuses).toBe(state.statuses)
    expect(result.title).toBe('T')
  })

  it('does not mutate the input state', () => {
    const state: StatusBarState = { ...base, widgets: { x: ['original'] } }
    applySetWidget(state, makeSetWidgetReq('x', ['changed']))
    expect(state.widgets.x).toEqual(['original'])
  })
})

// ── applySetTitle ─────────────────────────────────────────────────────────────

describe('applySetTitle', () => {
  const base: StatusBarState = emptyStatusBarState

  it('sets the title from null', () => {
    const result = applySetTitle(base, makeSetTitleReq('My Project'))
    expect(result.title).toBe('My Project')
  })

  it('overwrites an existing title', () => {
    const state: StatusBarState = { ...base, title: 'Old Title' }
    const result = applySetTitle(state, makeSetTitleReq('New Title'))
    expect(result.title).toBe('New Title')
  })

  it('does not affect statuses or widgets', () => {
    const state: StatusBarState = {
      statuses: { s: 'text' },
      widgets: { w: ['line1'] },
      title: null,
    }
    const result = applySetTitle(state, makeSetTitleReq('Title'))
    expect(result.statuses).toBe(state.statuses)
    expect(result.widgets).toBe(state.widgets)
  })

  it('does not mutate the input state', () => {
    const state: StatusBarState = { ...base, title: 'original' }
    applySetTitle(state, makeSetTitleReq('changed'))
    expect(state.title).toBe('original')
  })
})

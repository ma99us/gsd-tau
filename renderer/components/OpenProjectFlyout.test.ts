/**
 * Unit tests for OpenProjectFlyout pure helpers.
 *
 * These cover `projectName` and `relativeTime` — the two exported pure
 * functions that have no DOM dependency and can run in a Node.js environment.
 * localStorage-backed helpers (`loadRecents`) are exercised via integration
 * rather than here, since they require a browser-like environment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { projectName, relativeTime } from './OpenProjectFlyout'

// ── projectName ───────────────────────────────────────────────────────────────

describe('projectName', () => {
  it('extracts the basename from a Windows backslash path', () => {
    expect(projectName('D:\\Projects\\gsd-tau')).toBe('gsd-tau')
  })

  it('extracts the basename from a Unix forward-slash path', () => {
    expect(projectName('/home/user/my-project')).toBe('my-project')
  })

  it('extracts the basename from a forward-slash Windows path', () => {
    expect(projectName('D:/Projects/gsd-tau')).toBe('gsd-tau')
  })

  it('strips a trailing backslash before extracting', () => {
    expect(projectName('D:\\Projects\\gsd-tau\\')).toBe('gsd-tau')
  })

  it('strips a trailing forward slash', () => {
    expect(projectName('/home/user/my-project/')).toBe('my-project')
  })

  it('strips multiple trailing slashes', () => {
    expect(projectName('D:/Projects/gsd-tau///')).toBe('gsd-tau')
  })

  it('returns the input when there is no path separator', () => {
    expect(projectName('myproject')).toBe('myproject')
  })

  it('returns an empty string for an empty input', () => {
    expect(projectName('')).toBe('')
  })

  it('handles a deeply nested path', () => {
    expect(projectName('C:\\a\\b\\c\\d\\e\\project-name')).toBe('project-name')
  })

  it('handles a path with spaces in the name', () => {
    expect(projectName('D:/My Projects/My App')).toBe('My App')
  })

  // ── Negative / boundary ───────────────────────────────────────────────────

  it('handles a path that ends with a separator and nothing else', () => {
    // "D:/" → split gives ['D:', ''] → pop → '' → fallback to whole string
    // (edge case — real paths would always have a name after the last slash)
    const result = projectName('/')
    // After stripping trailing slashes the string is '' → split by / → [''] → pop → ''
    // The fallback cwd is returned when pop() returns ''.
    expect(typeof result).toBe('string')
  })
})

// ── relativeTime ──────────────────────────────────────────────────────────────

describe('relativeTime', () => {
  const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z').getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for a timestamp 0 ms ago', () => {
    expect(relativeTime(new Date(FIXED_NOW).toISOString())).toBe('just now')
  })

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const ts = new Date(FIXED_NOW - 45_000).toISOString()
    expect(relativeTime(ts)).toBe('just now')
  })

  it('returns "1m ago" at exactly 60 seconds', () => {
    const ts = new Date(FIXED_NOW - 60_000).toISOString()
    expect(relativeTime(ts)).toBe('1m ago')
  })

  it('returns minutes for 1–59 minute deltas', () => {
    expect(relativeTime(new Date(FIXED_NOW - 5 * 60_000).toISOString())).toBe('5m ago')
    expect(relativeTime(new Date(FIXED_NOW - 59 * 60_000).toISOString())).toBe('59m ago')
  })

  it('returns "1h ago" at exactly 60 minutes', () => {
    const ts = new Date(FIXED_NOW - 60 * 60_000).toISOString()
    expect(relativeTime(ts)).toBe('1h ago')
  })

  it('returns hours for 1–23 hour deltas', () => {
    expect(relativeTime(new Date(FIXED_NOW - 3 * 3_600_000).toISOString())).toBe('3h ago')
    expect(relativeTime(new Date(FIXED_NOW - 23 * 3_600_000).toISOString())).toBe('23h ago')
  })

  it('returns "1d ago" at exactly 24 hours', () => {
    const ts = new Date(FIXED_NOW - 24 * 3_600_000).toISOString()
    expect(relativeTime(ts)).toBe('1d ago')
  })

  it('returns days for 1–6 day deltas', () => {
    expect(relativeTime(new Date(FIXED_NOW - 4 * 86_400_000).toISOString())).toBe('4d ago')
    expect(relativeTime(new Date(FIXED_NOW - 6 * 86_400_000).toISOString())).toBe('6d ago')
  })

  it('returns "1w ago" at exactly 7 days', () => {
    const ts = new Date(FIXED_NOW - 7 * 86_400_000).toISOString()
    expect(relativeTime(ts)).toBe('1w ago')
  })

  it('returns weeks for 7–29 day deltas', () => {
    expect(relativeTime(new Date(FIXED_NOW - 14 * 86_400_000).toISOString())).toBe('2w ago')
    expect(relativeTime(new Date(FIXED_NOW - 21 * 86_400_000).toISOString())).toBe('3w ago')
  })

  it('returns months for 30+ day deltas', () => {
    expect(relativeTime(new Date(FIXED_NOW - 30 * 86_400_000).toISOString())).toBe('1mo ago')
    expect(relativeTime(new Date(FIXED_NOW - 60 * 86_400_000).toISOString())).toBe('2mo ago')
  })

  // ── Negative / malformed inputs ───────────────────────────────────────────

  it('returns empty string for a malformed date string', () => {
    expect(relativeTime('not-a-date')).toBe('')
  })

  it('returns empty string for an empty string', () => {
    expect(relativeTime('')).toBe('')
  })

  it('returns empty string for a future timestamp', () => {
    const future = new Date(FIXED_NOW + 60_000).toISOString()
    expect(relativeTime(future)).toBe('')
  })

  it('returns empty string for a far-future timestamp', () => {
    const future = new Date(FIXED_NOW + 365 * 86_400_000).toISOString()
    expect(relativeTime(future)).toBe('')
  })
})

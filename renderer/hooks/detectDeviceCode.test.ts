import { describe, it, expect } from 'vitest'
import { parseDeviceCodeNotify, classifyLoginStatus } from './detectDeviceCode'

describe('parseDeviceCodeNotify', () => {
  it('parses a standard GitHub device-code message', () => {
    const msg = 'Enter code ABCD-1234 at https://github.com/login/device to sign in.'
    expect(parseDeviceCodeNotify(msg)).toEqual({
      url: 'https://github.com/login/device',
      code: 'ABCD-1234',
    })
  })

  it('parses when the URL appears before the code', () => {
    const msg = 'Visit https://github.com/login/device and enter WXYZ-9876'
    expect(parseDeviceCodeNotify(msg)).toEqual({
      url: 'https://github.com/login/device',
      code: 'WXYZ-9876',
    })
  })

  it('uppercases a lowercase code', () => {
    const msg = 'Go to https://github.com/login/device and type abcd-1234'
    expect(parseDeviceCodeNotify(msg)?.code).toBe('ABCD-1234')
  })

  it('parses a non-hyphenated code shape', () => {
    const msg = 'Code: ABC123XY — verify at https://github.com/login/device'
    expect(parseDeviceCodeNotify(msg)).toEqual({
      url: 'https://github.com/login/device',
      code: 'ABC123XY',
    })
  })

  it('returns null when there is no URL', () => {
    expect(parseDeviceCodeNotify('Your code is ABCD-1234')).toBeNull()
  })

  it('returns null when there is no code', () => {
    expect(parseDeviceCodeNotify('Visit https://github.com/login/device to continue')).toBeNull()
  })

  it('returns null for an unrelated notify message', () => {
    expect(parseDeviceCodeNotify('Compaction complete — 42% context freed')).toBeNull()
  })

  it('does not match a code fragment embedded in the URL itself', () => {
    // The path segment "ABCDEF" could look like a 6-char code if not excluded.
    const msg = 'https://github.com/login/device/ABCDEF no separate code here'
    expect(parseDeviceCodeNotify(msg)).toBeNull()
  })
})

describe('classifyLoginStatus', () => {
  it('classifies success messages', () => {
    expect(classifyLoginStatus('Signed in to GitHub Copilot')).toBe('success')
    expect(classifyLoginStatus('Login succeeded')).toBe('success')
    expect(classifyLoginStatus('Authorization complete')).toBe('success')
  })

  it('classifies failure messages', () => {
    expect(classifyLoginStatus('Login failed: network error')).toBe('failure')
    expect(classifyLoginStatus('Device code expired')).toBe('failure')
    expect(classifyLoginStatus('Request was cancelled')).toBe('failure')
  })

  it('classifies polling/status messages as pending', () => {
    expect(classifyLoginStatus('Waiting for authorization…')).toBe('pending')
  })

  it('prioritises success over an overlapping failure-like word', () => {
    expect(classifyLoginStatus('Sign-in successful, no errors encountered')).toBe('success')
  })
})


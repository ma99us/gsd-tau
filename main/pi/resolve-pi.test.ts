import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolvePiBinary, ResolvePiError } from './resolve-pi'

// vi.mock calls are hoisted before imports by vitest's transform, so the SUT
// receives the mocked modules even though these lines appear after the imports.
vi.mock('fs', () => ({ existsSync: vi.fn() }))
vi.mock('child_process', () => ({ spawnSync: vi.fn() }))

// Typed handles to the mocked functions (set once after hoisting takes effect)
const mockExistsSync = vi.mocked(existsSync)
const mockSpawnSync = vi.mocked(spawnSync)

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal spawnSync return value that looks like `where gsd` succeeding. */
function whereOk(line: string) {
  return {
    status: 0,
    stdout: `${line}\r\n`,
    stderr: '',
    error: undefined,
    pid: 1,
    output: [],
    signal: null,
  } as unknown as ReturnType<typeof spawnSync>
}

/** Build a minimal spawnSync return value that looks like `where gsd` failing. */
function whereFail() {
  return {
    status: 1,
    stdout: '',
    stderr: 'INFO: Could not find files for the given pattern(s).',
    error: undefined,
    pid: 1,
    output: [],
    signal: null,
  } as unknown as ReturnType<typeof spawnSync>
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('resolvePiBinary', () => {
  afterEach(() => {
    vi.resetAllMocks()   // clear mock call history and implementations
    vi.unstubAllEnvs()   // restore any env vars stubbed with vi.stubEnv
  })

  // ── Case 1: PATH hit ────────────────────────────────────────────────────────
  it('returns the path found on the system PATH via `where gsd`', () => {
    // GSD_PI_PATH empty → step 1 skipped; where succeeds → step 2 returns
    vi.stubEnv('GSD_PI_PATH', '')
    mockSpawnSync.mockReturnValue(whereOk('C:\\nvm4w\\nodejs\\gsd.cmd'))
    mockExistsSync.mockReturnValue(false) // step 3 must not fire

    const result = resolvePiBinary()

    expect(result).toBe('C:\\nvm4w\\nodejs\\gsd.cmd')
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'where',
      ['gsd'],
      expect.objectContaining({ encoding: 'utf8' })
    )
  })

  // ── Case 2: env var override ────────────────────────────────────────────────
  it('returns GSD_PI_PATH when the env var is set and the path exists', () => {
    const customPath = 'C:\\custom\\tools\\gsd.cmd'
    vi.stubEnv('GSD_PI_PATH', customPath)
    mockExistsSync.mockImplementation((p) => p === customPath)

    const result = resolvePiBinary()

    expect(result).toBe(customPath)
    // Step 1 returns early — where should never be called
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })

  // ── Case 3: not-found error ─────────────────────────────────────────────────
  it('throws ResolvePiError with an actionable message when the binary is not found anywhere', () => {
    vi.stubEnv('GSD_PI_PATH', '')
    mockSpawnSync.mockReturnValue(whereFail())
    mockExistsSync.mockReturnValue(false)

    let err: unknown
    try {
      resolvePiBinary()
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(ResolvePiError)
    expect((err as ResolvePiError).name).toBe('ResolvePiError')
    // Message must guide the user toward a fix
    expect((err as ResolvePiError).message).toMatch(/npm install|GSD_PI_PATH/i)
  })

  // ── Case 4: malformed env var path ─────────────────────────────────────────
  it('throws ResolvePiError (naming GSD_PI_PATH) when the env var points to a nonexistent file', () => {
    const badPath = 'C:\\does\\not\\exist\\gsd.cmd'
    vi.stubEnv('GSD_PI_PATH', badPath)
    mockExistsSync.mockReturnValue(false)

    let err: unknown
    try {
      resolvePiBinary()
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(ResolvePiError)
    // User must see which env var is misconfigured
    expect((err as ResolvePiError).message).toContain('GSD_PI_PATH')
    // And the bad path itself so they know what to correct
    expect((err as ResolvePiError).message).toContain(badPath)
  })
})

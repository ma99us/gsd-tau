import { existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { join } from 'path'

/**
 * Thrown when the gsd (pi) binary cannot be located on this machine.
 * The message is user-facing and includes actionable remediation steps.
 */
export class ResolvePiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResolvePiError'
  }
}

/**
 * Attempt to locate 'gsd' via Windows `where` (system PATH search).
 * Returns the first match or null on any failure.
 */
function findGsdOnPath(): string | null {
  try {
    const result = spawnSync('where', ['gsd'], {
      encoding: 'utf8',
      shell: false,
      timeout: 5_000,
    })
    if (!result.error && result.status === 0 && result.stdout) {
      const first = result.stdout.trim().split(/\r?\n/)[0]?.trim()
      return first || null
    }
  } catch {
    // spawnSync itself can throw if the OS cannot find 'where' — safe to swallow.
  }
  return null
}

/**
 * Build the list of well-known gsd install paths.
 * Evaluated at call time so env vars reflect the process state at resolution time.
 */
function commonLocations(): string[] {
  const appData = process.env.APPDATA ?? ''
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const userProfile = process.env.USERPROFILE ?? ''
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'

  return [
    // npm global — most common Windows install path
    join(appData, 'npm', 'gsd.cmd'),
    join(userProfile, 'AppData', 'Roaming', 'npm', 'gsd.cmd'),
    // nvm4w
    join(localAppData, 'nvm', 'nodejs', 'gsd.cmd'),
    'C:\\nvm4w\\nodejs\\gsd.cmd',
    // fnm
    join(localAppData, 'fnm', 'aliases', 'default', 'gsd.cmd'),
    // volta
    join(userProfile, '.volta', 'bin', 'gsd.cmd'),
    // system nodejs
    join(programFiles, 'nodejs', 'gsd.cmd'),
  ]
}

/**
 * Resolve the absolute path to the gsd (pi) binary.
 *
 * Resolution order:
 *  1. `GSD_PI_PATH` environment variable — if set, the path MUST exist.
 *  2. `where gsd` on the system PATH.
 *  3. Well-known install locations (npm global, nvm4w, fnm, volta).
 *
 * @returns Absolute path string to the gsd binary.
 * @throws {ResolvePiError} With an actionable message when the binary cannot be found.
 */
export function resolvePiBinary(): string {
  // ── Step 1: explicit env var override ────────────────────────────────────
  const envPath = process.env.GSD_PI_PATH
  if (envPath !== undefined && envPath !== '') {
    if (!existsSync(envPath)) {
      throw new ResolvePiError(
        `GSD_PI_PATH is set to "${envPath}" but no file exists at that path.\n` +
          'Fix: unset GSD_PI_PATH or update it to point to the correct gsd binary.\n' +
          'Reinstall pi: npm install -g @opengsd/gsd-pi'
      )
    }
    return envPath
  }

  // ── Step 2: system PATH via `where gsd` ──────────────────────────────────
  const onPath = findGsdOnPath()
  if (onPath) {
    return onPath
  }

  // ── Step 3: probe well-known install locations ────────────────────────────
  for (const loc of commonLocations()) {
    if (loc && existsSync(loc)) {
      return loc
    }
  }

  // ── Nothing found ─────────────────────────────────────────────────────────
  throw new ResolvePiError(
    'Could not locate the gsd (pi) binary.\n' +
      'Options:\n' +
      '  • Install pi globally:   npm install -g @opengsd/gsd-pi\n' +
      '  • Set the path manually: GSD_PI_PATH=C:\\path\\to\\gsd.cmd\n' +
      'After installing, restart gsd-tau.'
  )
}

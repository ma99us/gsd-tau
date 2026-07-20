import { existsSync, readFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { join, dirname } from 'path'

/**
 * Derive the system node.exe path from a resolved loader.js path.
 *
 * loader.js lives at: <nodeDir>/node_modules/@opengsd/gsd-pi/dist/loader.js
 * node.exe lives at:  <nodeDir>/node.exe
 *
 * So node.exe is exactly 4 directories above loader.js.
 */
function nodeExeFromLoader(loaderPath: string): string | null {
  const candidate = join(dirname(loaderPath), '..', '..', '..', '..', 'node.exe')
  return existsSync(candidate) ? candidate : null
}

/**
 * Resolve the absolute path to a system node.exe that satisfies the
 * >= 22 requirement of gsd-pi.
 *
 * Resolution order:
 *  1. Derive from loaderPath (sibling node.exe in the same node install).
 *  2. `where node` on system PATH.
 *  3. Well-known nvm4w location.
 *
 * Returns null if nothing satisfying is found (caller falls back gracefully).
 */
export function resolveSystemNode(loaderPath?: string): string | null {
  const candidates: (string | null)[] = [
    loaderPath ? nodeExeFromLoader(loaderPath) : null,
    ...findNodeOnPath(),
    'C:\\nvm4w\\nodejs\\node.exe',
  ]

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue
    if (isNodeVersionSufficient(candidate)) return candidate
  }
  return null
}

/** Run `where node` and return all .exe candidates found. */
function findNodeOnPath(): string[] {
  try {
    const result = spawnSync('where', ['node'], {
      encoding: 'utf8',
      shell: false,
      timeout: 5_000,
    })
    if (!result.error && result.status === 0 && result.stdout) {
      return result.stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.toLowerCase().endsWith('.exe'))
    }
  } catch {
    // ignore
  }
  return []
}

/** Returns true if the given node binary reports a version >= 22. */
function isNodeVersionSufficient(nodePath: string): boolean {
  try {
    const result = spawnSync(nodePath, ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
    })
    if (result.status !== 0 || !result.stdout) return false
    const m = result.stdout.trim().match(/^v(\d+)\./)
    return m ? parseInt(m[1], 10) >= 22 : false
  } catch {
    return false
  }
}

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
 * Given a resolved `.cmd` wrapper path, derive the companion JS loader path.
 *
 * On Windows, `gsd.cmd` lives next to node.exe and reads:
 *   node "%dp0%\node_modules\@opengsd\gsd-pi\dist\loader.js" %*
 *
 * RpcClient uses `spawn(process.execPath, [cliPath, ...args])` so cliPath
 * must be the `.js` file, NOT the `.cmd` wrapper.
 */
function deriveJsFromCmd(cmdPath: string): string | null {
  const dir = dirname(cmdPath)
  const candidate = join(dir, 'node_modules', '@opengsd', 'gsd-pi', 'dist', 'loader.js')
  if (existsSync(candidate)) return candidate

  // Fallback: parse the cmd file to extract the js path
  try {
    const content = readFileSync(cmdPath, 'utf8')
    // Match: node_modules\@opengsd\gsd-pi\dist\loader.js or similar
    const m = content.match(/node_modules[\\/]@opengsd[\\/]gsd-pi[\\/]dist[\\/]\S+\.js/)
    if (m) {
      const jsPath = join(dir, m[0].replace(/\\/g, '/'))
      if (existsSync(jsPath)) return jsPath
    }
  } catch {
    // ignore read errors
  }
  return null
}

/**
 * Attempt to locate 'gsd' via Windows `where` (system PATH search).
 * Returns the JS loader path (not the .cmd wrapper) or null on any failure.
 */
function findGsdOnPath(): string | null {
  try {
    const result = spawnSync('where', ['gsd'], {
      encoding: 'utf8',
      shell: false,
      timeout: 5_000,
    })
    if (!result.error && result.status === 0 && result.stdout) {
      // `where gsd` may return multiple lines; prefer .cmd over .ps1
      const lines = result.stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const cmdLine = lines.find((l) => l.toLowerCase().endsWith('.cmd')) ?? lines[0]
      if (!cmdLine) return null
      // Derive the JS file from the .cmd wrapper
      if (cmdLine.toLowerCase().endsWith('.cmd')) {
        return deriveJsFromCmd(cmdLine)
      }
      return cmdLine
    }
  } catch {
    // spawnSync itself can throw if the OS cannot find 'where' — safe to swallow.
  }
  return null
}

/**
 * Build the list of well-known gsd .cmd wrapper paths.
 * Evaluated at call time so env vars reflect the process state at resolution time.
 */
function commonCmdLocations(): string[] {
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
  for (const cmdLoc of commonCmdLocations()) {
    if (cmdLoc && existsSync(cmdLoc)) {
      const jsPath = deriveJsFromCmd(cmdLoc)
      if (jsPath) return jsPath
    }
  }

  // ── Nothing found ─────────────────────────────────────────────────────────
  throw new ResolvePiError(
    'Could not locate the gsd (pi) binary.\n' +
      'Options:\n' +
      '  • Install pi globally:   npm install -g @opengsd/gsd-pi\n' +
      '  • Set the path manually: GSD_PI_PATH=C:\\path\\to\\dist\\loader.js\n' +
      'After installing, restart gsd-tau.'
  )
}

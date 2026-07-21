/**
 * QuotaService — main-process singleton owning the Copilot quota poll loop,
 * GitHub API fetches, rolling history persistence, burn-rate projections,
 * and IPC fan-out.
 *
 * ## Token source
 * `gh-auth.json` in the app data dir (`%APPDATA%/gsd-tau`).  When absent the
 * service returns `null` snapshots and the renderer shows "Connect GitHub".
 *
 * ## Polling cadence
 * | Trigger                          | Action                         |
 * |----------------------------------|--------------------------------|
 * | `start()` (token present)        | Immediate fetch                |
 * | Every 15 min                     | Fetch + history append         |
 * | `refreshNow()`                   | On-demand fetch + append       |
 * | `onAgentEnd()`                   | Fetch if ≥5 min since last     |
 * | `gh-auth.json` changes on disk   | Immediate fetch (fs.watchFile) |
 *
 * ## No circular dependency
 * `GetAllWebContents` is redefined here as a local type so that `handlers.ts`
 * can freely import `QuotaService` in T03 without creating a circular import.
 *
 * ## Auth security
 * The `gh-auth.json` `access_token` is NEVER included in any console.log line.
 * Only the account `login` string and boolean auth-state changes are logged.
 *
 * ## Device-code flow
 * Requires `GSD_TAU_GITHUB_CLIENT_ID` (registered GitHub OAuth App, `read:user`
 * scope).  Until a real app is registered, `startDeviceCodeFlow()` throws a
 * descriptive error.  The callback `onDeviceCode` is called once when the
 * device code is ready; the caller (T03 IPC handler) fans it out to the renderer.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { WebContents } from 'electron'
import type {
  QuotaSnapshot,
  QuotaProjection,
  QuotaVerdict,
  QuotaHistoryEntry,
  DeviceCodeInfo,
} from '../../shared/types'
import { QuotaHistory } from './quota-history'

// ── IPC channel constant ──────────────────────────────────────────────────────

/**
 * Push channel name for quota snapshot broadcasts.
 *
 * T03 mirrors this as `PUSH.QUOTA_UPDATE` in handlers.ts so that handler code
 * and quota-service always agree on the channel name.
 */
export const QUOTA_UPDATE_CHANNEL = 'quota:update'

// ── Local types ───────────────────────────────────────────────────────────────

/** Redefined locally to avoid a circular import with handlers.ts. */
type GetAllWebContents = () => WebContents[]

/** Shape of `gh-auth.json` persisted by the device-code flow. */
interface GhAuthFile {
  access_token: string
  login?: string
}

/**
 * Subset of `https://api.github.com/copilot_internal/user` we care about.
 *
 * The endpoint is undocumented; every field access is null-safe.
 */
interface RawCopilotUser {
  login?: string
  copilot_plan?: string
  premium_interactions?: {
    used?: number
    remaining?: number
    entitlement?: number
    overage_permitted?: boolean
    /** ISO-8601 date string, e.g. "2025-08-01". */
    reset_date?: string
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** How often to poll GitHub for a fresh quota snapshot. */
const POLL_INTERVAL_MS = 15 * 60 * 1000

/** Minimum gap before `onAgentEnd()` triggers a fetch. */
const AGENT_END_DEBOUNCE_MS = 5 * 60 * 1000

/**
 * GitHub OAuth App client_id for the device-code flow.
 *
 * Set `GSD_TAU_GITHUB_CLIENT_ID` at build time or in the environment before
 * shipping the auth flow.  Until a real OAuth App is registered, the flow
 * throws an informative error instead of silently failing.
 */
const GITHUB_CLIENT_ID = process.env['GSD_TAU_GITHUB_CLIENT_ID'] ?? ''

// ── QuotaService ──────────────────────────────────────────────────────────────

export class QuotaService {
  private readonly _dataDir: string
  private readonly _authPath: string
  private readonly _getAllWc: GetAllWebContents
  private readonly _history: QuotaHistory

  private _timer: NodeJS.Timeout | null = null
  private _watchingAuth = false
  private _lastSnapshot: QuotaSnapshot | null = null
  private _lastFetchAt = 0

  constructor(dataDir: string, getAllWc: GetAllWebContents) {
    this._dataDir = dataDir
    this._authPath = path.join(dataDir, 'gh-auth.json')
    this._getAllWc = getAllWc
    this._history = new QuotaHistory(dataDir)
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start the poll loop and begin watching `gh-auth.json` for changes.
   *
   * Loads the rolling history from disk, then immediately fetches if a valid
   * token is present.  The 15-min poll fires its first tick 15 min later.
   */
  start(): void {
    this._history.load()
    this._watchAuthFile()
    void this._fetchAndBroadcast()
    this._timer = setInterval(() => {
      console.log('[quota-service] poll tick — fetching quota')
      void this._fetchAndBroadcast()
    }, POLL_INTERVAL_MS)
  }

  /** Stop the poll loop and unwatch `gh-auth.json`. */
  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer)
      this._timer = null
    }
    if (this._watchingAuth) {
      try {
        fs.unwatchFile(this._authPath)
      } catch {
        // best-effort
      }
      this._watchingAuth = false
    }
  }

  /**
   * Return the last-cached quota snapshot without a network round-trip.
   *
   * Called by the `getQuota` IPC handler (T03).
   */
  getLastSnapshot(): QuotaSnapshot | null {
    return this._lastSnapshot
  }

  /**
   * Trigger an immediate GitHub API fetch and return the fresh snapshot.
   *
   * Called by the `refreshQuota` IPC handler (T03).
   */
  async refreshNow(): Promise<QuotaSnapshot | null> {
    return this._fetchAndBroadcast()
  }

  /**
   * Debounced post-session hook.
   *
   * Called by the `agent_end` event path in handlers.ts (T03).
   * Fetches only when at least 5 min have elapsed since the last fetch to
   * avoid hammering the API at the end of short sessions.
   */
  onAgentEnd(): void {
    if (Date.now() - this._lastFetchAt >= AGENT_END_DEBOUNCE_MS) {
      console.log('[quota-service] agent_end debounce passed — fetching quota')
      void this._fetchAndBroadcast()
    }
  }

  /**
   * Start the GitHub device-code OAuth flow.
   *
   * Throws when `GSD_TAU_GITHUB_CLIENT_ID` is not configured.
   *
   * Flow:
   *   1. POST `/login/device/code` → receive device code + user-facing code.
   *   2. Call `onDeviceCode(info)` so the renderer can display the code.
   *   3. Poll `/login/oauth/access_token` until authorised or expired.
   *   4. Write `gh-auth.json` on success — `_watchAuthFile` fires immediately.
   *
   * @param onDeviceCode  Called once when the device code is ready.  The
   *                      T03 IPC handler passes a `fanOut` wrapper here.
   */
  async startDeviceCodeFlow(
    onDeviceCode: (info: DeviceCodeInfo) => void,
  ): Promise<void> {
    if (!GITHUB_CLIENT_ID) {
      throw new Error(
        '[quota-service] GSD_TAU_GITHUB_CLIENT_ID is not configured. ' +
          'Register a GitHub OAuth App with scope "read:user" and set the env var.',
      )
    }

    // ── Step 1: request device code ──────────────────────────────────────────
    const codeRes = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'gsd-tau',
      },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'read:user' }),
    })
    if (!codeRes.ok) {
      throw new Error(
        `[quota-service] device-code request failed: HTTP ${codeRes.status}`,
      )
    }

    const codeData = (await codeRes.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
      interval: number
    }

    onDeviceCode({
      userCode: codeData.user_code,
      verificationUri: codeData.verification_uri,
      expiresIn: codeData.expires_in,
      interval: codeData.interval,
      deviceCode: codeData.device_code,
    })

    // ── Step 2: poll for access token ────────────────────────────────────────
    // GitHub recommends waiting `interval + 1` seconds between polls.
    const pollMs = (codeData.interval + 1) * 1000
    const expiresAt = Date.now() + codeData.expires_in * 1000

    while (Date.now() < expiresAt) {
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs))

      const tokenRes = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'gsd-tau',
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: codeData.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        },
      )

      if (!tokenRes.ok) continue

      const tokenData = (await tokenRes.json()) as {
        access_token?: string
        error?: string
      }

      if (tokenData.error === 'authorization_pending') continue
      if (tokenData.error === 'slow_down') {
        // GitHub is throttling — add an extra poll interval
        await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
        continue
      }
      if (tokenData.error) {
        throw new Error(
          `[quota-service] device-code flow error: ${tokenData.error}`,
        )
      }

      if (tokenData.access_token) {
        // ── Step 3: resolve login, write gh-auth.json ──────────────────────
        let login: string | undefined
        try {
          const userRes = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `token ${tokenData.access_token}`,
              'User-Agent': 'gsd-tau',
              Accept: 'application/json',
            },
          })
          if (userRes.ok) {
            const userData = (await userRes.json()) as { login?: string }
            login = userData.login
          }
        } catch {
          // login is optional — auth still succeeds without it
        }

        const authData: GhAuthFile = { access_token: tokenData.access_token }
        if (login) authData.login = login

        this._writeAuthFile(authData)
        console.log(
          `[quota-service] device-code auth succeeded — token saved for login="${login ?? '(unknown)'}"`,
        )
        return
      }
    }

    throw new Error('[quota-service] device-code flow timed out — user did not authorise')
  }

  /**
   * Disconnect by removing `gh-auth.json`.
   *
   * Immediately broadcasts a `null` snapshot so the renderer shows
   * "Connect GitHub" without waiting for the next poll tick.
   *
   * Called by the `disconnectQuotaAuth` IPC handler (T03).
   */
  async disconnect(): Promise<void> {
    try {
      fs.rmSync(this._authPath, { force: true })
      console.log('[quota-service] auth disconnected — gh-auth.json removed')
    } catch (err) {
      console.warn('[quota-service] disconnect: failed to remove gh-auth.json:', err)
    }
    this._lastSnapshot = null
    this._fanOut(QUOTA_UPDATE_CHANNEL, null)
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Watch `gh-auth.json` for changes using `fs.watchFile` (polling).
   *
   * `fs.watch` works on Windows but can miss rapid changes (e.g. write +
   * delete in the same tick); `fs.watchFile` with a 2-second poll interval
   * is more reliable for this slow-moving file.
   */
  private _watchAuthFile(): void {
    fs.watchFile(this._authPath, { interval: 2000, persistent: false }, () => {
      console.log('[quota-service] auth file changed — triggering fetch')
      void this._fetchAndBroadcast()
    })
    this._watchingAuth = true
  }

  /**
   * Perform one GitHub API fetch cycle:
   *   1. Read `gh-auth.json` for the token.
   *   2. Call `/copilot_internal/user`.
   *   3. Append to rolling history.
   *   4. Build snapshot + projections.
   *   5. Fan-out the snapshot to all renderers.
   *
   * On network error: return + broadcast the last-known snapshot marked `stale`.
   * On missing token: return `null` without broadcasting (renderer is already in unauthenticated state).
   */
  private async _fetchAndBroadcast(): Promise<QuotaSnapshot | null> {
    try {
      const auth = this._readAuthFile()
      if (!auth) {
        console.log('[quota-service] no token in gh-auth.json — skipping fetch')
        return null
      }

      const raw = await this._fetchGitHub(auth.access_token)

      // If premium_interactions is absent, the account does not have the quota
      // feature; hide the widget entirely by returning null.
      if (!raw.premium_interactions) {
        console.log(
          '[quota-service] premium_interactions absent — quota unavailable for this account',
        )
        this._lastSnapshot = null
        return null
      }

      const pi = raw.premium_interactions
      const used = pi.used ?? null
      const remaining = pi.remaining ?? null
      const entitlement = pi.entitlement ?? null
      const login = auth.login ?? raw.login ?? null
      const plan = raw.copilot_plan ?? null
      const resetDateUtc = pi.reset_date ?? null
      const overagePermitted = pi.overage_permitted ?? false

      // Append to history only when all numeric fields are present.
      if (used !== null && remaining !== null && entitlement !== null) {
        this._history.append({ ts: new Date().toISOString(), used, remaining, entitlement })
      }

      const percentRemaining =
        entitlement !== null && entitlement > 0 && remaining !== null
          ? Math.round((remaining / entitlement) * 100)
          : null

      const verdict = this._computeVerdict(used, remaining, entitlement, overagePermitted)
      const projection = this._computeProjection(resetDateUtc)

      const snapshot: QuotaSnapshot = {
        fetchedAt: new Date().toISOString(),
        login,
        plan,
        used,
        remaining,
        entitlement,
        percentRemaining,
        overagePermitted,
        resetDateUtc,
        verdict,
        projection,
        stale: false,
      }

      this._lastSnapshot = snapshot
      this._lastFetchAt = Date.now()
      this._fanOut(QUOTA_UPDATE_CHANNEL, snapshot)
      console.log(
        `[quota-service] fetch ok — used=${used} remaining=${remaining}` +
          ` entitlement=${entitlement} verdict=${verdict}`,
      )
      return snapshot
    } catch (err) {
      console.warn('[quota-service] fetch error:', err)
      // Mark the last snapshot as stale and re-broadcast so the renderer
      // shows the stale indicator instead of going blank.
      if (this._lastSnapshot) {
        const stale: QuotaSnapshot = { ...this._lastSnapshot, stale: true }
        this._fanOut(QUOTA_UPDATE_CHANNEL, stale)
        return stale
      }
      return null
    }
  }

  /**
   * Fetch `https://api.github.com/copilot_internal/user`.
   *
   * Throws on non-2xx responses so the caller can record the stale snapshot.
   * The `access_token` value is never logged here.
   */
  private async _fetchGitHub(token: string): Promise<RawCopilotUser> {
    const res = await fetch('https://api.github.com/copilot_internal/user', {
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'gsd-tau',
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(`[quota-service] GitHub API responded HTTP ${res.status}`)
    }
    return res.json() as Promise<RawCopilotUser>
  }

  /**
   * Derive a colour-coded verdict from the latest quota numbers.
   *
   * Thresholds:
   * - `overage`  — used > entitlement AND overage is permitted
   * - `runout`   — remaining ≤ 0 or used > entitlement (not permitted)
   * - `tight`    — percentRemaining ≤ 30 %
   * - `safe`     — percentRemaining > 30 %
   * - `unknown`  — insufficient data
   */
  private _computeVerdict(
    used: number | null,
    remaining: number | null,
    entitlement: number | null,
    overagePermitted: boolean,
  ): QuotaVerdict {
    if (remaining === null || entitlement === null || entitlement === 0) {
      return 'unknown'
    }

    // Overage: consumed beyond entitlement
    if (used !== null && used > entitlement) {
      return overagePermitted ? 'overage' : 'runout'
    }

    if (remaining <= 0) return 'runout'

    const pct = (remaining / entitlement) * 100
    if (pct <= 30) return 'tight'
    return 'safe'
  }

  /**
   * Compute burn-rate projections from the rolling history.
   *
   * Returns `null` when there are fewer than 2 history entries (no delta
   * to compute a rate from).
   */
  private _computeProjection(resetDateUtc: string | null): QuotaProjection | null {
    const entries = this._history.getEntries()
    if (entries.length < 2) return null

    const now = Date.now()
    const oldest = entries[0]
    const newest = entries[entries.length - 1]

    const spanMs =
      new Date(newest.ts).getTime() - new Date(oldest.ts).getTime()
    const spanDays = spanMs / (24 * 60 * 60 * 1000)
    if (spanDays < 0.001) return null

    const consumed = newest.used - oldest.used
    const burnPerDay = consumed >= 0 ? consumed / spanDays : null

    // Last 24-hour burn
    const cutoff24h = new Date(now - 24 * 60 * 60 * 1000)
    const base24h = this._history.getAt(cutoff24h)
    const burnLast24h =
      base24h !== null && base24h !== newest
        ? Math.max(0, newest.used - base24h.used)
        : null

    // Last 7-day burn
    const cutoff7d = new Date(now - 7 * 24 * 60 * 60 * 1000)
    const base7d = this._history.getAt(cutoff7d)
    const burnLast7d =
      base7d !== null && base7d !== newest
        ? Math.max(0, newest.used - base7d.used)
        : null

    let daysElapsed: number | null = null
    let daysRemaining: number | null = null
    let projectedAtReset: number | null = null
    let safeDailyBudget: number | null = null

    if (resetDateUtc) {
      const resetMs = new Date(resetDateUtc).getTime()
      // Approximate cycle start as reset − 30 days
      const cycleStartMs = resetMs - 30 * 24 * 60 * 60 * 1000
      daysElapsed = Math.max(0, (now - cycleStartMs) / (24 * 60 * 60 * 1000))
      daysRemaining = Math.max(0, (resetMs - now) / (24 * 60 * 60 * 1000))

      if (burnPerDay !== null && burnPerDay > 0 && daysRemaining > 0) {
        projectedAtReset = Math.max(
          0,
          newest.remaining - burnPerDay * daysRemaining,
        )
      }

      if (daysRemaining > 0 && newest.remaining > 0) {
        safeDailyBudget = newest.remaining / daysRemaining
      }
    }

    return {
      burnPerDay: burnPerDay !== null ? Math.round(burnPerDay * 10) / 10 : null,
      burnLast24h,
      burnLast7d,
      projectedAtReset:
        projectedAtReset !== null ? Math.round(projectedAtReset) : null,
      safeDailyBudget:
        safeDailyBudget !== null ? Math.round(safeDailyBudget * 10) / 10 : null,
      daysElapsed:
        daysElapsed !== null ? Math.round(daysElapsed * 10) / 10 : null,
      daysRemaining:
        daysRemaining !== null ? Math.round(daysRemaining * 10) / 10 : null,
    }
  }

  /**
   * Read and validate `gh-auth.json`.
   *
   * Returns `null` when the file is absent, unreadable, or malformed.
   * Does NOT log the token value.
   */
  private _readAuthFile(): GhAuthFile | null {
    try {
      const raw = fs.readFileSync(this._authPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>).access_token === 'string'
      ) {
        return parsed as GhAuthFile
      }
      console.warn('[quota-service] gh-auth.json has unexpected shape — ignoring')
      return null
    } catch {
      return null
    }
  }

  /** Write `gh-auth.json`; creates the data dir if needed. */
  private _writeAuthFile(data: GhAuthFile): void {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true })
      fs.writeFileSync(this._authPath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      console.error('[quota-service] failed to write gh-auth.json:', err)
    }
  }

  /** Send `payload` to every non-destroyed renderer WebContents. */
  private _fanOut(channel: string, payload: unknown): void {
    for (const wc of this._getAllWc()) {
      if (!wc.isDestroyed()) {
        wc.send(channel, payload)
      }
    }
  }
}

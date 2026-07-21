# S05 Research — Copilot Quota Service and Header Widget

## Summary

S05 is the highest-risk slice in M005. It introduces a new main-process singleton
service (`QuotaService`) that owns GitHub OAuth token management, periodic API polling,
rolling history persistence, burn-rate projections, and IPC fan-out. The renderer
adds a compact header widget + popover. No existing quota/auth code exists; everything
is net-new.

---

## Files Retrieved

1. `docs/65-copilot-quota.md` (full) — definitive quota service spec: API endpoint, auth chain, polling cadence, history schema, projections, UI surfaces, failure modes.
2. `docs/70-auth-github-copilot.md` (full) — Copilot provider auth is delegated to pi; quota service uses a **separate** narrow GitHub OAuth token (`read:user`).
3. `main/ipc/handlers.ts` (full) — existing IPC patterns: `IPC` constants, `PUSH` constants, `fanOut()`, injectable `GetAllWebContents`, `registerHandlers()` signature.
4. `preload/preload.ts` (full) — `createGsdApi()` factory, mirrored IPC constants, `contextBridge.exposeInMainWorld`.
5. `main/index.ts` (full) — startup wiring: `registryStore` and `sessionManager` singletons, `registerHandlers()` call, `app.whenReady()` sequence.
6. `main/persistence/registry-store.ts` (lines 1–130) — atomic write pattern: tmp + rename + bak; `defaultDataDir()` → `%APPDATA%/gsd-tau`.
7. `shared/types.ts` (full) — existing types; `GsdApi` interface that needs quota additions.
8. `package.json` (via node) — no third-party HTTP client; must use Node.js built-in `fetch` (Electron 31 ships Node 20+, `fetch` is available globally).

---

## Key Existing Patterns

### IPC handler pattern (handlers.ts)

```typescript
// Constants block
export const IPC = {
  GET_RPC_STATE: 'getRpcState',
  // ...
} as const

export const PUSH = {
  SESSION_EVENT: 'session:event',
  // ...
} as const

// Inject getAllWebContents for testability
export type GetAllWebContents = () => WebContents[]

function fanOut(getAllWc: GetAllWebContents, channel: string, payload: unknown): void {
  for (const wc of getAllWc()) {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

// Handler registration
ipcMain.handle(IPC.GET_RPC_STATE, async (_event, sessionId: SessionId) => {
  try { return await manager.getRpcState(sessionId) }
  catch (err) { console.warn(...); return null }
})
```

### Push subscription pattern (preload.ts)

```typescript
onQuotaUpdate: (cb: (snapshot: QuotaSnapshot) => void): Unsubscribe => {
  const listener = (_ev: IpcRendererEvent, snapshot: QuotaSnapshot) => cb(snapshot)
  ipcRenderer.on(PUSH.QUOTA_UPDATE, listener)
  return () => ipcRenderer.off(PUSH.QUOTA_UPDATE, listener)
}
```

### Atomic write pattern (registry-store.ts)

```typescript
// 1. write to .tmp
// 2. copy current → .bak
// 3. rename .tmp → live file  (atomic on same filesystem)
```

### App startup wiring (index.ts)

```typescript
// Singletons created at module level before app.whenReady()
const registryStore = new RegistryStore()
export const sessionManager = new SessionManager({ registryStore })

app.whenReady().then(async () => {
  // Services instantiated here, after singletons are ready
  const { cleanup, handleOpenProject } = registerHandlers(sessionManager, ...)
  // New services (QuotaService) follow same pattern: new QuotaService(dataDir).start()
})
```

---

## Architecture for S05

### New files to create

```
main/services/quota-service.ts     Main singleton: poll loop, GitHub API fetch, projections, IPC fan-out
main/services/quota-history.ts     Atomic JSON read/write for quota-history.json; 90-day prune
renderer/components/QuotaWidget.tsx Header bar widget + popover (Radix Popover)
```

### Modified files

```
main/ipc/handlers.ts    Add IPC.GET_QUOTA, PUSH.QUOTA_UPDATE constants; register getQuota handler
preload/preload.ts      Add getQuota(), onQuotaUpdate() to IPC constants + createGsdApi()
shared/types.ts         Add QuotaSnapshot, QuotaProjection, QuotaVerdict types; extend GsdApi
main/index.ts           Instantiate QuotaService singleton after app.whenReady()
renderer/components/SessionHeaderBar.tsx  Mount <QuotaWidget> alongside context gauge
```

---

## Types to Add (shared/types.ts)

```typescript
export type QuotaVerdict = 'safe' | 'tight' | 'overage' | 'runout' | 'unknown'

export interface QuotaSnapshot {
  /** ISO-8601 timestamp of the fetch. */
  fetchedAt: string
  /** Account login (e.g. "ma99us"). */
  login: string | null
  plan: string | null
  used: number | null
  remaining: number | null
  entitlement: number | null
  percentRemaining: number | null
  overagePermitted: boolean
  /** ISO-8601 date when the quota resets. */
  resetDateUtc: string | null
  verdict: QuotaVerdict
  projection: QuotaProjection | null
  /** True when the last fetch was performed while offline / network error. */
  stale: boolean
}

export interface QuotaProjection {
  burnPerDay: number | null
  burnLast24h: number | null
  burnLast7d: number | null
  projectedAtReset: number | null
  safeDailyBudget: number | null
  daysElapsed: number | null
  daysRemaining: number | null
}

export interface QuotaHistoryEntry {
  ts: string       // ISO-8601
  used: number
  remaining: number
  entitlement: number
}
```

### GsdApi additions

```typescript
interface GsdApi {
  // ...existing methods...
  getQuota(): Promise<QuotaSnapshot | null>
  onQuotaUpdate(cb: (snapshot: QuotaSnapshot) => void): Unsubscribe
  /** Trigger an immediate on-demand refresh. Returns the fresh snapshot. */
  refreshQuota(): Promise<QuotaSnapshot | null>
  /** Start the GitHub device-code auth flow for the quota service. */
  startQuotaAuth(): Promise<void>
  /** Disconnect the quota service GitHub account (delete gh-auth.json). */
  disconnectQuotaAuth(): Promise<void>
}
```

---

## IPC Channels to Add

### handlers.ts IPC/PUSH additions

```typescript
export const IPC = {
  // ...existing...
  GET_QUOTA: 'getQuota',
  REFRESH_QUOTA: 'refreshQuota',
  START_QUOTA_AUTH: 'startQuotaAuth',
  DISCONNECT_QUOTA_AUTH: 'disconnectQuotaAuth',
} as const

export const PUSH = {
  // ...existing...
  QUOTA_UPDATE: 'quota:update',
} as const
```

---

## QuotaService Design

### quota-service.ts

```typescript
export class QuotaService {
  private _timer: NodeJS.Timeout | null = null
  private _lastSnapshot: QuotaSnapshot | null = null
  private _getAllWc: GetAllWebContents

  constructor(
    private readonly dataDir: string,          // %APPDATA%/gsd-tau
    getAllWc: GetAllWebContents,
  ) {
    this._getAllWc = getAllWc
  }

  start(): void {
    // Watch gh-auth.json for token changes
    this._watchAuthFile()
    // Immediate fetch on start (if token available)
    void this._fetchAndBroadcast()
    // 15-min poll loop
    this._timer = setInterval(() => void this._fetchAndBroadcast(), 15 * 60_000)
  }

  stop(): void {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    // Unwatch auth file
  }

  getLastSnapshot(): QuotaSnapshot | null { return this._lastSnapshot }

  async refreshNow(): Promise<QuotaSnapshot | null> {
    return this._fetchAndBroadcast()
  }

  private async _fetchAndBroadcast(): Promise<QuotaSnapshot | null> {
    try {
      const token = await this._resolveToken()
      if (!token) {
        // Unauthenticated state — broadcast null/unauthenticated snapshot
        return null
      }
      const raw = await this._fetchGitHub(token)
      const history = this._history.append(raw)
      const snapshot = this._buildSnapshot(raw, history)
      this._lastSnapshot = snapshot
      fanOut(this._getAllWc, PUSH.QUOTA_UPDATE, snapshot)
      return snapshot
    } catch (err) {
      console.warn('[quota-service] fetch error:', err)
      // Return stale snapshot with stale=true
      return null
    }
  }

  private async _fetchGitHub(token: string): Promise<RawQuotaResponse> {
    // Uses global fetch (Node 20+, available in Electron 31)
    const res = await fetch('https://api.github.com/copilot_internal/user', {
      headers: { Authorization: `token ${token}`, 'User-Agent': 'gsd-tau' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    return res.json() as Promise<RawQuotaResponse>
  }
}
```

### quota-history.ts

```typescript
export class QuotaHistory {
  private readonly historyPath: string
  private readonly tmpPath: string
  private readonly bakPath: string
  private _entries: QuotaHistoryEntry[] = []

  load(): void { /* read historyPath or bakPath; prune to 90 days */ }
  append(entry: QuotaHistoryEntry): QuotaHistoryEntry[] { /* add + prune + atomic write */ }
  getAt(ts: Date): QuotaHistoryEntry | null { /* find closest entry <= ts */ }
}
```

### Auth resolution chain

```typescript
// 1. Try gh-auth.json in dataDir
// 2. If absent/invalid: return null → widget shows "Connect GitHub"
// 3. Token validation: lightweight GET /user on first load, cached per-session
```

**Note:** Doc says to check `get_state()` for a usable token first (priority 1), but
the exact field is TBD ("verify against actual RPC contract"). For v1, start with
`gh-auth.json` as the sole source; add session-state shortcut if the field is confirmed.

---

## GitHub Device-Code Auth Flow

Triggered by user clicking "Connect GitHub" in the widget:

1. `POST https://github.com/login/device/code` with `client_id` (needs an OAuth App registered for gsd-tau) and `scope: read:user`
2. Show code + URL in modal (reuse `InputModal` or new `DeviceCodeModal`)
3. Poll `https://github.com/login/oauth/access_token` every 5 s until authorised or expired
4. On success: write `gh-auth.json`, `QuotaService._watchAuthFile()` fires → immediate fetch
5. On failure: inline error + Retry button

**Open question for planner:** The device-code flow requires a registered GitHub OAuth App with a `client_id`. This needs to be decided before coding the auth flow (likely stored as a compile-time constant or env variable).

---

## HTTP Client

No third-party HTTP client is installed. Use Node.js built-in `fetch` available globally in Electron 31 (ships Node 20+). No new dependency needed.

---

## Polling cadence (from spec)

| Event | Action |
|---|---|
| App launch (token present) | Immediate fetch |
| Every 15 min | Fetch + history append |
| User clicks widget | On-demand fetch, spinner |
| Session `agent_end` | Fetch if ≥5 min since last |
| Token changes (re-auth) | Immediate fetch |

For `agent_end` debounce: `QuotaService.onAgentEnd()` called from handlers when `agent_end` event fires. Check `Date.now() - lastFetchAt >= 5 * 60_000` before fetching.

---

## Renderer Widget

```tsx
// renderer/components/QuotaWidget.tsx
// Depends on sessions-store or a dedicated quota store (simple useState + onQuotaUpdate)
// Uses Radix Popover (already in package.json: @radix-ui/react-dropdown-menu exists;
// @radix-ui/react-popover may need to be added)

function QuotaWidget() {
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | null>(null)

  useEffect(() => {
    void window.gsd.getQuota().then(setSnapshot)
    return window.gsd.onQuotaUpdate(setSnapshot)
  }, [])

  if (!snapshot) return <ConnectGitHubButton />
  return <Popover><PopoverTrigger><QuotaBar snapshot={snapshot} /></PopoverTrigger>
    <PopoverContent><QuotaPopover snapshot={snapshot} /></PopoverContent></Popover>
}
```

**Check:** `@radix-ui/react-popover` is NOT in package.json currently (only `@radix-ui/react-dialog` and `@radix-ui/react-dropdown-menu`). Planner should add it, or implement the popover using the existing dropdown-menu or a custom div with `onOpenChange`.

---

## Failure Modes (from spec)

| Failure | Behaviour |
|---|---|
| API non-200 | Widget shows `Quota: —` grey bar |
| Token missing/expired | `Not signed in` + Connect button |
| Network offline | Last known values + stale indicator |
| `premium_interactions` absent | Widget hidden entirely |
| History file corrupted | Prune and restart; burn rates → `—` |

All fetches wrapped in `try/catch`. No unhandled rejections.

---

## Wiring into main/index.ts

```typescript
// After registerHandlers(), before session restore:
const quotaService = new QuotaService(
  path.join(process.env.APPDATA ?? app.getPath('userData'), 'gsd-tau'),
  () => electronWebContents.getAllWebContents(),
)
quotaService.start()
app.once('will-quit', () => quotaService.stop())

// Register IPC handlers (can be in handlers.ts or a separate quota-handlers.ts)
ipcMain.handle(IPC.GET_QUOTA, () => quotaService.getLastSnapshot())
ipcMain.handle(IPC.REFRESH_QUOTA, async () => quotaService.refreshNow())
ipcMain.handle(IPC.START_QUOTA_AUTH, () => quotaService.startDeviceCodeFlow())
ipcMain.handle(IPC.DISCONNECT_QUOTA_AUTH, () => quotaService.disconnect())
```

---

## Risks

1. **OAuth App client_id needed** — device-code flow requires a registered GitHub OAuth App. Must be resolved before auth flow is coded. Planner should create the app or add a config mechanism.
2. **`/copilot_internal/user` is undocumented** — field names may change. Wrap response parsing defensively; every field access must be null-safe.
3. **`@radix-ui/react-popover` not installed** — planner must add it or choose an alternative (dropdown-menu Radix or custom).
4. **`agent_end` IPC routing** — handlers.ts processes session events but doesn't expose them to QuotaService. Wiring the 5-min-debounce trigger requires either: (a) QuotaService listens to session events via an EventEmitter on SessionManager, or (b) the `agent_end` handler in `doOpenProject` calls `quotaService.onAgentEnd()`. Option (b) requires injecting QuotaService into `registerHandlers()`.
5. **gh-auth.json `fs.watch` on Windows** — `fs.watch` works on Windows but can miss rapid changes; use `fs.watchFile` (polling) as a fallback if `watch` misses events.

---

## Start Here

Begin with `shared/types.ts` — add `QuotaSnapshot`, `QuotaProjection`, `QuotaHistoryEntry`, `QuotaVerdict`, and extend `GsdApi`. This establishes the contract all other files depend on. Then implement `quota-history.ts` (atomic write, no deps), then `quota-service.ts` (depends on history), then IPC wiring, then renderer widget.

# Copilot Quota Tracking

Always-on service that fetches quota data from the GitHub API, maintains a
rolling history, computes burn-rate projections, and surfaces a compact widget
in every session header. Ported from the
[copilot-quota-forecast](https://github.com/mgerdov-igt/ai-cookbook/tree/main/skills/copilot-quota-forecast)
skill — same data, same projections, native to the app.

## Why native, not on-demand

The skill version is invoked explicitly in a chat session. As a native feature:

- Quota is visible at a glance across all tabs, all the time.
- History accumulates automatically (every poll, not just when you ask).
- A single token fetch serves every open session simultaneously.
- Warning state can drive a badge or toast without any user action.

## Source of truth

GitHub internal API used by the skill:

```
GET https://api.github.com/copilot_internal/user
Authorization: token <copilot-oauth-token>
```

Response fields we consume:

| Field | Path in response |
|---|---|
| Used | `entitlement - quota_snapshots.premium_interactions.remaining` |
| Remaining | `quota_snapshots.premium_interactions.remaining` |
| Entitlement | `quota_snapshots.premium_interactions.entitlement` |
| Percent remaining | `quota_snapshots.premium_interactions.percent_remaining` |
| Overage allowed | `quota_snapshots.premium_interactions.overage_permitted` |
| Reset date (UTC) | `quota_reset_date_utc` |
| Login | `login` |
| Plan | `copilot_plan` |

This is an undocumented internal endpoint (same one `gh api` uses). If it
breaks in a future GitHub change, the widget degrades gracefully — see
[Failure modes](#failure-modes) below.

## Auth token

The quota service resolves a GitHub OAuth token through this priority chain:

### 1. gsd session state (cheapest — no extra auth)

When an active session exists, call `get_state()` and check if it returns a
usable GitHub token (field TBD — verify against the actual RPC contract during
Phase 4 implementation). If present and valid, use it directly.

### 2. gsd-tau own cache (fast — already authenticated)

`%APPDATA%\gsd-tau\gh-auth.json`:

```jsonc
{
  "version": 1,
  "github_token": "gho_...",
  "scopes": ["read:user"],
  "cached_at": "2026-07-19T10:00:00Z",
  "login": "ma99us"
}
```

The service reads this file on startup, validates the token with a lightweight
`GET /user` ping (once per app launch, not per fetch cycle), and uses it if
valid. Token validation errors are treated as cache miss, not as fatal errors.

### 3. GitHub device-code flow (user prompt — first run or expired)

If neither source yields a valid token, the quota widget shows a
**"Connect GitHub"** button. Clicking it:

1. Calls `POST https://github.com/login/device/code` with the app's OAuth
   client ID (scope: `read:user` — the minimum needed for
   `/copilot_internal/user`).
2. Shows the device code + verification URL in a small modal (same visual
   pattern as the Copilot login modal in [70-auth-github-copilot.md](./70-auth-github-copilot.md)).
3. Polls `https://github.com/login/oauth/access_token` until the user
   authorises or the code expires (15 min).
4. On success: writes the token to the own cache (`gh-auth.json`), triggers
   an immediate quota fetch, and dismisses the modal.
5. On failure/expiry: shows an inline error with a Retry button. Never
   blocks or crashes other app functionality.

This flow is independent of pi's `/login` and of whatever Copilot provider the
user has configured. A user can use the quota widget without ever setting up
Copilot through pi, as long as they have a GitHub account.

### Relationship to ADR-003

[ADR-003](./decisions/ADR-003-delegate-auth-to-pi.md) delegates **Copilot
provider auth** (model access, billing, proxied API calls) to pi. The quota
service's GitHub token is a separate, narrower credential — it only reads
usage data, not model APIs. These are independent auth concerns.

### Auth file watcher

The quota service watches `gh-auth.json` via `fs.watch`. On any change (token
written after a fresh auth, or file deleted on sign-out):
1. Re-read the token.
2. If token appeared or changed → immediate quota fetch.
3. If file deleted → revert to the "Connect GitHub" state.

### Sign-out

The `⋮` overflow menu in the quota popover includes **Disconnect GitHub
account**. This deletes `gh-auth.json` and revokes the token via
`DELETE https://api.github.com/applications/{client_id}/token`.

## Polling cadence

| Event | Action |
|---|---|
| App launch (session available) | Immediate fetch |
| Every 15 minutes (background) | Fetch + history append |
| User clicks the quota widget | Fetch on demand, spinner while in-flight |
| Session `agent_end` event | Fetch, **if ≥ 5 min since last fetch** (debounced — turns can be short) |
| Token changes (re-auth) | Immediate fetch |

15 minutes is a balance between freshness and API rate-limit headroom. The
GitHub API has a 5000 req/hour limit for OAuth tokens; 4 req/hour is trivial.

## Rolling history

Stored in `%APPDATA%\gsd-tau\quota-history.json` (not per-project — quota is
account-wide).

```jsonc
{
  "version": 1,
  "entries": [
    {
      "ts": "2026-07-19T10:00:00Z",
      "used": 412,
      "remaining": 588,
      "entitlement": 1000
    }
    // ... rolling window, max 90 days
  ]
}
```

Entries older than 90 days are pruned on each write. Atomic write (temp +
rename) — same pattern as the registry store.

## Projections

Ported directly from the skill's logic, implemented in TypeScript in the main
process. Calendar-day mode only in v1 (work-day + holiday-aware mode is Phase
4b stretch):

```
burn_per_day       = used / days_elapsed_this_period
projected_month_end = used + burn_per_day * days_remaining
safe_daily_budget  = remaining / days_remaining
burn_last_24h      = used_now - used_at(now - 24h)   [from history]
burn_last_7d       = used_now - used_at(now - 7d)    [from history]
```

`days_elapsed` and `days_remaining` are computed from `quota_reset_date_utc`.

Verdict thresholds (same as skill):

| Projected % | Verdict |
|---|---|
| ≤ 90 | ✅ Safe |
| 91–100 | ⚠ Tight |
| 101–120, overage allowed | ⚠ Will exceed (overage) |
| > 100, overage not allowed | ❌ On track to run out |
| Insufficient data | ? |

## UI surfaces

### Header widget (always visible)

Compact, lives next to the context gauge in the session header:

```
  anthropic/claude-sonnet-4-5 ▼   Context ██████░░░░ 62%  $0.42
  Copilot ████████░░ 78%  ⚠ Tight · 44/day budget             ←
```

- Colour-coded bar matching the verdict: green / amber / red.
- Shows `percent_used` as a filled bar + numeric label.
- Shows `safe_daily_budget` as "N/day budget" when not safe; omitted when safe.
- Verdict icon (`✅` / `⚠` / `❌`) prefixes the bar when not safe.
- Clicking opens the **quota popover**.

### Quota popover (click to expand)

```
┌─────────────────────────────────────────────────────┐
│  Copilot Quota                          ↻ (refresh) │
├─────────────────────────────────────────────────────┤
│  Used      412 / 1000  (41.2%)                      │
│  Remaining 588                                      │
│  Resets    Aug 1 · 13 days                          │
│                                                     │
│  Burn today   28       Last 7 days  196             │
│  Burn/day     32       Safe budget  45/day          │
│                                                     │
│  Projected    ████████████░░  ~82% at reset         │
│                                                     │
│  ✅ Safe — at current pace you'll finish at 82%.    │
│                                                     │
│  Plan: copilot_enterprise   Login: ma99us           │
│  Last updated 2 min ago                             │
└─────────────────────────────────────────────────────┘
```

- `↻` button triggers an on-demand refresh.
- "Last updated N min ago" shows staleness.
- All fields null-safe — missing values show `—`.

### Global quota badge (Phase 7+)

When quota verdict is ⚠ or ❌ and the user is not looking at the session:

- Tab badge shows a small amber/red quota icon in addition to the session
  state dot.
- Windows toast fires once per verdict change (not on every poll).
- Tray icon badge includes quota warning in aggregate.

## Failure modes

| Failure | Behaviour |
|---|---|
| API returns non-200 | Widget shows `Quota: —` with grey bar; no error toast |
| Token missing / expired | Widget shows `Not signed in`; links to login |
| Network offline | Last known values shown with "offline" indicator; staleness clock continues |
| `premium_interactions` field absent | Widget hidden entirely; no crash |
| History file corrupted | Prune and start fresh; burn-from-history values become `—` |

The widget must never crash the app or produce unhandled rejections. All quota
fetches are isolated in a `try/catch` with structured error logging.

## Work-day mode (Phase 4b stretch)

The skill supports holiday-aware projections via Nager.Date. Deferring to a
later phase:

- Calendar-day mode is the v1 default — correct for most users, simpler.
- Work-day mode + holiday fetch adds ~100 lines of logic and a network
  dependency (Nager.Date) for modest benefit.
- Config file at `%APPDATA%\gsd-tau\quota-config.json` will mirror the skill's
  `config.json` schema when implemented.

## Phase placement

This feature spans two phases:

| Phase | Scope |
|---|---|
| **Phase 4** (model picker + context gauge) | Core service + header widget + popover. Calendar-day projections. |
| **Phase 7** (notifications + tray) | Tab badge + toast on verdict change + tray aggregate. |
| **Phase 4b** (stretch, own phase if done) | Work-day mode + holiday fetch via Nager.Date. |

## Files (future — not created until Phase 4)

```
main/services/quota-service.ts     poll loop, fetch, history, projections
main/services/quota-history.ts     atomic JSON read/write, 90-day prune
main/ipc/handlers.ts               getQuota, onQuotaUpdate (additions)
shared/types.ts                    QuotaSnapshot, QuotaProjection types
renderer/components/quota-widget.tsx   header bar + popover
```

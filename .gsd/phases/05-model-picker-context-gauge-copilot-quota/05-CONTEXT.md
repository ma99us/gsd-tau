# M005 Execution Context

## Goal
Phase 4 — Session header with live model/cost, model picker, thinking level chip, context gauge, and Copilot quota service.

## Key files to read before starting S01
- `docs/60-model-and-context.md` — full spec for header, model picker, thinking level, context gauge
- `docs/65-copilot-quota.md` — quota service spec
- `renderer/components/SessionView.tsx` — where header will be inserted
- `main/ipc/handlers.ts` — add getState, getSessionStats, getAvailableModels, setModel, setThinkingLevel, compact IPC
- `main/session/session-manager.ts` — surface getState, getSessionStats, getAvailableModels, setModel, setThinkingLevel, compact
- `shared/types.ts` — add ModelInfo, SessionStats, QuotaSnapshot types
- `renderer/state/sessions-store.ts` — add modelInfo, stats, cost fields per session

## RPC surface (verify via contracts before calling)
```
get_state()             → { model: ModelInfo, thinkingLevel, ... }
get_session_stats()     → { tokens: { input, output, cacheRead, cacheWrite, total }, cost }
get_available_models()  → ModelInfo[]
set_model({ provider, modelId })
set_thinking_level({ level })
compact()
```

All calls go through SessionHandle (session-manager.ts). Feature-detect per ADR-005: call via try/catch; degrade gracefully if unimplemented.

## Architecture notes
- `get_state` every 5s while session is focused, once on tab switch — use a `useEffect` with `setInterval` in SessionView
- `cost_update` events fan-out from handlers.ts to renderer already (M003); extend to carry token data
- Copilot quota service (S05): main process singleton, polls every 15min, IPC `getQuota` + `onQuotaUpdate` push
- GitHub auth for quota: `%APPDATA%\gsd-tau\gh-auth.json`, device-code flow for first run
- `quota-history.json` in `%APPDATA%\gsd-tau\` (account-wide, not per-project)

## Baseline (start of M005)
- TSC clean, 602 passing / 5 pre-existing failures
- SessionView has StatusBar + TurnList + Composer
- cost_update events already reach renderer (handlers.ts SessionHandle dispatch)

## Decisions to preserve
- `--continue` removed from pi spawn (no-op in RPC mode, confirmed)
- `_sessionHistory` still tracked (future use when pi implements context restore)

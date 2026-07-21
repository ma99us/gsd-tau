# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
|---|------|-------|----------|--------|-----------|------------|---------|
| D001 | M005/S05 planning | architecture | How to provide the GitHub OAuth App client_id required by the QuotaService device-code flow | Define QUOTA_OAUTH_CLIENT_ID as a compile-time string constant in quota-service.ts, initially set to empty string with a TODO comment. Device-code flow throws 'OAuth App not configured' when the constant is empty, rendering the Connect GitHub button inert until a real client_id is registered and filled in. | The OAuth App registration is a product/ops step that cannot be automated by the coding agent. Placeholder-constant approach ships the feature skeleton without blocking; a real client_id can be patched in one line once the app is registered. Avoids environment variable complexity for a desktop app. | Yes — replace constant with real client_id once GitHub OAuth App is registered for gsd-tau | agent |
| D002 | M005/S05 planning | architecture | How to route agent_end events to QuotaService for the 5-min-debounce post-turn fetch | Inject QuotaService as an optional parameter into registerHandlers(). When the agent_end session event fires inside the handler, call quotaService?.onAgentEnd(). | Keeps QuotaService decoupled from SessionManager (no EventEmitter plumbing needed). Consistent with the existing injectable-side-effects pattern (MEM016) used for getAllWebContents and other handler dependencies. Minimal surface area. | Yes | agent |

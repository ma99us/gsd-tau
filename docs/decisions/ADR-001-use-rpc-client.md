# ADR-001: Drive pi via `@opengsd/rpc-client`

**Status:** Accepted
**Date:** 2026-07-19

## Context

pi (`@opengsd/gsd-pi`) is designed as a TUI. To build a desktop wrapper we need
some way for our app to send prompts, receive events, and observe agent state
without a human sitting at the pi TUI.

Options considered:

1. **TUI scraping.** Spawn pi's TUI in a pseudo-terminal, parse the rendered
   output, inject keystrokes. Zero coupling to pi's internal API.
2. **`@opengsd/rpc-client` SDK.** pi ships a Node SDK that spawns the agent
   with `--mode rpc`, performs a versioned handshake, and exposes typed
   command/event surface.
3. **`gsd --mode mcp`.** pi can also run as an MCP server. Any MCP client can
   drive it — we get tool listing for free.
4. **`gsd --print` batch mode.** One-shot single prompts.
5. **Fork pi and expose our own API surface.**

## Decision

Use `@opengsd/rpc-client`.

## Consequences

Positive:
- Typed contract via `@opengsd/contracts`. Compile-time safety.
- Bidirectional streaming: agent events + our commands.
- Full session control: model, thinking, compact, fork, session switching.
- Access to `extension_ui_request` — critical for making the app usable when
  pi's skills ask questions.
- Officially supported and versioned. Contract changes are announced.

Negative:
- Ties us to Node in the main process (fine — we picked Electron for other reasons).
- SDK version must roughly track pi version. Mitigated by `init.capabilities`
  feature detection and a clear "minimum pi version" per gsd-tau release.

## Rejected alternatives

- **TUI scraping**: brittle, fights every pi UI change, no structured events.
- **MCP mode**: coarse-grained; MCP tools aren't a natural fit for streaming
  chat + tool-result rendering. Also loses `extension_ui_request` fidelity.
- **`--print`**: no interactivity, no long-running sessions.
- **Fork**: we'd inherit maintenance of the entire agent stack. Not viable for
  a wrapper project.

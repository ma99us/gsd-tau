# ADR-005: Forward-Compatibility Strategy

**Status:** Accepted
**Date:** 2026-07-19

## Context

The user installs pi separately (see [ADR-007](./ADR-007-no-bundled-pi.md)).
That means pi will update independently of gsd-tau. We must design so that
routine pi updates don't break the shell, and rare breaking pi updates fail
loudly and safely rather than silently corrupt state.

## Decision

Adopt a three-tier forward-compatibility strategy:

1. **Depend only on the contract-versioned RPC v2 protocol** (`@opengsd/contracts`
   RPC types). Refuse to run against `protocolVersion !== 2` with a clear
   "Incompatible pi version" screen.

2. **Feature-detect everything else** via `init.capabilities.commands`,
   `init.capabilities.events`, and per-session `get_commands`. Hide UI for any
   command that isn't advertised.

3. **Graceful degradation on RPC errors.** Any `success: false` response for a
   feature we thought was available: log, tell the user, keep the session alive.

## Non-negotiables

- No imports from pi's private modules (`packages/pi-*/dist/*`).
- No direct file reads of pi's session files or `.gsd/gsd.db`.
- No TUI scraping — we never spawn `gsd` without `--mode rpc`.
- No parsing of `gsd --help` or private CLI flags.
- All slash command names (`/login`, `/gsd auto`, `/compact`) come from
  `get_commands` at runtime, not hardcoded.

## What we allow ourselves

- Reading pi's public artifacts (`.gsd/*.md`, roadmap/plan templates) as
  documented in pi's docs.
- Calling public MCP workflow tools via `client.bash()` with
  `excludeFromContext: true`.
- Using CLI flags documented in `gsd --help` (`--mode rpc`, `--version`).

## Testing implication

CI matrix runs the smoke suite against:
- Minimum supported pi (what our `@opengsd/rpc-client` is pinned to).
- Latest stable pi.
- Latest pre-release pi (best-effort).

Any smoke failure on the pre-release is filed as an upstream issue immediately.

## When to bump our pi minimum

Only when:
- We need a capability that isn't feature-detectable.
- Protocol version bumps.
- A stable RPC command we depend on gets renamed without alias.

Every bump is announced in gsd-tau release notes.

## Rejected alternatives

- **Pin pi exactly (require exact version)**: user-hostile. They already picked
  the "user-installed pi" path knowing they own versioning.
- **Auto-update pi from within gsd-tau**: violates the "we don't manage pi" boundary.

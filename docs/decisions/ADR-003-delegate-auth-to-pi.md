# ADR-003: Delegate Copilot Auth to pi

**Status:** Accepted
**Date:** 2026-07-19

## Context

We need GitHub Copilot login. pi already implements the browser-based device-code
flow: it contacts GitHub, shows a code + verification URL, opens the browser,
polls for a token, and writes the token to `%USERPROFILE%\.gsd\auth.json`.

We could either:

1. **Delegate**: trigger pi's `/login github-copilot` and observe its
   `extension_ui_request` events to render the UI.
2. **Native**: speak the device-code endpoint ourselves, obtain a token, write
   directly to `.gsd\auth.json`.

## Decision

Delegate to pi.

## Rationale

- pi owns the auth file schema. If pi changes it, our native flow breaks. Their
  own flow updates in lockstep.
- Multiple processes writing `auth.json` is a corruption path we don't want.
- Copilot's request headers (`Editor-Version`, `Copilot-Integration-Id`, etc.)
  are pi's concern; they're tuned to what GitHub Copilot's API expects.
- Delegation is <50 lines: detect device-code shape in `notify` requests, render
  a specialised modal, send responses. Native is ~500 lines including token
  refresh, error handling, and header maintenance.
- Users signed in via pi TUI get the login for free in gsd-tau. And vice versa.

## Consequences

Positive:
- One source of truth for auth.
- Free forward-compat as pi updates its auth flow.
- Small code surface in gsd-tau.

Negative:
- Our UX depends on pi's `notify` message shape. Mitigated by regex-based
  detection with graceful fallback to generic notify rendering.
- If pi renames `/login` in a future major version we need to feature-detect
  via `get_commands` and adapt.

## Rejected alternatives

- **Native flow**: rejected on maintenance and correctness grounds above.
- **Copy the token from pi's file**: not really an alternative — we'd still
  need pi to do the login. And we don't want to touch the file at all.

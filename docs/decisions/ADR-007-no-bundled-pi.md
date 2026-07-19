# ADR-007: Do Not Bundle pi

**Status:** Accepted
**Date:** 2026-07-19

## Context

We can either bundle the `gsd` CLI + a Node runtime inside our Electron app
(~150 MB installer) or require the user to install pi separately (~50 MB
installer, requires `npm i -g @opengsd/gsd-pi` first).

## Decision

Do not bundle. Users install pi separately.

## Rationale

Chosen by the project lead. Trade-offs accepted:

Positive:
- Small installer (~50 MB).
- One source of truth for pi: whatever the user installed. Any TUI use, any
  other wrapper, and gsd-tau all share sessions, auth (including Copilot
  tokens), and `.gsd/` data automatically.
- User controls pi version — they can update pi (`gsd update`) without waiting
  for us. They can pin pi if a new version regresses.
- Our update story is dramatically simpler: no pi bundle to keep current.
- No risk of a stale bundled pi shipping with known bugs.

Negative:
- First-run UX cost: if `gsd` isn't on PATH, we can't do anything until it is.
  Mitigated by a full-screen guided setup with copy-paste install commands and
  a "Locate manually" fallback.
- Version drift risk: user can install a pi version older or newer than what
  we expect. Mitigated by aggressive feature detection ([ADR-005](./ADR-005-forward-compatibility-strategy.md))
  and clear version incompatibility screens.
- Support burden: "gsd-tau isn't finding pi" will be a common issue.

## Consequences

Implementation implications, echoed in [90-tech-stack.md](../90-tech-stack.md):

- On every startup we probe multiple pi install locations (PATH, common
  npm-global paths, nvm-for-windows patterns, user override via env var or setting).
- If not found, we block the app with a guided setup screen. Nothing else works.
- We show pi's version in session settings for diagnostic clarity.
- We test against multiple pi versions in CI ([80-forward-compatibility.md](../80-forward-compatibility.md#testing-matrix)).

## Rejected alternatives

- **Bundle pi + Node**: rejected on installer size, update story, and pi's
  auth/state living somewhere that isn't the standard `~/.gsd/`.
- **Hybrid (bundle as fallback, prefer PATH)**: rejected as extra scope for v1.
  Could revisit if support burden proves too high.

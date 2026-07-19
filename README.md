# gsd-tau

A Windows desktop shell for [GSD pi](https://www.npmjs.com/package/@opengsd/gsd-pi) —
multi-project, multi-window, chat-first, session-persistent.

**Status:** design phase. No shippable code yet. All design decisions and phase
plans are in [`docs/`](./docs/README.md).

## What it does

pi is a terminal AI-coding agent. Some people (including its author) don't want
to live in the terminal. gsd-tau is an Electron app that speaks pi's RPC
protocol so you get the same engine — same skills, same `.gsd/` workflow, same
GitHub Copilot login, same models — behind a native Windows UI with:

- Tabs and windows for multiple concurrent projects.
- All sessions survive reboots.
- Clear visual state per session: needs-input, working, stopped, auto-mode.
- Windows toasts when a session is waiting on you.
- Live model picker and context-window utilisation gauge.
- First-class GitHub Copilot login flow.

## What it isn't

- Not a fork of pi. Uses pi's public `@opengsd/rpc-client` SDK.
- Not a replacement for pi's TUI — that stays first-class.
- Not bundled with pi. You install `gsd` yourself
  (`npm i -g @opengsd/gsd-pi`), and gsd-tau spawns it per project. Any TUI
  session, any auth, any `.gsd/` folder is shared.
- Not cross-platform in v1 (Windows only).

## Design docs

Start at [`docs/README.md`](./docs/README.md) for the reading order.

Highlights:
- [docs/00-vision-and-requirements.md](./docs/00-vision-and-requirements.md) — 11 requirements
- [docs/10-architecture.md](./docs/10-architecture.md) — process model
- [docs/plan/ROADMAP.md](./docs/plan/ROADMAP.md) — 13-phase build plan
- [docs/decisions/](./docs/decisions/) — 7 ADRs

## For AI agents working on this repo

Read [AGENTS.md](./AGENTS.md) first. It routes to the specific design docs
needed per task and lists the core invariants.

## Contributing

Not yet accepting external contributions — the design is still stabilising and
Phase 1 hasn't shipped. Watch this repo for a Phase 1 announcement.

## License

TBD (will be MIT-compatible to align with the pi ecosystem).

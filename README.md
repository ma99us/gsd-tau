# gsd-tau

A Windows desktop shell for [GSD pi](https://www.npmjs.com/package/@opengsd/gsd-pi) —
multi-project, multi-window, chat-first, session-persistent.

**Status:** planning complete. No shippable code yet. Phases 1–3 are pre-planned
as GSD milestones M002–M004; ready for `gsd auto`. All design decisions and
phase plans are in [`docs/`](./docs/README.md).

## What it does

pi is a terminal AI-coding agent. Some people (including its author) don't want
to live in the terminal. gsd-tau is an Electron app that speaks pi's RPC
protocol so you get the same engine — same skills, same `.gsd/` workflow, same
GitHub Copilot login, same models — behind a native Windows UI with:

- Tabs and windows for multiple concurrent projects.
- All sessions survive reboots.
- Clear visual state per session: needs-input, working, stopped, auto-mode.
- Windows toasts when a session is waiting on you.
- Live model picker, thinking level selector, and context-window gauge.
- Proactive context-full nudge with one-click `/compact`.
- First-class GitHub Copilot login flow.

## What it isn't

- Not a fork of pi. Uses pi's public `@opengsd/rpc-client` SDK.
- Not a replacement for pi's TUI — that stays first-class.
- Not bundled with pi. You install `gsd` yourself
  (`npm i -g @opengsd/gsd-pi`), and gsd-tau spawns it per project. Any TUI
  session, any auth, any `.gsd/` folder is shared.
- Not cross-platform in v1 (Windows only).

## Design docs

Start at [`docs/README.md`](./docs/README.md) for the reading order (21 docs).

Highlights:
- [docs/00-vision-and-requirements.md](./docs/00-vision-and-requirements.md) — requirements
- [docs/10-architecture.md](./docs/10-architecture.md) — process model and module map
- [docs/15-ipc-bridge.md](./docs/15-ipc-bridge.md) — `window.gsd.*` IPC surface
- [docs/40-ui-design.md](./docs/40-ui-design.md) — window/tab/session layout
- [docs/45-chat-experience.md](./docs/45-chat-experience.md) — chat pane spec
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

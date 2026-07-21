# gsd-tau

**Status:** Active development — M005 complete  
**Phase:** Model Picker, Context Gauge, Copilot Quota delivered

## What This Is

gsd-tau is a Windows Electron desktop shell over headless `@opengsd/gsd-pi` sessions. It provides a chat-first UI for pi, with multiple concurrent sessions across tabs and windows, surviving reboots.

- **Config dir:** `%APPDATA%\gsd-tau\`
- **AppUserModelID:** `io.opengsd.gsd-tau`
- **pi min version:** 1.11.0
- **Shell:** PowerShell 7+ (pwsh) — Windows-native

## Completed Milestones

- **M002 (Phase 1):** Session Manager — pi process lifecycle, IPC bridge, session persistence
- **M003 (Phase 2):** UI Request Bridge — extension_ui_request handling, blocker resolution
- **M004 (Phase 3):** Project and Session Switcher — tabs, window management, session restore
- **M005:** Model Picker, Context Gauge, Copilot Quota — SessionHeaderBar with model chip, thinking level chip, context gauge, and quota widget; 859 unit tests pass

## M005 Deliverables

- **ThinkingLevelChip** — 7-level dropdown with Ctrl+Shift+T cycling, hidden on non-reasoning models
- **ModelPickerDropdown** — grouped provider list, optimistic setModel, 60s TTL cache, rollback on error
- **ContextGauge** — live token fill bar from get_session_stats, colour-coded at 80%/95%, popover with breakdown and Compact button
- **QuotaService** — main-process singleton, polls GitHub every 15 min, atomic-write history, fans out to all renderers
- **QuotaWidget** — account-wide Copilot usage bar, popover with burn rate and projection, graceful degradation when unauthenticated

## Architecture

- Electron + Vite + React + Zustand + Radix + Tailwind
- SessionManager lives in main process; renderer never spawns children or touches `.gsd/`
- IPC bridge via `window.gsd.*` preload API
- RPC transport: `@opengsd/rpc-client` + `gsd --mode rpc`
- All popover UI uses inline controlled-div pattern (no @radix-ui/react-popover dependency)

## Key Patterns Established

- Optimistic-update + rollback for IPC-backed UI state
- Module-level TTL cache for stable IPC data
- Main-process singleton service (instantiate in main/index.ts, pass to registerHandlers)
- Atomic-write persistence (.tmp → rename) for JSON state files
- Export pure helpers from components for Node-env unit testing
- IPC push fan-out via `getAllWebContents()`

## Next Phase

Phase 4 and beyond per `docs/plan/ROADMAP.md`.

## Milestone Sequence

- [ ] M001:  — Planned.
- [x] M002: Session Manager and Minimal Shell — A running Electron app that spawns a pi child for one project, streams every RPC event to a chat pane, and shuts down cleanly.
- [x] M003: UI-request Bridge — Every pi question reaches the user as a native modal.
- [x] M004: Multi-project Tabs, Persistence, Resume — A real multi-project desktop shell that survives reboots.
- [ ] M005: Model Picker, Context Gauge, Copilot Quota — Session header shows live model, thinking level, context gauge, and cost.

# M002 Context — Phase 1: Session Manager and Minimal Shell

## Goal

Ship a working Electron app that can spawn a pi child for one project, stream every RPC event to a chat pane, and shut down cleanly. Proves the core loop end-to-end.

## Source Documents

- `docs/plan/PHASE-1-session-manager.md` — authoritative task reference
- `docs/10-architecture.md` — component boundaries
- `docs/20-pi-integration.md` — RpcClient / SessionHandle API contract
- `docs/40-ui-design.md` — chat view and composer spec
- `docs/90-tech-stack.md` — confirmed stack (Vite + Electron + React + TypeScript + pnpm)

## Key Decisions

- **pnpm** workspace; electron-vite for main/preload/renderer split
- **contextIsolation: true, nodeIntegration: false, sandbox: true** — no exceptions
- **text_delta throttled to 60fps** (16ms debounce) before IPC fan-out
- **Shutdown**: `client.shutdown()` with 3s watchdog → fallback `client.stop()`; 5s hard cap then allow quit
- **Session IDs**: `s_` + nanoid (stable across IPC calls)
- **Phase-1 restriction**: max one concurrent session (lifted in M004)
- **Fixture repo**: `test/fixtures/sample-project/` — minimal git repo with `package.json` only (pi inits `.gsd/` on first run)
- **RPC contract reference**: `C:/nvm4w/nodejs/node_modules/@opengsd/gsd-pi/packages/contracts/dist/rpc.d.ts` — read with the `read` tool, never bundled

## Directory Layout (target)

```
main/
  index.ts
  pi/
    resolve-pi.ts / resolve-pi.test.ts
    client-factory.ts / client-factory.test.ts
  session/
    session-handle.ts / session-handle.test.ts
    state-machine.ts / state-machine.test.ts
    session-manager.ts / session-manager.test.ts
  ipc/
    handlers.ts / handlers.test.ts
preload/
  preload.ts
renderer/
  main.tsx / App.tsx
  components/TurnList.tsx, Composer.tsx, ToolCard.tsx
  hooks/useSession.ts
shared/
  types.ts
test/
  smoke.spec.ts
  fixtures/sample-project/package.json
```

## Shell / Git Tooling Note

`bash` tool requires WSL — unavailable on this machine (Hyper-V error). All shell/git ops use `gsd_exec runtime:node` + `execSync('pwsh -NoProfile -Command "..."', { encoding, cwd, timeout })`. pwsh 7.6.3 confirmed.

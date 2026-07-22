# M007/S04 — SessionView integration, shortcut wiring, and panel visibility — Research

**Date:** 2026-07-22

## Summary

S04 wires the already-built `AutoRunPanel` (S03) into `SessionView`, subscribes to live progress updates (IPC from S02), adds Ctrl+Slash toggle, and plumbs the Pause / Refresh / Open-roadmap actions. All infrastructure exists except one missing piece: there is no `shellOpen` method on the `GsdApi` surface for the "Open roadmap" button, so a new IPC channel must be added.

The integration is mechanically straightforward — every pattern needed already exists in the codebase. Ctrl+Slash follows the same App.tsx `keydown` listener pattern as Ctrl+K. Progress subscription follows the same `onEvent` / `onUiRequestAdded` pattern inside `SessionView`. The only novel work is the `shellOpen` IPC trio (channel constant + `GsdApi` entry + main handler).

Panel visibility rule: show `AutoRunPanel` when `progress?.milestone !== null`. There is no separate 'Auto' `SessionState` variant in the main-process 4-state machine; the presence of a planned milestone in `GsdProgress` is the correct signal. The panel defaults to open and is toggled by Ctrl+Slash (local `panelOpen` boolean state in `SessionView`).

## Recommendation

Three focused tasks:
1. Add `shellOpen` IPC (channel + `GsdApi` type + preload + handler + handler test update).
2. Integrate `AutoRunPanel` into `SessionView`: `getProgress` on mount, `onProgressUpdate` subscription, `panelOpen` toggle, Ctrl+Slash wiring, action callbacks.
3. Update `SessionView.test.ts` to cover the new behaviour (progress rendering, shortcut, callbacks).

Ctrl+Slash handling: wire directly inside `SessionView`'s `useEffect` (guarded by `isActive`) rather than threading another prop through App.tsx. Panel state is SessionView-local; `isActive` already gates which view is focused. This avoids the `forcePickerOpen` boilerplate pattern when state never needs to leave the component.

`onRefresh` implementation: call `window.gsd.getProgress(sessionId)` (already on `GsdApi`) and update local state — avoids adding `refreshProgress` to `GsdApi`. No extra surface needed.

## Implementation Landscape

### Key Files

- `renderer/components/SessionView.tsx` — Add `GsdProgress | null` state + `panelOpen` state + `onProgressUpdate` subscription + `useEffect` for Ctrl+Slash + conditional `<AutoRunPanel>` render + `onPause`/`onRefresh`/`onOpenRoadmap` callbacks.
- `renderer/components/AutoRunPanel.tsx` — **No changes needed.** Purely prop-driven, ready to mount.
- `renderer/App.tsx` — **No changes needed.** Ctrl+Slash is scoped to the active SessionView, not App-level state.
- `shared/types.ts` — Add `shellOpen(path: string): Promise<void>` to the `GsdApi` interface. Add `IPC.SHELL_OPEN` channel constant mirror comment (for docs consistency; actual constant lives in preload).
- `preload/preload.ts` — Add `IPC.SHELL_OPEN: 'shellOpen'` constant; implement `shellOpen: (path) => ipcRenderer.invoke(IPC.SHELL_OPEN, path)`.
- `preload/preload.test.ts` — Add test for `shellOpen` preload delegation.
- `main/ipc/handlers.ts` — Add `ipcMain.handle(IPC.SHELL_OPEN, ...)` calling `shell.openPath(filePath)` from Electron. Add `IPC.SHELL_OPEN: 'shellOpen'` to the `IPC` constant block.
- `main/ipc/handlers.test.ts` — Update `toHaveBeenCalledTimes` count for ipcMain.handle (25→26); add test for SHELL_OPEN handler.
- `renderer/components/SessionView.test.ts` — Add tests for: panel renders when `progress.milestone !== null`; panel hidden when `panelOpen=false`; Ctrl+Slash toggles `panelOpen`; `onPause` fires `abort`; `onRefresh` calls `getProgress`.

### `AutoRunPanel` wire-up inside `SessionView`

```tsx
// New state
const [progress, setProgress] = useState<GsdProgress | null>(null)
const [panelOpen, setPanelOpen] = useState(true)

// Initial fetch on mount
useEffect(() => {
  void window.gsd.getProgress(sessionId).then(setProgress)
}, [sessionId])

// Live updates
useEffect(() => {
  return window.gsd.onProgressUpdate(sessionId, setProgress)
}, [sessionId])

// Ctrl+Slash toggle (only when this tab is active)
useEffect(() => {
  if (!isActive) return
  const handler = (e: KeyboardEvent): void => {
    if (e.ctrlKey && e.key === '/') {
      e.preventDefault()
      setPanelOpen((v) => !v)
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [isActive])

// Callbacks
const handlePause = useCallback(() => void abort(), [abort])
const handleRefresh = useCallback(() => {
  void window.gsd.getProgress(sessionId).then(setProgress)
}, [sessionId])
const handleOpenRoadmap = useCallback(() => {
  if (!progress?.milestone) return
  const milestoneId = progress.milestone.id
  // Construct path: {cwd}/.gsd/phases/{milestoneId}-*/{milestoneId}-ROADMAP.md
  // Simplest: send the sessionId to main and let main resolve the path,
  // OR pass cwd prop (already available) and construct in renderer.
  // cwd is already a prop — build the path deterministically.
  // Note: directory uses numeric prefix pattern (e.g. 07-auto-run-panel).
  // Main-process shell.openPath on the resolved path.
  void window.gsd.shellOpen(`${cwd}/.gsd/phases/${milestoneId}-*/${milestoneId}-ROADMAP.md`)
  // Actually glob won't work — pass to main and let it glob, OR
  // use a simpler convention: pass sessionId and let SHELL_OPEN_ROADMAP resolve it.
}, [progress, cwd])
```

**Note on `shellOpen` vs `shellOpenRoadmap`:** The simplest approach is a generic `shellOpen(path: string)` that calls `shell.openPath`. The renderer constructs the path from `cwd` + milestone ID. However since the directory has a prefix (e.g. `07-auto-run-panel`), the renderer can't reliably build the path without a glob. **Better approach:** add `openRoadmap(sessionId: SessionId): Promise<void>` to `GsdApi` and let the main handler (which already knows the cwd and can glob) resolve the ROADMAP.md path. This is one extra IPC channel but safer than glob in renderer.

Alternative simpler: pass `cwd` to a generic `shellOpen` and in main use `shell.openPath` — but we still need a glob. The main-process `REFRESH_PROGRESS` handler already uses `entry.cwd` from SessionEntry. Add `IPC.OPEN_ROADMAP: 'openRoadmap'` that takes `sessionId`, resolves the path, and calls `shell.openPath`.

### Build Order

1. **T01 — `openRoadmap` IPC** (main/ipc/handlers.ts + shared/types.ts + preload/preload.ts + tests): unblocks T02's "Open roadmap" callback; small, isolated.
2. **T02 — SessionView integration** (SessionView.tsx): mount AutoRunPanel, subscribe to progress, wire Ctrl+Slash, all action callbacks. Depends on T01 for `openRoadmap`.
3. **T03 — Tests** (SessionView.test.ts, handler test count update): verify the full integration path in vitest.

### Verification Approach

```
pnpm tsc --noEmit                  # Must exit 0
pnpm vitest run                    # All tests pass (≥ 1146 expected — 1112 + new tests)
```

Manual (running app):
- Open a project, send `/gsd auto`, observe AutoRunPanel appears automatically.
- Ctrl+Slash → panel collapses; Ctrl+Slash again → panel opens.
- Click Pause → session state transitions (abort fires).
- Click Refresh → progress snapshot re-fetches.
- Click "Open roadmap" → ROADMAP.md opens in OS default editor.

## Constraints

- `SessionState` (4-state machine: Working/Idle/Stopped/Waiting) has no 'Auto' variant. Panel visibility must derive from `progress.milestone !== null`, not from session state.
- `shellOpen` / `openRoadmap` must go through the preload bridge — renderer cannot import `shell` from Electron directly.
- `ROADMAP.md` path uses a prefixed directory (`{milestoneId}-{slug}`) — path resolution must happen in main process using `fs.glob` or `path.join` + directory scan.
- Ctrl+Slash listener must be removed when `isActive` changes to false to avoid double-handling across tabs.
- SessionView is mounted for all tabs simultaneously (hidden via `display:none`) — the `isActive` guard in the Ctrl+Slash `useEffect` is required to prevent multiple tabs from all intercepting the shortcut.

## Common Pitfalls

- **Stale `isActive` in keydown listener** — The useEffect dependency array must include `isActive`; otherwise the listener registered when `isActive=false` never adds itself, and toggling tabs won't re-arm it.
- **Double progress subscription** — `getProgress` on mount and `onProgressUpdate` subscription are separate effects; initialising state from `onProgressUpdate` alone would miss the initial snapshot if no update fires immediately.
- **`openRoadmap` path resolution with directory prefix** — The milestone directory uses a numeric prefix (e.g. `07-auto-run-panel`), not a plain `M007` directory. Main-process handler must `fs.readdirSync(cwd + '/.gsd/phases')` and find the matching directory rather than constructing the path directly.

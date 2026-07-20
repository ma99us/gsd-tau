import { contextBridge } from 'electron'

// Expose window.gsd API surface via contextBridge.
// Populated in M002/S02 (IPC handlers slice).
contextBridge.exposeInMainWorld('gsd', {
  // Phase 1 shell — expanded when IPC handlers are wired up
})

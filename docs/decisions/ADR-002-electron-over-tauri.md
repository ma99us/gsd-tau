# ADR-002: Electron over Tauri

**Status:** Accepted
**Date:** 2026-07-19

## Context

Windows desktop app. Needs to spawn Node child processes (pi via
`@opengsd/rpc-client`), manage them, and render a chat UI. Two viable frameworks:

- **Electron**: Chromium + Node bundled. Renderer is Chromium; main is Node.
- **Tauri**: OS webview + Rust host. Renderer is Edge WebView2 on Windows; main
  is a Rust binary.

## Decision

Use Electron for v1.

## Rationale

`@opengsd/rpc-client` is a Node package. It uses `child_process.spawn` to launch
`gsd --mode rpc` and pipes stdin/stdout. In Electron this runs directly in the
main process — one language, one runtime, one boundary (main ↔ renderer).

In Tauri the Rust host cannot import the Node SDK. Options:
1. Ship Node as a Tauri sidecar and IPC to it — three boundaries (renderer ↔
   Rust ↔ Node ↔ pi), extra install size, complex lifecycle.
2. Reimplement the RPC protocol in Rust — duplicates ~549 lines of `.d.ts` and
   has to track every contract bump.
3. Spawn pi from Rust and parse JSON directly — same as (2) with slightly less code.

None of those are worth the ~100MB installer savings for a v1 wrapper.

## Consequences

Positive:
- SDK imports directly, one language throughout.
- Massive ecosystem: `electron-builder`, `electron-updater`, notification APIs,
  tray, all first-class on Windows.
- Playwright can drive Electron end-to-end.
- Well-known deployment story.

Negative:
- ~150 MB app size (vs ~10 MB for Tauri).
- More memory than Tauri per window.
- Chromium updates on our schedule, not the OS's.

## When to reconsider

If we later grow a strong reason for a tiny installer (embedded devices?
security-conscious enterprises?), the SessionManager and IPC layers are
Node-agnostic enough that a Tauri port with a Node sidecar becomes tractable.
Everything renderer-side is web tech and portable already.

## Rejected alternatives

- **Tauri**: see above.
- **Neutralino, NW.js, Wails**: smaller communities, less docs, no compelling
  Windows advantage over Electron for our shape.
- **Native Win32 / WinUI 3**: ruled out — team velocity and cross-platform
  future both matter.

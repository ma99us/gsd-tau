# S06 Replan

**Milestone:** M002
**Slice:** S06
**Blocker Task:** T12
**Created:** 2026-07-20T15:56:23.694Z

## Blocker Description

pnpm test:e2e fails at Electron launch with ERR_PACKAGE_PATH_NOT_EXPORTED: @opengsd/rpc-client is ESM-only but electron-vite's externalizeDepsPlugin makes the CJS main bundle do require('@opengsd/rpc-client'). T12 ran tests against a stale pre-11:04 AM build that predated the runtime import in client-factory.ts; rebuilding now exposes the bug. Fix: exclude @opengsd/rpc-client and @opengsd/contracts from externalization in electron.vite.config.ts.

## What Changed

Added T13 to fix the ESM/CJS interop issue (externalizeDepsPlugin must exclude @opengsd/rpc-client) and confirm the smoke test passes 10 consecutive runs as required by the slice goal. T11 and T12 remain complete.

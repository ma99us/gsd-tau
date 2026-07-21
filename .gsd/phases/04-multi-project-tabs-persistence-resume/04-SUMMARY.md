---
id: M004
title: "Multi-project Tabs, Persistence, Resume"
status: complete
completed_at: 2026-07-21T17:45:45.717Z
key_decisions:
  - pi --continue flag is a no-op in RPC mode for context restoration — all sessions start fresh regardless; --continue removed from spawn args
  - Second win.close() pass guard added to prevent registry overwrite after sessions are already closed
  - _lastSessionHistory in RegistryStore ensures bounds-only saves never discard session history
key_files:
  - main/session/session-manager.ts
  - main/persistence/registry-store.ts
  - main/ipc/handlers.ts
  - main/index.ts
  - renderer/state/sessions-store.ts
  - renderer/components/TabBar.tsx
  - renderer/components/ClosingOverlay.tsx
  - renderer/App.tsx
  - shared/types.ts
lessons_learned:
  - pi --continue in RPC mode creates a fresh session every time — test with 'remember X' before claiming session continuity works
  - cacheRead token count reflects the system prompt cache, not prior conversation — not a reliable indicator of context restoration
---

# M004: Multi-project Tabs, Persistence, Resume

**Delivered multi-tab session UI, atomic registry persistence, reboot-cycle restore, and graceful app-closing overlay**

## What Happened

M004 built the full multi-project session shell: TabBar with per-session tabs (S01), Zustand session store wiring (S02), tab close with clean session teardown (S03), RegistryStore with atomic JSON writes and window-bounds tracking (S04), session restore on reboot including active-tab restoration (S05), and app-closing overlay with shutdown coordination (S06). One limitation discovered and accepted: pi v1.11.0's RPC mode does not replay prior conversation context when a session is reopened — tabs reopen to the correct project directory but the chat starts fresh. This is deferred to a future milestone pending pi support.

## Success Criteria Results

Not provided.

## Definition of Done Results

Not provided.

## Requirement Outcomes

Not provided.

## Deviations

None.

## Follow-ups

["Conversation history replay after restart requires future pi RPC support or JSONL parsing in renderer","session restoration could track sessionHistory for when pi implements switch_session"]

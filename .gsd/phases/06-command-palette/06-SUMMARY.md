---
id: M006
title: "Command Palette"
status: complete
completed_at: 2026-07-22T14:03:48.214Z
key_decisions:
  - Hand-rolled greedy fuzzy scorer — avoids DP overhead for short palette queries
  - Injectable StorageAdapter pattern for useMRU — decouples from window.localStorage in node-env tests
  - Pure factory buildAppCommands alongside the React hook — enables test-only import without jsdom
  - filterAndSortCommands exported as pure helper — node-env unit tests without JSX overhead
  - Radix Dialog for CommandPalette — provides focus trap, Escape, aria-modal, and portal for free
  - acceptsArgs two-stage input mode for pi commands — prefix chip + arg input, Escape returns to browse
key_files:
  - renderer/hooks/fuzzyMatch.ts
  - renderer/hooks/useMRU.ts
  - renderer/hooks/useAppCommands.ts
  - renderer/hooks/usePiCommands.ts
  - renderer/components/CommandPalette.tsx
  - renderer/App.tsx
  - renderer/components/SessionView.tsx
  - renderer/components/Composer.tsx
  - renderer/components/ModelPickerDropdown.tsx
lessons_learned:
  - Pi slash commands need argument dispatch — the palette must support a two-stage flow for commands that accept subcommands/args
  - Deferring browser/live tests across multiple slices is risky — live behavior gaps surface at validation time rather than slice UAT
---

# M006: Command Palette

**Global Ctrl+Shift+P command palette with fuzzy-match, MRU, app commands, pi slash commands with argument dispatch, and full keyboard shortcut baseline.**

## What Happened

M006 delivered a fully keyboard-navigable command palette over 5 slices: S01 built the fuzzy scorer and MRU hook as pure, testable utilities; S02 registered 7 typed app commands; S03 assembled the CommandPalette overlay with Radix Dialog for focus trapping and Escape handling; S04 wired Ctrl+Shift+P, Ctrl+K, and Ctrl+. into the running app; S05 integrated pi slash commands fetched via get_commands RPC with source badges and prompt dispatch. Post-milestone live testing revealed that pi slash commands needed argument support — fixed by adding an acceptsArgs two-stage input mode to the palette (prefix chip + arg input, Escape to go back). Final test count: 1028/1028 passing. Manual live-app verification confirmed by user.

## Success Criteria Results

Not provided.

## Definition of Done Results

Not provided.

## Requirement Outcomes

Not provided.

## Deviations

None.

## Follow-ups

["show-tray and toggle-auto-run-panel are console.warn stubs — wire to real IPC in a future milestone", "Arg mode currently applies to all pi commands; could be refined if the contracts surface an acceptsArgs flag on RpcSlashCommand"]

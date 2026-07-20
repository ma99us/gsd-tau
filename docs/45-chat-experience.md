# Chat Experience

This document is the authoritative spec for the chat interface: message anatomy,
rendering, streaming, scroll behaviour, input affordances, slash-command
integration, queuing/steering, and all the context-aware intelligence features
of the conversation pane. Cross-references [40-ui-design.md](./40-ui-design.md)
for layout anchors, [41-design-system.md](./41-design-system.md) for the token
layer and `ThinkingIndicator`, and [20-pi-integration.md](./20-pi-integration.md)
for the RPC event surface.

---

## 1. Anatomy of a conversation

The chat pane is a single vertically-scrolling column. Items appear in strict
chronological order. The list is virtualised (react-virtual) to handle long
sessions without DOM bloat.

### 1.1 Item types

| Type | Origin | Visual treatment |
|---|---|---|
| **User message** | Human | Right-aligned bubble, accent-tinted background |
| **Agent text block** | `text_delta` stream | Left-aligned, no bubble; flush with margin |
| **Thinking block** | `thinking` event (extended thinking mode) | Collapsed block above agent text; distinct tint, italic. See §3.2 |
| **Tool call card** | `tool_use` event | Collapsed card row. See §3.4 |
| **"What changed" card** | Derived after file-writing turns | Compact diff summary. See §3.5 |
| **UI-request** | `extension_ui_request` | Full-width prompt card. See §4 |
| **Suggested follow-ups** | Derived post-turn | Chip row below the last agent message. See §3.6 |
| **System event** | App-generated | Centred pill: "Session resumed", "Model changed to …" |
| **Context-full nudge** | App-generated (85% threshold) | Wide warn pill with /compact CTA. See §8.1 |
| **Slash-command echo** | Composer | Right-aligned, monospace, faint border |
| **Queued message** | Composer (mid-turn) | Right-aligned, grey-tinted, ⏳ badge. See §6.1 |

### 1.2 Turn grouping

User message + all agent events that follow form a **turn group**. Groups are
separated by 16 px. Within a group, items are tightly stacked (4 px) so the
reader sees them as one coherent response.

---

## 2. Message history

History persists in pi's session file — we never own the message store. On session
resume, we replay via pi's `get_history` RPC. If unavailable, a "History
unavailable — session continued" pill is shown at the top.

History loads lazily: first 50 turns on open; older turns load on scroll-to-top
(a loading skeleton appears during fetch, scroll anchor is preserved via
`scrollToIndex` not raw pixel offset).

---

## 3. Agent output rendering

### 3.1 Thinking indicator

Before the first `text_delta` arrives (or when only tool cards have appeared so
far), a `ThinkingIndicator` occupies the agent text slot — three animated dots
with a 200 ms entry delay, fading out when real content starts. Full animation
spec in [41-design-system.md §7](./41-design-system.md#7-thinking--progress-animation).

### 3.2 Thinking / reasoning blocks

When pi streams a `thinking` event (extended thinking mode), it renders as a
collapsed block *above* the agent's main response text:

```
▸ 🧠 Reasoning  ·  8s
```

Expanded:

```
▾ 🧠 Reasoning  ·  8s
┌─────────────────────────────────────────────────────────────┐
│ (italic, softer tint, monospace — not copyable, not         │
│  indexable in search)                                       │
│                                                             │
│ Let me think through the session lifecycle. The main risk   │
│ is a race condition between tab close and the RPC shutdown  │
│ call…                                                       │
└─────────────────────────────────────────────────────────────┘
```

- Visually distinct from tool cards: softer background tint, italic text,
  no Copy button (it's internal process, not deliverable output).
- Duration badge ("8s") comes from the elapsed time between `thinking` start
  and `thinking` end events.
- Collapse state persists in localStorage keyed by `sessionId + turnIndex`.

### 3.3 Text blocks

- Markdown rendered: bold, italic, inline code, fenced code blocks, ordered /
  unordered lists, blockquotes.
- Streaming: text renders incrementally as `text_delta` arrives. A blinking
  cursor `▌` trails the last character during streaming.
- Long code blocks (> 30 lines) truncate to 20 with "Show all N lines" expand.
- Agent turns ≥ 8 lines auto-collapse to 3 lines + `▾ 47 more lines — expand`.
  Turns pi marks as `SUMMARY` get a "📋 Summary" header before the collapsed
  block.
- Expand/collapse state persists per turn in localStorage.

### 3.4 Intelligent highlighting

Applied post-stream — raw text renders first, then a single pass wraps matched
spans to avoid mid-word flicker.

| Signal | Visual |
|---|---|
| File paths (`src/foo/bar.ts`) | Monospace, underline on hover, click-to-reveal in Explorer |
| Shell commands (`npm run build`) | Inline code chip with ⎘ copy icon |
| GSD IDs (`M002`, `S01`, `T03`) | Pill badge; colour resolved from `.gsd/` state data |
| URLs | Underline, click opens system browser |
| Cost values (`$0.42`) | Tinted chip matching the header cost gauge |
| `ERROR` / `WARNING` line prefixes | Red / amber left-border on that line |

### 3.5 Tool call cards

Every `tool_use` event renders collapsed:

```
┌ read  src/main/session-manager.ts ─────────── 12 KB  ▸ ┐
└─────────────────────────────────────────────────────────┘
```

Expanded:

```
┌ read  src/main/session-manager.ts ─────────── 12 KB  ▾ ┐
│ Arguments                                               │
│   path: "src/main/session-manager.ts"                  │
│ Output                              [Copy] [Open] [Diff]│
│   (first 40 lines · "Show all 312 lines")               │
└─────────────────────────────────────────────────────────┘
```

**Code block actions** — code fences inside agent text and inside expanded tool
output cards get an action bar:

```
┌ typescript ──────────────── [Copy] [Apply to file ▾] [Diff] ┐
│ export function createSession(…) {                           │
│   …                                                         │
└─────────────────────────────────────────────────────────────┘
```

| Action | Behaviour |
|---|---|
| **Copy** | Copies the code block text to clipboard |
| **Apply to file ▾** | If agent mentioned a file path nearby, write the block to that path. If ambiguous, a "Where?" dropdown lists candidate paths. A confirmation toast shows the file written. |
| **Diff** | Opens a side-by-side diff of the block against the current on-disk file (resolved same as Apply). Uses a diff panel within the app or the system diff tool. |

**GSD-native tool overrides** — `gsd_*` tools get rich cards:

| Tool | Card content |
|---|---|
| `gsd_plan_milestone` | Mini roadmap: milestone title + slice checklist |
| `gsd_task_complete` | Task title, one-liner, verification status |
| `gsd_slice_complete` | Slice summary pill with pass/fail UAT indicator |
| `gsd_complete_milestone` | Celebration card: milestone title + timestamp |
| `gsd_uat_result_save` | UAT result table: check ID, PASS/FAIL/NEEDS-HUMAN |
| `ask_user_questions` | Rendered as inline UI-request (see §4) |

### 3.6 "What changed" diff summary card

When a turn writes ≥ 1 file (detected from `write`/`edit` tool cards in the
turn), a summary card appends at the end of the turn group:

```
┌ 3 files changed ─────────────────────────────── [View diff] ┐
│  +  src/main/theme.ts                    (new, 47 lines)    │
│  ~  src/renderer/ui/ThemeProvider.tsx        (+23 / -8)     │
│  ~  tailwind.config.ts                       (+18 / -2)     │
└─────────────────────────────────────────────────────────────┘
```

- Derived from `git diff --stat HEAD` run after the turn completes.
- **[View diff]** opens the full diff in a panel or system difftool.
- If `git` is not available in the project, the card falls back to listing
  the file paths without stats. If no files were written the card is omitted.

### 3.7 Suggested follow-ups

After each completed agent turn (on `agent_end`), 2–4 chip suggestions appear
below the last agent message:

```
  ┌───────────────────────────────────────────────────────┐
  │  Run the tests    Write a changelog    Explain this   │
  └───────────────────────────────────────────────────────┘
```

- Chips are derived heuristically from the turn content:
  - File written → "Run tests", "Review the diff"
  - Milestone completed → "Start next slice", "Show milestone status"
  - Error mentioned → "Explain this error", "Try a different approach"
  - Code block present → "Explain this code", "Write tests for this"
- A static fallback set appears when no heuristic fires: "Continue",
  "What's next?", "Summarise this session".
- Clicking a chip pre-fills and immediately submits the composer (same as typing
  and pressing Enter).
- Chips disappear once the user sends their next message.
- Maximum 4 chips; minimum 0 (suppressed if agent turn was a short one-liner).

### 3.8 Per-turn metadata strip

Below each completed agent turn, a faint single-line strip:

```
  ⏱ 14s · $0.034                                              ⋯
```

Default state shows only elapsed time and cost. Clicking `⋯` or hovering
expands inline:

```
  ⏱ 14s   📥 2,340 in   📤 847 out   $0.034   🔁 Fork   ⎘ Copy turn
```

- Data sourced from `cost_update` events (pi emits these).
- The `Fork` shortcut here is equivalent to the hover menu's fork action.
- The strip is `--color-text-muted` — visually recedes until hovered.

### 3.9 Turn branching indicator

When forks have been created from a turn (via `fork({ entryId })`), the turn
gets a branch glyph in the left margin:

```
│  Agent: I'll refactor the session manager…         ⎇ 2
```

Clicking the `⎇ 2` glyph opens a small dropdown:

```
  ⎇  Branches from this turn
  ─────────────────────────────────────────────
  [●] Current  —  "Refactor the session manager"
  [ ] Branch 1 — "Use a factory function instead"  ↗ Open
  [ ] Branch 2 — "Keep class-based, extract types" ↗ Open
```

Selecting a branch switches to that session's tab (or opens it in a new tab).
The current branch has a filled indicator. This makes fork discoverable — it was
previously only accessible via a right-click hidden menu.

### 3.10 Distinguishing sources — visual summary

| Source | Visual |
|---|---|
| User messages | Right-aligned, accent background, user initial avatar |
| Agent text | Left-aligned, clean background, no avatar |
| Thinking blocks | Left-aligned, softer tint, italic, collapsed by default |
| Tool cards | Left-aligned, monospace header, indented 8 px from agent text |
| "What changed" card | Full-width, diff-tinted background |
| Suggested follow-ups | Chip row below agent message, ghost/muted style |
| UI-request cards | Full-width, orange left border, "Needs input" badge |
| System events | Centred small pill, muted text |
| Slash-command echoes | Right-aligned, monospace, dimmed |
| Queued messages | Right-aligned, grey-tinted, ⏳ badge |

---

## 4. UI-request rendering (pi blockers)

`extension_ui_request` events render **inline in the chat** as the next item in
the turn. The in-chat card is the primary interaction surface; the separate
modal (from [40-ui-design.md](./40-ui-design.md)) is only shown for background
tabs / minimised windows.

Inline card anatomy:

```
┌─────────────────────────────────────────────────────────────┐
│ 🔶  Choose a verification approach              [required]  │
│                                                             │
│  ○  Run the existing test suite                             │
│  ○  Manual smoke test in browser                            │
│  ◉  Both                                                    │
│                                                             │
│                             [Cancel turn]  [Confirm ▶]     │
└─────────────────────────────────────────────────────────────┘
```

- Orange left border.
- "Required" badge when there is no default / timeout.
- Confirm is the primary CTA (keyboard: Enter). Cancel sends `abort()`.
- After response: orange tint fades, answer shown inline ("✓ Both"), card
  shrinks to one line.
- If pi cancels: "⚠ Request cancelled by agent".

---

## 5. Input composer

```
┌──────────────────────────────────────────────────────────────┐
│  Type a message, / for commands, @ to reference…  [Send ▶]  │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 Baseline behaviour

- **Enter** → send. **Shift+Enter** → newline.
- **Ctrl+K** → focus composer from anywhere.
- **↑ / ↓** → cycle through previously sent messages (shell history pattern).
  State is per-session, persisted in localStorage, capped at 100 entries.
- Multiline textarea, auto-grows up to ~5 lines then scrolls.
- Paste or drag images → attached as `images[]` in `prompt(msg, images)`.
  Preview thumbnails appear above the textarea.

### 5.2 Draft auto-save

Unsent composer text is saved to localStorage on every keystroke, keyed by
`sessionId`. On re-entry to the tab (or app relaunch), if a non-empty draft
exists a toast appears:

```
  ↩ Restore unsent message?   [Restore]  [Discard]
```

Restoring puts the draft back in the composer. Discarding clears it. The toast
times out after 8 s (auto-discards). Draft is deleted immediately on send.

### 5.3 Slash-command palette

Typing `/` at the start of the input (or on a fresh line) opens an autocomplete
overlay anchored above the composer.

```
┌───────────────────────────────────────────────────┐
│ /auto          Start auto-mode run       [skill]  │
│ /gsd status    Show milestone dashboard  [app]    │
│ /compact       Compact context           [pi]     │
│ /help          List all commands         [pi]     │
│ …                                                 │
└───────────────────────────────────────────────────┘
```

- Sources: **pi commands** (from `get_commands`) and **app commands** (static,
  `src/renderer/commands/app-commands.ts`).
- Source badges: `[pi]`, `[skill]`, `[extension]`, `[app]`.
- Fuzzy match on name + description. Arrow keys + Enter to select.
- Pi commands → submitted as `prompt()`. App commands → local handler, nothing
  sent to pi.

**UI-linked app commands** (intercepted before `prompt()`):

| Command | Local action |
|---|---|
| `/milestone-status` | Opens auto-run panel |
| `/model` | Opens model picker |
| `/cost` | Focuses cost gauge in header |
| `/sessions` | Opens session switcher |
| `/search` | Focuses the in-chat search bar (see §10) |
| `/theme` | Opens appearance settings |

### 5.4 `@`-mention system

Typing `@` opens a contextual picker above the composer. Two categories:

**Files** — scoped to the project root, fuzzy-matched by path. Selecting inserts
a repo-relative path (`@src/main/session-manager.ts`). Sent verbatim to pi; pi
resolves it.

**GSD artifacts** — available when `.gsd/` exists in the project:

| Mention | Resolves to |
|---|---|
| `@M002` / `@milestone` | Current milestone context (`02-CONTEXT.md`) |
| `@S03` / `@slice` | Active slice plan |
| `@R007` / `@requirement` | Row from `REQUIREMENTS.md` |
| `@D003` / `@decision` | Row from `DECISIONS.md` |
| `@last-summary` | Most recent slice `SUMMARY.md` |

Artifact mentions inject the resolved content as additional context in the
`prompt()` call (prepended as a system-context block, not visible in the chat
bubble). The mention token remains visible in the user bubble for traceability.

---

## 6. Mid-turn queuing and steering

When the session state is **Working** or **Auto**, the composer changes:

```
┌──────────────────────────────────────────────────────────────┐
│  What you type here will be queued…           [Queue ▾] [✕]  │
└──────────────────────────────────────────────────────────────┘
```

### 6.1 Queue mode

Queued messages are held in `pendingQueue: string[]` in the renderer store. A
"Queued (N)" indicator appears above the composer. Clicking it opens a stack
overlay listing queued messages with remove buttons.

On `agent_end`, the first queued message is dequeued and submitted as `prompt()`.
Continues until empty.

Queued messages render in chat as right-aligned grey-tinted bubbles with ⏳. When
consumed the badge drops and the bubble gets the normal accent tint.

### 6.2 Steer / Follow-up

`[Queue ▾]` opens a dropdown:

```
  Queue (default)
  ──────
  ✦ Steer agent now
  ✦ Follow-up after this turn
```

- **Steer** → `steer(msg)`. Shown only when `steer` is in `init.capabilities.commands`.
  A "Steering…" indicator appears in the stream between the current tool cards
  and the next text block.
- **Follow-up** → `follow_up(msg)`. Shown only when `follow_up` is in capabilities.
- If neither is supported, the dropdown is suppressed and only Queue is available.

### 6.3 Abort

The `✕` button calls `abort()`. In auto-mode, a confirmation modal appears first:
"This will stop auto-mode. Are you sure?".

---

## 7. Auto-scroll behaviour

### 7.1 Scroll states

- **Pinned**: within 80 px of bottom. New messages scroll the view down.
- **Detached**: user scrolled above the threshold. Auto-scroll suspended.

### 7.2 Transitions

| Event | Behaviour |
|---|---|
| New message arrives | Pinned → scroll down. Detached → append silently. |
| User scrolls up > 80 px | → Detached |
| User scrolls to within 80 px of bottom | → Pinned |
| User sends a message | → Pinned (always) |
| UI-request arrives | → Pinned (always — must be seen) |
| Search activated | → Detached (suspends auto-scroll for search) |

**Active scroll guard:** Programmatic `scrollTo` is frozen during an active
pointer drag and for 500 ms after the last manual scroll event.

### 7.3 "Jump to latest" button

Floating pill, bottom-right, Detached state only:

```
   ╭─────────────────────╮
   │  ↓  Jump to latest  │
   ╰─────────────────────╯
```

Shows a count badge when messages arrived while detached: "↓ 3 new". Clicking
smooth-scrolls to bottom and enters Pinned. Fades out when the user manually
scrolls to the bottom.

### 7.4 Implementation notes

- `ResizeObserver` + `MutationObserver` on the list container for content height
  changes; never `setInterval`.
- Virtualised list scroll anchor: `scrollToIndex` with the anchor item, not raw
  pixel offset — prevents prepend jumps when loading history.
- All programmatic `scrollTo` calls deferred via `requestAnimationFrame`.

---

## 8. Ambient session health bar

During **Auto** state, a non-intrusive sticky bar appears at the top of the
chat pane (below the auto-run progression panel):

```
  Auto-mode  ·  M002 S03 T02  ·  Context 71%  ·  ⏱ 23m  ·  $1.24
```

- Single line, `--text-sm`, `--color-text-secondary`, no borders.
- Updates live from `cost_update` and `tool_use` events.
- Disappears when auto-mode ends (`agent_end` with no queued messages).
- Suppressed in regular interactive mode (would add noise with no benefit).

### 8.1 Context-full nudge

When the context window reaches **85 %** (derived from `get_session_stats`),
a system event pill is injected into the chat scroll at the current position:

```
        ─────  Context window 87% full  ─────
              [Run /compact now]  [Dismiss]
```

- Styled as a wide system event pill (full-width, centred, `--color-status-warn`
  tint) rather than a modal or toast — it lives in the scroll alongside the
  conversation so it's seen at the right moment without interrupting flow.
- **[Run /compact now]** sends `/compact` as a `prompt()` call. The button
  label changes to "Compacting…" and the pill becomes non-interactive until
  the turn completes.
- **[Dismiss]** hides the pill for the rest of the session. Context gauge in
  the header continues to reflect the true value.
- The nudge fires **once per 85 % crossing** — if the user compacts and the
  gauge drops below 85 %, then climbs back over, a new pill appears. If
  dismissed, no further nudge until a new session.
- Shown in both interactive and auto-mode. In auto-mode it is especially
  useful — the agent may be deep in a task when context fills and the user
  is not watching the header gauge.
- pi is never automatically compacted without user action (button press).
- Implementation: `useSessionStats` hook in the renderer watches the
  `contextPercent` value and dispatches a `CONTEXT_WARN` synthetic chat item
  when threshold is crossed and the nudge hasn't been dismissed.

---

## 9. Message actions (hover menu)

Hovering a user message or agent text block reveals an icon row at the
top-right corner of the item:

| Icon | Action |
|---|---|
| ⎘ | Copy message text to clipboard |
| 🔁 | Fork from this turn (`fork({ entryId })` + re-submit) |
| ✏ | Edit & re-send (loads text into composer for editing) |
| ⋯ | More: "Copy as Markdown", "Copy turn JSON" |

For tool cards, the hover menu adds:

| Icon | Action |
|---|---|
| ⎘ | Copy output |
| 📂 | Reveal file in Explorer |
| ⊞ | Diff against current disk version |

---

## 10. In-chat search

`Ctrl+F` (or `/search` app command) opens a search bar anchored to the top of
the chat pane:

```
┌────────────────────────────────────── ✕ ─┐
│ 🔍  session manager          3 of 17  ↑ ↓│
└──────────────────────────────────────────┘
```

- Matches highlighted inline in yellow across all rendered text, code blocks,
  and tool card headers.
- `Enter` / `↓` → next match; `Shift+Enter` / `↑` → previous.
- While search is active, scroll state is forced Detached. Closing search
  returns to the previous scroll state.
- Thinking block content is excluded from search (it's process, not output).
- `Escape` closes search and returns focus to composer.

---

## 11. Accessibility

- All interactive elements keyboard-reachable.
- Tool cards, thinking blocks, and collapse toggles: `aria-expanded`.
- "Jump to latest" button: announced via `aria-live="polite"` on first appear.
- Streaming text: `aria-live="polite"` region.
- `ThinkingIndicator`: `aria-label="Agent is thinking"`, `aria-busy`.
- Search bar: `role="search"`, result count announced on change.
- Code blocks: `role="region"` with descriptive `aria-label`.
- Colour is never the only differentiator — icons and labels always accompany
  colour signals.

---

## 12. Empty and loading states

| Scenario | Chat pane shows |
|---|---|
| Brand-new session | Starter suggestion grid: 4 cards ("Start auto-mode", "Show milestone status", "Ask a question", "Run tests"). Cards pre-fill composer on click. |
| History loading | Skeleton rows (matching expected turn shapes). |
| History unavailable | "History stored by pi — unavailable" pill at top. |
| Turn in progress | `ThinkingIndicator` then streaming cursor `▌`. |
| Session disconnected | Banner: "⚠ Session disconnected — [Retry] [Close tab]". Composer disabled. |
| No suggestions to show | Suggest follow-ups row is simply omitted. |

---

## 13. Feature — implementation phase mapping

Not all features ship in the same milestone. Dependency order:

| Feature | When |
|---|---|
| Streaming text, tool cards, UI-request inline, auto-scroll | Phase 2 (UI request bridge) — core chat infrastructure |
| `ThinkingIndicator`, per-turn cost strip, message hover menu | Phase 2 — low-effort additions alongside core |
| Slash-command palette (`/`) | Phase 2 — pi `get_commands` already wired |
| Draft auto-save, composer history ↑/↓ | Phase 2 — pure localStorage, zero RPC changes |
| Thinking / reasoning blocks | Phase 2 — if `thinking` events are in pi's stream |
| Suggested follow-ups (heuristic) | Phase 3 — needs one turn of history to be useful |
| `@`-mention file picker | Phase 3 — project root navigation needed |
| `@`-mention GSD artifacts | Phase 3 — `.gsd/` parsing, depends on project open |
| Code block Apply / Diff actions | Phase 3 — needs git integration |
| "What changed" diff card | Phase 3 — needs git diff after turn |
| In-chat search (`Ctrl+F`) | Phase 4 — needs virtualised list to be stable first |
| Turn branching indicator | Phase 4 — needs fork session tracking across tabs |
| Ambient session health bar | Phase 5 (auto-mode view) — depends on auto-run panel |

---

## 14. Relationship to other design docs

- Layout and window model: [40-ui-design.md](./40-ui-design.md)
- Design tokens, theming, `ThinkingIndicator` component: [41-design-system.md](./41-design-system.md)
- UI-request modals (background-tab path): [40-ui-design.md §The UI-request bridge](./40-ui-design.md)
- Auto-run progression panel above the chat: [50-auto-run-view.md](./50-auto-run-view.md)
- RPC events driving the stream: [20-pi-integration.md](./20-pi-integration.md)
- Copilot device-code special-case: [70-auth-github-copilot.md](./70-auth-github-copilot.md)

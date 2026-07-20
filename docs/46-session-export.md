# Session Export

This document specifies what session export produces, the formats offered, the
UI entry points, and what is explicitly excluded.

Cross-references [30-persistence.md](./30-persistence.md) for what pi owns
(session files) vs what we own (registry), and
[45-chat-experience.md](./45-chat-experience.md) for the message rendering
that export mirrors.

---

## 1. Purpose

Export lets users archive a conversation, share it with a colleague, file a
bug report with context, or keep a local copy outside pi's session store.

---

## 2. Export formats

| Format | Use case | Contents |
|---|---|---|
| **Markdown** | Readable archive, sharing, docs | All turns as formatted Markdown |
| **JSON** | Machine-readable, debugging | Raw turn list with metadata |

HTML export is deliberately out of scope for v1 — Markdown is sufficient and
avoids owning a rendered template.

---

## 3. What is included

Both formats include, for every turn:

- **User messages** — full text.
- **Agent text** — full text.
- **Thinking blocks** — included if `settings.chat.showThinkingBlocks` is
  true at export time; omitted otherwise. Clearly labelled `[Thinking]`.
- **Tool calls** — tool name, arguments, output. Collapsed in Markdown (fenced
  code block), expanded in JSON.
- **System events** — session-start marker, model-change events, compaction
  events. Brief one-line entries.
- **Metadata header** — session display name, project path, date range,
  model used, total cost, total tokens.

---

## 4. What is excluded

- **Auth tokens, API keys** — never present in session data; nothing to redact.
- **`.gsd/` files** — the export is conversation-only. GSD state
  (roadmaps, plans, decisions) lives in the project directory and is the
  user's to manage.
- **pi's internal session file** (`.jsonl`) — the export is a rendered view,
  not a copy of pi's raw wire format. Users who want the raw file can find it
  at the path shown in Settings → Advanced.
- **Incomplete/streaming turns** — export is only available when the session
  is Idle (no active turn).

---

## 5. Markdown format

```markdown
# gsd-tau session — gsd-tau project
**Date:** 2026-07-15 09:14 → 2026-07-20 11:42
**Model:** anthropic/claude-sonnet-4-5
**Total cost:** $3.42  |  **Total tokens:** 412,800

---

## Turn 1 — 2026-07-15 09:14

**You:** Add a settings screen for theme selection.

**Assistant:**

I'll start by reading the existing preferences structure…

<details><summary>read · src/main/settings.ts</summary>

```
(file content)
```

</details>

Here's the updated settings screen. I've added…

---
```

- H2 heading per turn, with timestamp.
- Tool calls rendered as `<details><summary>` so they are collapsed by
  default in most Markdown renderers but expand on click.
- Thinking blocks rendered as `> [Thinking] …` block quotes, only when
  included.
- Code blocks use fenced syntax with language hint where known.

---

## 6. JSON format

```jsonc
{
  "exportVersion": 1,
  "session": {
    "displayName": "gsd-tau project",
    "projectCwd": "D:/Projects/gsd-tau",
    "model": "anthropic/claude-sonnet-4-5",
    "exportedAt": "2026-07-20T11:42:00Z",
    "cost": 3.42,
    "tokens": { "total": 412800, "input": 380000, "output": 32800 }
  },
  "turns": [
    {
      "id": "turn_01",
      "createdAt": "2026-07-15T09:14:22Z",
      "user": { "text": "Add a settings screen for theme selection." },
      "agent": {
        "thinking": null,
        "text": "I'll start by reading the existing preferences structure…",
        "toolCalls": [
          {
            "tool": "read",
            "input": { "path": "src/main/settings.ts" },
            "output": "(file content)"
          }
        ]
      },
      "cost": 0.08,
      "tokens": { "input": 4200, "output": 820 }
    }
  ]
}
```

---

## 7. UI entry points

### 7.1 Session overflow menu

Session header `⋮` → **Export session…**

Opens a small dialog:

```
┌─────────────────────────────────────────────────────────────┐
│  Export session                                         ✕   │
│                                                             │
│  Format                                                     │
│  ◉ Markdown (.md)    ○ JSON (.json)                        │
│                                                             │
│  Include thinking blocks                                    │
│  ☑ Include if present                                       │
│                                                             │
│  Filename                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ gsd-tau-session-2026-07-20.md                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│                              [Cancel]  [Save as…]          │
└─────────────────────────────────────────────────────────────┘
```

**[Save as…]** opens the native Windows Save dialog pre-seeded with the
suggested filename. On confirm, the file is written and a toast appears:
"Session exported to D:/…/gsd-tau-session-2026-07-20.md  [Show in Explorer]"

### 7.2 Keyboard shortcut

`Ctrl+Shift+E` — opens the export dialog for the active session.

### 7.3 Tab right-click menu

Right-click a session tab → **Export session…** — same dialog.

---

## 8. Availability guard

Export is only available when the session is in **Idle** state. The menu item
and keyboard shortcut are disabled (greyed out) while the session is Working,
Waiting, or Auto. Tooltip on hover: "Export is available after the current
turn completes."

---

## 9. Default filename

`{displayName}-session-{YYYY-MM-DD}.{ext}`, with the display name slugified
(lowercase, spaces to hyphens, non-alphanumeric stripped). Examples:
- `gsd-tau-session-2026-07-20.md`
- `website-rewrite-session-2026-07-20.json`

If a file with the same name already exists in the chosen directory, the
native Save dialog handles the conflict (Windows prompts to overwrite).

---

## 10. What we do not do

- **Batch export** (all sessions at once) — out of scope for v1.
- **Copy to clipboard** — Markdown turns can be copied turn-by-turn via the
  message hover menu (§9 of [45-chat-experience.md](./45-chat-experience.md)).
- **Auto-export on session close** — would be noisy and produce many files
  most users never want.
- **Encryption or password protection** — the export is a plain file; OS
  filesystem permissions apply.

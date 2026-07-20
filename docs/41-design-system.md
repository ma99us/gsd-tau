# Design System

This document defines the token layer, theming architecture, and component
library conventions for gsd-tau. All screens consume tokens — never raw colour
hex, pixel values, or font sizes. This makes skin/theme support a configuration
change, not a code change.

Cross-references [90-tech-stack.md](./90-tech-stack.md) for the Tailwind + Radix
stack and [45-chat-experience.md](./45-chat-experience.md) for chat-specific
usage.

---

## 1. Architecture overview

```
Design tokens (CSS custom properties)
        │
        ▼
Tailwind CSS — semantic utility classes that alias tokens
        │
        ▼
Radix UI primitives — accessible, unstyled component roots
        │
        ▼
gsd-tau component library  (src/renderer/ui/)
        │
        ▼
Feature screens  (src/renderer/features/*)
```

Feature screens import only from the component library. They never import
Tailwind utility classes for colours or spacing directly — they use the
semantic aliases defined in the library. Raw Tailwind utilities are allowed only
inside `src/renderer/ui/` itself.

---

## 2. Token categories

Tokens are declared as CSS custom properties on `:root` and overridden per theme.
They are grouped into three layers:

### 2.1 Primitive tokens (do not use in components)

Raw values that themes reference internally. Never referenced in components.

```css
/* src/renderer/ui/tokens/primitives.css */

/* Colour palette */
--primitive-neutral-0:   #ffffff;
--primitive-neutral-50:  #f8f9fa;
--primitive-neutral-100: #f1f3f5;
--primitive-neutral-200: #e9ecef;
--primitive-neutral-300: #dee2e6;
--primitive-neutral-400: #adb5bd;
--primitive-neutral-500: #6c757d;
--primitive-neutral-600: #495057;
--primitive-neutral-700: #343a40;
--primitive-neutral-800: #212529;
--primitive-neutral-900: #0d0f12;

--primitive-blue-300:    #74c0fc;
--primitive-blue-400:    #4dabf7;
--primitive-blue-500:    #339af0;
--primitive-blue-600:    #228be6;
--primitive-blue-700:    #1c7ed6;

--primitive-orange-400:  #ffa94d;
--primitive-orange-500:  #ff922b;

--primitive-green-400:   #69db7c;
--primitive-green-500:   #51cf66;

--primitive-red-400:     #ff8787;
--primitive-red-500:     #ff6b6b;

--primitive-amber-400:   #ffd43b;

--primitive-violet-500:  #845ef7;

/* Spacing scale (px) */
--primitive-space-0:   0px;
--primitive-space-1:   2px;
--primitive-space-2:   4px;
--primitive-space-3:   8px;
--primitive-space-4:   12px;
--primitive-space-5:   16px;
--primitive-space-6:   24px;
--primitive-space-7:   32px;
--primitive-space-8:   48px;
--primitive-space-9:   64px;

/* Radius */
--primitive-radius-sm:  4px;
--primitive-radius-md:  8px;
--primitive-radius-lg:  12px;
--primitive-radius-xl:  16px;
--primitive-radius-pill: 9999px;

/* Typography */
--primitive-font-sans:  'Inter', system-ui, -apple-system, sans-serif;
--primitive-font-mono:  'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;
--primitive-font-size-xs:   11px;
--primitive-font-size-sm:   12px;
--primitive-font-size-md:   13px;
--primitive-font-size-lg:   15px;
--primitive-font-size-xl:   18px;
--primitive-font-size-2xl:  22px;
--primitive-line-height-tight:  1.3;
--primitive-line-height-normal: 1.5;
--primitive-line-height-relaxed: 1.7;

/* Duration */
--primitive-duration-fast:    80ms;
--primitive-duration-normal:  160ms;
--primitive-duration-slow:    300ms;
--primitive-duration-slower:  500ms;

/* Easing */
--primitive-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--primitive-ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
--primitive-ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);
```

### 2.2 Semantic tokens (use in components)

Semantic tokens express intent, not visual appearance. Components always use
semantic tokens; themes override them.

```css
/* src/renderer/ui/tokens/semantic.css  — light theme default */

/* Surfaces */
--color-bg-app:           var(--primitive-neutral-100);
--color-bg-panel:         var(--primitive-neutral-0);
--color-bg-elevated:      var(--primitive-neutral-0);
--color-bg-sunken:        var(--primitive-neutral-50);
--color-bg-overlay:       rgba(0, 0, 0, 0.50);

/* Interactive surfaces */
--color-bg-interactive:        var(--primitive-neutral-200);
--color-bg-interactive-hover:  var(--primitive-neutral-300);
--color-bg-interactive-active: var(--primitive-neutral-400);
--color-bg-interactive-disabled: var(--primitive-neutral-100);

/* Accent (primary brand action) */
--color-accent:            var(--primitive-blue-600);
--color-accent-hover:      var(--primitive-blue-700);
--color-accent-subtle:     color-mix(in srgb, var(--primitive-blue-500) 12%, transparent);
--color-accent-on:         var(--primitive-neutral-0);   /* text on accent bg */

/* Text */
--color-text-primary:      var(--primitive-neutral-800);
--color-text-secondary:    var(--primitive-neutral-600);
--color-text-muted:        var(--primitive-neutral-400);
--color-text-disabled:     var(--primitive-neutral-300);
--color-text-on-accent:    var(--primitive-neutral-0);
--color-text-code:         var(--primitive-violet-500);

/* Borders */
--color-border:            var(--primitive-neutral-200);
--color-border-strong:     var(--primitive-neutral-300);
--color-border-focus:      var(--primitive-blue-500);

/* Semantic states */
--color-state-working:     var(--primitive-blue-500);
--color-state-waiting:     var(--primitive-orange-500);
--color-state-idle:        var(--primitive-neutral-400);
--color-state-done:        var(--primitive-green-500);
--color-state-stopped:     var(--primitive-red-500);
--color-state-auto:        var(--primitive-green-400);

/* Status signals */
--color-status-error:      var(--primitive-red-500);
--color-status-error-bg:   color-mix(in srgb, var(--primitive-red-500) 10%, transparent);
--color-status-warning:    var(--primitive-amber-400);
--color-status-warning-bg: color-mix(in srgb, var(--primitive-amber-400) 10%, transparent);
--color-status-success:    var(--primitive-green-500);
--color-status-success-bg: color-mix(in srgb, var(--primitive-green-500) 10%, transparent);
--color-status-info:       var(--primitive-blue-500);
--color-status-info-bg:    color-mix(in srgb, var(--primitive-blue-500) 10%, transparent);

/* Chat-specific */
--color-chat-user-bg:       var(--color-accent-subtle);
--color-chat-user-border:   var(--color-accent);
--color-chat-agent-bg:      transparent;
--color-chat-tool-bg:       var(--color-bg-sunken);
--color-chat-tool-border:   var(--color-border);
--color-chat-ui-request-bg:     var(--color-bg-panel);
--color-chat-ui-request-border: var(--color-state-waiting);
--color-chat-system-text:   var(--color-text-muted);
--color-chat-queued-bg:     color-mix(in srgb, var(--color-text-muted) 10%, transparent);

/* Spacing aliases (components use these names) */
--space-xs:   var(--primitive-space-2);
--space-sm:   var(--primitive-space-3);
--space-md:   var(--primitive-space-5);
--space-lg:   var(--primitive-space-6);
--space-xl:   var(--primitive-space-7);

/* Radius aliases */
--radius-sm:  var(--primitive-radius-sm);
--radius-md:  var(--primitive-radius-md);
--radius-lg:  var(--primitive-radius-lg);
--radius-pill: var(--primitive-radius-pill);

/* Typography aliases */
--font-sans:  var(--primitive-font-sans);
--font-mono:  var(--primitive-font-mono);
--text-xs:    var(--primitive-font-size-xs);
--text-sm:    var(--primitive-font-size-sm);
--text-md:    var(--primitive-font-size-md);
--text-lg:    var(--primitive-font-size-lg);
--text-xl:    var(--primitive-font-size-xl);
--leading-tight:   var(--primitive-line-height-tight);
--leading-normal:  var(--primitive-line-height-normal);
--leading-relaxed: var(--primitive-line-height-relaxed);

/* Motion */
--duration-fast:    var(--primitive-duration-fast);
--duration-normal:  var(--primitive-duration-normal);
--duration-slow:    var(--primitive-duration-slow);
--ease-standard:    var(--primitive-ease-standard);
--ease-spring:      var(--primitive-ease-spring);

/* Shadow */
--shadow-sm:  0 1px 2px rgba(0,0,0,0.06);
--shadow-md:  0 4px 8px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
--shadow-lg:  0 8px 24px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.05);
```

### 2.3 Component tokens (scoped overrides)

Individual components may define their own local tokens scoped to their root
element. This allows theme overrides at the component level without changing
semantics.

```css
/* Example: ThinkingIndicator component */
.thinking-indicator {
  --thinking-dot-color:  var(--color-state-working);
  --thinking-dot-size:   6px;
  --thinking-gap:        5px;
  --thinking-duration:   1.2s;
}
```

---

## 3. Dark theme

```css
/* src/renderer/ui/tokens/themes/dark.css */
[data-theme="dark"] {
  --color-bg-app:           var(--primitive-neutral-900);
  --color-bg-panel:         var(--primitive-neutral-800);
  --color-bg-elevated:      var(--primitive-neutral-700);
  --color-bg-sunken:        color-mix(in srgb, var(--primitive-neutral-900) 60%, black);

  --color-bg-interactive:        var(--primitive-neutral-700);
  --color-bg-interactive-hover:  var(--primitive-neutral-600);
  --color-bg-interactive-active: var(--primitive-neutral-500);
  --color-bg-interactive-disabled: var(--primitive-neutral-800);

  --color-accent:            var(--primitive-blue-400);
  --color-accent-hover:      var(--primitive-blue-300);
  --color-accent-subtle:     color-mix(in srgb, var(--primitive-blue-400) 15%, transparent);
  --color-accent-on:         var(--primitive-neutral-900);

  --color-text-primary:      var(--primitive-neutral-100);
  --color-text-secondary:    var(--primitive-neutral-400);
  --color-text-muted:        var(--primitive-neutral-500);
  --color-text-disabled:     var(--primitive-neutral-600);
  --color-text-code:         var(--primitive-violet-500);

  --color-border:            var(--primitive-neutral-700);
  --color-border-strong:     var(--primitive-neutral-600);

  --shadow-sm:  0 1px 2px rgba(0,0,0,0.20);
  --shadow-md:  0 4px 8px rgba(0,0,0,0.30), 0 1px 2px rgba(0,0,0,0.15);
  --shadow-lg:  0 8px 24px rgba(0,0,0,0.40), 0 2px 4px rgba(0,0,0,0.20);
}
```

Light theme is the default (`:root` values). Themes only override what differs.

---

## 4. Theme selection

### 4.1 User preference

Three modes selectable in app Preferences → Appearance:

| Mode | `data-theme` value | Resolution |
|---|---|---|
| **Light** | `light` | Always light |
| **Dark** | `dark` | Always dark |
| **System** (default) | `light` or `dark` | Follows OS `prefers-color-scheme` |

### 4.2 Implementation

**Main process** (once, at startup):
```ts
// src/main/theme.ts
ipcMain.handle('theme:get', () => store.get('theme', 'system'));
ipcMain.on('theme:set', (_, value: 'light' | 'dark' | 'system') => {
  store.set('theme', value);
  broadcastToAllWindows('theme:changed', value);
});

// Relay OS theme changes to all windows
nativeTheme.on('updated', () => {
  broadcastToAllWindows('theme:os-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});
```

**Renderer** (`src/renderer/ui/theme-provider.tsx`):
```tsx
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useThemeStore();    // 'light' | 'dark' | 'system'
  const [osTheme, setOsTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // Bootstrap from main
    window.gsd.theme.get().then(setTheme);
    window.gsd.theme.onChanged(setTheme);
    window.gsd.theme.onOsChanged(setOsTheme);
    // Detect OS on init
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setOsTheme(mq.matches ? 'dark' : 'light');
  }, []);

  const resolved = theme === 'system' ? osTheme : theme;

  return (
    <div data-theme={resolved} className="theme-root h-full">
      {children}
    </div>
  );
}
```

`data-theme` on the root element controls which CSS custom properties are active.
No JS-in-CSS, no runtime style injection — purely CSS cascade.

### 4.3 Skin/theme extensibility (deferred to later phase)

The token layer is designed to support additional themes without code changes:

- Themes are CSS files that override semantic tokens on `[data-theme="<name>"]`.
- A theme manifest (`theme.json`) declares the theme name, author, and the CSS
  file path.
- The theme loader in `ThemeProvider` reads a `<link>` element to inject external
  theme CSS. Nothing in feature code needs to change.
- This is **explicitly out of scope for v1**. The architecture just doesn't
  prevent it.

---

## 5. Tailwind integration

`tailwind.config.ts` maps utility classes to CSS custom properties so components
use semantic names, not hardcoded values:

```ts
// tailwind.config.ts
export default {
  content: ['./src/renderer/**/*.{tsx,ts}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        'bg-app':         'var(--color-bg-app)',
        'bg-panel':       'var(--color-bg-panel)',
        'bg-elevated':    'var(--color-bg-elevated)',
        'bg-sunken':      'var(--color-bg-sunken)',
        // Interactive
        'bg-interactive':         'var(--color-bg-interactive)',
        'bg-interactive-hover':   'var(--color-bg-interactive-hover)',
        // Accent
        'accent':         'var(--color-accent)',
        'accent-hover':   'var(--color-accent-hover)',
        'accent-subtle':  'var(--color-accent-subtle)',
        'accent-on':      'var(--color-accent-on)',
        // Text
        'text-primary':   'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted':     'var(--color-text-muted)',
        'text-code':      'var(--color-text-code)',
        // Borders
        'border':         'var(--color-border)',
        'border-strong':  'var(--color-border-strong)',
        'border-focus':   'var(--color-border-focus)',
        // States
        'state-working':  'var(--color-state-working)',
        'state-waiting':  'var(--color-state-waiting)',
        'state-idle':     'var(--color-state-idle)',
        'state-done':     'var(--color-state-done)',
        'state-stopped':  'var(--color-state-stopped)',
        'state-auto':     'var(--color-state-auto)',
        // Status
        'status-error':       'var(--color-status-error)',
        'status-error-bg':    'var(--color-status-error-bg)',
        'status-warning':     'var(--color-status-warning)',
        'status-warning-bg':  'var(--color-status-warning-bg)',
        'status-success':     'var(--color-status-success)',
        'status-success-bg':  'var(--color-status-success-bg)',
        // Chat
        'chat-user-bg':       'var(--color-chat-user-bg)',
        'chat-agent-bg':      'var(--color-chat-agent-bg)',
        'chat-tool-bg':       'var(--color-chat-tool-bg)',
        'chat-ui-request-border': 'var(--color-chat-ui-request-border)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        xs:  'var(--text-xs)',
        sm:  'var(--text-sm)',
        md:  'var(--text-md)',
        lg:  'var(--text-lg)',
        xl:  'var(--text-xl)',
      },
      borderRadius: {
        sm:   'var(--radius-sm)',
        md:   'var(--radius-md)',
        lg:   'var(--radius-lg)',
        pill: 'var(--radius-pill)',
      },
      spacing: {
        xs: 'var(--space-xs)',
        sm: 'var(--space-sm)',
        md: 'var(--space-md)',
        lg: 'var(--space-lg)',
        xl: 'var(--space-xl)',
      },
      transitionDuration: {
        fast:   'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow:   'var(--duration-slow)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
    },
    // Disable default Tailwind colour palette — no raw colours in components
    colors: {},
  },
  plugins: [],
};
```

With `colors: {}` the default Tailwind palette is disabled. The only colour
classes available are the semantic aliases above. This makes a hardcoded colour
a type error (no class will exist).

---

## 6. Component library

Location: `src/renderer/ui/`

```
src/renderer/ui/
  tokens/
    primitives.css
    semantic.css
    themes/
      dark.css
  ThemeProvider.tsx
  index.ts                  ← re-exports everything; feature code imports from here
  components/
    Button.tsx
    IconButton.tsx
    Input.tsx
    Textarea.tsx
    Card.tsx
    Badge.tsx
    Pill.tsx
    Tooltip.tsx
    DropdownMenu.tsx
    Dialog.tsx
    Separator.tsx
    ScrollArea.tsx
    CodeBlock.tsx
    MarkdownRenderer.tsx
    ThinkingIndicator.tsx   ← see §7
    StatusDot.tsx
    ProgressBar.tsx
    Skeleton.tsx
    Avatar.tsx
    Kbd.tsx                 ← keyboard shortcut label
```

### 6.1 Component conventions

- Every component accepts a `className?: string` prop for layout overrides (margin,
  width). Internal colours and spacing never override via className — use tokens.
- No component hardcodes colours, sizes, or font values. All values reference CSS
  custom properties via Tailwind semantic aliases.
- All interactive components use Radix UI as the accessible primitive root.
- Components export their TypeScript prop types from `index.ts`.
- No component imports from `src/renderer/features/` — the dependency is
  one-directional: features → ui, never ui → features.

### 6.2 Example: Button

```tsx
// src/renderer/ui/components/Button.tsx
import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

const button = cva(
  // Base — semantic tokens only
  'inline-flex items-center gap-sm rounded-md font-sans text-sm font-medium ' +
  'transition-colors duration-fast ease-standard focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-border-focus disabled:pointer-events-none ' +
  'disabled:text-text-muted disabled:bg-bg-interactive-disabled',
  {
    variants: {
      variant: {
        primary:  'bg-accent text-accent-on hover:bg-accent-hover',
        ghost:    'bg-transparent text-text-secondary hover:bg-bg-interactive',
        danger:   'bg-status-error-bg text-status-error hover:bg-status-error',
      },
      size: {
        sm: 'h-7 px-sm text-xs',
        md: 'h-8 px-md',
        lg: 'h-10 px-lg text-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={button({ variant, size, className })} {...props} />;
  }
);
Button.displayName = 'Button';
```

---

## 7. Thinking / progress animation

Shown whenever the session state is **Working** or **Auto** and the agent has not
yet produced any text in the current turn (i.e. the stream has started but only
tool calls have appeared, or we are waiting for the first token).

### 7.1 Visual design

Three animated dots in a smooth stagger:

```
  Agent   ●  ●  ●
           ↑   sequentially bounce, offset by 160ms each
```

- Dot size: `var(--thinking-dot-size)` → 6 px default.
- Dot colour: `var(--thinking-dot-color)` → `--color-state-working` (blue).
- Animation: vertical translate −4 px with ease-in-out, loop duration 1.2 s.
- Each dot offset by `duration / 3` from its predecessor.
- Appears 200 ms after the turn starts (prevents flash for instant responses).
- Fades out (opacity 0, 160 ms) when the first `text_delta` or tool card arrives.

### 7.2 Component

```tsx
// src/renderer/ui/components/ThinkingIndicator.tsx
import { useEffect, useState } from 'react';

interface ThinkingIndicatorProps {
  visible: boolean;
  delayMs?: number;   // default 200
}

export function ThinkingIndicator({ visible, delayMs = 200 }: ThinkingIndicatorProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!visible) { setShown(false); return; }
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [visible, delayMs]);

  return (
    <div
      aria-label="Agent is thinking"
      aria-live="polite"
      aria-busy={shown}
      className={
        'thinking-indicator flex items-center gap-[var(--thinking-gap)] h-5 ' +
        'transition-opacity duration-normal ' +
        (shown ? 'opacity-100' : 'opacity-0 pointer-events-none')
      }
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="thinking-dot rounded-pill bg-state-working"
          style={{
            width:  'var(--thinking-dot-size)',
            height: 'var(--thinking-dot-size)',
            animationDelay: `${i * 160}ms`,
          }}
        />
      ))}
    </div>
  );
}
```

CSS (in `src/renderer/ui/tokens/animations.css`):

```css
.thinking-indicator {
  --thinking-dot-color:   var(--color-state-working);
  --thinking-dot-size:    6px;
  --thinking-gap:         5px;
  --thinking-duration:    1.2s;
}

@keyframes thinking-bounce {
  0%, 60%, 100% { transform: translateY(0);    opacity: 0.4; }
  30%           { transform: translateY(-4px); opacity: 1;   }
}

.thinking-dot {
  background: var(--thinking-dot-color);
  animation: thinking-bounce var(--thinking-duration) ease-in-out infinite;
}

/* Respect reduced-motion preference */
@media (prefers-reduced-motion: reduce) {
  .thinking-dot { animation: none; opacity: 0.6; }
}
```

### 7.3 Placement in the chat pane

The `ThinkingIndicator` renders as the last item in the current turn group,
immediately after any tool cards, on the agent text's left margin (same
horizontal position as agent text). It is replaced — not hidden — by the first
`text_delta` span.

### 7.4 Secondary indicators

| Surface | What shows |
|---|---|
| Tab badge | Blue dot with subtle CSS spin while Working (existing, see [40-ui-design.md](./40-ui-design.md)) |
| Composer | Send button disabled, "⏳" prefix on Queue button label |
| Status bar (if added later) | "Thinking…" text with the same three-dot animation |

---

## 8. Skeleton loading

When history is loading or a panel data-fetch is in progress, content areas are
replaced with `<Skeleton>` bars of the same dimensions as the expected content.
No spinner or loading text — the shape conveys that content is coming.

```tsx
// src/renderer/ui/components/Skeleton.tsx
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={
        'bg-bg-interactive animate-pulse rounded-md ' + (className ?? '')
      }
    />
  );
}
```

Use: `<Skeleton className="h-4 w-3/4" />` — layout classes are the only
external customisation; internals stay token-driven.

---

## 9. Rules for feature code

1. **Import from `ui/index.ts`** — never import a UI component's file directly.
2. **Never use raw hex, rgb(), or named CSS colours** in TSX or inline styles.
   Use Tailwind semantic classes or CSS custom properties.
3. **Never use raw pixel values** in inline `style` props for spacing or radius.
   Use `--space-*` or `--radius-*` custom properties.
4. **Never use `@media (prefers-color-scheme)` in component code** — the
   `ThemeProvider` handles this. Components see only `data-theme`.
5. **Animation: always include a `prefers-reduced-motion` counterpart** in the
   CSS, either as no-animation or a static fallback.
6. **No `z-index` literals** — use a z-index token layer (to be added when the
   first stacking context is needed): `--z-dropdown`, `--z-modal`, `--z-toast`.

---

## 10. File locations summary

| File | Purpose |
|---|---|
| `src/renderer/ui/tokens/primitives.css` | Raw values, never used in components |
| `src/renderer/ui/tokens/semantic.css` | Semantic mapping, light theme default |
| `src/renderer/ui/tokens/themes/dark.css` | Dark theme overrides |
| `src/renderer/ui/tokens/animations.css` | Keyframes (`thinking-bounce`, future) |
| `tailwind.config.ts` | Maps Tailwind classes to CSS custom properties |
| `src/renderer/ui/ThemeProvider.tsx` | OS detection + IPC theme sync |
| `src/renderer/ui/index.ts` | Single public re-export barrel |
| `src/renderer/ui/components/` | Library components |
| `src/main/theme.ts` | IPC handlers + nativeTheme relay |

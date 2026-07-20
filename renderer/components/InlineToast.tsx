import type { RpcExtensionUIRequest } from '@shared/types'

// ── Narrowed request type ─────────────────────────────────────────────────────

type NotifyRequest = Extract<RpcExtensionUIRequest, { method: 'notify' }>

export type { NotifyRequest }

// ── Model ─────────────────────────────────────────────────────────────────────

export interface ToastEntry {
  /** Unique ID for this toast — taken from the pi request id. */
  id: string
  message: string
  notifyType: 'info' | 'warning' | 'error'
}

/** Maximum simultaneously visible toasts. */
export const TOAST_MAX = 3

/** Auto-dismiss delay in milliseconds. */
export const TOAST_TTL_MS = 4_000

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Build a ToastEntry from a `notify` extension-UI request.
 * `notifyType` defaults to `'info'` when absent.
 */
export function buildToastEntry(request: NotifyRequest): ToastEntry {
  return {
    id: request.id,
    message: request.message,
    notifyType: request.notifyType ?? 'info',
  }
}

/**
 * Add a new toast to the stack, enforcing the `TOAST_MAX` cap.
 * When the cap is reached the *oldest* entry (index 0) is removed first.
 * Never mutates the input array.
 */
export function addToastCapped(toasts: ToastEntry[], entry: ToastEntry): ToastEntry[] {
  const next = [...toasts, entry]
  if (next.length > TOAST_MAX) {
    return next.slice(next.length - TOAST_MAX)
  }
  return next
}

// ── Component ─────────────────────────────────────────────────────────────────

interface InlineToastProps {
  toasts: ToastEntry[]
  onDismiss: (id: string) => void
}

/**
 * Stack of up to TOAST_MAX inline notification toasts.
 *
 * Auto-dismissal timers are managed by the parent (App.tsx) via setTimeout;
 * this component only provides the dismiss-button for immediate close.
 * Returns null when there are no toasts so it takes up no DOM space.
 */
export function InlineToast({ toasts, onDismiss }: InlineToastProps): JSX.Element | null {
  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-16 right-4 z-40 flex flex-col gap-2"
      aria-live="polite"
      aria-label="Notifications"
      data-testid="toast-container"
    >
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

// ── ToastItem ─────────────────────────────────────────────────────────────────

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastEntry
  onDismiss: (id: string) => void
}): JSX.Element {
  const colorClass =
    toast.notifyType === 'error'
      ? 'bg-red-900/90 border-red-700 text-red-200'
      : toast.notifyType === 'warning'
        ? 'bg-yellow-900/90 border-yellow-700 text-yellow-200'
        : 'bg-neutral-800/90 border-neutral-600 text-neutral-200'

  const icon =
    toast.notifyType === 'error'
      ? '✕'
      : toast.notifyType === 'warning'
        ? '⚠'
        : 'ℹ'

  return (
    <div
      className={[
        'pointer-events-auto flex items-start gap-2.5',
        'rounded-lg border px-3 py-2.5',
        'shadow-lg backdrop-blur-sm',
        'w-72 max-w-sm',
        colorClass,
      ].join(' ')}
      role="status"
      aria-atomic="true"
      data-testid={`toast-${toast.id}`}
    >
      <span className="mt-px shrink-0 text-xs" aria-hidden="true">
        {icon}
      </span>
      <p className="flex-1 text-xs leading-snug">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="mt-px shrink-0 text-xs opacity-60 transition-opacity hover:opacity-100"
        aria-label={`Dismiss: ${toast.message}`}
      >
        ✕
      </button>
    </div>
  )
}

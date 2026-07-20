import type { RpcExtensionUIRequest } from '@shared/types'

/**
 * Non-blocking UI-request methods handled inline without a modal.
 * Any method NOT in this set requires a blocking modal response.
 */
export const NON_MODAL_METHODS = new Set<string>([
  'notify',
  'setStatus',
  'setWidget',
  'setTitle',
  'set_editor_text',
])

/**
 * Returns true when the request method requires a blocking modal response.
 * Known blocking methods: select, confirm, input, editor.
 * Any unknown future method also returns true — FallbackModal handles it.
 */
export function isBlockingMethod(method: string): boolean {
  return !NON_MODAL_METHODS.has(method)
}

/**
 * Ordered queue of pending modal requests.
 * Index 0 is the active (frontmost) modal; the rest are queued behind it.
 */
export type ModalQueue = RpcExtensionUIRequest[]

/**
 * Append a new blocking request to the end of the queue.
 * Never mutates the original array.
 */
export function enqueueModal(
  queue: ModalQueue,
  request: RpcExtensionUIRequest,
): ModalQueue {
  return [...queue, request]
}

/**
 * Remove the head of the queue (the active modal that was just answered).
 * Never mutates the original array.  Safe to call on an empty queue.
 */
export function dequeueModal(queue: ModalQueue): ModalQueue {
  return queue.slice(1)
}

/**
 * Remove a specific request by id from anywhere in the queue.
 * Used when pi cancels a blocker externally via a ui-request-removed event
 * before the user answers (e.g. a pi-side timeout).
 * Never mutates the original array.  No-op when the id is not present.
 */
export function removeFromQueue(
  queue: ModalQueue,
  requestId: string,
): ModalQueue {
  return queue.filter(r => r.id !== requestId)
}

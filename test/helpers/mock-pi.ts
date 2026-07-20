/**
 * Helpers for ui-requests.spec.ts — mock pi test infrastructure.
 *
 * MOCK_PI_SERVER_PATH points to mock-pi-server.cjs, a pre-built CommonJS script
 * that implements the v2 RPC protocol over stdio.  Pass it as GSD_TAU_MOCK_PI
 * when launching Electron in Playwright tests.
 *
 * Scenario format (GSD_TAU_MOCK_SCENARIO):
 *   JSON.stringify(scenarios: MockScenario[])
 *   where scenarios[N] is the events emitted after the N-th `prompt` command.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Absolute path to the standalone mock-pi server script (CommonJS). */
export const MOCK_PI_SERVER_PATH: string = join(__dirname, 'mock-pi-server.cjs')

/**
 * A single event object to emit after a prompt.
 * `_delay` is consumed by the server (not forwarded to the app) as extra wait time (ms).
 * All other fields are forwarded verbatim.
 */
export interface MockEvent {
  type: string
  id?: string
  method?: string
  title?: string
  options?: string[]
  allowMultiple?: boolean
  secure?: boolean
  message?: string
  text?: string
  _delay?: number
  [key: string]: unknown
}

/**
 * Events to emit for one prompt invocation.
 * Pass as an element of the array given to GSD_TAU_MOCK_SCENARIO.
 */
export type MockScenario = MockEvent[]

/**
 * Read all recorded extension_ui_response payloads from the response file.
 * Returns {} when the file does not yet exist or is unreadable.
 */
export function readResponses(
  responseFile: string,
): Record<string, Record<string, unknown>> {
  if (!existsSync(responseFile)) return {}
  try {
    return JSON.parse(readFileSync(responseFile, 'utf8')) as Record<
      string,
      Record<string, unknown>
    >
  } catch {
    return {}
  }
}

/**
 * Poll the response file until every `requestId` has a recorded entry, or
 * the deadline elapses.  Returns whatever is recorded at that point.
 *
 * Useful after app.close() when checking cancellation responses.
 */
export async function waitForResponses(
  responseFile: string,
  requestIds: string[],
  deadlineMs = 10_000,
): Promise<Record<string, Record<string, unknown>>> {
  const end = Date.now() + deadlineMs
  while (Date.now() < end) {
    const r = readResponses(responseFile)
    if (requestIds.every(id => id in r)) return r
    await new Promise<void>(resolve => setTimeout(resolve, 100))
  }
  return readResponses(responseFile)
}

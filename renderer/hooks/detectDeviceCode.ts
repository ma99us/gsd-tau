/**
 * detectDeviceCode.ts — heuristic parser for GitHub Copilot's device-code
 * login flow, surfaced to us as a plain `notify` extension-UI request.
 *
 * See docs/70-auth-github-copilot.md "Special renderer for the device-code
 * notify": pi's `/login github-copilot` flow emits a `notify` whose message
 * body contains a verification URL and a short alphanumeric user code (the
 * GitHub device-flow shape is typically `XXXX-XXXX`, e.g. "ABCD-1234").
 *
 * Detection is intentionally heuristic — if the shape doesn't match we fall
 * through to the plain `notify` toast (see SessionView.tsx), so there is no
 * data loss if pi ever changes its message wording.
 */

/** Parsed device-code shape extracted from a notify message body. */
export interface DeviceCodeMatch {
  /** Verification URL the user should visit (e.g. "https://github.com/login/device"). */
  url: string
  /** Short user code to enter at `url` (e.g. "ABCD-1234"). */
  code: string
}

// Matches http(s) URLs up to the first whitespace character.
const URL_RE = /https?:\/\/\S+/

// Matches a short alphanumeric device code, optionally hyphenated in groups
// (GitHub's shape is 4-4, but be lenient: 3-10 alnum chars per group). The
// non-hyphenated fallback additionally requires at least one digit in the
// match (via lookahead) so ordinary English words in the surrounding prose
// (e.g. "continue", "separate") are never mistaken for a code.
const CODE_RE = /\b[A-Z0-9]{3,10}-[A-Z0-9]{3,10}\b|\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,10}\b/i

/**
 * Attempt to parse a device-code URL + code pair out of a notify message.
 *
 * Returns `null` when either piece is missing — callers should fall back to
 * rendering the plain notify toast in that case.
 *
 * @example
 * parseDeviceCodeNotify('Enter code ABCD-1234 at https://github.com/login/device')
 * // → { url: 'https://github.com/login/device', code: 'ABCD-1234' }
 */
export function parseDeviceCodeNotify(message: string): DeviceCodeMatch | null {
  const urlMatch = URL_RE.exec(message)
  if (!urlMatch) return null

  // Search for the code in the message with the URL stripped out, so the URL
  // itself (which may contain path segments that look code-like) never
  // accidentally matches CODE_RE.
  const withoutUrl = message.slice(0, urlMatch.index) + message.slice(urlMatch.index + urlMatch[0].length)
  const codeMatch = CODE_RE.exec(withoutUrl)
  if (!codeMatch) return null

  return { url: urlMatch[0], code: codeMatch[0].toUpperCase() }
}

/** Keywords indicating the device-code flow finished successfully. */
const SUCCESS_RE = /sign(ed)?[- ]?in|succ(ess|eed(ed)?)|authoriz(ed|ation complete)|logged in/i

/** Keywords indicating the device-code flow failed or expired. */
const FAILURE_RE = /fail(ed|ure)?|expir(ed|es)|denied|error|cancel(led)?/i

/**
 * Classify a follow-up `notify` message that arrives while a Copilot login
 * modal is open (polling status / success / failure).
 *
 * Order matters: success keywords are checked first so a message like
 * "Sign-in successful" is not miscategorised as neither by an overzealous
 * failure regex.
 */
export function classifyLoginStatus(message: string): 'success' | 'failure' | 'pending' {
  if (SUCCESS_RE.test(message)) return 'success'
  if (FAILURE_RE.test(message)) return 'failure'
  return 'pending'
}




import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { GsdNodeStatus } from '../../shared/types'

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Result of a Path B reconciliation pass against a ROADMAP.md file.
 * Callers merge {@link sliceStatuses} into a live {@link ProgressTracker}
 * snapshot to correct any drift accumulated by Path A (tool_use events).
 */
export interface ReconcileResult {
  /**
   * Authoritative slice statuses parsed from ROADMAP.md checkbox syntax.
   *
   * Key: slice ID (e.g. `"S01"`).
   * Value: `'complete'` for `[x]` lines, `'pending'` for `[ ]` lines.
   *
   * In-progress and skipped statuses are not observable from a static ROADMAP.md
   * and remain the responsibility of Path A (tool_use tracking).
   */
  sliceStatuses: Map<string, GsdNodeStatus>

  /**
   * `true` when the ROADMAP.md file was found and contained at least one
   * recognisable `- [x]` / `- [ ]` slice entry.
   *
   * `false` when the file is missing, unreadable, or empty — callers should
   * keep existing Path A data rather than overwriting with an empty map.
   */
  hasData: boolean
}

// ── Pure parser ────────────────────────────────────────────────────────────────

/**
 * Parse ROADMAP.md checkbox lines into a `sliceId → status` map.
 *
 * **This is a pure function — no filesystem access.** Exported so it can be
 * tested directly with inline fixture strings.
 *
 * Recognised line format (rendered by `gsd_plan_milestone`):
 * ```
 * - [x] **S01: <title>** `risk:low` `depends:[]`
 * - [ ] **S02: <title>** `risk:medium` `depends:[S01]`
 * ```
 *
 * Mapping:
 * - `[x]` → `'complete'`
 * - `[ ]` → `'pending'`
 *
 * Lines that do not match the pattern are silently ignored.
 * Duplicate slice IDs: last occurrence wins (matches ROADMAP.md append semantics).
 */
export function parseRoadmapCheckboxes(content: string): Map<string, GsdNodeStatus> {
  const result = new Map<string, GsdNodeStatus>()
  for (const match of content.matchAll(/^- \[([ x])\] \*\*(\w+):/gm)) {
    result.set(match[2], match[1] === 'x' ? 'complete' : 'pending')
  }
  return result
}

// ── Filesystem reconciler ──────────────────────────────────────────────────────

/**
 * Read and parse the ROADMAP.md for a milestone, returning authoritative slice
 * statuses for Path B reconciliation.
 *
 * Reads from: `{cwd}/.gsd/phases/{milestoneId}/{milestoneId}-ROADMAP.md`
 *
 * **Never throws.** Returns `{ hasData: false, sliceStatuses: empty }` when:
 * - The file does not exist (ENOENT).
 * - Any read error occurs (EACCES, I/O error, etc.).
 * - The file contains no recognisable checkbox lines.
 *
 * Callers should guard on `hasData` before merging — an empty result must
 * not overwrite valid Path A slice statuses already in the tracker.
 */
export async function reconcileProgress(
  cwd: string,
  milestoneId: string,
): Promise<ReconcileResult> {
  const roadmapPath = path.join(
    cwd,
    '.gsd',
    'phases',
    milestoneId,
    `${milestoneId}-ROADMAP.md`,
  )

  let content: string
  try {
    content = await readFile(roadmapPath, 'utf-8')
  } catch {
    // File missing, permission denied, I/O error — return empty result.
    // Callers should keep existing Path A data when hasData is false.
    return { sliceStatuses: new Map(), hasData: false }
  }

  const sliceStatuses = parseRoadmapCheckboxes(content)
  return {
    sliceStatuses,
    hasData: sliceStatuses.size > 0,
  }
}

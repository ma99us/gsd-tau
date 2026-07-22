import { EventEmitter } from 'node:events'
import type {
  GsdProgress,
  GsdMilestone,
  GsdSlice,
  GsdTask,
  GsdNodeStatus,
} from '../../shared/types'

// ── Events ─────────────────────────────────────────────────────────────────────

// Typed overloads so callers get full type-safety on on() / emit().
declare interface ProgressTracker {
  on(event: 'updated', listener: (progress: GsdProgress) => void): this
  on(event: 'milestone-complete', listener: (milestone: GsdMilestone) => void): this
  emit(event: 'updated', progress: GsdProgress): boolean
  emit(event: 'milestone-complete', milestone: GsdMilestone): boolean
}

// ── ProgressTracker ─────────────────────────────────────────────────────────────

/**
 * Tracks the `GsdProgress` tree for a session's auto-run panel.
 *
 * - Accepts raw `tool_use` event payloads via {@link handleToolUse}.
 * - Accepts `cost_update` events via {@link handleCostUpdate}.
 * - Mutates an in-memory `GsdProgress` tree on every relevant tool call.
 * - Emits `'updated'` with a **deep copy** of the tree on every change.
 *
 * {@link snapshot} also returns a deep copy — safe to hold a reference.
 *
 * Usage (S02 wiring pattern):
 * ```ts
 * const tracker = new ProgressTracker()
 * tracker.on('updated', (p) => ipc.push(sessionId, 'progress:update', p))
 *
 * // From the pi RPC stream:
 * client.on('event', (ev) => {
 *   if (ev.type === 'tool_use') {
 *     tracker.handleToolUse(ev.toolName, ev.toolInput)
 *   } else if (ev.type === 'cost_update') {
 *     tracker.handleCostUpdate(ev.totalCostUsd)
 *   }
 * })
 * ```
 */
class ProgressTracker extends EventEmitter {
  private _progress: GsdProgress = {
    milestone: null,
    currentSliceId: null,
    currentTaskId: null,
    lastToolAt: null,
  }

  // Cumulative session cost at the time gsd_plan_milestone was last called.
  // Used to compute per-milestone delta.
  private _costAtMilestoneStart = 0
  // Most recent totalCostUsd seen, so we can set the baseline when a milestone
  // is planned mid-session (after some cost has already accrued).
  private _lastTotalCostUsd = 0

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Process a `tool_use` event payload from the pi RPC stream.
   *
   * Recognised tool names:
   * `gsd_plan_milestone`, `gsd_plan_slice`, `gsd_plan_task`,
   * `gsd_task_complete`, `gsd_slice_complete`, `gsd_complete_milestone`,
   * `gsd_skip_slice`, `gsd_replan_slice`, `gsd_reassess_roadmap`.
   *
   * Unknown tool names are accepted without error — they still update
   * `lastToolAt` and emit `'updated'`.
   *
   * @param name  The `toolName` field from the pi RPC `tool_use` event.
   * @param args  The `toolInput` field — caller passes the raw object.
   */
  handleToolUse(name: string, args: unknown): void {
    const a = (args ?? {}) as Record<string, unknown>

    switch (name) {
      case 'gsd_plan_milestone':
        this._planMilestone(a)
        break
      case 'gsd_plan_slice':
        this._planSlice(a)
        break
      case 'gsd_plan_task':
        this._planTask(a)
        break
      case 'gsd_task_complete':
      case 'gsd_complete_task':
        this._completeTask(a)
        break
      case 'gsd_slice_complete':
      case 'gsd_complete_slice':
        this._completeSlice(a)
        break
      case 'gsd_complete_milestone':
        this._completeMilestone(a)
        break
      case 'gsd_skip_slice':
        this._skipSlice(a)
        break
      case 'gsd_replan_slice':
      case 'gsd_slice_replan':
        this._replanSlice(a)
        break
      case 'gsd_reassess_roadmap':
      case 'gsd_roadmap_reassess':
        this._reassessRoadmap(a)
        break
      // All other tool names: fall through — lastToolAt still gets updated.
    }

    this._progress.lastToolAt = new Date().toISOString()
    this.emit('updated', this.snapshot())
  }

  /**
   * Process a `cost_update` event from the pi RPC stream.
   *
   * `totalCostUsd` is the cumulative session total. The tracker stores
   * the delta since `gsd_plan_milestone` was last called as
   * `milestone.cumulativeCostUsd`, giving per-milestone cost attribution.
   *
   * Emits `'updated'` when there is an active milestone; silently ignores
   * calls before any milestone is planned.
   */
  handleCostUpdate(totalCostUsd: number): void {
    this._lastTotalCostUsd = totalCostUsd
    if (!this._progress.milestone) return
    this._progress.milestone.cumulativeCostUsd = Math.max(
      0,
      totalCostUsd - this._costAtMilestoneStart,
    )
    this.emit('updated', this.snapshot())
  }

  /**
   * Returns a deep copy of the current `GsdProgress` tree.
   *
   * Because this returns a clone, callers can hold the reference safely:
   * subsequent mutations inside the tracker will not affect it.
   */
  snapshot(): GsdProgress {
    return structuredClone(this._progress)
  }

  /**
   * Apply Path B (ROADMAP.md) reconciliation results to the current snapshot.
   *
   * Upgrades a slice to `'complete'` when the authoritative ROADMAP.md checkbox
   * is checked (`[x]`).  Never downgrades a slice that is already `'complete'`
   * or `'skipped'`.  Cascades incomplete tasks inside a newly-completed slice
   * to `'complete'`.
   *
   * Emits `'updated'` when at least one slice status changed.
   *
   * Guard: callers must check `ReconcileResult.hasData` before calling — pass
   * the map only when `hasData` is `true`.
   *
   * @param sliceStatuses  Map from slice ID to status parsed from ROADMAP.md.
   */
  applyReconciliation(sliceStatuses: Map<string, GsdNodeStatus>): void {
    const m = this._progress.milestone
    if (!m) return

    let changed = false
    for (const [sliceId, reconciledStatus] of sliceStatuses) {
      const slice = m.slices.find((s) => s.id === sliceId)
      if (!slice) continue
      // Path B is authoritative for 'complete'; never downgrade 'complete' or 'skipped'.
      if (
        reconciledStatus === 'complete' &&
        slice.status !== 'complete' &&
        slice.status !== 'skipped'
      ) {
        slice.status = 'complete'
        // Cascade: incomplete tasks in a reconciled-complete slice → complete.
        for (const t of slice.tasks) {
          if (t.status !== 'complete' && t.status !== 'skipped') {
            t.status = 'complete'
          }
        }
        changed = true
      }
      // 'pending' from ROADMAP.md: do not override in-progress or complete status
      // that Path A already knows about.
    }

    if (changed) {
      this.emit('updated', this.snapshot())
    }
  }

  // ── Mutation helpers ────────────────────────────────────────────────────────

  private _planMilestone(a: Record<string, unknown>): void {
    const milestoneId = str(a.milestoneId)
    const title = str(a.title)
    const rawSlices = arr<Record<string, unknown>>(a.slices)

    // Capture cost baseline so per-milestone delta is accurate.
    this._costAtMilestoneStart = this._lastTotalCostUsd

    const slices: GsdSlice[] = rawSlices.map((s) => ({
      id: str(s.sliceId),
      title: str(s.title),
      status: 'pending' as GsdNodeStatus,
      tasks: [],
      replanned: false,
    }))

    this._progress.milestone = {
      id: milestoneId,
      title,
      status: 'in-progress',
      slices,
      cumulativeCostUsd: 0,
      autoStartedAt: new Date().toISOString(),
    }
    this._progress.currentSliceId = null
    this._progress.currentTaskId = null
  }

  private _planSlice(a: Record<string, unknown>): void {
    const m = this._progress.milestone
    if (!m) return

    const sliceId = str(a.sliceId)
    const rawTasks = arr<Record<string, unknown>>(a.tasks)

    let slice = m.slices.find((s) => s.id === sliceId)
    if (!slice) {
      // Slice wasn't in the initial milestone plan — create it on the fly.
      slice = {
        id: sliceId,
        title: str(a.goal ?? sliceId),
        status: 'pending',
        tasks: [],
        replanned: false,
      }
      m.slices.push(slice)
    }

    slice.status = 'in-progress'
    this._progress.currentSliceId = sliceId
    this._progress.currentTaskId = null

    // Add any tasks provided in the initial plan batch (status: pending).
    // gsd_plan_task will later mark individual tasks in-progress.
    for (const t of rawTasks) {
      const taskId = str(t.taskId)
      if (!slice.tasks.find((x) => x.id === taskId)) {
        slice.tasks.push({ id: taskId, title: str(t.title), status: 'pending' })
      }
    }
  }

  private _planTask(a: Record<string, unknown>): void {
    const slice = this._findSlice(a)
    if (!slice) return

    const taskId = str(a.taskId)
    let task = slice.tasks.find((t) => t.id === taskId)
    if (!task) {
      task = { id: taskId, title: str(a.title), status: 'pending' }
      slice.tasks.push(task)
    }

    // Planning a task means the orchestrator is about to execute it.
    task.status = 'in-progress'
    task.title = str(a.title) || task.title
    this._progress.currentTaskId = taskId
  }

  private _completeTask(a: Record<string, unknown>): void {
    const slice = this._findSlice(a)
    if (!slice) return

    const taskId = str(a.taskId)
    const task = slice.tasks.find((t) => t.id === taskId)
    if (task) task.status = 'complete'

    if (this._progress.currentTaskId === taskId) {
      this._progress.currentTaskId = null
    }
  }

  private _completeSlice(a: Record<string, unknown>): void {
    const slice = this._findSlice(a)
    if (!slice) return

    slice.status = 'complete'
    // Cascade: any tasks that were never explicitly completed get marked complete.
    for (const t of slice.tasks) {
      if (t.status === 'pending' || t.status === 'in-progress') {
        t.status = 'complete'
      }
    }

    if (this._progress.currentSliceId === slice.id) {
      this._progress.currentSliceId = null
    }
    this._progress.currentTaskId = null
  }

  private _completeMilestone(a: Record<string, unknown>): void {
    const m = this._progress.milestone
    if (!m) return
    if (m.id !== str(a.milestoneId)) return

    m.status = 'complete'
    this._progress.currentSliceId = null
    this._progress.currentTaskId = null

    // Emit a dedicated 'milestone-complete' event so handlers can react
    // without inspecting every 'updated' emission for status changes.
    // The payload is an independent deep copy — callers may hold it safely.
    this.emit('milestone-complete', structuredClone(m))
  }

  private _skipSlice(a: Record<string, unknown>): void {
    const slice = this._findSlice(a)
    if (!slice) return

    slice.status = 'skipped'
    // Cascade pending/in-progress tasks; never downgrade complete tasks.
    for (const t of slice.tasks) {
      if (t.status !== 'complete') t.status = 'skipped'
    }

    if (this._progress.currentSliceId === slice.id) {
      this._progress.currentSliceId = null
    }
  }

  private _replanSlice(a: Record<string, unknown>): void {
    const slice = this._findSlice(a)
    if (!slice) return

    const updatedTasks = arr<Record<string, unknown>>(a.updatedTasks)
    const removedIds = arr<string>(a.removedTaskIds)

    // Remove tasks listed in removedTaskIds.
    slice.tasks = slice.tasks.filter((t) => !removedIds.includes(t.id))

    // Upsert updated tasks. Completed tasks keep their status.
    for (const ut of updatedTasks) {
      const taskId = str(ut.taskId)
      const existing = slice.tasks.find((t) => t.id === taskId)
      if (existing) {
        existing.title = str(ut.title) || existing.title
        // Do NOT downgrade status of a completed task.
      } else {
        slice.tasks.push({ id: taskId, title: str(ut.title), status: 'pending' })
      }
    }

    slice.replanned = true
    if (typeof a.whatChanged === 'string') {
      slice.replanNote = a.whatChanged
    }
  }

  private _reassessRoadmap(a: Record<string, unknown>): void {
    const m = this._progress.milestone
    if (!m) return

    const changes = (a.sliceChanges ?? {}) as Record<string, unknown>
    const removed = arr<string>(changes.removed)
    const modified = arr<Record<string, unknown>>(changes.modified)
    const added = arr<Record<string, unknown>>(changes.added)

    // Remove.
    m.slices = m.slices.filter((s) => !removed.includes(s.id))

    // Modify titles (other slice fields are immutable in reassess).
    for (const mod of modified) {
      const slice = m.slices.find((s) => s.id === str(mod.sliceId))
      if (slice && mod.title) slice.title = str(mod.title)
    }

    // Add new slices.
    for (const add of added) {
      const sliceId = str(add.sliceId)
      if (!m.slices.find((s) => s.id === sliceId)) {
        m.slices.push({
          id: sliceId,
          title: str(add.title),
          status: 'pending',
          tasks: [],
          replanned: false,
        })
      }
    }
  }

  // ── Internal utilities ─────────────────────────────────────────────────────

  private _findSlice(a: Record<string, unknown>): GsdSlice | undefined {
    return this._progress.milestone?.slices.find((s) => s.id === str(a.sliceId))
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Coerce an unknown value to a string; unknown / null / undefined → ''. */
function str(v: unknown): string {
  if (v == null) return ''
  return String(v)
}

/** Coerce an unknown value to a typed array; non-arrays → []. */
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export { ProgressTracker }

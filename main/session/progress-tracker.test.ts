import { describe, it, expect, beforeEach } from 'vitest'
import { ProgressTracker } from './progress-tracker'
import type { GsdProgress } from '../../shared/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Call handleToolUse and return the resulting snapshot. */
function feed(tracker: ProgressTracker, name: string, args: unknown): GsdProgress {
  tracker.handleToolUse(name, args)
  return tracker.snapshot()
}

/** Standard milestone args covering two slices. */
function milestonePlan(overrides?: object) {
  return {
    milestoneId: 'M007',
    title: 'Auto-run panel',
    vision: 'Ship it',
    slices: [
      { sliceId: 'S01', title: 'Data model' },
      { sliceId: 'S02', title: 'IPC wiring' },
    ],
    ...overrides,
  }
}

/** Plan S01 with two tasks. */
function slicePlan(extra?: object) {
  return {
    milestoneId: 'M007',
    sliceId: 'S01',
    goal: 'Define data model',
    tasks: [
      { taskId: 'T01', title: 'Types' },
      { taskId: 'T02', title: 'Tracker' },
    ],
    ...extra,
  }
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('ProgressTracker', () => {
  let tracker: ProgressTracker

  beforeEach(() => {
    tracker = new ProgressTracker()
  })

  // ── gsd_plan_milestone ───────────────────────────────────────────────────────

  describe('gsd_plan_milestone', () => {
    it('initialises milestone with slices, status=in-progress, no current ids', () => {
      const p = feed(tracker, 'gsd_plan_milestone', milestonePlan())

      expect(p.milestone).not.toBeNull()
      expect(p.milestone!.id).toBe('M007')
      expect(p.milestone!.title).toBe('Auto-run panel')
      expect(p.milestone!.status).toBe('in-progress')
      expect(p.milestone!.slices).toHaveLength(2)
      expect(p.milestone!.slices[0]).toMatchObject({ id: 'S01', title: 'Data model', status: 'pending' })
      expect(p.milestone!.slices[1]).toMatchObject({ id: 'S02', title: 'IPC wiring', status: 'pending' })
      expect(p.milestone!.cumulativeCostUsd).toBe(0)
      expect(p.milestone!.autoStartedAt).not.toBeNull()
      expect(p.currentSliceId).toBeNull()
      expect(p.currentTaskId).toBeNull()
      expect(p.lastToolAt).not.toBeNull()
    })

    it('replaces an existing milestone with a fresh one', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      feed(tracker, 'gsd_plan_slice', slicePlan())
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types' })

      // A second plan_milestone resets everything.
      const p = feed(tracker, 'gsd_plan_milestone', {
        milestoneId: 'M008',
        title: 'Phase 2',
        vision: '',
        slices: [{ sliceId: 'S01', title: 'First slice' }],
      })

      expect(p.milestone!.id).toBe('M008')
      expect(p.currentSliceId).toBeNull()
      expect(p.currentTaskId).toBeNull()
    })
  })

  // ── gsd_plan_slice ────────────────────────────────────────────────────────────

  describe('gsd_plan_slice', () => {
    beforeEach(() => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
    })

    it('marks slice in-progress and sets currentSliceId', () => {
      const p = feed(tracker, 'gsd_plan_slice', {
        milestoneId: 'M007',
        sliceId: 'S01',
        goal: 'Define data model',
      })

      expect(p.milestone!.slices[0].status).toBe('in-progress')
      expect(p.currentSliceId).toBe('S01')
      expect(p.currentTaskId).toBeNull()
    })

    it('adds tasks from the batch plan as pending', () => {
      const p = feed(tracker, 'gsd_plan_slice', slicePlan())

      const tasks = p.milestone!.slices[0].tasks
      expect(tasks).toHaveLength(2)
      expect(tasks[0]).toMatchObject({ id: 'T01', title: 'Types', status: 'pending' })
      expect(tasks[1]).toMatchObject({ id: 'T02', title: 'Tracker', status: 'pending' })
    })

    it('does not duplicate tasks on repeated plan_slice calls', () => {
      feed(tracker, 'gsd_plan_slice', slicePlan())
      const p = feed(tracker, 'gsd_plan_slice', slicePlan())  // same tasks again

      expect(p.milestone!.slices[0].tasks).toHaveLength(2)
    })

    it('creates a new slice if it was not in the initial milestone plan', () => {
      const p = feed(tracker, 'gsd_plan_slice', {
        milestoneId: 'M007',
        sliceId: 'S03',
        goal: 'New late slice',
      })

      const ids = p.milestone!.slices.map((s) => s.id)
      expect(ids).toContain('S03')
      expect(p.milestone!.slices.find((s) => s.id === 'S03')!.status).toBe('in-progress')
    })

    it('clears currentTaskId when a new slice starts', () => {
      feed(tracker, 'gsd_plan_slice', slicePlan())
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types' })
      expect(tracker.snapshot().currentTaskId).toBe('T01')

      feed(tracker, 'gsd_plan_slice', { milestoneId: 'M007', sliceId: 'S02', goal: 'IPC wiring' })
      expect(tracker.snapshot().currentTaskId).toBeNull()
    })
  })

  // ── gsd_plan_task ─────────────────────────────────────────────────────────────

  describe('gsd_plan_task', () => {
    beforeEach(() => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      feed(tracker, 'gsd_plan_slice', slicePlan())
    })

    it('marks task in-progress and sets currentTaskId', () => {
      const p = feed(tracker, 'gsd_plan_task', {
        milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types',
      })

      const t = p.milestone!.slices[0].tasks.find((x) => x.id === 'T01')!
      expect(t.status).toBe('in-progress')
      expect(p.currentTaskId).toBe('T01')
    })

    it('creates a task when it was not in the slice plan', () => {
      const p = feed(tracker, 'gsd_plan_task', {
        milestoneId: 'M007', sliceId: 'S01', taskId: 'T99', title: 'Late task',
      })

      const t = p.milestone!.slices[0].tasks.find((x) => x.id === 'T99')!
      expect(t).toBeDefined()
      expect(t.status).toBe('in-progress')
    })

    it('updates the title when a pre-existing pending task is re-planned', () => {
      const p = feed(tracker, 'gsd_plan_task', {
        milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types (revised)',
      })

      expect(p.milestone!.slices[0].tasks[0].title).toBe('Types (revised)')
    })
  })

  // ── gsd_task_complete ─────────────────────────────────────────────────────────

  describe('gsd_task_complete', () => {
    beforeEach(() => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      feed(tracker, 'gsd_plan_slice', slicePlan())
      feed(tracker, 'gsd_plan_task', {
        milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types',
      })
    })

    it('marks task complete and clears currentTaskId', () => {
      const p = feed(tracker, 'gsd_task_complete', {
        milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', oneLiner: 'Done', narrative: '',
      })

      const t = p.milestone!.slices[0].tasks.find((x) => x.id === 'T01')!
      expect(t.status).toBe('complete')
      expect(p.currentTaskId).toBeNull()
    })

    it('does not clear currentTaskId for a different completed task', () => {
      feed(tracker, 'gsd_plan_task', {
        milestoneId: 'M007', sliceId: 'S01', taskId: 'T02', title: 'Tracker',
      })
      // complete T01 while T02 is current
      feed(tracker, 'gsd_task_complete', {
        milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', oneLiner: '', narrative: '',
      })

      // currentTaskId was set to T02 by the last plan_task — completing T01
      // should not clear it (it's a different id).
      expect(tracker.snapshot().currentTaskId).toBe('T02')
    })

    it('accepts the canonical alias gsd_complete_task', () => {
      const p = feed(tracker, 'gsd_complete_task', {
        milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', oneLiner: '', narrative: '',
      })
      expect(p.milestone!.slices[0].tasks[0].status).toBe('complete')
    })
  })

  // ── gsd_slice_complete ────────────────────────────────────────────────────────

  describe('gsd_slice_complete', () => {
    beforeEach(() => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      feed(tracker, 'gsd_plan_slice', slicePlan())
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types' })
      feed(tracker, 'gsd_task_complete', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', oneLiner: '', narrative: '' })
    })

    it('marks slice complete and clears currentSliceId', () => {
      const p = feed(tracker, 'gsd_slice_complete', {
        milestoneId: 'M007', sliceId: 'S01', sliceTitle: 'Data model', oneLiner: '', narrative: '', uatContent: '',
      })

      expect(p.milestone!.slices[0].status).toBe('complete')
      expect(p.currentSliceId).toBeNull()
      expect(p.currentTaskId).toBeNull()
    })

    it('cascades pending/in-progress tasks to complete', () => {
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T02', title: 'Tracker' })
      // T02 is now in-progress; skip gsd_task_complete for it.
      const p = feed(tracker, 'gsd_slice_complete', {
        milestoneId: 'M007', sliceId: 'S01', sliceTitle: '', oneLiner: '', narrative: '', uatContent: '',
      })

      const tasks = p.milestone!.slices[0].tasks
      expect(tasks.find((t) => t.id === 'T02')!.status).toBe('complete')
    })

    it('accepts the canonical alias gsd_complete_slice', () => {
      const p = feed(tracker, 'gsd_complete_slice', {
        milestoneId: 'M007', sliceId: 'S01', sliceTitle: '', oneLiner: '', narrative: '', uatContent: '',
      })
      expect(p.milestone!.slices[0].status).toBe('complete')
    })
  })

  // ── gsd_complete_milestone ────────────────────────────────────────────────────

  describe('gsd_complete_milestone', () => {
    beforeEach(() => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      feed(tracker, 'gsd_plan_slice', { milestoneId: 'M007', sliceId: 'S01', goal: '' })
      feed(tracker, 'gsd_slice_complete', {
        milestoneId: 'M007', sliceId: 'S01', sliceTitle: '', oneLiner: '', narrative: '', uatContent: '',
      })
    })

    it('marks milestone complete and clears current ids', () => {
      const p = feed(tracker, 'gsd_complete_milestone', {
        milestoneId: 'M007', title: 'Auto-run panel', oneLiner: 'Done', narrative: '', verificationPassed: true,
      })

      expect(p.milestone!.status).toBe('complete')
      expect(p.currentSliceId).toBeNull()
      expect(p.currentTaskId).toBeNull()
    })

    it('is a no-op when milestoneId does not match', () => {
      feed(tracker, 'gsd_complete_milestone', {
        milestoneId: 'M_WRONG', title: '', oneLiner: '', narrative: '', verificationPassed: true,
      })
      expect(tracker.snapshot().milestone!.status).toBe('in-progress')
    })
  })

  // ── Full happy-path integration ───────────────────────────────────────────────

  describe('full happy path: plan → execute → complete', () => {
    it('produces the correct GsdProgress tree end-to-end', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      feed(tracker, 'gsd_plan_slice', slicePlan())

      // Execute T01.
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types' })
      feed(tracker, 'gsd_task_complete', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', oneLiner: '', narrative: '' })

      // Execute T02.
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T02', title: 'Tracker' })
      feed(tracker, 'gsd_task_complete', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T02', oneLiner: '', narrative: '' })

      feed(tracker, 'gsd_slice_complete', {
        milestoneId: 'M007', sliceId: 'S01', sliceTitle: '', oneLiner: '', narrative: '', uatContent: '',
      })
      feed(tracker, 'gsd_complete_milestone', {
        milestoneId: 'M007', title: '', oneLiner: '', narrative: '', verificationPassed: true,
      })

      const p = tracker.snapshot()
      expect(p.milestone!.status).toBe('complete')
      expect(p.milestone!.slices[0].status).toBe('complete')
      expect(p.milestone!.slices[0].tasks[0].status).toBe('complete')
      expect(p.milestone!.slices[0].tasks[1].status).toBe('complete')
      expect(p.currentSliceId).toBeNull()
      expect(p.currentTaskId).toBeNull()
    })
  })

  // ── gsd_skip_slice ────────────────────────────────────────────────────────────

  describe('gsd_skip_slice', () => {
    beforeEach(() => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
    })

    it('marks slice skipped and cascades pending/in-progress tasks', () => {
      feed(tracker, 'gsd_plan_slice', slicePlan())
      const p = feed(tracker, 'gsd_skip_slice', {
        milestoneId: 'M007', sliceId: 'S01', reason: 'Descoped',
      })

      const slice = p.milestone!.slices[0]
      expect(slice.status).toBe('skipped')
      expect(slice.tasks[0].status).toBe('skipped')
      expect(slice.tasks[1].status).toBe('skipped')
    })

    it('does not downgrade already-complete tasks when skipping', () => {
      feed(tracker, 'gsd_plan_slice', slicePlan())
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types' })
      feed(tracker, 'gsd_task_complete', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', oneLiner: '', narrative: '' })

      const p = feed(tracker, 'gsd_skip_slice', { milestoneId: 'M007', sliceId: 'S01' })

      const tasks = p.milestone!.slices[0].tasks
      expect(tasks.find((t) => t.id === 'T01')!.status).toBe('complete')   // preserved
      expect(tasks.find((t) => t.id === 'T02')!.status).toBe('skipped')    // cascaded
    })

    it('clears currentSliceId when the active slice is skipped', () => {
      feed(tracker, 'gsd_plan_slice', { milestoneId: 'M007', sliceId: 'S01', goal: '' })
      expect(tracker.snapshot().currentSliceId).toBe('S01')

      const p = feed(tracker, 'gsd_skip_slice', { milestoneId: 'M007', sliceId: 'S01' })
      expect(p.currentSliceId).toBeNull()
    })

    it('leaves currentSliceId unchanged when a non-active slice is skipped', () => {
      feed(tracker, 'gsd_plan_slice', { milestoneId: 'M007', sliceId: 'S01', goal: '' })
      // S01 is now active; skip the not-yet-started S02.
      const p = feed(tracker, 'gsd_skip_slice', { milestoneId: 'M007', sliceId: 'S02' })
      expect(p.currentSliceId).toBe('S01')
      expect(p.milestone!.slices[1].status).toBe('skipped')
    })
  })

  // ── gsd_replan_slice ──────────────────────────────────────────────────────────

  describe('gsd_replan_slice', () => {
    beforeEach(() => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      feed(tracker, 'gsd_plan_slice', slicePlan())
    })

    it('sets replanned=true and stores replanNote', () => {
      const p = feed(tracker, 'gsd_replan_slice', {
        milestoneId: 'M007',
        sliceId: 'S01',
        blockerTaskId: 'T01',
        blockerDescription: 'API changed',
        whatChanged: 'Replaced T02 with T03',
        updatedTasks: [{ taskId: 'T01', title: 'Types' }, { taskId: 'T03', title: 'New task' }],
        removedTaskIds: ['T02'],
      })

      const slice = p.milestone!.slices[0]
      expect(slice.replanned).toBe(true)
      expect(slice.replanNote).toBe('Replaced T02 with T03')
    })

    it('removes tasks in removedTaskIds', () => {
      const p = feed(tracker, 'gsd_replan_slice', {
        milestoneId: 'M007',
        sliceId: 'S01',
        blockerTaskId: 'T01',
        blockerDescription: '',
        whatChanged: '',
        updatedTasks: [],
        removedTaskIds: ['T02'],
      })

      const ids = p.milestone!.slices[0].tasks.map((t) => t.id)
      expect(ids).not.toContain('T02')
      expect(ids).toContain('T01')
    })

    it('adds new tasks from updatedTasks as pending', () => {
      const p = feed(tracker, 'gsd_replan_slice', {
        milestoneId: 'M007',
        sliceId: 'S01',
        blockerTaskId: 'T01',
        blockerDescription: '',
        whatChanged: '',
        updatedTasks: [{ taskId: 'T03', title: 'Brand new' }],
        removedTaskIds: [],
      })

      const t03 = p.milestone!.slices[0].tasks.find((t) => t.id === 'T03')!
      expect(t03).toBeDefined()
      expect(t03.status).toBe('pending')
    })

    it('updates the title of an existing task without downgrading its status', () => {
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types' })
      // T01 is now in-progress
      const p = feed(tracker, 'gsd_replan_slice', {
        milestoneId: 'M007',
        sliceId: 'S01',
        blockerTaskId: 'T01',
        blockerDescription: '',
        whatChanged: '',
        updatedTasks: [{ taskId: 'T01', title: 'Types (revised)' }],
        removedTaskIds: [],
      })

      const t01 = p.milestone!.slices[0].tasks.find((t) => t.id === 'T01')!
      expect(t01.title).toBe('Types (revised)')
      expect(t01.status).toBe('in-progress')   // status not downgraded
    })

    it('does not downgrade a completed task title-update via replan', () => {
      feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: 'Types' })
      feed(tracker, 'gsd_task_complete', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', oneLiner: '', narrative: '' })

      const p = feed(tracker, 'gsd_replan_slice', {
        milestoneId: 'M007',
        sliceId: 'S01',
        blockerTaskId: 'T02',
        blockerDescription: '',
        whatChanged: '',
        updatedTasks: [{ taskId: 'T01', title: 'Types (post-replan)' }],
        removedTaskIds: [],
      })

      // Title updated but status stays complete
      const t01 = p.milestone!.slices[0].tasks.find((t) => t.id === 'T01')!
      expect(t01.status).toBe('complete')
    })

    it('accepts the canonical alias gsd_slice_replan', () => {
      const p = feed(tracker, 'gsd_slice_replan', {
        milestoneId: 'M007',
        sliceId: 'S01',
        blockerTaskId: 'T01',
        blockerDescription: '',
        whatChanged: 'alias test',
        updatedTasks: [],
        removedTaskIds: [],
      })
      expect(p.milestone!.slices[0].replanned).toBe(true)
    })
  })

  // ── cost_update ───────────────────────────────────────────────────────────────

  describe('handleCostUpdate', () => {
    it('sets cumulativeCostUsd on the milestone', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      tracker.handleCostUpdate(1.5)
      expect(tracker.snapshot().milestone!.cumulativeCostUsd).toBeCloseTo(1.5)
    })

    it('tracks the delta since gsd_plan_milestone was called', () => {
      // Simulate pre-existing session cost before the milestone is planned.
      tracker.handleCostUpdate(5.0)   // before milestone — baseline stored on next plan
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      tracker.handleCostUpdate(5.5)
      expect(tracker.snapshot().milestone!.cumulativeCostUsd).toBeCloseTo(0.5)

      tracker.handleCostUpdate(6.0)
      expect(tracker.snapshot().milestone!.cumulativeCostUsd).toBeCloseTo(1.0)
    })

    it('cumulative cost never goes below zero', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      tracker.handleCostUpdate(100.0)  // set baseline
      // Simulate a bogus lower value (shouldn't happen in practice).
      tracker.handleCostUpdate(50.0)
      expect(tracker.snapshot().milestone!.cumulativeCostUsd).toBeGreaterThanOrEqual(0)
    })

    it('emits updated when a milestone is active', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      const fired: GsdProgress[] = []
      tracker.on('updated', (p) => fired.push(p))
      tracker.handleCostUpdate(0.5)
      expect(fired).toHaveLength(1)
      expect(fired[0].milestone!.cumulativeCostUsd).toBeCloseTo(0.5)
    })

    it('does not emit and does not crash when no milestone is active', () => {
      const fired: GsdProgress[] = []
      tracker.on('updated', (p) => fired.push(p))
      expect(() => tracker.handleCostUpdate(1.0)).not.toThrow()
      expect(fired).toHaveLength(0)
    })
  })

  // ── gsd_reassess_roadmap ──────────────────────────────────────────────────────

  describe('gsd_reassess_roadmap', () => {
    beforeEach(() => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
    })

    it('adds, modifies, and removes slices', () => {
      const p = feed(tracker, 'gsd_reassess_roadmap', {
        milestoneId: 'M007',
        completedSliceId: 'S01',
        verdict: 'roadmap-adjusted',
        assessment: 'Added S03',
        sliceChanges: {
          modified: [{ sliceId: 'S02', title: 'IPC wiring (revised)' }],
          added: [{ sliceId: 'S03', title: 'New slice' }],
          removed: ['S01'],
        },
      })

      const ids = p.milestone!.slices.map((s) => s.id)
      expect(ids).not.toContain('S01')
      expect(ids).toContain('S02')
      expect(ids).toContain('S03')
      expect(p.milestone!.slices.find((s) => s.id === 'S02')!.title).toBe('IPC wiring (revised)')
      expect(p.milestone!.slices.find((s) => s.id === 'S03')!.status).toBe('pending')
    })

    it('does not duplicate an added slice on repeated calls', () => {
      feed(tracker, 'gsd_reassess_roadmap', {
        milestoneId: 'M007',
        completedSliceId: 'S01',
        verdict: 'roadmap-adjusted',
        assessment: '',
        sliceChanges: { modified: [], added: [{ sliceId: 'S03', title: 'New' }], removed: [] },
      })
      const p = feed(tracker, 'gsd_reassess_roadmap', {
        milestoneId: 'M007',
        completedSliceId: 'S01',
        verdict: 'roadmap-adjusted',
        assessment: '',
        sliceChanges: { modified: [], added: [{ sliceId: 'S03', title: 'New' }], removed: [] },
      })
      expect(p.milestone!.slices.filter((s) => s.id === 'S03')).toHaveLength(1)
    })

    it('accepts the canonical alias gsd_roadmap_reassess', () => {
      const p = feed(tracker, 'gsd_roadmap_reassess', {
        milestoneId: 'M007',
        completedSliceId: 'S01',
        verdict: 'roadmap-adjusted',
        assessment: '',
        sliceChanges: { modified: [], added: [{ sliceId: 'S99', title: 'alias test' }], removed: [] },
      })
      expect(p.milestone!.slices.find((s) => s.id === 'S99')).toBeDefined()
    })
  })

  // ── snapshot isolation ────────────────────────────────────────────────────────

  describe('snapshot()', () => {
    it('returns a deep copy — mutating the snapshot does not affect tracker state', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      const snap = tracker.snapshot()

      // Mutate the snapshot aggressively.
      snap.milestone!.status = 'complete'
      snap.milestone!.slices[0].id = 'ZZZ'
      snap.currentSliceId = 'FAKE'

      const fresh = tracker.snapshot()
      expect(fresh.milestone!.status).toBe('in-progress')
      expect(fresh.milestone!.slices[0].id).toBe('S01')
      expect(fresh.currentSliceId).toBeNull()
    })
  })

  // ── 'updated' event ───────────────────────────────────────────────────────────

  describe("'updated' event", () => {
    it('fires on every handleToolUse call including unknown tools', () => {
      const received: GsdProgress[] = []
      tracker.on('updated', (p) => received.push(p))

      tracker.handleToolUse('gsd_plan_milestone', milestonePlan())
      tracker.handleToolUse('some_unknown_tool', {})

      expect(received).toHaveLength(2)
    })

    it('each emission is an independent deep copy', () => {
      const received: GsdProgress[] = []
      tracker.on('updated', (p) => received.push(p))

      tracker.handleToolUse('gsd_plan_milestone', milestonePlan())
      tracker.handleToolUse('gsd_plan_slice', {
        milestoneId: 'M007', sliceId: 'S01', goal: '',
      })

      // First emission (plan_milestone): S01 was pending.
      expect(received[0].milestone!.slices[0].status).toBe('pending')
      // Second emission (plan_slice): S01 is now in-progress.
      expect(received[1].milestone!.slices[0].status).toBe('in-progress')
      // They are independent objects.
      expect(received[0]).not.toBe(received[1])
    })
  })

  // ── lastToolAt ────────────────────────────────────────────────────────────────

  describe('lastToolAt', () => {
    it('is set to a valid ISO-8601 timestamp on every handleToolUse', () => {
      const before = new Date().toISOString()
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      const after = new Date().toISOString()

      const { lastToolAt } = tracker.snapshot()
      expect(lastToolAt).not.toBeNull()
      expect(lastToolAt! >= before).toBe(true)
      expect(lastToolAt! <= after).toBe(true)
    })

    it('is updated even for unknown tool names', () => {
      feed(tracker, 'some_mystery_tool', {})
      expect(tracker.snapshot().lastToolAt).not.toBeNull()
    })
  })

  // ── Negative tests ─────────────────────────────────────────────────────────────

  describe('negative tests — robustness', () => {
    it('operations before gsd_plan_milestone are all no-ops', () => {
      expect(() => {
        feed(tracker, 'gsd_plan_slice', { milestoneId: 'M007', sliceId: 'S01', goal: '' })
        feed(tracker, 'gsd_plan_task', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', title: '' })
        feed(tracker, 'gsd_task_complete', { milestoneId: 'M007', sliceId: 'S01', taskId: 'T01', oneLiner: '', narrative: '' })
        feed(tracker, 'gsd_slice_complete', { milestoneId: 'M007', sliceId: 'S01', sliceTitle: '', oneLiner: '', narrative: '', uatContent: '' })
        feed(tracker, 'gsd_complete_milestone', { milestoneId: 'M007', title: '', oneLiner: '', narrative: '', verificationPassed: true })
        feed(tracker, 'gsd_skip_slice', { milestoneId: 'M007', sliceId: 'S01' })
        feed(tracker, 'gsd_replan_slice', { milestoneId: 'M007', sliceId: 'S01', updatedTasks: [], removedTaskIds: [], whatChanged: '', blockerTaskId: '', blockerDescription: '' })
        feed(tracker, 'gsd_reassess_roadmap', { milestoneId: 'M007', completedSliceId: 'S01', verdict: '', assessment: '', sliceChanges: { modified: [], added: [], removed: [] } })
      }).not.toThrow()

      expect(tracker.snapshot().milestone).toBeNull()
    })

    it('gsd_task_complete for non-existent task does not crash', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      feed(tracker, 'gsd_plan_slice', { milestoneId: 'M007', sliceId: 'S01', goal: '' })
      expect(() =>
        feed(tracker, 'gsd_task_complete', {
          milestoneId: 'M007', sliceId: 'S01', taskId: 'T_NONEXISTENT', oneLiner: '', narrative: '',
        }),
      ).not.toThrow()
    })

    it('gsd_skip_slice for non-existent slice does not crash', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      expect(() =>
        feed(tracker, 'gsd_skip_slice', { milestoneId: 'M007', sliceId: 'S_NONEXISTENT' }),
      ).not.toThrow()
    })

    it('gsd_replan_slice for non-existent slice does not crash', () => {
      feed(tracker, 'gsd_plan_milestone', milestonePlan())
      expect(() =>
        feed(tracker, 'gsd_replan_slice', {
          milestoneId: 'M007', sliceId: 'S_NONEXISTENT',
          updatedTasks: [], removedTaskIds: [], whatChanged: '', blockerTaskId: '', blockerDescription: '',
        }),
      ).not.toThrow()
    })

    it('handles completely empty args object without crashing', () => {
      expect(() => {
        feed(tracker, 'gsd_plan_milestone', {})
        feed(tracker, 'gsd_plan_slice', {})
        feed(tracker, 'gsd_plan_task', {})
        feed(tracker, 'gsd_task_complete', {})
        feed(tracker, 'gsd_slice_complete', {})
        feed(tracker, 'gsd_skip_slice', {})
        feed(tracker, 'gsd_replan_slice', {})
        feed(tracker, 'gsd_reassess_roadmap', {})
      }).not.toThrow()
    })

    it('handles null args without crashing', () => {
      expect(() => {
        feed(tracker, 'gsd_plan_milestone', null)
        feed(tracker, 'gsd_plan_slice', null)
      }).not.toThrow()
    })

    it('unknown tool name still updates lastToolAt', () => {
      feed(tracker, 'gsd_unknown_fictional_tool', { foo: 'bar' })
      expect(tracker.snapshot().lastToolAt).not.toBeNull()
    })
  })
})

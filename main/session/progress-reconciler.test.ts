import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { parseRoadmapCheckboxes, reconcileProgress } from './progress-reconciler'

// ── Mock node:fs/promises ──────────────────────────────────────────────────────
//
// vi.mock is hoisted above imports by vitest — the factory runs before any
// module code, so progress-reconciler's `readFile` import receives the mock.

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

// ── helpers ────────────────────────────────────────────────────────────────────

/** Import the mocked readFile for per-test setup. */
async function getMockedReadFile() {
  const fsMod = await import('node:fs/promises')
  return fsMod.readFile as ReturnType<typeof vi.fn>
}

// ── parseRoadmapCheckboxes — pure function ─────────────────────────────────────

describe('parseRoadmapCheckboxes', () => {
  // ── positive cases ─────────────────────────────────────────────────────────

  it('maps [x] lines to complete', () => {
    const content = `
- [x] **S01: Data model** \`risk:low\` \`depends:[]\`
- [x] **S02: IPC wiring** \`risk:medium\` \`depends:[S01]\`
`
    const result = parseRoadmapCheckboxes(content)
    expect(result.get('S01')).toBe('complete')
    expect(result.get('S02')).toBe('complete')
  })

  it('maps [ ] lines to pending', () => {
    const content = `
- [ ] **S01: Data model** \`risk:low\` \`depends:[]\`
- [ ] **S02: IPC wiring** \`risk:medium\` \`depends:[S01]\`
`
    const result = parseRoadmapCheckboxes(content)
    expect(result.get('S01')).toBe('pending')
    expect(result.get('S02')).toBe('pending')
  })

  it('handles mixed checked and unchecked slices', () => {
    const content = `
- [x] **S01: GsdProgress data model and progress tracker** \`risk:medium\` \`depends:[]\`
- [ ] **S02: SessionHandle integration and Path B reconciliation** \`risk:medium\` \`depends:[S01]\`
- [ ] **S03: AutoRunPanel React component** \`risk:low\` \`depends:[S01,S02]\`
- [ ] **S04: SessionView integration** \`risk:low\` \`depends:[S02,S03]\`
`
    const result = parseRoadmapCheckboxes(content)
    expect(result.get('S01')).toBe('complete')
    expect(result.get('S02')).toBe('pending')
    expect(result.get('S03')).toBe('pending')
    expect(result.get('S04')).toBe('pending')
    expect(result.size).toBe(4)
  })

  it('parses the real gsd-tau ROADMAP.md fixture format exactly', () => {
    // Copied verbatim from .gsd/phases/07-auto-run-panel/07-ROADMAP.md
    const content = `## Slices

- [x] **S01: GsdProgress data model and progress tracker** \`risk:medium\` \`depends:[]\`
  > After this: vitest run passes.

- [ ] **S02: SessionHandle integration and Path B reconciliation** \`risk:medium\` \`depends:[S01]\`
  > After this: In the running app…
`
    const result = parseRoadmapCheckboxes(content)
    expect(result.get('S01')).toBe('complete')
    expect(result.get('S02')).toBe('pending')
    expect(result.size).toBe(2)
  })

  // ── negative / boundary cases ──────────────────────────────────────────────

  it('returns an empty map for empty string input', () => {
    expect(parseRoadmapCheckboxes('')).toEqual(new Map())
  })

  it('returns an empty map when content has no checkbox lines', () => {
    const content = `# M007 Roadmap

**Vision:** Some description.

## Success Criteria

- Criterion A
- Criterion B
`
    expect(parseRoadmapCheckboxes(content)).toEqual(new Map())
  })

  it('ignores lines with checkbox but no **SliceId: pattern', () => {
    const content = `
- [x] Just a checked list item (no **ID: pattern)
- [ ] Another unchecked item
- [x] **S01: Valid slice**
`
    const result = parseRoadmapCheckboxes(content)
    // Only the line with **S01: should be captured
    expect(result.size).toBe(1)
    expect(result.get('S01')).toBe('complete')
  })

  it('ignores lines with unknown bracket content (not space or x)', () => {
    const content = `
- [?] **S01: Unknown marker**
- [-] **S02: Dash marker**
- [ ] **S03: Valid pending**
- [x] **S04: Valid complete**
`
    const result = parseRoadmapCheckboxes(content)
    // Only the lines with ' ' or 'x' in brackets match
    expect(result.has('S01')).toBe(false)
    expect(result.has('S02')).toBe(false)
    expect(result.get('S03')).toBe('pending')
    expect(result.get('S04')).toBe('complete')
  })

  it('handles duplicate slice IDs — last occurrence wins', () => {
    // Can happen if a roadmap has been manually edited
    const content = `
- [ ] **S01: First occurrence**
- [x] **S01: Second occurrence — overwrites first**
`
    const result = parseRoadmapCheckboxes(content)
    expect(result.get('S01')).toBe('complete')
    expect(result.size).toBe(1)
  })

  it('does not capture inline **bold** text on non-checkbox lines', () => {
    const content = `
**Bold heading**

Some **S01: not a checkbox** text in a paragraph.

- [x] **S02: Valid slice**
`
    const result = parseRoadmapCheckboxes(content)
    expect(result.has('S01')).toBe(false)
    expect(result.get('S02')).toBe('complete')
    expect(result.size).toBe(1)
  })

  it('handles milestone-level ROADMAP format without slices (only milestone items)', () => {
    // The top-level .gsd/ROADMAP.md uses emoji format — should produce empty map
    const content = `
- ✅ **M002: Session Manager and Minimal Shell** (\`depends:[—]\`)
- 🔄 **M007: Auto-run Panel** (\`depends:[—]\`)
`
    // Emoji format does not match [x] / [ ] pattern
    expect(parseRoadmapCheckboxes(content)).toEqual(new Map())
  })

  it('handles very large content without stack overflow (> 1000 slices)', () => {
    const lines = Array.from({ length: 1200 }, (_, i) => {
      const id = `S${String(i + 1).padStart(3, '0')}`
      const checked = i % 2 === 0 ? 'x' : ' '
      return `- [${checked}] **${id}: Slice ${i + 1}**`
    })
    const content = lines.join('\n')
    const result = parseRoadmapCheckboxes(content)
    expect(result.size).toBe(1200)
    expect(result.get('S001')).toBe('complete')  // even index 0 → checked
    expect(result.get('S002')).toBe('pending')   // odd index 1 → unchecked
  })
})

// ── reconcileProgress — filesystem integration ─────────────────────────────────

describe('reconcileProgress', () => {
  let readFileMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    readFileMock = await getMockedReadFile()
    readFileMock.mockReset()
  })

  // ── happy path ─────────────────────────────────────────────────────────────

  it('returns hasData=true and parsed statuses when ROADMAP.md exists', async () => {
    readFileMock.mockResolvedValue(`
- [x] **S01: Data model** \`risk:low\`
- [ ] **S02: IPC wiring** \`risk:medium\`
`)
    const result = await reconcileProgress('/project', 'M007')
    expect(result.hasData).toBe(true)
    expect(result.sliceStatuses.get('S01')).toBe('complete')
    expect(result.sliceStatuses.get('S02')).toBe('pending')
  })

  it('constructs the ROADMAP.md path using cwd and milestoneId', async () => {
    readFileMock.mockResolvedValue('- [x] **S01: Test**')
    await reconcileProgress('/my/project', 'M007')

    const calledPath = readFileMock.mock.calls[0][0] as string
    // Must include both the milestoneId directory segment and the file name
    expect(calledPath).toContain('M007')
    expect(calledPath).toContain('M007-ROADMAP.md')
    // Must be rooted at the cwd
    expect(calledPath.startsWith('/my/project') || calledPath.includes('my') && calledPath.includes('project')).toBe(true)
  })

  it('includes .gsd/phases/ in the constructed path', async () => {
    readFileMock.mockResolvedValue('- [x] **S01: Test**')
    await reconcileProgress('/project', 'M001')

    const calledPath = readFileMock.mock.calls[0][0] as string
    const normalized = calledPath.replace(/\\/g, '/')
    expect(normalized).toContain('.gsd/phases/M001/M001-ROADMAP.md')
  })

  it('reads the file as utf-8', async () => {
    readFileMock.mockResolvedValue('- [x] **S01: Test**')
    await reconcileProgress('/project', 'M007')
    expect(readFileMock.mock.calls[0][1]).toBe('utf-8')
  })

  // ── failure / missing file cases ───────────────────────────────────────────

  it('returns hasData=false and empty map when file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory"), { code: 'ENOENT' })
    readFileMock.mockRejectedValue(err)

    const result = await reconcileProgress('/project', 'M007')
    expect(result.hasData).toBe(false)
    expect(result.sliceStatuses.size).toBe(0)
  })

  it('returns hasData=false and empty map on permission denied (EACCES)', async () => {
    const err = Object.assign(new Error("EACCES: permission denied"), { code: 'EACCES' })
    readFileMock.mockRejectedValue(err)

    const result = await reconcileProgress('/project', 'M007')
    expect(result.hasData).toBe(false)
    expect(result.sliceStatuses.size).toBe(0)
  })

  it('returns hasData=false on any unexpected read error', async () => {
    readFileMock.mockRejectedValue(new Error('Disk read failure'))

    const result = await reconcileProgress('/project', 'M007')
    expect(result.hasData).toBe(false)
    expect(result.sliceStatuses.size).toBe(0)
  })

  it('returns hasData=false when file content contains no checkboxes', async () => {
    readFileMock.mockResolvedValue('# Empty roadmap\n\nNo slices defined.')

    const result = await reconcileProgress('/project', 'M007')
    expect(result.hasData).toBe(false)
    expect(result.sliceStatuses.size).toBe(0)
  })

  it('returns hasData=false for empty file content', async () => {
    readFileMock.mockResolvedValue('')

    const result = await reconcileProgress('/project', 'M007')
    expect(result.hasData).toBe(false)
    expect(result.sliceStatuses.size).toBe(0)
  })

  // ── safety contract: never throws ─────────────────────────────────────────

  it('never throws — resolves even when readFile rejects with an Error', async () => {
    readFileMock.mockRejectedValue(new Error('Unexpected I/O error'))
    await expect(reconcileProgress('/project', 'M007')).resolves.toBeDefined()
  })

  it('never throws — resolves even when readFile rejects with a non-Error value', async () => {
    readFileMock.mockRejectedValue('string error')
    await expect(reconcileProgress('/project', 'M007')).resolves.toBeDefined()
  })

  it('never throws — resolves even when readFile rejects with null', async () => {
    readFileMock.mockRejectedValue(null)
    await expect(reconcileProgress('/project', 'M007')).resolves.toBeDefined()
  })

  // ── caller contract: empty result must not overwrite Path A data ───────────

  it('sliceStatuses is always a Map (never undefined or null)', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    const result = await reconcileProgress('/project', 'M007')
    expect(result.sliceStatuses).toBeInstanceOf(Map)
  })

  it('returns independent Map instances on successive calls', async () => {
    readFileMock.mockResolvedValue('- [x] **S01: Test**')
    const r1 = await reconcileProgress('/project', 'M007')
    const r2 = await reconcileProgress('/project', 'M007')
    // Different Map instances (not the same reference)
    expect(r1.sliceStatuses).not.toBe(r2.sliceStatuses)
  })
})

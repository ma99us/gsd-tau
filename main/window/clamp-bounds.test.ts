/**
 * Tests for main/window/clamp-bounds.ts
 *
 * Pure function — no Electron imports, no fake timers needed.
 */

import { describe, it, expect } from 'vitest'
import { clampBoundsToDisplays } from './clamp-bounds'
import type { WorkArea, Bounds } from './clamp-bounds'

// ── Helpers ───────────────────────────────────────────────────────────────────

function display(wa: WorkArea): { workArea: WorkArea } {
  return { workArea: wa }
}

const primaryDisplay = display({ x: 0, y: 0, width: 1920, height: 1040 })
const secondaryRight = display({ x: 1920, y: 0, width: 1280, height: 720 })
const secondaryBelow = display({ x: 0, y: 1040, width: 1920, height: 1040 })

// ── Test suite ────────────────────────────────────────────────────────────────

describe('clampBoundsToDisplays()', () => {

  // ── On-screen fast path ───────────────────────────────────────────────────

  describe('on-screen bounds — returns same reference unchanged', () => {
    it('returns the same object reference when window centre is on the primary display', () => {
      const bounds: Bounds = { x: 100, y: 100, width: 1200, height: 800 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)
      expect(result).toBe(bounds) // same reference, not a copy
    })

    it('returns unchanged when window centre is near the display edge (but still on-screen)', () => {
      // Centre at (10, 10) — just inside the 0-based work area
      const bounds: Bounds = { x: 0, y: 0, width: 20, height: 20 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)
      expect(result).toBe(bounds)
    })

    it('handles multi-monitor: window on secondary display is not moved', () => {
      // Window centre: 1920 + 640 = 2560, y = 360 — on secondary display
      const bounds: Bounds = { x: 2000, y: 50, width: 1280, height: 620 }
      const result = clampBoundsToDisplays([primaryDisplay, secondaryRight], bounds)
      expect(result).toBe(bounds)
    })
  })

  // ── Off-screen clamping ───────────────────────────────────────────────────

  describe('off-screen bounds — clamps to nearest display work area', () => {
    it('clamps window fully to the right of a single display', () => {
      // Centre at (2500, 400) — off-screen to the right
      const bounds: Bounds = { x: 2000, y: 0, width: 1000, height: 800 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)

      const wa = primaryDisplay.workArea
      expect(result.x).toBeGreaterThanOrEqual(wa.x)
      expect(result.y).toBeGreaterThanOrEqual(wa.y)
      expect(result.x + result.width).toBeLessThanOrEqual(wa.x + wa.width)
    })

    it('clamps window fully above a single display (negative y)', () => {
      // Centre at (960, -200) — above the display
      const bounds: Bounds = { x: 460, y: -600, width: 1000, height: 800 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)

      const wa = primaryDisplay.workArea
      expect(result.y).toBeGreaterThanOrEqual(wa.y)
    })

    it('clamps window fully below a single display', () => {
      const bounds: Bounds = { x: 100, y: 2000, width: 800, height: 600 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)

      const wa = primaryDisplay.workArea
      expect(result.y + result.height).toBeLessThanOrEqual(wa.y + wa.height)
    })

    it('clamps window to the left of a single display', () => {
      const bounds: Bounds = { x: -1500, y: 200, width: 800, height: 600 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)

      const wa = primaryDisplay.workArea
      expect(result.x).toBeGreaterThanOrEqual(wa.x)
    })

    it('caps window width to the display work-area width when window is wider', () => {
      const bounds: Bounds = { x: 5000, y: 200, width: 3000, height: 600 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)

      expect(result.width).toBeLessThanOrEqual(primaryDisplay.workArea.width)
    })

    it('caps window height to the display work-area height when window is taller', () => {
      const bounds: Bounds = { x: 200, y: 5000, width: 800, height: 3000 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)

      expect(result.height).toBeLessThanOrEqual(primaryDisplay.workArea.height)
    })
  })

  // ── Multi-monitor: nearest display ────────────────────────────────────────

  describe('multi-monitor — clamps to the nearest display', () => {
    it('sends window far to the right to the secondary display (nearer)', () => {
      // Centre at (3500, 400) — between secondary (1920–3200) and nowhere — secondary is nearest
      const bounds: Bounds = { x: 3200, y: 0, width: 600, height: 800 }
      const result = clampBoundsToDisplays([primaryDisplay, secondaryRight], bounds)

      // Should end up on the secondary (rightmost) display work area
      const wa = secondaryRight.workArea
      expect(result.x).toBeGreaterThanOrEqual(wa.x)
      expect(result.x + result.width).toBeLessThanOrEqual(wa.x + wa.width)
    })

    it('sends a window far below to the secondary-below display', () => {
      // Centre at (960, 2500) — below the primary, closer to secondaryBelow centre (960, 1560)
      const bounds: Bounds = { x: 400, y: 2100, width: 1120, height: 800 }
      const result = clampBoundsToDisplays([primaryDisplay, secondaryBelow], bounds)

      const wa = secondaryBelow.workArea
      expect(result.y).toBeGreaterThanOrEqual(wa.y)
      expect(result.y + result.height).toBeLessThanOrEqual(wa.y + wa.height)
    })
  })

  // ── Edge / boundary cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns bounds unchanged when displays is empty', () => {
      const bounds: Bounds = { x: 99999, y: 99999, width: 800, height: 600 }
      const result = clampBoundsToDisplays([], bounds)
      expect(result).toBe(bounds)
    })

    it('handles a zero-size work area without throwing', () => {
      const zeroDisplay = display({ x: 0, y: 0, width: 0, height: 0 })
      const bounds: Bounds = { x: 100, y: 100, width: 800, height: 600 }
      // Should not throw; result is clamped to the (degenerate) work area
      expect(() => clampBoundsToDisplays([zeroDisplay], bounds)).not.toThrow()
    })

    it('handles a single-pixel window', () => {
      const bounds: Bounds = { x: -500, y: -500, width: 1, height: 1 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)
      const wa = primaryDisplay.workArea
      expect(result.x).toBeGreaterThanOrEqual(wa.x)
      expect(result.y).toBeGreaterThanOrEqual(wa.y)
    })

    it('window centre exactly on display boundary (right edge) is treated as on-screen', () => {
      // cx = 1918 + Math.floor(2/2) = 1918 + 1 = 1919, which is < 1920 → on-screen
      const bounds: Bounds = { x: 1918, y: 100, width: 2, height: 200 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)
      expect(result).toBe(bounds)
    })

    it('window centre exactly AT display right boundary (cx === width) is treated as off-screen', () => {
      // cx = 1920, which is NOT < 1920 → off-screen
      const bounds: Bounds = { x: 1920, y: 100, width: 2, height: 200 }
      const result = clampBoundsToDisplays([primaryDisplay], bounds)
      expect(result).not.toBe(bounds) // was clamped
    })
  })
})

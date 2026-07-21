/**
 * clampBoundsToDisplays — pure geometry utility for off-screen window recovery.
 *
 * No Electron imports — fully unit-testable without a display.
 * The thin `clampBoundsToScreen()` wrapper in main/index.ts supplies the real
 * display list from `screen.getAllDisplays()`.
 */

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Return `bounds` unchanged when the window **centre** lies within any
 * display's work area.  Otherwise move the window to the geometrically
 * nearest display's work area, clamping width/height to fit.
 *
 * "Nearest" is Euclidean distance from the window centre to the display's
 * work-area centre.
 *
 * @param displays  List of display descriptors (typically from `screen.getAllDisplays()`).
 *                  An empty list returns `bounds` unchanged.
 * @param bounds    Current (possibly off-screen) window geometry.
 */
export function clampBoundsToDisplays(
  displays: { workArea: WorkArea }[],
  bounds: Bounds,
): Bounds {
  if (displays.length === 0) return bounds

  // Window centre point.
  const cx = bounds.x + Math.floor(bounds.width / 2)
  const cy = bounds.y + Math.floor(bounds.height / 2)

  // Fast path: centre is already within a display's work area.
  const isOnScreen = displays.some(
    ({ workArea: wa }) =>
      cx >= wa.x && cx < wa.x + wa.width && cy >= wa.y && cy < wa.y + wa.height,
  )
  if (isOnScreen) return bounds

  // Find the display whose work-area centre is nearest to the window centre.
  let nearest = displays[0]
  let minDist = Infinity
  for (const d of displays) {
    const { x, y, width, height } = d.workArea
    const dist = Math.hypot(cx - (x + width / 2), cy - (y + height / 2))
    if (dist < minDist) {
      minDist = dist
      nearest = d
    }
  }

  // Fit the window inside the nearest work area.
  const wa = nearest.workArea
  const w = Math.min(bounds.width, wa.width)
  const h = Math.min(bounds.height, wa.height)
  const x = Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - w))
  const y = Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - h))

  return { x, y, width: w, height: h }
}

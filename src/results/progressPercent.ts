/**
 * The whole percent a sampling-progress fraction DISPLAYS as — the one granularity anything in the
 * app renders progress at (`describeClipStripStatus`'s caption and live-region announcement).
 *
 * Shared by the renderer and by `useVideoAnalysis`'s progress throttle on purpose (strides-e4c.3):
 * the throttle publishes a new fraction only when this value changes, and because both sides read
 * the SAME function the throttled stream displays exactly what the unthrottled one would, frame
 * for frame. Keyed on a different bucket (say `Math.floor`) the throttle could suppress a frame
 * that would have rounded the label up, and the strip would lag the real progress by a percent.
 *
 * Progress arrives from a sampler, so a stray NaN or an out-of-range value must not reach a label.
 */
export function progressPercent(fraction: number): number {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return Math.round(clamped * 100)
}

/**
 * Small numeric primitives shared across the heuristics modules (body-scale normalization,
 * view-detection signals, gait-cycle amplitude aggregation, confidence clamping). Kept as one
 * file rather than duplicated per-module because median/percentile have easy-to-get-wrong edge
 * cases (even-length arrays, empty input) that are worth getting right exactly once.
 */

/** Callers must not pass an empty array — every call site here first checks `length > 0`. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Linear-interpolation percentile (matches the common "linear" method, e.g. numpy's default).
 * Used for the sagittal-excursion-ratio signal in view detection specifically because it's
 * robust to a single stray bad detection in a way a plain min/max range wouldn't be — but only once
 * there are enough samples for the quantile to sit off the end of the sorted array, which is why
 * that caller carries its own minimum sample count rather than reading this as an unconditional
 * guarantee.
 */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const idx = p * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  const t = idx - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * t
}

export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** NaN clamps to 0 rather than propagating — the one place a stray NaN gets stopped before it
 * could leak into a `MetricResult.confidence`, which the output contract forbids from ever
 * being NaN. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Interior angle at `vertex`, in degrees, between the rays vertex→a and vertex→b — the standard
 * three-point joint-angle formula (e.g. hip-knee-ankle), used by kneeFlexion. Always in `[0,
 * 180]` by construction (an absolute angular difference, wrapped).
 *
 * atan2-based rather than the law-of-cosines/`acos` form: `acos` loses precision as its argument
 * approaches ±1 — exactly where a near-straight (180°) or near-fully-folded (0°) joint would need
 * precision most — while two `atan2` calls plus a subtraction stay well-conditioned across the
 * whole range. This mirrors the atan2 style `trunkLean.ts` already uses for its own angle, rather
 * than introducing a second angle-computation convention.
 */
export function angleBetweenVectorsDeg(
  vertex: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const angleToA = Math.atan2(a.y - vertex.y, a.x - vertex.x)
  const angleToB = Math.atan2(b.y - vertex.y, b.x - vertex.x)
  let diff = Math.abs(angleToA - angleToB)
  if (diff > Math.PI) diff = 2 * Math.PI - diff
  return (diff * 180) / Math.PI
}

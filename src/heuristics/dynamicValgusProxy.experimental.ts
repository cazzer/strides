import type { Keypoint, KeypointName, PoseFrame } from '../pose/types'
import { deriveBoundingBox, computeCropRect } from '../pose/backends/movenetCrop'
import type { BoundingBoxPx, CropRectPx } from '../pose/backends/movenetCrop'

/**
 * Dynamic-valgus-proxy probe (GitHub #47, scope-corrected — see CLAUDE.md's "Dynamic valgus
 * proxy investigation" section for the full story). Frontal-plane ankle/knee collapse toward the
 * midline during stance ("dynamic valgus" / colloquially "knock-knee"), probed on
 * `park-approach.mp4` (the only front-view footage in this repo) as a substitute for the
 * original ticket's rear-view heel-whip/shoe-roll signals — those stay structurally
 * front-invisible and remain blocked on real rear-view footage, not attempted here.
 *
 * Naming discipline: this measures a lower-leg SILHOUETTE lean angle, not a joint angle and not
 * a validated biomechanical quantity. Never call it "pronation". Never call it "clinical"
 * anything. "Dynamic valgus proxy" only, per the scope correction.
 *
 * Throwaway probe code, not a shipped metric — no `HeuristicsConfig` plumbing, no `MetricResult`
 * shape, no unit tests (mirrors this repo's experimental-probe convention for a single-clip
 * smoke test; unlike a shipped heuristic, correctness here is validated by eyeballing keyframes
 * against the live-clip numbers, not by a fixture-driven test suite).
 */

export type LowerLegSide = 'left' | 'right'

function kneeAnkleNames(side: LowerLegSide): { knee: KeypointName; ankle: KeypointName } {
  return side === 'left'
    ? { knee: 'left_knee', ankle: 'left_ankle' }
    : { knee: 'right_knee', ankle: 'right_ankle' }
}

function findKeypoint(frame: PoseFrame, name: KeypointName): Keypoint | undefined {
  return frame.keypoints.find((k) => k.name === name)
}

/**
 * Picks a side ONCE for the whole clip — by whichever side's knee+ankle confidence sums higher
 * on the first frame that offers a real comparison — rather than re-deciding every frame. A
 * per-frame flip would make the crop region (and therefore the lean signal) discontinuous for
 * reasons that have nothing to do with the runner's actual motion. Callers should call this once
 * per clip and reuse the result; calling it again mid-clip would just re-derive the same answer
 * off a different frame, which is the exact instability this function exists to avoid.
 */
export function pickTrackingSide(frame: PoseFrame): LowerLegSide | null {
  const left = kneeAnkleNames('left')
  const right = kneeAnkleNames('right')
  const leftKnee = findKeypoint(frame, left.knee)
  const leftAnkle = findKeypoint(frame, left.ankle)
  const rightKnee = findKeypoint(frame, right.knee)
  const rightAnkle = findKeypoint(frame, right.ankle)
  const leftScore = leftKnee && leftAnkle ? leftKnee.score + leftAnkle.score : -Infinity
  const rightScore = rightKnee && rightAnkle ? rightKnee.score + rightAnkle.score : -Infinity
  if (leftScore === -Infinity && rightScore === -Infinity) return null
  return leftScore >= rightScore ? 'left' : 'right'
}

export interface LegCropOptions {
  minKeypointConfidence: number
  paddingMultiplier: number
  minCropSidePx: number
}

/** Not tuned against real footage beyond this spike's one clip — see CLAUDE.md write-up. Padding
 * is generous (1.8x) relative to `movenetCrop.ts`'s tracking-crop defaults because this crop
 * needs to keep the whole shank in frame across a stride cycle, not just a slow-moving torso
 * bbox. */
export const DEFAULT_LEG_CROP_OPTIONS: LegCropOptions = {
  minKeypointConfidence: 0.3,
  paddingMultiplier: 1.8,
  minCropSidePx: 150,
}

/**
 * Crop rect over just the tracked side's knee+ankle pair. Reuses `movenetCrop.ts`'s
 * `deriveBoundingBox`/`computeCropRect` primitives exactly as MoveNet's tracking crop uses them
 * for a full-body box — here over a 2-point knee/ankle bbox instead, so the crop shows the shank
 * (what a frontal-plane collapse actually displaces), not just the foot.
 */
export function deriveLegCropRect(
  frame: PoseFrame,
  side: LowerLegSide,
  frameWidth: number,
  frameHeight: number,
  options: LegCropOptions = DEFAULT_LEG_CROP_OPTIONS,
): CropRectPx | null {
  const { knee, ankle } = kneeAnkleNames(side)
  const kneeKp = findKeypoint(frame, knee)
  const ankleKp = findKeypoint(frame, ankle)
  if (!kneeKp || !ankleKp) return null

  const box: BoundingBoxPx | null = deriveBoundingBox(
    [kneeKp, ankleKp],
    options.minKeypointConfidence,
    2,
  )
  if (!box) return null

  return computeCropRect(
    box,
    frameWidth,
    frameHeight,
    options.paddingMultiplier,
    options.minCropSidePx,
  )
}

export interface MaskPcaResult {
  centroidX: number
  centroidY: number
  foregroundPixelCount: number
  /** Signed degrees off vertical. 0 = the silhouette's long axis points straight up in the crop.
   * Positive = tilts toward larger x (screen-right) going up from the ankle end; negative =
   * screen-left. Whether "positive" corresponds to inward or outward collapse depends on which
   * side was tracked (`pickTrackingSide`) and isn't resolved by this function — that's gate 3,
   * resolved by eyeballing pulled keyframes against the sign, see CLAUDE.md. */
  leanAngleDeg: number
}

/** A judgment-call floor, not derived from real footage: below this many foreground pixels in a
 * 256x256 crop canvas, a centroid/covariance estimate is too noisy to trust at all. */
const MIN_FOREGROUND_PIXELS = 200

/**
 * 2D PCA over foreground-mask pixel coordinates: centroid + covariance matrix, dominant
 * eigenvector via the closed-form 2x2 solution (no general eigensolver needed at this size).
 *
 * Real gotcha this function exists to handle: PCA eigenvectors are only defined up to a ±180°
 * sign flip. Without an explicit sign-continuity rule, a random per-frame flip would masquerade
 * as noise in the lean-angle series. Fixed here by always orienting the axis to point "up"
 * (toward the knee end, i.e. decreasing image y) — a convention that's stable BY CONSTRUCTION on
 * every frame independently, rather than one that depends on frame-to-frame continuity holding,
 * which a single noisy/fragmented mask could break.
 *
 * `isForeground` is injected rather than hardcoded to a specific category value so this doesn't
 * silently break if the segmenter's actual category encoding differs from what was assumed —
 * see CLAUDE.md's write-up for what was actually observed live.
 */
export function computeMaskPca(
  mask: Uint8Array,
  width: number,
  height: number,
  isForeground: (value: number) => boolean = (v) => v > 0,
): MaskPcaResult | null {
  let sumX = 0
  let sumY = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      if (isForeground(mask[rowOffset + x])) {
        sumX += x
        sumY += y
        count++
      }
    }
  }
  if (count < MIN_FOREGROUND_PIXELS) return null

  const meanX = sumX / count
  const meanY = sumY / count

  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      if (isForeground(mask[rowOffset + x])) {
        const dx = x - meanX
        const dy = y - meanY
        sxx += dx * dx
        syy += dy * dy
        sxy += dx * dy
      }
    }
  }
  sxx /= count
  syy /= count
  sxy /= count

  // Dominant eigenvalue of the 2x2 symmetric covariance matrix [[sxx, sxy], [sxy, syy]] from the
  // trace/determinant quadratic, then solve (M - lambda*I)v = 0 for v. The (sxy, lambda - syy)
  // form is degenerate when sxy ~ 0 (an axis-aligned covariance), handled as a fallback below.
  const trace = sxx + syy
  const det = sxx * syy - sxy * sxy
  const discriminant = Math.max(0, (trace * trace) / 4 - det)
  const lambda1 = trace / 2 + Math.sqrt(discriminant)

  let vx: number
  let vy: number
  if (Math.abs(sxy) > 1e-9) {
    vx = lambda1 - syy
    vy = sxy
  } else if (sxx >= syy) {
    vx = 1
    vy = 0
  } else {
    vx = 0
    vy = 1
  }
  const norm = Math.hypot(vx, vy)
  if (norm === 0) return null
  vx /= norm
  vy /= norm

  // Sign-continuity rule (see doc comment above): orient so the axis points "up" in image space
  // (vy <= 0, i.e. toward decreasing y / toward the knee).
  if (vy > 0) {
    vx = -vx
    vy = -vy
  }

  // Signed angle of the "up" axis off true vertical (0, -1): 0 when the axis points straight up,
  // positive when it leans toward +x (screen-right).
  const leanAngleDeg = (Math.atan2(vx, -vy) * 180) / Math.PI

  return { centroidX: meanX, centroidY: meanY, foregroundPixelCount: count, leanAngleDeg }
}

/**
 * Intersection-over-union between two same-size masks — the temporal-stability signal (gate 1).
 * Both masks must be the same width/height; the probe's crop canvas is a fixed size regardless
 * of the source crop rect's side, so this always holds for consecutive frames in practice.
 */
export function computeMaskIoU(
  a: Uint8Array,
  b: Uint8Array,
  isForeground: (value: number) => boolean = (v) => v > 0,
): number {
  if (a.length !== b.length) {
    throw new Error(`computeMaskIoU: mask length mismatch (${a.length} vs ${b.length})`)
  }
  let intersection = 0
  let union = 0
  for (let i = 0; i < a.length; i++) {
    const fa = isForeground(a[i])
    const fb = isForeground(b[i])
    if (fa || fb) union++
    if (fa && fb) intersection++
  }
  return union === 0 ? 0 : intersection / union
}

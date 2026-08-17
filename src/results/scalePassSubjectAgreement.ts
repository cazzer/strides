import {
  deriveBoundingBox,
  isBoundingBoxContinuous,
} from '../pose/backends/movenetCrop'
import type { BoundingBoxPx } from '../pose/backends/movenetCrop'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { Keypoint } from '../pose/types'
import type { PersonSelectionDiagnostics } from './retroactivePersonSelection'
import type { RetroactivePersonSelectionConfig } from './retroactivePersonSelection'

export interface SubjectAgreement {
  status: 'agreed' | 'diverged' | 'no-opinion'
  /** Why no opinion was formed. `null` exactly when `status` is `'agreed'` or `'diverged'`. */
  reason:
    | 'primary-not-selected'
    | 'scale-not-selected'
    | 'too-few-comparable-instants'
    | null
  /** Primary detections that found a scale-pass detection within `MAX_PAIRING_GAP_SECONDS`. */
  comparedInstants: number
  /** Of those, how many pairs passed the continuity predicate. */
  agreeingInstants: number
}

/**
 * How far apart in time two detections may sit and still describe the same instant.
 *
 * Derived from measured cadence: the side-view demo's primary pass produces ~56-58 detections
 * across ~6.2s, so ~108ms spacing and a typical nearest-neighbour distance of <= 54ms; on the
 * sequential path both passes draw from the same discrete set of frame presentation times and
 * share timestamps outright (measured: `totalSamples` identical across the two passes on all
 * three test clips).
 *
 * Upper-bounded by subject travel rather than by convenience: a runner crossing a 1920px frame in
 * ~1.5s moves ~1.8 box sides per second, so 0.1s of slack is ~0.18 sides — the same person's boxes
 * still overlap heavily across it, while reaching a DIFFERENT person in the frame requires >~1
 * side. Widening this would start letting genuine divergence read as agreement.
 */
const MAX_PAIRING_GAP_SECONDS = 0.1

/**
 * Below this many comparable instants the answer is "no opinion", never "diverged". A verdict
 * drawn from a handful of instants is a verdict drawn from detector noise, and the cost of a
 * false "diverged" (a caveat sentence contradicting an accurate number on every normal run) is
 * paid on every clip, while the cost of an extra "no opinion" is one silent graft that behaves
 * exactly as it did before this check existed.
 */
const MIN_COMPARABLE_INSTANTS = 10

/**
 * Divergence takes a STRICT majority of the comparable instants: `agreeing / compared < 0.5`.
 *
 * The expected separation is ~1.0 (same person) against ~0.0 (different person), so this sits
 * mid-dead-zone with ~0.4 of margin on each side and two or three collapsed detections cannot
 * move it. The asymmetry is deliberate — the default is to graft silently, and it takes a
 * majority of the evidence to add the sentence. A winner that is half runner and half bystander
 * lands near 0.5 and resolves to `'agreed'`; that is epic #52's mixed-winner problem, and
 * tightening this threshold to catch it would import false-positive risk to fix a different bug.
 */
const MIN_AGREEING_FRACTION = 0.5

interface Instant {
  timestamp: number
  box: BoundingBoxPx
}

/**
 * The box the person-selection stage itself scored for this frame, or `null` if the frame yielded
 * none.
 *
 * `status === 'detected'` holds iff the keypoint cleared the robustness floor in a sample that
 * SURVIVED person selection — a sample the stage attributed to somebody else was replaced by
 * `{ timestamp, frame: null }`, and every channel of a null frame comes back
 * `'unrecoverable'`/`'interpolated'`, never `'detected'`. So filtering to `'detected'` keypoints
 * and re-deriving with the run's own selection knobs reproduces exactly the box the stage used,
 * with no new diagnostics field to carry it.
 *
 * Exact so long as `robustness.minKeypointConfidence` and `personSelection.minKeypointConfidence`
 * agree (both 0.3 by default); the effective floor here is the MAX of the two, because the
 * `'detected'` filter already applied the robustness one. Only a dev override moving exactly one
 * of them separates them — CLAUDE.md's own worked example is
 * `{ robustness: { minKeypointConfidence: 0.9 } }` — and the asymmetry is benign in direction: a
 * raised robustness floor shrinks the box on BOTH sides symmetrically, so the realistic outcome
 * is fewer comparable instants and more `'no-opinion'`, never a spurious `'diverged'`.
 */
function boxForFrame(
  frame: RobustPoseFrame,
  bounds: RetroactivePersonSelectionConfig,
): BoundingBoxPx | null {
  const detected: Keypoint[] = []
  for (const keypoint of frame.keypoints) {
    if (keypoint.status !== 'detected') continue
    // Non-null by construction: `x`/`y` are null only when status is 'unrecoverable'.
    detected.push({
      name: keypoint.name,
      x: keypoint.x as number,
      y: keypoint.y as number,
      score: keypoint.score,
    })
  }
  return deriveBoundingBox(
    detected,
    bounds.minKeypointConfidence,
    bounds.minConfidentKeypoints,
  )
}

function instants(
  frames: RobustPoseFrame[],
  bounds: RetroactivePersonSelectionConfig,
): Instant[] {
  const out: Instant[] = []
  for (const frame of frames) {
    const box = boxForFrame(frame, bounds)
    if (box !== null) out.push({ timestamp: frame.timestamp, box })
  }
  return out
}

function noOpinion(reason: SubjectAgreement['reason']): SubjectAgreement {
  return { status: 'no-opinion', reason, comparedInstants: 0, agreeingInstants: 0 }
}

/**
 * Whether the background scale pass's independently selected subject is the same person the
 * primary pass selected (issue #56, epic #52 item 3).
 *
 * Each pass runs `selectRetroactivePersonOfInterest` over its own sample sequence from its own
 * backend and commits to its own identity; before this check nothing reconciled the two, so a
 * scale pass that won on a bystander could write that bystander's centimetre metrics onto a
 * result whose other seven metrics describe the runner.
 *
 * **The comparison is per-instant, not per-aggregate.** Every aggregate candidate — the winner's
 * evidence span, its median bbox centre, its `medianAreaPx` — is a statistic over a DIFFERENT
 * SAMPLE SET on each side, so it confounds "different person" with "different detector recall".
 * Measured on real footage: the side-view demo's two passes report winner partition spans of
 * [0.08, 6.32] and [0.08, 9.16] for indisputably the same runner, and the front-approach demo's
 * apparent subject size grows ~3x across the clip, so a median-area comparison is span-dependent
 * there too — in the opposite direction. At a MATCHED TIMESTAMP the same person has the same
 * apparent size and the same image position regardless of backend, so span-dependence vanishes by
 * construction and positional plus scale evidence arrive together.
 *
 * Cross-backend comparability is structural rather than assumed: `deriveBoundingBox` excludes head
 * and foot keypoints, so both boxes are the hull of the same 12 limb/torso landmarks, and
 * MediaPipe emits them in source-video pixels exactly as MoveNet does.
 *
 * The per-pair predicate is `isBoundingBoxContinuous` — this codebase's single answer to "could
 * these two boxes be the same person" — fed `bounds`, the run's own already-resolved
 * `personSelection` configuration. **No new geometric threshold**: a development override that
 * loosens continuity loosens this identically. `primaryBox` is the REFERENCE, deliberately: the
 * relation is not symmetric, since the speed bound normalises displacement by the reference's own
 * side length.
 *
 * At a shared timestamp (the common case on the sequential path) the elapsed gap is exactly 0, so
 * `isWithinCenterSpeedBound` reports "unavailable" and position continuity rests entirely on the
 * boxes OVERLAPPING — which is the strictest and most correct reading available at a single
 * instant: the same person's two boxes overlap heavily, and a different person's do not overlap at
 * all. The speed term is there for the pairs that land tens of milliseconds apart.
 *
 * Both frame arrays MUST be sorted ascending by `timestamp` — the same precondition
 * `selectRetroactivePersonOfInterest` documents, and satisfied for the same reason: both come from
 * `runClipAnalysisPipeline`, which sorts. The pairing walk assumes it.
 *
 * Pure: neither input, nor anything reachable from it, is mutated.
 */
export function assessScalePassSubjectAgreement(
  primary: { frames: RobustPoseFrame[]; personSelection: PersonSelectionDiagnostics },
  scale: { frames: RobustPoseFrame[]; personSelection: PersonSelectionDiagnostics },
  bounds: RetroactivePersonSelectionConfig,
): SubjectAgreement {
  // A pass that committed to no subject cannot be said to have selected a different one. This
  // reads `status`, never `segments` — on every skip path `segments` is `[]`, so a segment-shaped
  // check would be reading absence and calling it evidence. It also covers the disabled stage
  // symmetrically: with no identity committed on either side, a firing check would be measuring
  // tracker hopping, not divergence.
  if (primary.personSelection.status !== 'selected') {
    return noOpinion('primary-not-selected')
  }
  if (scale.personSelection.status !== 'selected') {
    return noOpinion('scale-not-selected')
  }

  const primaryInstants = instants(primary.frames, bounds)
  const scaleInstants = instants(scale.frames, bounds)

  let comparedInstants = 0
  let agreeingInstants = 0
  // Two-pointer nearest-neighbour: `cursor` only ever advances, because both lists ascend and the
  // nearest scale instant to a later primary instant can never precede the nearest to an earlier
  // one. O(n + m) overall.
  let cursor = 0
  for (const primaryInstant of primaryInstants) {
    while (
      cursor + 1 < scaleInstants.length &&
      Math.abs(scaleInstants[cursor + 1].timestamp - primaryInstant.timestamp) <=
        Math.abs(scaleInstants[cursor].timestamp - primaryInstant.timestamp)
    ) {
      cursor += 1
    }
    const nearest = scaleInstants[cursor]
    if (nearest === undefined) break
    const gapSeconds = Math.abs(nearest.timestamp - primaryInstant.timestamp)
    if (gapSeconds > MAX_PAIRING_GAP_SECONDS) continue

    comparedInstants += 1
    if (
      isBoundingBoxContinuous(nearest.box, primaryInstant.box, gapSeconds, bounds)
    ) {
      agreeingInstants += 1
    }
  }

  if (comparedInstants < MIN_COMPARABLE_INSTANTS) {
    return {
      status: 'no-opinion',
      reason: 'too-few-comparable-instants',
      comparedInstants,
      agreeingInstants,
    }
  }

  return {
    status:
      agreeingInstants / comparedInstants < MIN_AGREEING_FRACTION
        ? 'diverged'
        : 'agreed',
    reason: null,
    comparedInstants,
    agreeingInstants,
  }
}

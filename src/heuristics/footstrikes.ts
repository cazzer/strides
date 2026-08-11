import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig } from './types'
import { estimateBodyScale } from './bodyScale'
import { resolvePoint } from './keypoints'
import { findLocalExtrema } from './extrema'
import type { Extremum } from './extrema'

export interface FootstrikeCandidate {
  frameIndex: number
  timestamp: number
  side: 'left' | 'right'
}

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

/**
 * `findLocalExtrema` gives every prominence-confirmed local max/min of one side's ankle-y series;
 * only the MAXIMA are candidate footstrikes (ankle.y largest ≈ foot lowest on screen ≈ closest to
 * the ground). This is an explicit approximation — there is no foot/toe keypoint or ground-plane
 * calibration anywhere in this pipeline, so "lowest visible ankle point" stands in for "ground
 * contact", which is a real but bounded source of error (see design.md).
 *
 * A simple greedy scan then enforces the minimum footstrike interval: real footstrikes can't be
 * closer together than a runner's fastest plausible cadence, so a candidate less than
 * `minIntervalSeconds` after the last KEPT one is almost certainly the same footstrike
 * re-detected across a couple of noisy frames, not a second one.
 */
function extractFootstrikes(
  extrema: Extremum[],
  side: 'left' | 'right',
  minIntervalSeconds: number,
): FootstrikeCandidate[] {
  const kept: FootstrikeCandidate[] = []
  let lastTimestamp = -Infinity
  for (const extremum of extrema) {
    if (extremum.kind !== 'max') continue
    if (extremum.timestamp - lastTimestamp < minIntervalSeconds) continue
    kept.push({ frameIndex: extremum.index, timestamp: extremum.timestamp, side })
    lastTimestamp = extremum.timestamp
  }
  return kept
}

/**
 * Detects footstrike candidates across both legs of a pose-frame sequence — the shared basis for
 * overstriding, cadence, and foot-strike-pattern, all of which need "when did a foot plant"
 * without each reimplementing ankle-extrema detection and dedup.
 *
 * Per side, builds the ankle-y series (`resolvePoint` — null where the ankle isn't resolvable
 * that frame, which `findLocalExtrema` treats as a gap boundary rather than interpolating across),
 * runs it through `findLocalExtrema` with a prominence threshold scaled to this clip's body size
 * (`footstrikeMinProminenceRatio * torsoLengthPx` — the same normalizer every heuristic in this
 * package uses, see `bodyScale.ts`), and keeps only the maxima that survive the
 * `footstrikeMinIntervalSeconds` dedup in `extractFootstrikes`.
 *
 * Returns candidates from both legs combined into one timestamp-ordered list (not grouped or
 * interleaved by side) — the natural shape for a cadence computation that just wants "every
 * footstrike, in order, regardless of which foot", while `side` is still carried on each
 * candidate for consumers (overstriding, foot-strike-pattern) that need to resolve a per-leg point
 * at that instant.
 *
 * Returns `[]` when there's no resolvable body-scale reference at all (no shoulders/hips to
 * measure torso length from) — there's no way to size the prominence threshold without one, so no
 * candidates can be extracted. Callers that need to distinguish "no body scale" from "body scale
 * present but zero footstrikes found" (as `computeOverstriding` does, for a more specific caveat
 * message) should call `estimateBodyScale` themselves first.
 */
export function detectFootstrikes(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): FootstrikeCandidate[] {
  const bodyScale = estimateBodyScale(frames)
  if (bodyScale === null) return []

  const minProminenceAbs = config.footstrikeMinProminenceRatio * bodyScale.torsoLengthPx

  const candidates: FootstrikeCandidate[] = []
  for (const side of ['left', 'right'] as const) {
    const ankleName = ANKLE_NAME[side]
    const series = frames.map((frame) => {
      const ankle = resolvePoint(frame, ankleName)
      return ankle === null ? null : { t: frame.timestamp, v: ankle.y }
    })
    const extrema = findLocalExtrema(series, minProminenceAbs)
    candidates.push(...extractFootstrikes(extrema, side, config.footstrikeMinIntervalSeconds))
  }

  candidates.sort((a, b) => a.timestamp - b.timestamp)
  return candidates
}

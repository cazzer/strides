import { classifyFrame } from './confidenceFilter'
import type { RawKeypointState } from './confidenceFilter'
import { COMMON_KEYPOINT_NAMES } from '../types'
import type { KeypointName } from '../types'
import { DEFAULT_ROBUSTNESS_CONFIG } from './types'
import type {
  PoseSample,
  RobustKeypoint,
  RobustPoseFrame,
  RobustnessConfig,
} from './types'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Treats one keypoint (e.g. "left_knee") as its own 1-D time series across all samples,
// independent of the other 11 keypoints — see design.md for why this unifies the null-frame
// case with the low-confidence-keypoint case instead of special-casing either.
function interpolateChannel(
  samples: PoseSample[],
  states: RawKeypointState[],
  name: KeypointName,
  maxGapSeconds: number,
): RobustKeypoint[] {
  const result: RobustKeypoint[] = new Array(samples.length)

  let i = 0
  while (i < states.length) {
    const state = states[i]

    if (state.kind === 'present') {
      result[i] = {
        name,
        x: state.keypoint.x,
        y: state.keypoint.y,
        score: state.keypoint.score,
        status: 'detected',
      }
      i += 1
      continue
    }

    const runStart = i
    let runEnd = i
    while (runEnd < states.length && states[runEnd].kind === 'missing') {
      runEnd += 1
    }

    // Maximal run of 'missing' states: the samples immediately flanking it, if they exist,
    // are guaranteed 'present' — never extrapolated from further away.
    const beforeIndex = runStart - 1
    const beforeState = beforeIndex >= 0 ? states[beforeIndex] : undefined
    const before =
      beforeState?.kind === 'present' ? beforeState.keypoint : undefined

    const afterIndex = runEnd
    const afterState =
      afterIndex < states.length ? states[afterIndex] : undefined
    const after =
      afterState?.kind === 'present' ? afterState.keypoint : undefined

    const gapSeconds =
      before !== undefined && after !== undefined
        ? samples[afterIndex].timestamp - samples[beforeIndex].timestamp
        : Infinity
    // gapSeconds > 0 (not >= 0): a zero-length gap between two same-timestamp
    // anchors has no well-defined interpolation position (t = 0/0 = NaN) —
    // treat it as unrecoverable rather than reporting a NaN as 'interpolated'.
    const recoverable =
      before !== undefined &&
      after !== undefined &&
      gapSeconds > 0 &&
      gapSeconds <= maxGapSeconds

    for (let j = runStart; j < runEnd; j += 1) {
      if (recoverable && before !== undefined && after !== undefined) {
        const t =
          (samples[j].timestamp - samples[beforeIndex].timestamp) / gapSeconds
        result[j] = {
          name,
          x: lerp(before.x, after.x, t),
          y: lerp(before.y, after.y, t),
          score: lerp(before.score, after.score, t),
          status: 'interpolated',
        }
      } else {
        result[j] = {
          name,
          x: null,
          y: null,
          score: 0,
          status: 'unrecoverable',
        }
      }
    }

    i = runEnd
  }

  return result
}

export function applyRobustness(
  samples: PoseSample[],
  config: RobustnessConfig = DEFAULT_ROBUSTNESS_CONFIG,
): RobustPoseFrame[] {
  const classifications = samples.map((sample) =>
    classifyFrame(sample.frame, config.minKeypointConfidence),
  )

  const channels = COMMON_KEYPOINT_NAMES.map((name, keypointIndex) =>
    interpolateChannel(
      samples,
      classifications.map((frameStates) => frameStates[keypointIndex]),
      name,
      config.maxGapSeconds,
    ),
  )

  return samples.map((sample, sampleIndex) => ({
    timestamp: sample.timestamp,
    keypoints: channels.map((channel) => channel[sampleIndex]),
    source: sample.frame === null ? 'missing' : 'detected',
    // Verbatim copy, deliberately outside the per-keypoint interpolation above — see the field's
    // docstring on RobustPoseFrame for why a scale is never gap-filled the way a position is.
    pixelsPerMeter: sample.frame?.pixelsPerMeter ?? null,
  }))
}

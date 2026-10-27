import { describe, expect, it } from 'vitest'
import { computeArmSwingAmplitude } from './armSwingAmplitude'
import { buildFrame } from './__fixtures__/testFrames'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'

/**
 * Fixed torso length matching syntheticGait.ts's own convention (shoulder-mid to hip-mid = 150px).
 * This metric DIVIDES by it, so the expected values below
 * carry it explicitly: value = (leftAmplitudePx + rightAmplitudePx) / (2 × TORSO_LENGTH_PX).
 */
const TORSO_LENGTH_PX = 150
const SHOULDER_Y = 250
const LEFT_SHOULDER_X = 170
const RIGHT_SHOULDER_X = 230
const LEFT_HIP_X = 175
const RIGHT_HIP_X = 225
/** Resting wrist-below-shoulder offset — an arbitrary but plausible carried-arm position; only
 * the OSCILLATION around it (see below) is what the metric measures. */
const BASE_WRIST_OFFSET_Y = 80
/** Whole-body vertical bounce, px peak-to-trough, the builder adds by default so the metric's own
 * stride-rate anchor (`resolveStrideRateHz`) resolves — see the builder's `bounceAmplitudePx`. */
const BODY_BOUNCE_PX = 10

/**
 * Deterministic, seedable jitter, so a noise fixture is reproducible run to run — a randomly-seeded
 * one would make a threshold test flaky in exactly the regime it exists to pin down. Mulberry32.
 */
function makeJitter(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let x = Math.imul(state ^ (state >>> 15), 1 | state)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    // Symmetric about 0, in [-1, 1).
    return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

/**
 * Builds a `RobustPoseFrame[]` with a resolvable torso (shoulders+hips) and each wrist oscillating
 * in y relative to its own shoulder — the exact signal the shared `computeSideSwing` reads. Same
 * generator as `armSwing.test.ts`'s: left and right swing in opposite phase, each with its
 * own configurable amplitude, so with the jitter/harmonic knobs at their `0` defaults each side is
 * an exact sinusoid whose peak-to-trough excursion is exactly that side's `amplitudePx` — and the
 * expected VALUE here is hand-computable as `(left + right) / (2 × TORSO_LENGTH_PX)`.
 */
function buildArmSwingFrames(params: {
  durationSec: number
  fps: number
  swingFreqHz: number
  leftAmplitudePx: number
  rightAmplitudePx: number
  /** Peak per-frame tracking jitter added to each wrist's y, px. Models what a real detector does
   * to this series; `0` (the default) keeps every pre-existing case an exact sinusoid. */
  leftJitterPx?: number
  rightJitterPx?: number
  /** Amplitude of a second harmonic at 2x `swingFreqHz`, as a fraction of that side's own
   * amplitude — the STEP rhythm riding on the stride rhythm (see `armSwing.test.ts`'s note on
   * why this is real rather than decorative). */
  harmonicRatio?: number
  /** Whole-body on-screen scale growth across the clip — every body dimension multiplied by
   * `g(t) = scaleGrowthFactor^(t / durationSec)`, exponential so the stabilizer's log-quadratic
   * trend captures it exactly (see `armSwing.test.ts`'s `scaleGrowthFactor` doc for the full
   * reasoning). `1` (the default) is bit-identical to the ungrown fixture. */
  scaleGrowthFactor?: number
  /**
   * Peak-to-trough whole-body vertical bounce, px, at TWICE `swingFreqHz` (one bounce per step, two
   * steps per stride), added identically to EVERY keypoint — so wrist−shoulder, shoulder span and
   * torso length are untouched by it, and the only thing it adds is a hip rhythm for
   * `resolveStrideRateHz` to anchor the arm search on. `0` keeps the hips motionless. ON by
   * default here, because the metric finds its own stride rate and has no anchor without it. */
  bounceAmplitudePx?: number
  /** Per-arm swing-frequency overrides, Hz — default `swingFreqHz`. The body bounce stays at
   * `2 × swingFreqHz`, so the metric's stride anchor is unaffected by either override. */
  leftSwingFreqHz?: number
  rightSwingFreqHz?: number
  seed?: number
}): RobustPoseFrame[] {
  const {
    durationSec,
    fps,
    swingFreqHz,
    leftAmplitudePx,
    rightAmplitudePx,
    leftJitterPx = 0,
    rightJitterPx = 0,
    harmonicRatio = 0,
    scaleGrowthFactor = 1,
    bounceAmplitudePx = BODY_BOUNCE_PX,
    leftSwingFreqHz = swingFreqHz,
    rightSwingFreqHz = swingFreqHz,
    seed = 1,
  } = params
  const frameCount = Math.round(durationSec * fps)
  const jitter = makeJitter(seed)
  const bodyCenterX = (LEFT_SHOULDER_X + RIGHT_SHOULDER_X) / 2

  const frames: RobustPoseFrame[] = []
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / fps
    const g = Math.pow(scaleGrowthFactor, t / durationSec)
    const leftPhase = 2 * Math.PI * leftSwingFreqHz * t
    const rightPhase = 2 * Math.PI * rightSwingFreqHz * t
    const harmonic = 2 * Math.PI * 2 * swingFreqHz * t
    const bounceY = (bounceAmplitudePx / 2) * Math.sin(harmonic)
    const leftShoulderX = bodyCenterX - (bodyCenterX - LEFT_SHOULDER_X) * g
    const rightShoulderX = bodyCenterX + (RIGHT_SHOULDER_X - bodyCenterX) * g
    const leftWristY =
      SHOULDER_Y +
      BASE_WRIST_OFFSET_Y * g -
      ((leftAmplitudePx * g) / 2) * Math.sin(leftPhase) +
      ((leftAmplitudePx * g * harmonicRatio) / 2) * Math.sin(2 * leftPhase) +
      jitter() * leftJitterPx
    const rightWristY =
      SHOULDER_Y +
      BASE_WRIST_OFFSET_Y * g -
      ((rightAmplitudePx * g) / 2) * Math.sin(rightPhase + Math.PI) +
      ((rightAmplitudePx * g * harmonicRatio) / 2) * Math.sin(2 * rightPhase) +
      jitter() * rightJitterPx

    frames.push(
      buildFrame(
        {
          left_shoulder: { x: leftShoulderX, y: SHOULDER_Y + bounceY },
          right_shoulder: { x: rightShoulderX, y: SHOULDER_Y + bounceY },
          left_hip: {
            x: bodyCenterX - (bodyCenterX - LEFT_HIP_X) * g,
            y: SHOULDER_Y + TORSO_LENGTH_PX * g + bounceY,
          },
          right_hip: {
            x: bodyCenterX + (RIGHT_HIP_X - bodyCenterX) * g,
            y: SHOULDER_Y + TORSO_LENGTH_PX * g + bounceY,
          },
          left_wrist: { x: leftShoulderX, y: leftWristY + bounceY },
          right_wrist: { x: rightShoulderX, y: rightWristY + bounceY },
        },
        t,
      ),
    )
  }
  return frames
}

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  swingFreqHz: 1.5,
}

/** The realistic fixture `armSwing.test.ts` uses for its shared-fit cases — stride-rate swing,
 * step-rate harmonic, modest jitter — reused so this metric's gates are exercised against the
 * same shape of trace the shared module is measured on. */
const REALISTIC = {
  ...BASE_PARAMS,
  leftAmplitudePx: 40,
  rightAmplitudePx: 20,
  leftJitterPx: 4,
  rightJitterPx: 4,
  harmonicRatio: 0.4,
  seed: 20260829,
}

describe('buildArmSwingFrames — the default body bounce', () => {
  it('moves every keypoint together, so wrist−shoulder and torso length are untouched by it', () => {
    const bouncing = buildArmSwingFrames({ ...BASE_PARAMS, leftAmplitudePx: 40, rightAmplitudePx: 20 })
    const still = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 20,
      bounceAmplitudePx: 0,
    })
    const y = (frame: RobustPoseFrame, name: string) =>
      frame.keypoints.find((kp) => kp.name === name)!.y!

    bouncing.forEach((frame, i) => {
      for (const side of ['left', 'right']) {
        expect(y(frame, `${side}_wrist`) - y(frame, `${side}_shoulder`)).toBeCloseTo(
          y(still[i], `${side}_wrist`) - y(still[i], `${side}_shoulder`),
          9,
        )
        expect(y(frame, `${side}_hip`) - y(frame, `${side}_shoulder`)).toBeCloseTo(
          y(still[i], `${side}_hip`) - y(still[i], `${side}_shoulder`),
          9,
        )
      }
    })
  })
})

describe('computeArmSwingAmplitude', () => {
  it('a clean front-view clip reports the MEAN of the two sides over torso length, exactly', () => {
    // Asymmetric on purpose: a mean of unequal sides is what distinguishes this metric's
    // aggregation from min/max, and both inputs are exact by construction —
    // (40 + 20) / (2 × 150) = 0.2.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 20,
    })

    const result = computeArmSwingAmplitude(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo((40 + 20) / (2 * TORSO_LENGTH_PX), 2)
    expect(result.unit).toBe('ratio')
    expect(result.viewFit).toBe('primary')
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1)
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, exact fits well past the
    // saturation R² and the cycle floor -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.caveat).toBeNull()
  })

  it('a side-view clip: still computed (never withheld), viewFit unsuitable, confidence capped near the 0.1 multiplier', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const result = computeArmSwingAmplitude(frames, 'side')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('side view')
  })

  it('an ambiguous-view clip: still computed, viewFit unsuitable, confidence capped near the 0.2 multiplier', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const result = computeArmSwingAmplitude(frames, 'ambiguous')

    expect(result.value).not.toBeNull()
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.25)
    expect(result.caveat).toContain('ambiguous view')
  })

  it('below the SHARED fit-quality gate the metric publishes nothing, on either arm', () => {
    const frames = buildArmSwingFrames(REALISTIC)

    // The realistic fixture's own fits sit around 0.79-0.84, so a 0.9 gate rejects it — the
    // shared `armSwingMinFitR2` key, read against the weaker arm.
    const strict = computeArmSwingAmplitude(frames, 'front', {
      ...DEFAULT_HEURISTICS_CONFIG,
      armSwingMinFitR2: 0.9,
    })

    expect(computeArmSwingAmplitude(frames, 'front').value).not.toBeNull()
    expect(strict.value).toBeNull()
    expect(strict.confidence).toBe(0)
    expect(strict.caveat).toContain('too irregular to measure')
  })

  it('a swing rhythm too irregular to fit on one arm yields null, never a fabricated amplitude', () => {
    // The gate reached by real noise rather than by a tightened config: the left arm swings
    // cleanly and the right arm is jitter with no rhythm in it at all. An estimator that reads
    // *some* amplitude off the right arm averages a fictional number into the mean.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 0,
      rightJitterPx: 20,
      seed: 7,
    })

    const result = computeArmSwingAmplitude(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.caveat).toContain('too irregular to measure')
  })

  it('an arm oscillating only at the STEP rate cannot be fitted to it — the step rate is off the grid', () => {
    // The multiperson clip's live failure (2026-08-29): the right arm's fit latched onto the STEP
    // rhythm at R² 0.324, clearing the 0.3 gate. Searched around the stride rate, the step rate is
    // not a candidate at all, so that arm now fits only what little of its trace sits near the
    // stride rate — nothing — and the metric publishes nothing rather than a mixed mean.
    const result = computeArmSwingAmplitude(
      buildArmSwingFrames({
        ...BASE_PARAMS,
        leftAmplitudePx: 40,
        rightAmplitudePx: 40,
        rightSwingFreqHz: 2 * BASE_PARAMS.swingFreqHz,
      }),
      'front',
    )

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toContain('too irregular to measure')
  })

  it('a rhythm mismatch between the two arms is not averaged into an amplitude', () => {
    // Both arms inside the ±20% stride band but on materially different rhythms — physically
    // impossible for one body, so at least one fit found something that is not the arm swing.
    // (1.75 − 1.25) / 1.25 = 0.4, past the shared 0.25 bound.
    const result = computeArmSwingAmplitude(
      buildArmSwingFrames({
        ...BASE_PARAMS,
        leftAmplitudePx: 40,
        rightAmplitudePx: 40,
        leftSwingFreqHz: 1.25,
        rightSwingFreqHz: 1.75,
      }),
      'front',
    )

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    // The caveat names the absence of one swing rhythm to size, never the comparability of the
    // two arms.
    expect(result.caveat).toContain('a single arm-swing size cannot be measured')
  })

  it('no resolvable body scale: null with the missing-normalizer caveat, never a claim about the arms', () => {
    // Hips and shoulders never resolve in the SAME frame — hips on even frames, shoulders and wrists
    // on odd ones — so the hip rhythm still anchors the arm search and both arms still fit, but
    // `estimateBodyScale` (shoulder-mid AND hip-mid in one frame) has nothing to measure. A
    // torso-normalized amplitude cannot be formed, and the caveat must name the true cause.
    const unresolve = (kp: RobustPoseFrame['keypoints'][number]) => ({
      ...kp,
      x: null,
      y: null,
      score: 0,
      status: 'unrecoverable' as const,
    })
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 20,
    }).map((frame, i) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) => {
        const isHip = kp.name === 'left_hip' || kp.name === 'right_hip'
        return (i % 2 === 0) === isHip ? kp : unresolve(kp)
      }),
    }))

    const result = computeArmSwingAmplitude(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toContain('No resolvable body-scale reference')
  })

  it('a degenerate zero-length torso is guarded, not divided by', () => {
    // Hips resolve ON the shoulders, so `estimateBodyScale` returns a measured torso of exactly
    // 0 px — the one resolvable-but-unusable normalizer. Never NaN/Infinity.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 20,
    }).map((frame) => {
      // Each hip sits ON its shoulder, bounce and all — the hip rhythm still anchors the search.
      const shoulderY = frame.keypoints.find((kp) => kp.name === 'left_shoulder')!.y
      return {
        ...frame,
        keypoints: frame.keypoints.map((kp) =>
          kp.name === 'left_hip'
            ? { ...kp, x: LEFT_SHOULDER_X, y: shoulderY }
            : kp.name === 'right_hip'
              ? { ...kp, x: RIGHT_SHOULDER_X, y: shoulderY }
              : kp,
        ),
      }
    })

    const result = computeArmSwingAmplitude(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toContain('No resolvable body-scale reference')
  })

  it('no resolvable wrist position: null value, 0 confidence, no crash', () => {
    // The body bounces (so the stride anchor resolves) but no wrist is ever detected.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    }).map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'left_wrist' || kp.name === 'right_wrist'
          ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : kp,
      ),
    }))

    expect(() => computeArmSwingAmplitude(frames, 'front')).not.toThrow()
    const result = computeArmSwingAmplitude(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toContain('No resolvable shoulder/wrist position')
  })

  it('no steady running rhythm: null with the rhythm caveat, never a fit over the bounce band', () => {
    // Arms swing cleanly, but the body never bounces, so there is no hip rhythm to anchor the
    // stride-rate search on — and deliberately no fallback to the shared bounce band.
    const result = computeArmSwingAmplitude(
      buildArmSwingFrames({
        ...BASE_PARAMS,
        leftAmplitudePx: 40,
        rightAmplitudePx: 40,
        bounceAmplitudePx: 0,
      }),
      'front',
    )

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toBe(
      'No steady running rhythm was found in this clip, so the arm swing could not be timed against it.',
    )
  })

  it('an empty frame list produces a well-formed null result, without throwing', () => {
    const result = computeArmSwingAmplitude([], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.frameCoverage).toBe(0)
    expect(result.caveat).not.toBeNull()
  })

  it('the side-quality disparity caveat fires, in amplitude terms, and costs confidence', () => {
    const bothEqual = computeArmSwingAmplitude(buildArmSwingFrames(REALISTIC), 'front')
    // Identical swing on both arms; only the RIGHT arm's tracking is degraded — a magnitude does
    // not self-cancel per-side tracking asymmetry — the worse arm's error lands undiluted in the
    // mean, so this caveat is load-bearing rather than decorative.
    const rightArmWorse = computeArmSwingAmplitude(
      buildArmSwingFrames({ ...REALISTIC, rightJitterPx: 9, seed: 42 }),
      'front',
    )

    expect(rightArmWorse.value).not.toBeNull()
    expect(rightArmWorse.confidence).toBeLessThan(bothEqual.confidence * 0.9)
    expect(rightArmWorse.caveat).toContain('fit its trace much less cleanly')
    expect(rightArmWorse.caveat).toContain('overall swing size')
    expect(bothEqual.caveat ?? '').not.toContain('fit its trace much less cleanly')
  })

  it('a subject growing 3× on screen reports the static body-proportion value — the growth cancels', () => {
    // Whole-body exponential growth (strides-egw): the stabilized per-side amplitudes come out at
    // the clip's reference (median inter-shoulder) scale — i.e. ×g at the median-sample instant —
    // and `estimateBodyScale`'s clip-median torso is the same ×g at the same median instant, so
    // the growth divides out exactly and the hand expectation is the STATIC one:
    // (40 + 20) / (2 × 150) = 0.2.
    const growing = computeArmSwingAmplitude(
      buildArmSwingFrames({
        ...BASE_PARAMS,
        leftAmplitudePx: 40,
        rightAmplitudePx: 20,
        scaleGrowthFactor: 3,
      }),
      'front',
    )

    expect(growing.value).not.toBeNull()
    expect(growing.value).toBeCloseTo((40 + 20) / (2 * TORSO_LENGTH_PX), 3)
  })

  it('never NaN: every degenerate input yields a finite number or null', () => {
    const empty = buildFrame({})
    const cases = [
      computeArmSwingAmplitude([], 'front'),
      computeArmSwingAmplitude([empty, empty], 'front'),
      computeArmSwingAmplitude(
        buildArmSwingFrames({ ...BASE_PARAMS, leftAmplitudePx: 0, rightAmplitudePx: 0 }),
        'front',
      ),
      computeArmSwingAmplitude(
        buildArmSwingFrames({ ...BASE_PARAMS, leftAmplitudePx: 40, rightAmplitudePx: 40 }),
        'ambiguous',
      ),
      computeArmSwingAmplitude(
        buildArmSwingFrames({
          ...BASE_PARAMS,
          leftAmplitudePx: 40,
          rightAmplitudePx: 40,
          bounceAmplitudePx: 0,
        }),
        'front',
      ),
    ]

    for (const result of cases) {
      if (result.value !== null) expect(Number.isFinite(result.value)).toBe(true)
      expect(Number.isNaN(result.confidence)).toBe(false)
      if (result.value === null) expect(result.confidence).toBe(0)
    }
  })
})

describe('computeArmSwingAmplitude — exemplars', () => {
  const frames = buildArmSwingFrames({
    ...BASE_PARAMS,
    leftAmplitudePx: 40,
    rightAmplitudePx: 24,
  })

  it('emits one armSwingCycle pair per side, from the shared builder', () => {
    const exemplars = computeArmSwingAmplitude(frames, 'front').exemplars!

    expect(exemplars).toHaveLength(2)
    expect(exemplars.map((exemplar) => exemplar.kind)).toEqual([
      'armSwingCycle',
      'armSwingCycle',
    ])
    // One per arm, never two of the same one.
    expect([...exemplars.map((exemplar) => exemplar.side)].sort()).toEqual(['left', 'right'])
    for (const exemplar of exemplars) {
      expect(exemplar.label).toContain('arm swing, ghosted together')
      expect(exemplar.quality).toBeGreaterThanOrEqual(0.5)
      expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.timestamp)
      expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.pairedTimestamp)
    }
  })

  it('emits nothing when the metric reports no value', () => {
    const flat = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 0,
      rightAmplitudePx: 0,
    })

    const result = computeArmSwingAmplitude(flat, 'front')

    expect(result.value).toBeNull()
    expect(result.exemplars).toBeUndefined()
  })
})

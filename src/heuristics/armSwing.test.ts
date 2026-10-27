import { describe, expect, it } from 'vitest'
import {
  ARM_SWING_BAND_HALF_WIDTH,
  ARM_SWING_BAND_STEP_FRACTION,
  buildSideExemplar,
  caveatForFailure,
  computeSideSwing,
  resolveStrideRateHz,
} from './armSwing'
import { buildFrame } from './__fixtures__/testFrames'
import { findLocalExtrema } from './extrema'
import { fitSpectralSinusoid } from './spectralFit'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { MetricExemplar } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'

/**
 * `armSwing.ts` is shared between the arm-swing metrics, and this suite exercises it DIRECTLY —
 * `computeSideSwing`, `buildSideExemplar` and `caveatForFailure`, not any metric that calls them.
 *
 * The distinction is load-bearing rather than stylistic. These cases lived in
 * `armSwingSymmetry.test.ts` until that metric was withdrawn, which made every one of them
 * coverage of shared code named after a consumer — and therefore coverage that looked deletable
 * alongside the consumer. Two of them (`MIN_SCALE_TREND_SAMPLES`, `FLAT_TREND_LOG_RANGE`) also
 * assert an EXACT no-op with `toBe`, which routing through a metric's own normalization would
 * have degraded to `toBeCloseTo` — destroying the exactness they exist for.
 */

/**
 * Fixed torso length matching syntheticGait.ts's own convention (shoulder-mid to hip-mid = 150px)
 * so amplitude-vs-prominence-threshold math stays consistent with the rest of this codebase's
 * fixtures.
 */
const TORSO_LENGTH_PX = 150
const SHOULDER_Y = 250
const LEFT_SHOULDER_X = 170
const RIGHT_SHOULDER_X = 230
const LEFT_HIP_X = 175
const RIGHT_HIP_X = 225
/** Resting wrist-below-shoulder offset — an arbitrary but plausible carried-arm position; only
 * the OSCILLATION around it (see below) is what the fit measures. */
const BASE_WRIST_OFFSET_Y = 80

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
 * in y relative to its own shoulder — the exact signal `computeSideSwing` reads. Left and right
 * swing in opposite phase (natural contralateral arm swing), each with its own configurable
 * amplitude.
 *
 * With `harmonicRatio` and the two jitter knobs left at their `0` defaults each side is an exact
 * sinusoid whose peak-to-trough excursion is exactly that side's `amplitudePx`, so the expected
 * per-side fitted amplitude is hand-computable.
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
  /**
   * Amplitude of a second harmonic at 2x `swingFreqHz`, as a fraction of that side's own
   * amplitude. This is the STEP rhythm riding on the stride rhythm, and it is real rather than
   * decorative: the shoulder itself rises and falls once per step, and it does not cancel out of a
   * wrist-relative-to-shoulder trace cleanly. Live evidence that these traces carry it — the
   * multi-person clip's right-arm fit lands on 2.80 Hz against a 174 spm cadence (2.90 Hz step
   * rate), and Demo 2's right arm reports `secondPeakRatio` 0.31.
   */
  harmonicRatio?: number
  /**
   * Whole-body on-screen scale growth across the clip: every body dimension — shoulder spread,
   * hip spread, torso length, wrist offset AND wrist amplitude — is multiplied by
   * `g(t) = scaleGrowthFactor^(t / durationSec)`, so the subject ends the clip this many times
   * larger while every BODY-UNIT quantity stays constant. This is Demo 2's shape (inter-shoulder
   * span 120 → 358 px inside the fit window). Exponential rather than linear so `log g(t)` is
   * exactly linear in time — inside the stabilizer's log-quadratic trend space by construction,
   * which makes the stabilized series an exact sinusoid again and the expected values
   * hand-computable. `1` (the default) is bit-identical to the ungrown fixture.
   */
  scaleGrowthFactor?: number
  /**
   * Peak-to-trough whole-body vertical bounce, px, at TWICE `swingFreqHz` (one bounce per step, two
   * steps per stride), added identically to EVERY keypoint — so wrist−shoulder, shoulder span and
   * torso length are untouched by it, and the only thing it adds is a hip rhythm for
   * `resolveStrideRateHz` to anchor the arm search on. `0` keeps the hips motionless. Default `0`
   * here: this suite hands `computeSideSwing` its stride rate directly. */
  bounceAmplitudePx?: number
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
    bounceAmplitudePx = 0,
    seed = 1,
  } = params
  const frameCount = Math.round(durationSec * fps)
  const jitter = makeJitter(seed)
  const bodyCenterX = (LEFT_SHOULDER_X + RIGHT_SHOULDER_X) / 2

  const frames: RobustPoseFrame[] = []
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / fps
    const g = Math.pow(scaleGrowthFactor, t / durationSec)
    const phase = 2 * Math.PI * swingFreqHz * t
    const harmonic = 2 * Math.PI * 2 * swingFreqHz * t
    const bounceY = (bounceAmplitudePx / 2) * Math.sin(harmonic)
    const leftShoulderX = bodyCenterX - (bodyCenterX - LEFT_SHOULDER_X) * g
    const rightShoulderX = bodyCenterX + (RIGHT_SHOULDER_X - bodyCenterX) * g
    const leftWristY =
      SHOULDER_Y +
      BASE_WRIST_OFFSET_Y * g -
      ((leftAmplitudePx * g) / 2) * Math.sin(phase) +
      ((leftAmplitudePx * g * harmonicRatio) / 2) * Math.sin(harmonic) +
      jitter() * leftJitterPx
    const rightWristY =
      SHOULDER_Y +
      BASE_WRIST_OFFSET_Y * g -
      ((rightAmplitudePx * g) / 2) * Math.sin(phase + Math.PI) +
      ((rightAmplitudePx * g * harmonicRatio) / 2) * Math.sin(harmonic) +
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

const SIDES = ['left', 'right'] as const

/** Every fixture below swings at `BASE_PARAMS.swingFreqHz` unless it says otherwise, so the stride
 * rate `computeSideSwing` is anchored on is that same frequency. */
const AT_STRIDE = { strideHz: BASE_PARAMS.swingFreqHz }

/** The anchored grid `computeSideSwing` searches, restated for the raw-pixel reference fits. */
const ANCHORED_GRID = {
  minFrequencyHz: (1 - ARM_SWING_BAND_HALF_WIDTH) * AT_STRIDE.strideHz,
  maxFrequencyHz: (1 + ARM_SWING_BAND_HALF_WIDTH) * AT_STRIDE.strideHz,
  frequencyStepHz: ARM_SWING_BAND_STEP_FRACTION * AT_STRIDE.strideHz,
}

function fittedAmplitude(frames: RobustPoseFrame[], side: 'left' | 'right'): number {
  const fit = computeSideSwing(frames, side, AT_STRIDE).fit
  if (!fit.ok) throw new Error(`fixture must fit on the ${side} side`)
  return fit.peakToPeakAmplitude
}

/**
 * The exact RAW-PIXEL computation `computeSideSwing` performed before scale stabilization
 * (strides-egw): that side's own wrist-relative-to-shoulder series wherever both resolve, fitted on
 * the shared grid. The no-op cases below must land on THIS number — a factor identically (or
 * numerically) 1 means the stabilized path and the raw path are the same computation, not merely
 * similar ones.
 */
function rawPixelAmplitude(frames: RobustPoseFrame[], side: 'left' | 'right'): number {
  const samples = frames.flatMap((frame) => {
    const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)!
    const shoulder = at(`${side}_shoulder`)
    const wrist = at(`${side}_wrist`)
    if (shoulder.y === null || wrist.y === null) return []
    return [{ t: frame.timestamp, v: wrist.y - shoulder.y }]
  })
  const fit = fitSpectralSinusoid(samples, ANCHORED_GRID)
  if (!fit.ok) throw new Error(`fixture must fit on the ${side} side`)
  return fit.peakToPeakAmplitude
}

function sideExemplar(frames: RobustPoseFrame[], side: 'left' | 'right'): MetricExemplar {
  const swing = computeSideSwing(frames, side, AT_STRIDE)
  const exemplars = buildSideExemplar(side, swing, frames)
  expect(exemplars).toHaveLength(1)
  return exemplars[0]
}

/**
 * Reads the raw series underlying `computeSideSwing`'s stabilized one — `wrist.y − shoulder.y` in
 * image-y — at the frame carrying `timestamp`. Image-y grows downward, so a SMALLER value is the
 * wrist higher on screen; the stabilizer's divisor is positive by construction, so it preserves
 * that ordering and the direction assertions below depend on it and on nothing else.
 */
function wristBelowShoulderPx(
  frames: RobustPoseFrame[],
  timestamp: number,
  side: 'left' | 'right',
): number {
  const frame = frames.find((candidate) => candidate.timestamp === timestamp)!
  const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)!.y!
  return at(`${side}_wrist`) - at(`${side}_shoulder`)
}

/**
 * The grid is anchored on the clip's stride rate (`strides-eiil.1`, design D1): the shared bounce
 * band (1.2–4.0 Hz) is the STEP band, which has no candidate for a slow-cadence or retimed clip's
 * arm swing and always offers the step rate as a rival.
 */
describe('computeSideSwing — searched around the stride rate', () => {
  for (const swingFreqHz of [1.0, 1.1]) {
    it(`recovers a ${swingFreqHz} Hz swing — below the bounce band's 1.2 Hz floor`, () => {
      const frames = buildArmSwingFrames({
        ...BASE_PARAMS,
        swingFreqHz,
        leftAmplitudePx: 40,
        rightAmplitudePx: 40,
      })

      for (const side of SIDES) {
        const { fit } = computeSideSwing(frames, side, { strideHz: swingFreqHz })
        expect(fit.ok).toBe(true)
        if (fit.ok) {
          expect(Math.abs(fit.frequencyHz - swingFreqHz)).toBeLessThanOrEqual(
            ARM_SWING_BAND_STEP_FRACTION * swingFreqHz + 1e-9,
          )
          expect(fit.peakToPeakAmplitude).toBeCloseTo(40, 0)
        }
      }
    })
  }

  it('recovers a retimed clip’s 0.2 Hz swing over 12 s, at the same relative grid resolution', () => {
    const frames = buildArmSwingFrames({
      durationSec: 12,
      fps: 30,
      swingFreqHz: 0.2,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const { fit } = computeSideSwing(frames, 'left', { strideHz: 0.2 })
    expect(fit.ok).toBe(true)
    if (fit.ok) {
      expect(Math.abs(fit.frequencyHz - 0.2)).toBeLessThanOrEqual(
        ARM_SWING_BAND_STEP_FRACTION * 0.2 + 1e-9,
      )
      expect(fit.peakToPeakAmplitude).toBeCloseTo(40, 0)
    }
  })

  it('cannot choose a larger step-rate component — the step rate is off the grid', () => {
    // A small stride-rate swing under a component at twice that rate, twice its size. The old
    // bounce-band grid takes the step rate; the anchored one cannot offer it.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 10,
      rightAmplitudePx: 10,
      harmonicRatio: 2,
    })
    const samples = frames.map((frame) => {
      const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)!.y!
      return { t: frame.timestamp, v: at('left_wrist') - at('left_shoulder') }
    })
    const bounceBand = fitSpectralSinusoid(samples, {
      minFrequencyHz: DEFAULT_HEURISTICS_CONFIG.spectralFitMinFrequencyHz,
      maxFrequencyHz: DEFAULT_HEURISTICS_CONFIG.spectralFitMaxFrequencyHz,
      frequencyStepHz: DEFAULT_HEURISTICS_CONFIG.spectralFitFrequencyStepHz,
    })
    const anchored = computeSideSwing(frames, 'left', AT_STRIDE).fit

    expect(bounceBand.ok && bounceBand.frequencyHz).toBeCloseTo(2 * BASE_PARAMS.swingFreqHz, 1)
    expect(anchored.ok).toBe(true)
    if (anchored.ok) {
      expect(anchored.frequencyHz).toBeGreaterThanOrEqual(
        (1 - ARM_SWING_BAND_HALF_WIDTH) * BASE_PARAMS.swingFreqHz - 1e-9,
      )
      expect(anchored.frequencyHz).toBeLessThanOrEqual(
        (1 + ARM_SWING_BAND_HALF_WIDTH) * BASE_PARAMS.swingFreqHz + 1e-9,
      )
    }
  })
})

describe('resolveStrideRateHz', () => {
  it('is half the hip-bounce frequency', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
      bounceAmplitudePx: 10,
    })

    // The bounce grid steps 0.02 Hz, so half of it lands within 0.01 Hz of the true stride rate.
    expect(resolveStrideRateHz(frames, DEFAULT_HEURISTICS_CONFIG)).toBeCloseTo(
      BASE_PARAMS.swingFreqHz,
      1,
    )
  })

  it('follows a retimed clip below the human-gait floor, via the sub-floor bounce pass', () => {
    const frames = buildArmSwingFrames({
      durationSec: 12,
      fps: 30,
      swingFreqHz: 0.2,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
      bounceAmplitudePx: 10,
    })

    const strideHz = resolveStrideRateHz(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(strideHz).not.toBeNull()
    expect(Math.abs(strideHz! - 0.2)).toBeLessThan(0.02)
  })

  it('is null when the hips never bounce — no rhythm to anchor on', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    expect(resolveStrideRateHz(frames, DEFAULT_HEURISTICS_CONFIG)).toBeNull()
  })

  it('is null below cadenceMinFitR2 — the gate cadence trusts the same fit on', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
      bounceAmplitudePx: 10,
    })

    expect(
      resolveStrideRateHz(frames, { ...DEFAULT_HEURISTICS_CONFIG, cadenceMinFitR2: 1.01 }),
    ).toBeNull()
  })
})

describe('computeSideSwing — fit failures', () => {
  it('tracked but motionless arms: degenerate-signal, and the caveat names the missing motion', () => {
    // Wrists resolve every frame but never move relative to the shoulder, so there is no
    // oscillation to fit on either side.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 0,
      rightAmplitudePx: 0,
    })

    for (const side of SIDES) {
      const swing = computeSideSwing(frames, side, AT_STRIDE)

      expect(swing.resolvedCount).toBe(frames.length)
      expect(swing.fit.ok).toBe(false)
      if (!swing.fit.ok) {
        expect(swing.fit.reason).toBe('degenerate-signal')
        expect(caveatForFailure(swing.fit.reason, swing.fit.sampleCount)).toContain(
          'no oscillating vertical motion',
        )
      }
    }
  })
})

/**
 * The defect bead `strides-gzl` names: at a prominence floor sized in pixels, ordinary tracking
 * jitter confirms extrema BETWEEN the real turning points, so the paired "half-swings" span a
 * fraction of a half-cycle and their median amplitude is a statistic over wiggle rather than over
 * swing. Measured on Demo 2 before the fix: 9 confirmed half-swings per side across a window
 * holding ~2.4 arm-swing cycles (so ~5 real half-swings), spaced as little as 0.050 s against a
 * 0.331 s half-cycle.
 *
 * These cases pin the fix against a fixture whose true half-cycle is known exactly, and the first
 * one asserts the old failure still reproduces in the primitive that caused it — so this is a
 * regression test for a mechanism, not just for today's numbers.
 */
describe('computeSideSwing — sub-cycle wiggle (strides-gzl)', () => {
  /**
   * A stride-rate swing carrying a step-rate harmonic and modest tracking jitter — the shape a
   * real wrist-relative-to-shoulder trace actually has, rather than the exact sinusoid every case
   * above uses.
   */
  const REALISTIC = {
    durationSec: 4,
    fps: 30,
    swingFreqHz: 1.5,
    leftAmplitudePx: 40,
    rightAmplitudePx: 20,
    leftJitterPx: 4,
    rightJitterPx: 4,
    harmonicRatio: 0.4,
    seed: 20260829,
  }
  /** One swing cycle is 1/1.5 s, so top-to-bottom is half that. */
  const HALF_CYCLE_SEC = 1 / (2 * REALISTIC.swingFreqHz)

  it('the retired prominence-threshold scan pairs extrema that are not half a cycle apart', () => {
    const frames = buildArmSwingFrames(REALISTIC)
    // Exactly what `computeSideSwing` used to do: this series, at the retired
    // `armSwingMinProminenceRatio` (0.03) times the fixture's own 150px torso.
    const series = frames.map((frame) => {
      const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)!.y!
      return { t: frame.timestamp, v: at('left_wrist') - at('left_shoulder') }
    })
    const extrema = findLocalExtrema(series, 0.03 * TORSO_LENGTH_PX)

    const gaps: number[] = []
    for (let i = 1; i < extrema.length; i += 1) {
      if (extrema[i].kind !== extrema[i - 1].kind) {
        gaps.push(Math.abs(extrema[i].timestamp - extrema[i - 1].timestamp))
      }
    }

    // The harmonic drags every confirmed turning point off the real half-cycle, alternately early
    // and late — so EVERY pair the scan would hand an exemplar spans the wrong interval, by 20% or
    // more, even though the count of them happens to come out about right. On real footage the
    // count goes wrong too: Demo 2 produced 9 half-swings across ~4.8 real ones, spaced as little
    // as 0.050 s against a 0.331 s half-cycle.
    expect(gaps.length).toBeGreaterThan(0)
    for (const gap of gaps) {
      expect(Math.abs(gap - HALF_CYCLE_SEC) / HALF_CYCLE_SEC).toBeGreaterThan(0.15)
    }
  })

  it('the fit recovers each side’s real amplitude despite the harmonic and the jitter', () => {
    // What the retired extrema scan could not do: the fitted amplitudes track the fixture's own
    // 40px and 20px excursions rather than a median over wiggle fragments.
    const frames = buildArmSwingFrames(REALISTIC)

    const left = fittedAmplitude(frames, 'left')
    const right = fittedAmplitude(frames, 'right')

    expect(left).toBeCloseTo(REALISTIC.leftAmplitudePx, 0)
    expect(right).toBeCloseTo(REALISTIC.rightAmplitudePx, 0)
    expect(Math.min(left, right) / Math.max(left, right)).toBeCloseTo(20 / 40, 1)
  })

  it('the exemplar pair spans one half-swing, not a sub-cycle wiggle', () => {
    const frames = buildArmSwingFrames(REALISTIC)

    for (const side of SIDES) {
      const exemplar = sideExemplar(frames, side)
      const spacing = Math.abs(exemplar.pairedTimestamp! - exemplar.timestamp)
      // Snapping each fitted instant to its nearest sampled frame can move it by up to half a
      // frame interval either way, so the tolerance is the frame interval, not zero.
      expect(spacing).toBeGreaterThan(HALF_CYCLE_SEC - 1 / REALISTIC.fps)
      expect(spacing).toBeLessThan(HALF_CYCLE_SEC + 1 / REALISTIC.fps)
    }
  })
})

/**
 * The scale stabilization strides-egw added: `computeSideSwing` divides each sample by a smoothed
 * inter-shoulder trend before the fit, so a subject whose on-screen size changes inside the fit
 * window is measured in body proportion instead of letting the large-scale frames dominate the
 * least squares (Demo 2: inter-shoulder 120 → 358 px, an ~9:1 RSS weighting toward the late
 * frames). The growth fixture is exponential on purpose — see the builder's `scaleGrowthFactor`
 * doc — so every expected value here is exact by construction rather than approximate.
 */
describe('computeSideSwing — scale stabilization (strides-egw)', () => {
  const GROWN = {
    ...BASE_PARAMS,
    leftAmplitudePx: 40,
    rightAmplitudePx: 20,
    scaleGrowthFactor: 3,
  }

  it('the raw pixel trace under the same growth violates the constant-amplitude premise the fit assumes', () => {
    // The mechanism, shown on the input rather than inferred: the raw series' amplitude is
    // modulated 1× → 3× across the window, so a constant-amplitude sinusoid necessarily leaves
    // amplitude-mismatch residuals — while the stabilized series `computeSideSwing` actually fits
    // is an exact sinusoid again and fits essentially perfectly.
    const frames = buildArmSwingFrames(GROWN)
    const samples = frames.map((frame) => {
      const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)!.y!
      return { t: frame.timestamp, v: at('left_wrist') - at('left_shoulder') }
    })
    const rawFit = fitSpectralSinusoid(samples, ANCHORED_GRID)
    const stabilizedFit = computeSideSwing(frames, 'left', AT_STRIDE).fit

    expect(rawFit.ok).toBe(true)
    expect(stabilizedFit.ok).toBe(true)
    if (rawFit.ok && stabilizedFit.ok) {
      expect(rawFit.sinusoidR2).toBeLessThan(0.95)
      expect(stabilizedFit.sinusoidR2).toBeGreaterThan(0.999)
    }
  })

  it('with too few both-shoulder frames the stabilization is an exact no-op, not an extrapolation', () => {
    // Both shoulders resolve TOGETHER in only 8 frames — below MIN_SCALE_TREND_SAMPLES — while
    // each side's own shoulder+wrist pair still resolves in over half the frames, plenty for both
    // fits. A scale trend fitted to 8 points would be exactly the poorly-founded guess the
    // fallback ladder exists to refuse: the factor must be IDENTICALLY 1, i.e. the raw-pixel
    // computation, even though this clip genuinely grows.
    const frames = buildArmSwingFrames(GROWN).map((frame, i) => {
      if (i % 15 === 0) return frame
      const dropName = i % 2 === 0 ? 'right_shoulder' : 'left_shoulder'
      return {
        ...frame,
        keypoints: frame.keypoints.map((kp) =>
          kp.name === dropName
            ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
            : kp,
        ),
      }
    })

    for (const side of SIDES) {
      // Bit-exact, not toBeCloseTo: the fallback rung returns the literal constant 1, and division
      // by exactly 1 is the identity — so the stabilized path IS the raw computation, and a
      // regression that swapped the exact no-op for a numerically-almost-1 factor must fail here.
      expect(fittedAmplitude(frames, side)).toBe(rawPixelAmplitude(frames, side))
    }
  })

  it('a frame whose proxy is missing still yields a stabilized sample, on the ACTIVE rung', () => {
    // The delta spec's "a frame whose proxy is missing SHALL still receive a factor from the
    // trend, so no swing sample is ever dropped for it" — exercised where it is NOT trivially
    // true: 114 both-shoulder frames (well past MIN_SCALE_TREND_SAMPLES) under real 3× growth,
    // with six frames made proxy-less. The right WRIST is dropped on those same six frames in
    // BOTH fixtures, so the two runs see identical per-side sample sets and differ ONLY in
    // whether the proxy resolves there. Frames 0–2 and 118–119 sit OUTSIDE the fitted proxy
    // window [t=0.1, t=3.9], so the left samples there also exercise the evaluation-time clamp —
    // an extrapolated exponentiated quadratic is exactly what those frames must not be divided
    // by.
    const DROP = new Set([0, 1, 2, 60, 118, 119])
    const dropAt = (frames: RobustPoseFrame[], names: string[]) =>
      frames.map((frame, i) =>
        DROP.has(i)
          ? {
              ...frame,
              keypoints: frame.keypoints.map((kp) =>
                names.includes(kp.name)
                  ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
                  : kp,
              ),
            }
          : frame,
      )
    const base = dropAt(buildArmSwingFrames(GROWN), ['right_wrist'])
    const proxyless = dropAt(buildArmSwingFrames(GROWN), ['right_wrist', 'right_shoulder'])

    // Identical per-side accounting: losing the proxy on six frames dropped nothing.
    for (const side of SIDES) {
      const proxylessSide = computeSideSwing(proxyless, side, AT_STRIDE)
      const baseSide = computeSideSwing(base, side, AT_STRIDE)

      expect(proxylessSide.resolvedCount).toBe(baseSide.resolvedCount)
      expect(proxylessSide.interpolatedCount).toBe(baseSide.interpolatedCount)
      expect(proxylessSide.seriesY.map((v) => v === null)).toEqual(
        baseSide.seriesY.map((v) => v === null),
      )
    }

    // And the amplitudes still track the body-unit expectation — the clamped edge frames are
    // divided by the nearest in-window scale (within ~3% of their true one), not an extrapolation.
    const left = fittedAmplitude(proxyless, 'left')
    const right = fittedAmplitude(proxyless, 'right')
    expect(Math.min(left, right) / Math.max(left, right)).toBeCloseTo(20 / 40, 2)
  })

  it('a constant-scale clip reads numerically as the raw-pixel computation — the no-op property', () => {
    // Load-bearing for every exact-sinusoid case in this file: when the proxy is flat the fitted
    // trend is that constant, the reference is that constant, and the factor is 1 to floating-
    // point precision — so the stabilization cannot move a number on footage it has nothing to
    // stabilize.
    const frames = buildArmSwingFrames({ ...GROWN, scaleGrowthFactor: 1 })

    for (const side of SIDES) {
      // Bit-exact: the flat-trend rung snaps a numerically-flat fitted trend to the literal
      // constant 1, so a constant-scale clip must be IDENTICAL to the raw-pixel computation, not
      // merely within an epsilon of it — deleting that rung would leave a 1±1e-15 factor that
      // still passes any toBeCloseTo.
      expect(fittedAmplitude(frames, side)).toBe(rawPixelAmplitude(frames, side))
    }
  })
})

describe('buildSideExemplar', () => {
  const frames = buildArmSwingFrames({
    ...BASE_PARAMS,
    leftAmplitudePx: 40,
    rightAmplitudePx: 24,
  })

  it('the base instant is the wrist HIGH frame, on both sides — the image-y sign trap', () => {
    // `wrist.y − shoulder.y` grows downward, so the series MINIMUM is the wrist at its highest,
    // which is why `buildSideExemplar` passes `maximumIs: 'lowest'`. Reading the extremum kind
    // straight through would caption every one of these backwards while passing every other
    // assertion in this file.
    for (const side of SIDES) {
      const exemplar = sideExemplar(frames, side)

      expect(wristBelowShoulderPx(frames, exemplar.timestamp, side)).toBeLessThan(
        wristBelowShoulderPx(frames, exemplar.pairedTimestamp!, side),
      )
    }
  })

  it('the pair spans that side’s full swing amplitude, not some smaller excursion', () => {
    for (const side of SIDES) {
      const exemplar = sideExemplar(frames, side)
      const spanned =
        wristBelowShoulderPx(frames, exemplar.pairedTimestamp!, side) -
        wristBelowShoulderPx(frames, exemplar.timestamp, side)
      // The fixture builds each side's peak-to-trough excursion as exactly `amplitudePx`; discrete
      // 30fps sampling can only land at or just inside that.
      const amplitudePx = side === 'left' ? 40 : 24
      expect(spanned).toBeGreaterThan(amplitudePx * 0.9)
      expect(spanned).toBeLessThanOrEqual(amplitudePx)
    }
  })

  it('seeds the crop on that side’s own shoulder and wrist, dropping context that resolves nowhere', () => {
    for (const side of SIDES) {
      // The elbow is context (design D2) and this fixture never resolves one, so it is omitted
      // rather than anchoring the crop at a keypoint with no position.
      expect(sideExemplar(frames, side).cropKeypoints).toEqual([
        `${side}_shoulder`,
        `${side}_wrist`,
      ])
    }
  })

  it('adds the elbow to the crop when it actually resolves', () => {
    const withElbows = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'left_elbow' || kp.name === 'right_elbow'
          ? { ...kp, x: 200, y: 300, score: 0.9, status: 'detected' as const }
          : kp,
      ),
    }))

    for (const side of SIDES) {
      expect(sideExemplar(withElbows, side).cropKeypoints).toEqual([
        `${side}_shoulder`,
        `${side}_wrist`,
        `${side}_elbow`,
      ])
    }
  })
})

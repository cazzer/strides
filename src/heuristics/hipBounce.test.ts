import { describe, expect, it } from 'vitest'
import { analyzeHipBounce } from './hipBounce'
import { fitBounceSpectrum } from './bounceSpectrum'
import { fitSpectralSinusoid } from './spectralFit'
import type { SpectralSample } from './spectralFit'
import { buildFrame } from './__fixtures__/testFrames'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { mulberry32 } from './__fixtures__/hipTraceFrames'
import { APPROACH, generateApproachingRunner } from './__fixtures__/approachingRunner'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'

describe('analyzeHipBounce', () => {
  it('an empty frame list: zero coverage, no fit, never throws', () => {
    expect(() => analyzeHipBounce([], DEFAULT_HEURISTICS_CONFIG)).not.toThrow()
    const result = analyzeHipBounce([], DEFAULT_HEURISTICS_CONFIG)

    expect(result.hipY).toEqual([])
    expect(result.resolvedCount).toBe(0)
    expect(result.interpolatedCount).toBe(0)
    // Guarded, not a 0/0 NaN.
    expect(result.frameCoverage).toBe(0)
    expect(result.interpolatedFraction).toBe(0)
    expect(result.fit.ok).toBe(false)
    if (!result.fit.ok) {
      expect(result.fit.reason).toBe('too-few-samples')
      expect(result.fit.sampleCount).toBe(0)
    }
  })

  it('single-side hip fallback raises interpolatedFraction without changing frameCoverage', () => {
    // Every frame has a resolvable left hip; every OTHER frame is also missing the right hip
    // entirely, forcing resolveMidpoint's single-side fallback (flagged interpolated: true) on
    // those frames. Every frame still resolves a hip position, so frameCoverage stays 1 in both
    // cases -- only interpolatedFraction should move.
    const frameCount = 20
    const bothSidesFrames = Array.from({ length: frameCount }, (_, i) =>
      buildFrame(
        {
          left_hip: { x: 195, y: 400 + i },
          right_hip: { x: 205, y: 400 + i },
        },
        i / 30,
      ),
    )
    const mixedFrames = Array.from({ length: frameCount }, (_, i) =>
      buildFrame(
        i % 2 === 0
          ? { left_hip: { x: 195, y: 400 + i }, right_hip: { x: 205, y: 400 + i } }
          : { left_hip: { x: 195, y: 400 + i } },
        i / 30,
      ),
    )

    const bothSides = analyzeHipBounce(bothSidesFrames, DEFAULT_HEURISTICS_CONFIG)
    const mixed = analyzeHipBounce(mixedFrames, DEFAULT_HEURISTICS_CONFIG)

    expect(bothSides.frameCoverage).toBe(1)
    expect(bothSides.interpolatedFraction).toBe(0)

    expect(mixed.resolvedCount).toBe(frameCount)
    expect(mixed.frameCoverage).toBe(1)
    expect(mixed.interpolatedCount).toBe(frameCount / 2)
    expect(mixed.interpolatedFraction).toBeCloseTo(0.5, 10)
  })

  it('subFloorRhythm is false on an ordinary in-band clip', () => {
    const frames = generateSyntheticGait({
      durationSec: 4,
      fps: 30,
      cadenceStepsPerMin: 170,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 5,
      view: 'side',
    })

    const result = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.fit.ok).toBe(true)
    expect(result.subFloorRhythm).toBe(false)
    expect(result.scaleNormalized).toBe(false)
  })

  it('subFloorRhythm is false on a clip with no fittable rhythm at all', () => {
    // The other existing fixture: a hip that only ramps. Nothing periodic in band, and nothing
    // below it either — so the second pass must not manufacture a verdict out of a straight line.
    const frames = Array.from({ length: 200 }, (_, i) =>
      buildFrame(
        { left_hip: { x: 195, y: 400 + i * 0.5 }, right_hip: { x: 205, y: 400 + i * 0.5 } },
        i / 30,
      ),
    )

    const result = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(result.subFloorRhythm).toBe(false)
    expect(result.scaleNormalized).toBe(false)
  })

  it('subFloorRhythm is true when the bounce is slower than any human gait', () => {
    // 26 steps/min on screen over 12 s at 30 fps — a ~7x retimed clip, the shape
    // `park-side-portrait.mp4` has. Every other field is unchanged in meaning; only the band the
    // fit came from differs.
    const frames = generateSyntheticGait({
      durationSec: 12,
      fps: 30,
      cadenceStepsPerMin: 26,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 5,
      view: 'side',
    })

    const result = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.subFloorRhythm).toBe(true)
    expect(result.scaleNormalized).toBe(false)
    expect(result.fit.ok).toBe(true)
    if (!result.fit.ok) return
    expect(result.fit.frequencyHz).toBeLessThan(DEFAULT_HEURISTICS_CONFIG.spectralFitMinFrequencyHz)
    // The bounce is one per STEP, so 26 spm is 26/60 Hz on screen.
    expect(result.fit.frequencyHz).toBeCloseTo(26 / 60, 1)
  })
})

describe('analyzeHipBounce — the scale-normalized fallback (approaching runner)', () => {
  const CONFIG = DEFAULT_HEURISTICS_CONFIG
  const IN_BAND = {
    minFrequencyHz: CONFIG.spectralFitMinFrequencyHz,
    maxFrequencyHz: CONFIG.spectralFitMaxFrequencyHz,
    frequencyStepHz: CONFIG.spectralFitFrequencyStepHz,
  }

  /** The raw pixel hip-mid series exactly as `analyzeBounceSignal` hands it to the fit. */
  function rawHipSamples(frames: RobustPoseFrame[]): SpectralSample[] {
    const samples: SpectralSample[] = []
    for (const frame of frames) {
      const left = frame.keypoints.find((kp) => kp.name === 'left_hip')
      const right = frame.keypoints.find((kp) => kp.name === 'right_hip')
      if (left?.y == null || right?.y == null) continue
      samples.push({ t: frame.timestamp, v: (left.y + right.y) / 2 })
    }
    return samples
  }

  it('recovers the bounce of a runner who grows six-fold in frame, and reports the hip trace raw', () => {
    const frames = generateApproachingRunner()
    const raw = rawHipSamples(frames)

    // Preconditions — the clip this exists for: the raw in-band fit fails the gate (on the right
    // frequency, as private IMG_9349 does), and the two-pass fit adopts nothing. Without these the
    // assertions below could pass on a clip that never reached the third pass.
    const rawInBand = fitSpectralSinusoid(raw, IN_BAND)
    expect(rawInBand.ok).toBe(true)
    if (!rawInBand.ok) return
    expect(rawInBand.sinusoidR2).toBeLessThan(CONFIG.verticalOscillationMinFitR2)
    expect(fitBounceSpectrum(raw, CONFIG)).toStrictEqual({
      fit: rawInBand,
      subFloor: false,
      scaleNormalized: false,
    })

    const result = analyzeHipBounce(frames, CONFIG)

    expect(result.scaleNormalized).toBe(true)
    expect(result.subFloorRhythm).toBe(false)
    expect(result.fit.ok).toBe(true)
    if (!result.fit.ok) return
    expect(Math.abs(result.fit.frequencyHz - APPROACH.bounceHz)).toBeLessThanOrEqual(
      CONFIG.spectralFitFrequencyStepHz + 1e-9,
    )
    expect(result.fit.sinusoidR2).toBeGreaterThanOrEqual(CONFIG.verticalOscillationMinFitR2)
    // The chart trace is the raw pixel series, untouched by the normalization.
    expect(result.hipY).toStrictEqual(raw.map((sample) => sample.v))

    // Pins the SIGN: the normalized series keeps image-y's downward-positive convention, so the
    // fitted maximum is the fixture's own sin maximum (the runner's lowest point), which is what
    // `footstrikes.ts` assumes. A flipped integral would put it half a period away.
    const omega = 2 * Math.PI * result.fit.frequencyHz
    const period = 1 / result.fit.frequencyHz
    const fittedMax = result.fit.tMeanSeconds + (Math.PI / 2 - result.fit.phaseRadians) / omega
    const trueMax = 1 / (4 * APPROACH.bounceHz)
    const offset = (((fittedMax - trueMax) % period) + period) % period
    expect(Math.min(offset, period - offset)).toBeLessThan(period / 20)
  })

  /** The approach clip with `names` unrecoverable on every frame in `[from, to)` seconds. */
  function approachWithGap(names: string[], from: number, to: number): RobustPoseFrame[] {
    return generateApproachingRunner().map((frame) =>
      frame.timestamp >= from && frame.timestamp < to
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
  }

  it.each([
    // A whole-body dropout: the signal has a gap, and the integral must carry across it.
    { label: 'hips and shoulders missing for 0.25 s', hipsToo: true, from: 1, to: 1.25 },
    // Shoulders missing for longer than the ±0.5 s torso window: some frames keep a signal but
    // have no local torso at all, and must be skipped rather than divided by nothing.
    { label: 'shoulders missing for 1.1 s', hipsToo: false, from: 1, to: 2.1 },
  ])('is still adopted at about the same frequency with $label', ({ hipsToo, from, to }) => {
    const names = ['left_shoulder', 'right_shoulder', ...(hipsToo ? ['left_hip', 'right_hip'] : [])]
    const frames = approachWithGap(names, from, to)

    const result = analyzeHipBounce(frames, CONFIG)

    expect(result.scaleNormalized).toBe(true)
    expect(result.fit.ok).toBe(true)
    if (!result.fit.ok) return
    expect(Math.abs(result.fit.frequencyHz - APPROACH.bounceHz)).toBeLessThanOrEqual(
      2 * CONFIG.spectralFitFrequencyStepHz + 1e-9,
    )
    if (hipsToo) {
      // The gap is in the signal itself; every remaining frame still has a local torso.
      expect(result.resolvedCount).toBeLessThan(frames.length)
      expect(result.fit.sampleCount).toBe(result.resolvedCount)
    } else {
      // Every frame keeps its hips, but the frames with no torso in their window are dropped.
      expect(result.resolvedCount).toBe(frames.length)
      expect(result.fit.sampleCount).toBeLessThan(result.resolvedCount)
    }
  })

  it('declines, without throwing, when frames are out of presentation order', () => {
    const frames = generateApproachingRunner()
    const random = mulberry32(17)
    const shuffled = [...frames]
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    // Precondition: the raw fit still fails the gate, so the fallback really is reached and has to
    // decline rather than never being asked.
    const rawInBand = fitSpectralSinusoid(rawHipSamples(shuffled), IN_BAND)
    expect(rawInBand.ok && rawInBand.sinusoidR2 >= CONFIG.verticalOscillationMinFitR2).toBe(false)

    expect(() => analyzeHipBounce(shuffled, CONFIG)).not.toThrow()
    const result = analyzeHipBounce(shuffled, CONFIG)
    expect(result.scaleNormalized).toBe(false)
    expect(result.fit).toStrictEqual(rawInBand)
  })

  it('is not attempted when no torso resolves (hips only), leaving the raw result untouched', () => {
    const frames = generateApproachingRunner({ withShoulders: false })
    const raw = rawHipSamples(frames)
    const rawInBand = fitSpectralSinusoid(raw, IN_BAND)
    expect(rawInBand.ok && rawInBand.sinusoidR2 >= CONFIG.verticalOscillationMinFitR2).toBe(false)

    const result = analyzeHipBounce(frames, CONFIG)

    expect(result.scaleNormalized).toBe(false)
    expect(result.subFloorRhythm).toBe(false)
    expect(result.fit).toStrictEqual(rawInBand)
  })
})

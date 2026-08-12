import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { computeVerticalOscillationCm } from './verticalOscillationCm'
import { computeVerticalOscillation } from './verticalOscillation'
import { estimateBodyScale } from './bodyScale'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'
import { mulberry32 } from './__fixtures__/hipTraceFrames'

/** The synthetic-gait fixture's fixed torso length, restated here for hand-computed expectations. */
const FIXTURE_TORSO_PX = 150

const HIP_BASE_Y = 400
const FPS = 30
/** Bounce frequency used by every hand-built fixture below. Lands exactly on the default spectral
 * grid (1.2 Hz + 15 × 0.02 Hz), so the fit recovers a clean sinusoid's amplitude exactly rather
 * than off a neighbouring candidate. */
const BOUNCE_HZ = 1.5
/**
 * Frames per hand-built integration run. At 30 fps that spans 1.47 s — over two complete cycles at
 * `BOUNCE_HZ`, and well clear of `fitSpectralSinusoid`'s 12-sample floor, which a run has to be to
 * contribute anything at all now that each run is fitted independently.
 */
const RUN_FRAMES = 45

/**
 * One hand-built frame with a purely vertical torso of `torsoPx`, so `estimateBodyScale` reads
 * back exactly `torsoPx`. A `null` hipY leaves both hips unrecoverable — the way an integration
 * run gets split.
 */
function frame(
  timestamp: number,
  hipY: number | null,
  torsoPx: number,
  pixelsPerMeter: number | null,
): RobustPoseFrame {
  const shoulderY = (hipY ?? HIP_BASE_Y) - torsoPx
  return buildFrame(
    {
      left_shoulder: { x: 195, y: shoulderY },
      right_shoulder: { x: 205, y: shoulderY },
      ...(hipY === null
        ? {}
        : { left_hip: { x: 195, y: hipY }, right_hip: { x: 205, y: hipY } }),
    },
    timestamp,
    pixelsPerMeter,
  )
}

/** Hip-y for a clean bounce of `peakToPeakPx` at `BOUNCE_HZ`, `frameIndex` frames into a run. */
function bouncingHipY(frameIndex: number, peakToPeakPx: number, baseY = HIP_BASE_Y): number {
  return baseY - (peakToPeakPx / 2) * Math.sin((2 * Math.PI * BOUNCE_HZ * frameIndex) / FPS)
}

/**
 * A gapless side-view gait clip whose bounce lands exactly on sampled frames: 90 steps/min gives a
 * 1.5 Hz bounce, which at 30 fps peaks every 10th frame — so each detected extremum sits on the
 * true peak rather than a sample near it, and hand-computed expectations hold exactly.
 */
function sinusoidFixture(pixelsPerMeter?: number | ((t: number, i: number) => number | null)) {
  return generateSyntheticGait({
    durationSec: 2,
    fps: FPS,
    cadenceStepsPerMin: 90,
    strideAmplitudePx: 40,
    verticalBouncePx: 30,
    trunkLeanDeg: 5,
    view: 'side',
    pixelsPerMeter,
  })
}

describe('computeVerticalOscillationCm', () => {
  it('matches the pixel-path amplitude exactly under a constant scale', () => {
    const scale = 300 // px/m — a 150px torso is then exactly 0.5m, as a real one is
    const frames = sinusoidFixture(scale)

    const pixelPath = computeVerticalOscillation(frames, 'side')
    const result = computeVerticalOscillationCm(frames)

    expect(pixelPath.value).not.toBeNull()
    expect(result).not.toBeNull()
    // The pixel path reports a fraction of torso length; converting it by hand through the same
    // constant scale must land on the same centimetres.
    const expectedCm = ((pixelPath.value ?? 0) * FIXTURE_TORSO_PX * 100) / scale
    expect(result?.verticalOscillationCm).toBeCloseTo(expectedCm, 9)

    // Now that BOTH paths fit the same spectral primitive, agreement under a constant scale is no
    // longer approximate-by-construction — it is an algebraic identity. The metric series
    // telescopes to `(y[0] − y[k]) / s`, an AFFINE image of the pixel series over the same samples
    // at the same timestamps: the constant offset is absorbed exactly by the intercept column,
    // every candidate frequency's RSS scales by the same `1/s²` (so the argmin is the same grid
    // frequency, exactly), `sinusoidR2` is a ratio of two quantities that both scale by `1/s²` (so
    // it is unchanged), and only the amplitude moves — by exactly `1/s`.
    expect(result?.sampleSize).toBe(pixelPath.sampleSize)
    expect(result?.fit?.frequencyHz).toBe(pixelPath.fit?.frequencyHz)
    expect(result?.fit?.sinusoidR2).toBeCloseTo(pixelPath.fit?.sinusoidR2 ?? 0, 9)
    expect(result?.fit?.peakToPeakAmplitudeCm).toBeCloseTo(
      ((pixelPath.fit?.peakToPeakAmplitudePx ?? 0) / scale) * 100,
      9,
    )
    // 30px peak-to-trough / 300 px per metre = 0.1m.
    expect(result?.verticalOscillationCm).toBeCloseTo(10, 9)
  })

  it('fabricates no bounce from a drifting scale over a stationary hip (the 480cm artifact)', () => {
    // Subject stands still (hip pixel row never moves) while the camera closes in: scale triples.
    const frameCount = 60
    const frames = Array.from({ length: frameCount }, (_, i) => {
      const scale = 300 + (600 * i) / (frameCount - 1) // 300 -> 900 px/m over 2s
      return frame(i / FPS, HIP_BASE_Y, 0.5 * scale, scale)
    })

    // What the naive conversion would have claimed: dividing the (constant) absolute pixel
    // position by the drifting scale swings by most of a metre, purely from the drift.
    const naive = frames.map((f) => HIP_BASE_Y / (f.pixelsPerMeter ?? 1))
    expect(Math.max(...naive) - Math.min(...naive)).toBeGreaterThan(0.5)

    const result = computeVerticalOscillationCm(frames)

    // Integrated deltas are all exactly zero — a stationary hip stays stationary at any scale.
    expect(result?.verticalOscillationCm).toBeNull()
    expect(result?.sampleSize).toBe(0)
    expect(result?.scaleDriftRatio).toBeCloseTo(3, 9)
    // An identically-flat series has nothing periodic in it, and the fit says so by name rather
    // than by returning a null nobody can explain.
    expect(result?.fitFailureReason).toBe('degenerate-signal')
    expect(result?.fit).toBeNull()
  })

  it('recovers a known real-world bounce under a mild camera-approach drift', () => {
    // 3cm amplitude => 6cm peak-to-trough, at 1.5Hz, while the scale drifts 1.2x across the clip.
    const amplitudeMeters = 0.03
    const bounceHz = 1.5
    const frameCount = 60
    const frames = Array.from({ length: frameCount }, (_, i) => {
      const t = i / FPS
      const scale = 300 * (1 + (0.2 * i) / (frameCount - 1))
      // A real vertical displacement of h metres shows up as h * scale pixels at that instant.
      const hipY = HIP_BASE_Y - amplitudeMeters * Math.sin(2 * Math.PI * bounceHz * t) * scale
      return frame(t, hipY, 0.5 * scale, scale)
    })

    const result = computeVerticalOscillationCm(frames)

    expect(result?.verticalOscillationCm).toBeGreaterThan(6 * 0.9)
    expect(result?.verticalOscillationCm).toBeLessThan(6 * 1.1)
    expect(result?.scaleDriftRatio).toBeCloseTo(1.2, 6)
  })

  it('absorbs camera-approach translation instead of charging it to the amplitude', () => {
    // The thesis of the estimator swap, isolated: the same 6cm bounce, measured once alone and
    // once with a whole-body translation 30x its size laid on top (−150·t − 60·t² px, i.e. 540px
    // of drift across 2s against an 18px bounce). An extrema-pairing estimator reads the
    // translation as amplitude on every half-cycle that runs with it; the fit's `d·t + e·t²` terms
    // take it out of the amplitude by construction.
    const scale = 300
    const torsoPx = 150
    const frameCount = 60
    const bouncePx = 18 // peak-to-peak; 18px / 300 px per metre = 6cm

    const build = (drift: (t: number) => number) =>
      Array.from({ length: frameCount }, (_, i) =>
        frame(i / FPS, bouncingHipY(i, bouncePx) + drift(i / FPS), torsoPx, scale),
      )

    const clean = computeVerticalOscillationCm(build(() => 0))
    const drifting = computeVerticalOscillationCm(
      build((t) => -150 * t - 60 * t * t),
    )

    expect(clean?.verticalOscillationCm).toBeCloseTo(6, 6)
    const cleanCm = clean?.verticalOscillationCm ?? 0
    expect(drifting?.verticalOscillationCm).toBeGreaterThan(cleanCm * 0.9)
    expect(drifting?.verticalOscillationCm).toBeLessThan(cleanCm * 1.1)
  })

  it("a run's baseline offset never becomes amplitude", () => {
    const scale = 300
    const torsoPx = 150
    // 15px peak-to-peak at 300 px/m is a 5cm bounce. Run B sits 500px lower on screen — a jump no
    // body made, just a re-acquisition after the tracker lost the subject.
    const build = (offset: number, startIndex: number) =>
      Array.from({ length: RUN_FRAMES }, (_, i) =>
        frame((startIndex + i) / FPS, bouncingHipY(i, 15, HIP_BASE_Y + offset), torsoPx, scale),
      )

    const frames = [
      ...build(0, 0),
      frame(RUN_FRAMES / FPS, null, torsoPx, scale), // hip unresolvable — splits the runs
      ...build(500, RUN_FRAMES + 1),
    ]

    const result = computeVerticalOscillationCm(frames)

    // Each run is fitted alone, so the 500px step between their baselines is never inside any
    // fit's data. Were it, it would show up as an amplitude near 500px/300 = 167cm — which the
    // explicit ceiling below could not survive.
    expect(result?.integrationRuns).toBe(2)
    expect(result?.verticalOscillationCm).toBeCloseTo(5, 6)
    expect(result?.verticalOscillationCm).toBeLessThan(20)
  })

  it('returns null when no frame carries a scale', () => {
    expect(computeVerticalOscillationCm(sinusoidFixture())).toBeNull()
  })

  it('interpolates missing scales within a run without changing the result', () => {
    const driftingScale = (_t: number, i: number) => 300 + i
    const fullyScaled = sinusoidFixture(driftingScale)
    // Drop every other frame's scale, keeping the run's first and last measured so the fill is
    // pure interpolation (linear in index, exactly recovering this linear drift) with no edge hold.
    const partiallyScaled = sinusoidFixture((t, i) =>
      i % 2 === 1 && i !== fullyScaled.length - 1 ? null : driftingScale(t, i),
    )

    const full = computeVerticalOscillationCm(fullyScaled)
    const partial = computeVerticalOscillationCm(partiallyScaled)

    expect(partial?.scaleCoverage).toBeLessThan(1)
    expect(full?.scaleCoverage).toBe(1)
    expect(partial?.sampleSize).toBe(full?.sampleSize)
    expect(partial?.verticalOscillationCm).toBeCloseTo(full?.verticalOscillationCm ?? 0, 9)
  })

  it('reports finite, self-consistent statistics', () => {
    const frames = sinusoidFixture((_t, i) => 300 + i)
    const result = computeVerticalOscillationCm(frames)
    const torsoLengthPx = estimateBodyScale(frames)?.torsoLengthPx ?? 0

    expect(result).not.toBeNull()
    if (!result) return

    expect(result.scaleDriftRatio).toBeCloseTo((300 + frames.length - 1) / 300, 9)
    expect(result.torsoMeters).toBeCloseTo(torsoLengthPx / result.medianPixelsPerMeter, 9)
    expect(result.torsoMeters).toBeGreaterThan(0.3)
    expect(result.torsoMeters).toBeLessThan(0.7)
    for (const value of Object.values(result)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
    }
    // The nested fit is where every new number lives, and `Object.values` above never descends
    // into it — walk it explicitly rather than trusting the shallow sweep.
    expect(result.fit).not.toBeNull()
    for (const value of Object.values(result.fit ?? {})) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(result.fitFailureReason).toBeNull()
    expect(result.fit?.observedCycles).toBeCloseTo(
      (result.fit?.spanSeconds ?? 0) * (result.fit?.frequencyHz ?? 0),
      9,
    )
  })

  it("drops a run with no scale at all rather than borrowing a neighbour's", () => {
    const scale = 300
    const torsoPx = 150
    const build = (startIndex: number, pixelsPerMeter: number | null) =>
      Array.from({ length: RUN_FRAMES }, (_, i) =>
        frame((startIndex + i) / FPS, bouncingHipY(i, 15), torsoPx, pixelsPerMeter),
      )
    // Run A carries no scale anywhere; run B does. Borrowing B's scale would let A contribute.
    const frames = [
      ...build(0, null),
      frame(RUN_FRAMES / FPS, null, torsoPx, null),
      ...build(RUN_FRAMES + 1, scale),
    ]

    const result = computeVerticalOscillationCm(frames)

    expect(result?.integrationRuns).toBe(1)
    expect(result?.verticalOscillationCm).toBeCloseTo(5, 6)
    // 45 of 91 frames measured — the dropped run's frames stay in the denominator.
    expect(result?.scaleCoverage).toBeCloseTo(RUN_FRAMES / (2 * RUN_FRAMES + 1), 9)
  })

  it('lets the sample-count-weighted median keep a short run from dominating', () => {
    const scale = 300
    const torsoPx = 150
    // 40 frames of a 15px (5cm) bounce...
    const long = Array.from({ length: 40 }, (_, i) =>
      frame(i / FPS, bouncingHipY(i, 15), torsoPx, scale),
    )
    // ...against a 14-frame fragment swinging 90px (30cm) at twice the rhythm. It clears the
    // 12-sample floor and fits cleanly, so nothing rejects it — only the weighting keeps it from
    // carrying the result. A plain median over two runs would average the two.
    const short = Array.from({ length: 14 }, (_, i) =>
      frame(
        (41 + i) / FPS,
        HIP_BASE_Y - 45 * Math.sin((2 * Math.PI * 2 * BOUNCE_HZ * i) / FPS),
        torsoPx,
        scale,
      ),
    )
    const frames = [...long, frame(40 / FPS, null, torsoPx, scale), ...short]

    const result = computeVerticalOscillationCm(frames)

    expect(result?.integrationRuns).toBe(2)
    // 40 of 54 samples sit on the long run, so it holds the weighted median outright — the
    // dominance property: a run with more than half the samples always wins, whatever the other
    // run's amplitude.
    expect(result?.verticalOscillationCm).toBeCloseTo(5, 6)
    expect(result?.fit?.sampleCount).toBe(40)
  })

  it('reports no amplitude, and names the quality gate, when nothing rhythmic can be fit', () => {
    const scale = 300
    const torsoPx = 150
    // Seeded jitter, no rhythm at all: the hip wanders ±10px frame to frame. The converted metric
    // series is `(y[0] − y[k]) / s` — white noise, not an integrated random walk — so this is the
    // regime the 0.30 gate was calibrated against (n = 60, pure-noise partial R² p95 ≈ 0.22).
    const random = mulberry32(7)
    const frames = Array.from({ length: 60 }, (_, i) =>
      frame(i / FPS, HIP_BASE_Y + (random() - 0.5) * 20, torsoPx, scale),
    )

    const result = computeVerticalOscillationCm(frames)

    expect(result).not.toBeNull()
    expect(result?.verticalOscillationCm).toBeNull()
    expect(result?.fit).toBeNull()
    expect(result?.fitFailureReason).toBe('below-quality-gate')
    // Measured-but-unfittable is not the same fact as not-measured: everything the scale
    // calibration itself established is still reported.
    expect(result?.scaleDriftRatio).toBe(1)
    expect(result?.medianPixelsPerMeter).toBe(scale)
    expect(result?.scaleCoverage).toBe(1)
    expect(result?.torsoMeters).toBeCloseTo(torsoPx / scale, 9)
  })

  it('stays hip-based regardless of verticalOscillationSignal — reads config only for the fit grid', () => {
    // `computeVerticalOscillationCm` now takes a HeuristicsConfig, so this pins the real thing:
    // setting `verticalOscillationSignal: 'earMid'` (which redirects the PIXEL metric to the head)
    // must not move the centimetre figure. The fixture gives the head a wildly different bounce
    // (3x, via headBounceDamping) than the hips, so a module that started reading left_ear/
    // right_ear would come out three times higher.
    const scale = 300
    const hipBounceFrames = sinusoidFixture(scale)
    const wildHeadBounceFrames = generateSyntheticGait({
      durationSec: 2,
      fps: FPS,
      cadenceStepsPerMin: 90,
      strideAmplitudePx: 40,
      verticalBouncePx: 30,
      trunkLeanDeg: 5,
      view: 'side',
      pixelsPerMeter: scale,
      headBounceDamping: 3.0,
    })

    const earMidConfig = {
      ...DEFAULT_HEURISTICS_CONFIG,
      verticalOscillationSignal: 'earMid' as const,
    }
    const hipResult = computeVerticalOscillationCm(hipBounceFrames, earMidConfig)
    const wildHeadResult = computeVerticalOscillationCm(wildHeadBounceFrames, earMidConfig)
    const defaultConfigResult = computeVerticalOscillationCm(hipBounceFrames)

    expect(hipResult?.verticalOscillationCm).not.toBeNull()
    expect(wildHeadResult?.verticalOscillationCm).toBeCloseTo(
      hipResult!.verticalOscillationCm!,
      9,
    )
    expect(hipResult?.verticalOscillationCm).toBeCloseTo(
      defaultConfigResult!.verticalOscillationCm!,
      9,
    )
  })
})

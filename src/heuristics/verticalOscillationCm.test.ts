import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { computeVerticalOscillationCm } from './verticalOscillationCm'
import { computeVerticalOscillation } from './verticalOscillation'
import { estimateBodyScale } from './bodyScale'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'

/** The synthetic-gait fixture's fixed torso length, restated here for hand-computed expectations. */
const FIXTURE_TORSO_PX = 150

const HIP_BASE_Y = 400
const FPS = 30

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
    // constant scale must land on the same centimetres, over the same half-cycles.
    const expectedCm = ((pixelPath.value ?? 0) * FIXTURE_TORSO_PX * 100) / scale
    expect(result?.verticalOscillationCm).toBeCloseTo(expectedCm, 9)
    expect(result?.sampleSize).toBe(pixelPath.sampleSize)
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

  it('never pairs extrema across an integration-run boundary', () => {
    const scale = 300
    const torsoPx = 150
    // Two 1.5Hz half-cycles' worth of frames per run: 400 -> 415 -> 400 in pixels (5cm at this
    // scale). Run B sits 500px lower on screen — a jump no body made, just a re-acquisition after
    // the tracker lost the subject.
    const runShape = [400, 407.5, 415, 407.5, 400]
    const build = (offset: number, startIndex: number) =>
      runShape.map((hipY, i) =>
        frame((startIndex + i) / FPS, hipY + offset, torsoPx, scale),
      )

    const frames = [
      ...build(0, 0),
      frame(5 / FPS, null, torsoPx, scale), // hip unresolvable — splits the runs
      ...build(500, 6),
    ]

    const result = computeVerticalOscillationCm(frames)

    // Each run contributes exactly one half-cycle pair (up then down => 2 amplitudes of 15px).
    // A cross-run pair would add a third amplitude of ~500px/300 = 167cm; sampleSize is the tell,
    // since a lone outlier barely moves a median.
    expect(result?.sampleSize).toBe(4)
    expect(result?.integrationRuns).toBe(2)
    expect(result?.verticalOscillationCm).toBeCloseTo(5, 9)
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
  })

  it('drops a run with no scale at all rather than borrowing a neighbour\'s', () => {
    const scale = 300
    const torsoPx = 150
    const runShape = [400, 407.5, 415, 407.5, 400]
    // Run A carries no scale anywhere; run B does. Borrowing B's scale would let A contribute.
    const frames = [
      ...runShape.map((hipY, i) => frame(i / FPS, hipY, torsoPx, null)),
      frame(5 / FPS, null, torsoPx, null),
      ...runShape.map((hipY, i) => frame((6 + i) / FPS, hipY, torsoPx, scale)),
    ]

    const result = computeVerticalOscillationCm(frames)

    expect(result?.integrationRuns).toBe(1)
    expect(result?.sampleSize).toBe(2)
    // 5 of 11 frames measured — the dropped run's frames stay in the denominator.
    expect(result?.scaleCoverage).toBeCloseTo(5 / 11, 9)
  })
})

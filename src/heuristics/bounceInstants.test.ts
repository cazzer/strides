import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { buildFrame } from './__fixtures__/testFrames'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { resolveMidpoint } from './keypoints'
import { resolvedSpanCenter, selectBounceInstants } from './bounceInstants'
import type { SpectralFitSuccess } from './spectralFit'
import { computeVerticalOscillation } from './verticalOscillation'
import { computeVerticalOscillationCmMetric } from './verticalOscillationCm'
import { computeVerticalRatio } from './verticalRatio'
import { computeCadence } from './cadence'

/**
 * A hand-built fit with arithmetic anyone can check by eye: `ω = 2π`, so `sin(ω(t − 2) + 0)` peaks
 * a quarter period after its centre — maxima at `2.25 + k`, minima at `1.75 + k`.
 */
const UNIT_FIT: SpectralFitSuccess = {
  ok: true,
  peakToPeakAmplitude: 20,
  frequencyHz: 1,
  sinusoidR2: 1,
  totalR2: 1,
  secondPeakRatio: 0,
  sampleCount: 81,
  spanSeconds: 4,
  observedCycles: 4,
  phaseRadians: 0,
  tMeanSeconds: 2,
}

/** 0 s to 4 s at 20 fps — a 0.05 s interval, so the snap tolerance is 0.025 s. */
function evenFrames(): RobustPoseFrame[] {
  return Array.from({ length: 81 }, (_, i) => buildFrame({}, i / 20))
}

describe('selectBounceInstants', () => {
  it('picks the cycle whose midpoint sits closest to the span centre', () => {
    const instants = selectBounceInstants({
      fit: UNIT_FIT,
      frames: evenFrames(),
      spanCenterSeconds: 2,
      maximumIs: 'highest',
    })

    // The (2.25, 1.75) pair straddles the centre exactly; every other cycle is a whole period out.
    expect(instants?.highest.timestamp).toBeCloseTo(2.25, 10)
    expect(instants?.lowest.timestamp).toBeCloseTo(1.75, 10)
  })

  it('follows the span centre to a different cycle when the fit is only supported early', () => {
    const instants = selectBounceInstants({
      fit: UNIT_FIT,
      frames: evenFrames(),
      spanCenterSeconds: 0.5,
      maximumIs: 'highest',
    })

    expect(instants?.highest.timestamp).toBeCloseTo(0.25, 10)
    expect(instants?.lowest.timestamp).toBeCloseTo(0.75, 10)
  })

  it('swaps which instant is the top when the fitted series is downward-positive', () => {
    const frames = evenFrames()
    const upwardPositive = selectBounceInstants({
      fit: UNIT_FIT,
      frames,
      spanCenterSeconds: 2,
      maximumIs: 'highest',
    })
    const downwardPositive = selectBounceInstants({
      fit: UNIT_FIT,
      frames,
      spanCenterSeconds: 2,
      maximumIs: 'lowest',
    })

    // Same two frames, opposite roles — this is the whole sign trap, in one assertion.
    expect(downwardPositive?.highest).toBe(upwardPositive?.lowest)
    expect(downwardPositive?.lowest).toBe(upwardPositive?.highest)
  })

  it('rejects the pair when an instant lands beyond half a sampling interval from any frame', () => {
    // Frames dropped either side of the 1.75 s minimum, leaving 1.55 and 1.95 as its nearest
    // neighbours — 0.2 s away, against a 0.025 s tolerance.
    const holed = evenFrames().filter(
      (frame) => frame.timestamp < 1.6 || frame.timestamp > 1.9,
    )

    expect(
      selectBounceInstants({
        fit: UNIT_FIT,
        frames: holed,
        spanCenterSeconds: 2,
        maximumIs: 'highest',
      }),
    ).toBeNull()
  })

  it('returns null rather than clamping when there is nothing to snap against', () => {
    for (const frames of [[], [buildFrame({}, 0)]]) {
      expect(
        selectBounceInstants({
          fit: UNIT_FIT,
          frames,
          spanCenterSeconds: 2,
          maximumIs: 'highest',
        }),
      ).toBeNull()
    }
  })

  it('returns null on a fit whose frequency cannot define a period', () => {
    for (const frequencyHz of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        selectBounceInstants({
          fit: { ...UNIT_FIT, frequencyHz },
          frames: evenFrames(),
          spanCenterSeconds: 2,
          maximumIs: 'highest',
        }),
      ).toBeNull()
    }
  })
})

describe('resolvedSpanCenter', () => {
  it('spans only the frames that contributed a sample', () => {
    const frames = Array.from({ length: 5 }, (_, i) => buildFrame({}, i))

    expect(resolvedSpanCenter(frames, [null, 1, 2, 3, null])).toBe(2)
    expect(resolvedSpanCenter(frames, [0, 1, 2, 3, 4])).toBe(2)
    expect(resolvedSpanCenter(frames, [null, null, 2, null, null])).toBe(2)
  })

  it('is null when nothing resolved', () => {
    const frames = Array.from({ length: 3 }, (_, i) => buildFrame({}, i))
    expect(resolvedSpanCenter(frames, [null, null, null])).toBeNull()
  })
})

/**
 * The direction test design D8 requires, and the one check a mislabelled caption cannot survive.
 *
 * Nothing else in this suite asserts direction, so a copy-pasted `maximumIs` would type-check,
 * pass every existing test, and ship a picture captioned as the exact opposite of what it shows.
 * The two paths fit series with OPPOSITE sign conventions — raw downward-positive image-y for the
 * pixel metrics, upward-positive integrated deltas for the centimetre one — so they must pass
 * OPPOSITE answers to reach the same body position, and this fixture's geometry is known well
 * enough to say which body position that is.
 */
describe('bounce exemplar direction, against a fixture with known geometry', () => {
  /** Hip-y is `400 + 15·sin(2π·1.5·t)` here — image y grows DOWNWARD, so the runner is HIGHEST
   * where that is smallest. 90 steps/min at 30 fps puts every true extremum exactly on a sampled
   * frame. */
  const CLIP = generateSyntheticGait({
    durationSec: 3,
    fps: 30,
    cadenceStepsPerMin: 90,
    strideAmplitudePx: 40,
    verticalBouncePx: 30,
    trunkLeanDeg: 5,
    view: 'side',
    pixelsPerMeter: 872,
  })

  const hipTrace = CLIP.map(
    (frame) => resolveMidpoint(frame, 'left_hip', 'right_hip')!.y,
  )
  const lowestY = Math.min(...hipTrace)
  const highestY = Math.max(...hipTrace)
  const range = highestY - lowestY

  function hipYAt(timestamp: number): number {
    const index = CLIP.findIndex((frame) => frame.timestamp === timestamp)
    expect(index, `no sampled frame at ${timestamp}`).toBeGreaterThanOrEqual(0)
    return hipTrace[index]
  }

  /** `timestamp` is the BASE and design D1 names it the top of the bounce; `pairedTimestamp` is
   * the ghost at the bottom. Both are also required to be near the clip's real extremes, so a
   * pair that merely happened to straddle the mean cannot pass. */
  function expectTopThenBottom(exemplar: { timestamp: number; pairedTimestamp?: number }) {
    const top = hipYAt(exemplar.timestamp)
    const bottom = hipYAt(exemplar.pairedTimestamp!)

    expect(top).toBeLessThan(bottom)
    expect(top - lowestY).toBeLessThan(range * 0.1)
    expect(highestY - bottom).toBeLessThan(range * 0.1)
  }

  it('names the top of the bounce for the pixel-space fit (image-y, downward-positive)', () => {
    const [exemplar] = computeVerticalOscillation(CLIP, 'side').exemplars!
    expectTopThenBottom(exemplar)
  })

  it('names the top of the bounce for the centimetre fit (deltas, upward-positive)', () => {
    const [exemplar] = computeVerticalOscillationCmMetric(CLIP, 'side').exemplars!
    expectTopThenBottom(exemplar)
  })

  it('names the top of the bounce for vertical ratio’s numerator', () => {
    const [exemplar] = computeVerticalRatio(CLIP, 'side').exemplars!
    expectTopThenBottom(exemplar)
  })

  it('has the two opposite conventions agree on the same instants for the same body', () => {
    const pixel = computeVerticalOscillation(CLIP, 'side').exemplars![0]
    const centimetre = computeVerticalOscillationCmMetric(CLIP, 'side').exemplars![0]

    expect(centimetre.timestamp).toBe(pixel.timestamp)
    expect(centimetre.pairedTimestamp).toBe(pixel.pairedTimestamp)
  })

  it('emits nothing for cadence, which reads the same fit and depicts a rate', () => {
    const cadence = computeCadence(CLIP, 'side')

    expect(cadence.value).not.toBeNull()
    expect(cadence.exemplars).toBeUndefined()
  })
})

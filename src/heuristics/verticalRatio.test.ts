import { describe, expect, it } from 'vitest'
import { computeVerticalRatio } from './verticalRatio'
import { detectFootstrikes } from './footstrikes'
import { estimateStrideLength } from './strideLength'
import { analyzeHipBounce } from './hipBounce'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { framesFromHipTrace, seededNormals } from './__fixtures__/hipTraceFrames'
import { buildFrame } from './__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  trunkLeanDeg: 5,
}

// Same derivation as strideLength.test.ts: at the fixture defaults (170 spm, 100px/s travel),
// true stride length is 100 * 120/170 = 70.588...px, with up to one frame of travel (100/30 =
// 3.33px) of discretization error either way.
const EXPECTED_STRIDE_PX = (100 * 120) / 170
const ONE_FRAME_TRAVEL_TOLERANCE = 100 / 30
const MIN_STRIDE_PX = EXPECTED_STRIDE_PX - ONE_FRAME_TRAVEL_TOLERANCE
const MAX_STRIDE_PX = EXPECTED_STRIDE_PX + ONE_FRAME_TRAVEL_TOLERANCE

const BOUNCE_HZ = 2.0
/**
 * A clip whose ankle rhythm disagrees with its hip-bounce rhythm — the shape of the Demo 1 defect
 * this metric's period gate exists for, built deliberately rather than sampled.
 *
 * The hips bounce cleanly at `BOUNCE_HZ` (a grid frequency, so the fit lands on it exactly and its
 * R² is effectively 1), which makes the expected stride period `2 / BOUNCE_HZ = 1.0 s` = 30 frames
 * at 30fps. `blockFrames` is the ankle-y rhythm's own period in frames, so `15` is a HALF-stride
 * rhythm and `60` a DOUBLE-stride one — the two multiplicity errors, one either side of the truth.
 * The right ankle is flatlined, well below the moving left one, which is why every surviving
 * candidate is a RIGHT-side one: on the relative contact series the flat foot is the one that reads
 * as being on the ground, and the left side's maxima are all negative and physically rejected.
 *
 * Everything else is deliberately healthy: torso length is a constant 100px, hip-x advances 8px a
 * frame so travel direction resolves, and the ankle bumps clear the prominence floor by 10x.
 */
/**
 * Shifts the ankle rhythm's phase so that no block boundary — where the ankle-y trough sits, and
 * therefore where the RIGHT side's relative contact series peaks and every surviving candidate
 * lands — coincides with the clip's first or last sampled frame. `detectFootstrikes` declines to
 * emit an instant with no frame on one side of it, so the unshifted block (troughs at frames 0 and
 * 60, plus the extremum scan's trailing pivot at frame 119) would have put every one of this
 * fixture's candidates on a boundary and left the clip with a single strike and no same-side pair
 * to gate.
 */
const ANKLE_BLOCK_PHASE_OFFSET_FRAMES = 10

function framesWithAnkleBlock(blockFrames: number): RobustPoseFrame[] {
  const fps = 30
  const frameCount = 120
  const ankleBlock = blockFrames
  const rampFrames = ankleBlock / 2
  return Array.from({ length: frameCount }, (_, i) => {
    const t = i / fps
    const hipX = 200 + i * 8
    const hipY = 400 + 20 * Math.sin(2 * Math.PI * BOUNCE_HZ * t)
    // Triangle bump peaking mid-block, so each block contributes exactly one ankle-y maximum.
    const phase = (i + ANKLE_BLOCK_PHASE_OFFSET_FRAMES) % ankleBlock
    const ankleY =
      600 + 50 * (phase <= rampFrames ? phase / rampFrames : (ankleBlock - phase) / rampFrames)
    return buildFrame(
      {
        left_shoulder: { x: hipX - 5, y: hipY - 100 },
        right_shoulder: { x: hipX + 5, y: hipY - 100 },
        left_hip: { x: hipX - 5, y: hipY },
        right_hip: { x: hipX + 5, y: hipY },
        left_ankle: { x: hipX, y: ankleY },
        right_ankle: { x: hipX, y: 800 },
      },
      t,
    )
  })
}

describe('computeVerticalRatio', () => {
  it('a clean side-view clip: value close to verticalBouncePx / strideLengthPx, high confidence', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'side' })

    const result = computeVerticalRatio(frames, 'side')

    expect(result.value).not.toBeNull()
    // fit.peakToPeakAmplitude recovers verticalBouncePx to within ~0.1% (see
    // verticalOscillation.test.ts's identical fit), so the dominant source of uncertainty in the
    // bounds is stride length's one-frame-of-travel quantization, not the bounce fit.
    expect(result.value).toBeGreaterThan(6 / MAX_STRIDE_PX)
    expect(result.value).toBeLessThan(6 / MIN_STRIDE_PX)
    expect(result.unit).toBe('percent')
    expect(result.viewFit).toBe('primary')
    expect(result.confidence).toBeGreaterThan(0.9)
    // No caveat at all now, where this used to name two rejected pairs. `findLocalExtrema`
    // manufactures an extremum at each run edge, and this 4s clip used to carry both -- a strike at
    // t=0.0000 (0.5333s before the first real one) and one at t=3.9667 (0.6s after the last real
    // one), neither a real gait cycle. `detectFootstrikes` now drops both at source: its same-side
    // spacing floor is one shortest-plausible stride (0.7059 / 1.15 = 0.6138s here) and each edge
    // artifact sits 0.5333s / 0.6s from its neighbour, so the lower-amplitude of each pair loses.
    // The period gate downstream is then left with 9 genuine pairs, all within 4.2% of the expected
    // period, and nothing to reject. That the two rules agree about exactly which instants were
    // spurious is the point -- the floor IS the gate's own lower band edge (`stridePeriod.ts`).
    expect(result.caveat).toBeNull()
  })

  it('indeterminate travel direction reports null with the exact caveat prefix', () => {
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      verticalBouncePx: 6,
      view: 'side',
      travelSpeedPxPerSec: 0,
    })

    const result = computeVerticalRatio(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
    expect(result.caveat).toContain(
      'Direction of travel could not be determined (no net horizontal displacement)',
    )
  })

  it('a front-view clip that still travels: non-null value, heavily discounted, view-unsuitable caveat', () => {
    // syntheticGait's hip-x advances by travelSpeedPxPerSec regardless of `view` -- front-view
    // clips are NOT automatically indeterminate the way real approach footage tends to be (see
    // design.md D4's narrower case: a runner crossing the frame at a shallow angle still has a
    // resolvable travel direction even face-on).
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'front' })

    const result = computeVerticalRatio(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toMatch(/not reliable from a front view/i)
  })

  it('degenerate zero bounce reports null ahead of the stride-length check (numerator gate first)', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' })

    const result = computeVerticalRatio(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    // A bounce-shaped caveat, not a stride-length-shaped one, even though this clip's stride
    // length would otherwise resolve fine (it has the same travel/footstrike geometry as the
    // clean case above).
    expect(result.caveat).toMatch(/no oscillating vertical motion/i)
  })

  it('degrades honestly when no stride pair is period-consistent, naming the real cause', () => {
    // A DOUBLE-stride ankle rhythm, not the half-stride one this test used to build. The halving
    // direction can no longer reach this branch at all: `detectFootstrikes`' same-side spacing
    // floor is the period gate's own lower band edge, computed from the same fitted step frequency
    // on the same frames, so a sub-stride same-side pair is now impossible to construct through
    // that path (`stridePeriod.ts`'s `shortestPlausibleStrideSeconds`). The gate's UPPER edge is
    // what still bites — a missed footstrike, whose pair spans two strides — and that is what this
    // fixture now exercises. Measured on it: one same-side pair, frames 50 and 110, spanning 2.000s
    // against an expected 1.0s, rejected. (It was two pairs before `detectFootstrikes` began
    // requiring a sampled frame on both sides of a candidate — the third strike was the extremum
    // scan's trailing pivot on the clip's final frame, which is not evidence of a contact. One pair
    // is all this test needs: it asserts the gate rejects what it is handed, not how much.)
    const frames = framesWithAnkleBlock(60)

    // The premise: without the gate this clip WOULD have reported a value, off a denominator
    // spanning two strides. Assert the premise so the test cannot silently degenerate into "some
    // other gate rejected it".
    const bounce = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(bounce.fit.ok).toBe(true)
    if (!bounce.fit.ok) return
    expect(bounce.fit.frequencyHz).toBeCloseTo(BOUNCE_HZ, 10)
    const minFitR2 = DEFAULT_HEURISTICS_CONFIG.verticalOscillationMinFitR2
    expect(bounce.fit.sinusoidR2).toBeGreaterThan(minFitR2)
    const ungated = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(ungated.ok).toBe(true)
    if (!ungated.ok) return
    expect(ungated.pairCount).toBeGreaterThan(0)

    const result = computeVerticalRatio(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    // Names the timing mismatch and the mechanism -- not the generic no-usable-pairs text, which
    // would describe a displacement failure that did not happen here.
    expect(result.caveat).toMatch(/lasted a full stride at the step rhythm measured in this clip/)
    expect(result.caveat).toMatch(/extra footstrike instants/)
    expect(result.caveat).not.toMatch(/advanced in the direction of travel/)
    expect(result.exemplars).toBeUndefined()
  })

  it('never produces NaN or Infinity, across every shape of input and every view', () => {
    const noise = seededNormals(7, 60)
    const fixtures: RobustPoseFrame[][] = [
      [],
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'side' }),
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' }),
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'front' }),
      framesFromHipTrace(noise.map((n, i) => ({ t: i / 30, y: 400 + 12 * n }))),
      // Fewer samples than the fit's floor, and a pure ramp at that.
      framesFromHipTrace([400, 401, 402, 403, 404].map((y, i) => ({ t: i / 30, y }))),
      framesWithAnkleBlock(15),
      framesWithAnkleBlock(60),
      generateSyntheticGait({
        ...BASE_PARAMS,
        verticalBouncePx: 6,
        view: 'side',
        travelSpeedPxPerSec: 0,
      }),
    ]

    for (const frames of fixtures) {
      for (const view of ['side', 'front', 'ambiguous'] as const) {
        expect(() => computeVerticalRatio(frames, view)).not.toThrow()
        const result = computeVerticalRatio(frames, view)
        expect(Number.isFinite(result.value ?? 0)).toBe(true)
        expect(Number.isFinite(result.confidence)).toBe(true)
        expect(Number.isFinite(result.sampleSize)).toBe(true)
        if (result.value === null) expect(result.confidence).toBe(0)
      }
    }
  })
})

describe('computeVerticalRatio — numerator exemplar', () => {
  const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'side' })

  it('emits the bounce pair its numerator was fitted from, hip-seeded', () => {
    const exemplars = computeVerticalRatio(frames, 'side').exemplars!

    // Selected by `kind`, not by position: this metric also emits a denominator exemplar (see the
    // block below), and `selectExemplars` ranks by quality, so which of the two comes first is not
    // this test's business.
    const bounce = exemplars.filter((candidate) => candidate.kind === 'bounceCycle')
    expect(bounce).toHaveLength(1)
    const [exemplar] = bounce
    // Hip-pinned, exactly as the numerator's own fit is — never `verticalOscillationSignal`'s pair.
    expect(exemplar.cropKeypoints.slice(0, 2)).toEqual(['left_hip', 'right_hip'])
    expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.timestamp)
    expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.pairedTimestamp)
  })

  it('emits nothing when the metric reports no value', () => {
    const flat = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' })
    const result = computeVerticalRatio(flat, 'side')

    expect(result.value).toBeNull()
    expect(result.exemplars).toBeUndefined()
  })
})

describe('computeVerticalRatio — denominator exemplar', () => {
  const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'side' })

  it('emits the median stride pair as a second, kind-distinguished exemplar', () => {
    const exemplars = computeVerticalRatio(frames, 'side').exemplars!

    // Numerator and denominator both survive: two candidates against a per-metric budget of two,
    // so neither crowds the other out.
    expect(exemplars).toHaveLength(2)
    expect([...exemplars.map((exemplar) => exemplar.kind)].sort()).toEqual([
      'bounceCycle',
      'stridePair',
    ])
  })

  it('its two instants are consecutive same-side footstrikes of one stride', () => {
    const [stride] = computeVerticalRatio(frames, 'side').exemplars!.filter(
      (exemplar) => exemplar.kind === 'stridePair',
    )

    const sameSideStrikes = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
      .filter((candidate) => candidate.side === stride.side)
      .map((candidate) => frames[candidate.frameIndex].timestamp)

    const start = sameSideStrikes.indexOf(stride.timestamp)
    expect(start).toBeGreaterThanOrEqual(0)
    // Consecutive, and forward in time — the stride started at `timestamp` and ended at
    // `pairedTimestamp`, never the other way round.
    expect(sameSideStrikes[start + 1]).toBe(stride.pairedTimestamp)
    expect(stride.pairedTimestamp!).toBeGreaterThan(stride.timestamp)
  })

  it('is the pair whose displacement is nearest the reported denominator', () => {
    const [stride] = computeVerticalRatio(frames, 'side').exemplars!.filter(
      (exemplar) => exemplar.kind === 'stridePair',
    )
    // Called exactly the way the metric calls it -- the same fitted step-frequency reference, so
    // the pair set compared against here is the one the exemplar was selected from, structurally
    // rather than by coincidence.
    const fit = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG).fit
    expect(fit.ok).toBe(true)
    if (!fit.ok) return
    const result = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG, {
      stepFrequencyHz: fit.frequencyHz,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const selected = result.pairs.find(
      (pair) => pair.startFrame.timestamp === stride.timestamp,
    )!
    const nearest = Math.min(
      ...result.pairs.map((pair) => Math.abs(pair.displacementPx - result.strideLengthPx)),
    )
    expect(Math.abs(selected.displacementPx - result.strideLengthPx)).toBe(nearest)
  })

  it('seeds the crop on the hips it measured, and spans the stride with the ankles', () => {
    const [stride] = computeVerticalRatio(frames, 'side').exemplars!.filter(
      (exemplar) => exemplar.kind === 'stridePair',
    )

    // Hips are the seed — the hip-mid horizontal displacement IS the stride length. The ankles are
    // context (design D2): a stride is a horizontal displacement, so the crop has to span it.
    expect(stride.cropKeypoints).toEqual([
      'left_hip',
      'right_hip',
      'left_ankle',
      'right_ankle',
    ])
  })

  it('emits nothing when the stride length could not be measured', () => {
    // A treadmill clip: the hip never advances, so `estimateTravelDirection` is indeterminate and
    // the metric reports no value at all.
    const treadmill = generateSyntheticGait({
      ...BASE_PARAMS,
      verticalBouncePx: 6,
      view: 'side',
      travelSpeedPxPerSec: 0,
    })
    const result = computeVerticalRatio(treadmill, 'side')

    expect(result.value).toBeNull()
    expect(result.exemplars).toBeUndefined()
  })
})

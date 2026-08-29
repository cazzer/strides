import { describe, expect, it } from 'vitest'
import { detectFootstrikes } from './footstrikes'
import { findLocalExtrema } from './extrema'
import { resolvePoint } from './keypoints'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig } from './types'
import { buildFrame } from './__fixtures__/testFrames'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import type { RobustPoseFrame } from '../pose/robustness/types'

/** shoulder-mid (0,0), hip-mid (0,100) -> torsoLengthPx 100 on every frame, so
 * footstrikeMinProminenceRatio * 100 gives an exact, easy-to-reason-about pixel threshold. */
const TORSO_POINTS = {
  left_shoulder: { x: -5, y: 0 },
  right_shoulder: { x: 5, y: 0 },
  left_hip: { x: -5, y: 100 },
  right_hip: { x: 5, y: 100 },
}

function configWithRatio(footstrikeMinProminenceRatio: number): HeuristicsConfig {
  return { ...DEFAULT_HEURISTICS_CONFIG, footstrikeMinProminenceRatio }
}

// ---------------------------------------------------------------------------
// Alternating two-leg gait fixture
// ---------------------------------------------------------------------------

const GROUND_Y = 250
const HIP_BASE_Y = 100
const TORSO_PX = 100
const STANCE_END = 0.35
const HEEL_OFF_START = 0.2
const APEX = 0.55
const APEX_LIFT_PX = 55
const FRAMES_PER_STRIDE = 30
const FPS = 25

interface GaitShape {
  /** Half-amplitude of the whole body's vertical oscillation, in px. The body is lowest at each
   * foot's midstance and highest at each flight apex, which is the real phase relationship. `0`
   * removes the body's bounce entirely, leaving a signal whose only content is leg geometry. */
  bounceHalfPx: number
  /** Phase at which the swinging foot stops hanging near its apex and begins its descent to
   * touchdown. Set equal to `APEX` for no hang at all. A long hang is what lets the body's own
   * oscillation dominate the swinging foot's absolute height for a stretch. */
  hangEnd: number
  /** How far the ankle has risen off the ground by toe-off (heel-off/push-off plantarflexion).
   * `0` models the pessimistic case: a perfectly flat stance plateau, where nothing in the raw
   * ankle-y series distinguishes touchdown from toe-off. */
  toeOffLiftPx: number
}

const wrapPhase = (phase: number) => phase - Math.floor(phase)

function bodyY(phase: number, shape: GaitShape): number {
  return (
    HIP_BASE_Y + shape.bounceHalfPx * Math.cos(4 * Math.PI * (wrapPhase(phase) - STANCE_END / 2))
  )
}

/**
 * One ankle's absolute screen y at a given phase of its own gait cycle (0 = its own touchdown).
 *
 * Two regimes, joined continuously, and the join is the point of the whole fixture:
 * - **Stance** (`phase <= STANCE_END`): the foot is on the ground, so it is pinned to `GROUND_Y`
 *   and does NOT move with the body — a planted foot cannot bounce. It rises only by the
 *   `toeOffLiftPx` heel-off ramp near the end of stance.
 * - **Swing**: the foot's height is the body's height plus a leg-relative offset, so it carries
 *   the body's vertical oscillation at FULL strength. The relative offset is chosen to match the
 *   pinned stance values at toe-off and at the next touchdown, which keeps the trace continuous.
 *
 * This asymmetry — the body's bounce present in the swinging foot's screen position and absent
 * from the planted one's — is not a fixture quirk. It is exactly why a single ankle's raw screen
 * y is an unreliable footstrike signal, and exactly what differencing the two ankles removes.
 */
function ankleY(phase: number, shape: GaitShape): number {
  const p = wrapPhase(phase)
  const stanceLift =
    p <= HEEL_OFF_START
      ? 0
      : shape.toeOffLiftPx *
        Math.sin((Math.PI / 2) * ((p - HEEL_OFF_START) / (STANCE_END - HEEL_OFF_START)))
  if (p <= STANCE_END) return GROUND_Y - stanceLift

  const relAtToeOff = GROUND_Y - shape.toeOffLiftPx - bodyY(STANCE_END, shape)
  const relAtContact = GROUND_Y - bodyY(0, shape)
  const relAtApex = relAtContact - APEX_LIFT_PX

  if (p <= APEX) {
    const rel =
      relAtApex +
      (relAtToeOff - relAtApex) * Math.cos((Math.PI / 2) * ((p - STANCE_END) / (APEX - STANCE_END)))
    return bodyY(p, shape) + rel
  }
  if (p <= shape.hangEnd) return bodyY(p, shape) + relAtApex
  const rel =
    relAtApex +
    (relAtContact - relAtApex) *
      Math.sin((Math.PI / 2) * ((p - shape.hangEnd) / (1 - shape.hangEnd)))
  return bodyY(p, shape) + rel
}

/**
 * A two-leg alternating running clip: the left foot touches down at phase 0 of every stride and
 * the right foot half a stride later, both feet built from the same `ankleY` profile. Ankle-x is
 * held fixed — this detector never reads it, and holding it constant keeps the fixture's only
 * varying quantity the one under test.
 */
function buildGait(shape: GaitShape, strides = 3): RobustPoseFrame[] {
  const frames: RobustPoseFrame[] = []
  // One frame past the last full stride, so the clip ENDS on a left touchdown rather than
  // mid-descent — `findLocalExtrema` always emits its trailing pivot, and ending on a real contact
  // keeps that pivot a real contact instead of an edge artifact this fixture would have to explain
  // away.
  for (let i = 0; i <= strides * FRAMES_PER_STRIDE; i += 1) {
    const phase = i / FRAMES_PER_STRIDE
    const body = bodyY(phase, shape)
    frames.push(
      buildFrame(
        {
          left_shoulder: { x: -5, y: body - TORSO_PX },
          right_shoulder: { x: 5, y: body - TORSO_PX },
          left_hip: { x: -5, y: body },
          right_hip: { x: 5, y: body },
          left_ankle: { x: 0, y: ankleY(phase, shape) },
          right_ankle: { x: 0, y: ankleY(phase + 0.5, shape) },
        },
        i / FPS,
      ),
    )
  }
  return frames
}

/** Frame indices of every touchdown `buildGait` was built to contain: one per foot per stride,
 * plus the closing left touchdown on the clip's final frame. */
const TRUE_CONTACT_FRAMES: Array<[side: 'left' | 'right', frameIndex: number]> = [
  ['left', 0],
  ['right', 15],
  ['left', 30],
  ['right', 45],
  ['left', 60],
  ['right', 75],
  ['left', 90],
]

/** The prominence-confirmed maxima of ONE ankle's raw screen-y series — the signal
 * `detectFootstrikes` used to read before it began differencing the two ankles. Used only to prove
 * a fixture really does exercise the defect under test, never as the thing under test. */
function rawAnkleYMaxima(frames: RobustPoseFrame[], side: 'left' | 'right') {
  const series = frames.map((frame) => {
    const ankle = resolvePoint(frame, side === 'left' ? 'left_ankle' : 'right_ankle')
    return ankle === null ? null : { t: frame.timestamp, v: ankle.y }
  })
  const minProminenceAbs = DEFAULT_HEURISTICS_CONFIG.footstrikeMinProminenceRatio * TORSO_PX
  return findLocalExtrema(series, minProminenceAbs).filter((extremum) => extremum.kind === 'max')
}

function detectedFrames(frames: RobustPoseFrame[]) {
  return detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG).map(
    (candidate) => [candidate.side, candidate.frameIndex] as [string, number],
  )
}

describe('detectFootstrikes', () => {
  it('keeps only maxima (footstrikes), not minima, on the single-leg fallback series', () => {
    // Reuses extrema.ts's own hand-traced "monotonic rise" case (see extrema.test.ts): raw
    // [0,1,2,3,4,5] at threshold 2 confirms min@index0 then max@index5 -- only the max is a
    // footstrike candidate. The right ankle is left UNRESOLVABLE, which is what isolates the left
    // side now that each ankle is read relative to the other: with no opposite ankle anywhere in
    // the clip there is no contralateral reference, so `buildContactSeries` falls back to raw left
    // ankle-y and this trace means exactly what it says.
    const leftY = [0, 1, 2, 3, 4, 5]
    const frames = leftY.map((y, i) => buildFrame({ ...TORSO_POINTS, left_ankle: { x: 0, y } }, i))

    const result = detectFootstrikes(frames, configWithRatio(0.02)) // 0.02 * 100 = 2

    expect(result).toEqual([{ frameIndex: 5, timestamp: 5, side: 'left' }])
  })

  it('drops a same-side candidate closer than footstrikeMinIntervalSeconds to the last kept one', () => {
    // Reuses extrema.test.ts's "hand-traced down-up-down" case: raw [10,8,6,4,6,8,10,8,6] at
    // threshold 3 confirms max@index0, min@index3, max@index6 -- two maxima, i.e. two footstrike
    // candidates before dedup. Timestamps are assigned independently of index/value (smoothing
    // and extrema selection only look at value order, never at timestamp), so the gap between the
    // two maxima's timestamps can be controlled precisely: index0 -> t=0, index6 -> t=0.1, well
    // under the default 0.25s minimum interval, so the second is dropped as a re-detection of the
    // first rather than a distinct footstrike. Right ankle unresolvable, as above.
    const leftY = [10, 8, 6, 4, 6, 8, 10, 8, 6]
    const timestamps = [0, 0.02, 0.04, 0.06, 0.08, 0.09, 0.1, 0.12, 0.14]
    const frames = leftY.map((y, i) =>
      buildFrame({ ...TORSO_POINTS, left_ankle: { x: 0, y } }, timestamps[i]),
    )

    const result = detectFootstrikes(frames, configWithRatio(0.03)) // 0.03 * 100 = 3

    expect(result).toEqual([{ frameIndex: 0, timestamp: 0, side: 'left' }])
  })

  it('combines both legs into a single timestamp-ordered list, not grouped/appended by side', () => {
    // Left ankle-y rises monotonically (max at the end, index 5); right ankle-y falls
    // monotonically (max at the start, index 0) -- mirror-image traces of the same "monotonic
    // rise" extrema.ts case, and a genuine antiphase pair, so each side's relative series peaks
    // exactly where that side's own ankle is lowest. Detection appends left's candidates before
    // right's internally, so the assertion on order below only holds if detectFootstrikes actually
    // re-sorts by timestamp afterward.
    const leftY = [0, 1, 2, 3, 4, 5]
    const rightY = [5, 4, 3, 2, 1, 0]
    const frames = leftY.map((y, i) =>
      buildFrame(
        { ...TORSO_POINTS, left_ankle: { x: 0, y }, right_ankle: { x: 0, y: rightY[i] } },
        i,
      ),
    )

    const result = detectFootstrikes(frames, configWithRatio(0.02)) // 0.02 * 100 = 2

    expect(result).toEqual([
      { frameIndex: 0, timestamp: 0, side: 'right' },
      { frameIndex: 5, timestamp: 5, side: 'left' },
    ])
  })

  it('scales the prominence threshold with footstrikeMinProminenceRatio * torsoLengthPx', () => {
    const leftY = [0, 1, 2, 3, 4, 5]
    const frames = leftY.map((y, i) => buildFrame({ ...TORSO_POINTS, left_ankle: { x: 0, y } }, i))

    // Same clip, same bump -- only the config's ratio changes. torsoLengthPx is fixed at 100, so
    // ratio 0.02 -> threshold 2 (bump clears it, as in the first test) but ratio 0.9 -> threshold
    // 90 (nothing in a 0-5px bump can clear that).
    expect(detectFootstrikes(frames, configWithRatio(0.02))).toHaveLength(1)
    expect(detectFootstrikes(frames, configWithRatio(0.9))).toEqual([])
  })

  it('returns an empty array when there is no resolvable body-scale reference', () => {
    const frame = buildFrame({ left_ankle: { x: 0, y: 500 }, right_ankle: { x: 0, y: 500 } })
    const frames = [frame, frame, frame]

    expect(detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)).toEqual([])
  })

  it('returns an empty array for an empty frame list', () => {
    expect(detectFootstrikes([], DEFAULT_HEURISTICS_CONFIG)).toEqual([])
  })

  it('on a realistic gait clip, returns strictly non-decreasing timestamps spanning both legs', () => {
    const frames = generateSyntheticGait({
      durationSec: 4,
      fps: 30,
      cadenceStepsPerMin: 170,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 5,
      view: 'side',
    })

    const result = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.length).toBeGreaterThanOrEqual(4)
    expect(result.some((c) => c.side === 'left')).toBe(true)
    expect(result.some((c) => c.side === 'right')).toBe(true)
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i].timestamp).toBeGreaterThanOrEqual(result[i - 1].timestamp)
    }
  })
})

describe('detectFootstrikes — ground contact vs. airborne ankle-y maxima', () => {
  /** A body that bounces 24% of torso length peak-to-peak (Demo 1's measured vertical oscillation
   * is 16.3%, so this is a bouncier-than-reference but entirely ordinary runner) and a swinging
   * foot that hangs near its apex until 85% of the cycle. */
  const TRAILING_LEG_SHAPE: GaitShape = { bounceHalfPx: 12, hangEnd: 0.85, toeOffLiftPx: 22 }
  /** The same geometry with the body's oscillation removed and the hang deleted, so each ankle's
   * raw screen y already has exactly one prominence-confirmed maximum per stride. */
  const CLEAN_SHAPE: GaitShape = { bounceHalfPx: 0, hangEnd: APEX, toeOffLiftPx: 22 }
  /** A perfectly flat stance plateau (no heel-off rise), the pessimistic case: nothing in the raw
   * ankle-y series orders touchdown against toe-off, so its argmax is decided by the scan's tie
   * handling rather than by the gait. */
  const FLAT_STANCE_SHAPE: GaitShape = { bounceHalfPx: 12, hangEnd: APEX, toeOffLiftPx: 0 }

  it('does not emit a trailing leg’s secondary ankle-y maximum as a footstrike', () => {
    const frames = buildGait(TRAILING_LEG_SHAPE)

    // The fixture really does contain the defect. The left ankle's RAW screen-y series carries a
    // prominence-confirmed maximum at t=0.80s — two thirds of the way through the left leg's
    // swing, while the RIGHT foot is in stance — 36px above the ground the left foot last touched.
    // No left footstrike happened there; the body descending into the other foot's stance faster
    // than the hanging left foot was rising is the whole of it. Three of them, one per stride.
    const airborneLeft = rawAnkleYMaxima(frames, 'left').filter(
      (extremum) => extremum.value < GROUND_Y - 30,
    )
    expect(airborneLeft.map((extremum) => Number(extremum.timestamp.toFixed(2)))).toEqual([
      0.8, 2.0, 3.2,
    ])

    // None of them survives, and every true contact does: 7 candidates, strictly alternating, each
    // within one sampled frame of its touchdown.
    expect(detectedFrames(frames)).toEqual([
      ['left', 1],
      ['right', 16],
      ['left', 31],
      ['right', 46],
      ['left', 61],
      ['right', 76],
      ['left', 90],
    ])
  })

  it('emits the contact ONSET, not the late-stance end of a flat stance plateau', () => {
    const frames = buildGait(FLAT_STANCE_SHAPE)

    // With a flat plateau the raw ankle-y series cannot order the frames within stance, and the
    // extremum scan reports the plateau's LAST frame: index 39, 9 frames (0.36s) after the
    // touchdown at index 30 that it belongs to. That is the same defect, and very nearly the same
    // magnitude, measured frame-by-frame on the Demo 1 track clip.
    const rawSecondStride = rawAnkleYMaxima(frames, 'left').filter(
      (extremum) => extremum.timestamp > 1 && extremum.timestamp < 2,
    )
    expect(rawSecondStride).toHaveLength(1)
    expect(rawSecondStride[0].index).toBe(39)

    // The same contact, now reported one frame after its onset instead of nine.
    expect(detectedFrames(frames)).toEqual([
      ['left', 1],
      ['right', 16],
      ['left', 31],
      ['right', 46],
      ['left', 61],
      ['right', 76],
      ['left', 90],
    ])
  })

  it('is unchanged on a clean signal with no secondary maxima', () => {
    const frames = buildGait(CLEAN_SHAPE)

    // Nothing to reject: with no body oscillation and no mid-swing hang, each ankle's raw screen-y
    // series has exactly one prominence-confirmed maximum per stride and every one of them is a
    // real contact.
    expect(rawAnkleYMaxima(frames, 'left')).toHaveLength(4)
    expect(rawAnkleYMaxima(frames, 'right')).toHaveLength(3)

    // Still one candidate per contact, still strictly alternating, still on the true contacts.
    // The two-frame offset (against one frame on the shapes above) is the estimator's only
    // systematic residual: the contralateral foot reaches its swing apex slightly AFTER this foot
    // touches down, so the differenced signal peaks slightly after touchdown too. It is bounded by
    // that phase offset and does not grow — bounded lateness is what distinguishes it from the
    // nine-frame plateau error above.
    expect(detectedFrames(frames)).toEqual([
      ['left', 2],
      ['right', 17],
      ['left', 32],
      ['right', 47],
      ['left', 62],
      ['right', 77],
      ['left', 90],
    ])
  })

  it('reports every candidate within two sampled frames of a true touchdown, on all three shapes', () => {
    for (const shape of [TRAILING_LEG_SHAPE, CLEAN_SHAPE, FLAT_STANCE_SHAPE]) {
      const detected = detectedFrames(buildGait(shape))
      expect(detected).toHaveLength(TRUE_CONTACT_FRAMES.length)
      detected.forEach(([side, frameIndex], i) => {
        const [trueSide, trueFrame] = TRUE_CONTACT_FRAMES[i]
        expect(side).toBe(trueSide)
        expect(Math.abs(frameIndex - trueFrame)).toBeLessThanOrEqual(2)
      })
    }
  })

  it('never reports a strike on the foot that is above the other one', () => {
    const frames = buildGait(TRAILING_LEG_SHAPE)

    for (const candidate of detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)) {
      const frame = frames[candidate.frameIndex]
      const striking = resolvePoint(frame, candidate.side === 'left' ? 'left_ankle' : 'right_ankle')!
      const other = resolvePoint(frame, candidate.side === 'left' ? 'right_ankle' : 'left_ankle')!
      expect(striking.y).toBeGreaterThanOrEqual(other.y)
    }
  })
})

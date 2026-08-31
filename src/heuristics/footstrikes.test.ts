import { describe, expect, it } from 'vitest'
import { detectFootstrikes, detectFootstrikesBetweenAnkles } from './footstrikes'
import { estimateBodyScale } from './bodyScale'
import { findLocalExtrema } from './extrema'
import { analyzeHipBounce } from './hipBounce'
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
/** Where heel-off begins as a fraction of stance, so a fixture with a different `stanceEnd` keeps
 * the same push-off shape rather than a differently-proportioned one. `0.2 / 0.35` — the default
 * pair, restated as a ratio, so `stanceEnd: STANCE_END` reproduces the original geometry exactly. */
const HEEL_OFF_FRACTION_OF_STANCE = HEEL_OFF_START / STANCE_END
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
  /** Phase of this foot's own cycle at which its swing reaches maximum height. Defaults to
   * `APEX`. Expressed relative to the OTHER foot's touchdown — which is half a stride earlier —
   * this is `apex - 0.5`, and that quantity is what sets the detector's phase error: see the
   * contralateral-apex test at the end of this file. Real runners vary it; a slow jogger's apex
   * comes later in the cycle than a sprinter's. */
  apex?: number
  /**
   * Phase of this foot's own cycle at which its stance ends (toe-off). Defaults to `STANCE_END`.
   * Expressed against a step — half a stride — this is `2 * stanceEnd`, and that quantity is what
   * sets the HIP-PHASE detector's residual: a single fitted sinusoid puts its inflection a quarter
   * period before its extremum, i.e. it assumes stance is exactly half a step, so the lag is
   * `(stance − T/2) / 2`. See the stance-sweep test at the end of this file. Real runners vary it;
   * duty factor (stance ÷ stride) runs roughly 0.25–0.35 in running, i.e. `stanceEnd` 0.25–0.35.
   */
  stanceEnd?: number
}

const wrapPhase = (phase: number) => phase - Math.floor(phase)

/** This shape's stance end, and the heel-off start that scales with it. */
const stanceEndOf = (shape: GaitShape) => shape.stanceEnd ?? STANCE_END
const heelOffStartOf = (shape: GaitShape) => stanceEndOf(shape) * HEEL_OFF_FRACTION_OF_STANCE

/**
 * The whole body's screen y. The `-stanceEnd/2` phase offset is the physical claim this fixture
 * makes and the one the hip-phase detector is measured against: the body is at its LOWEST (largest
 * image-y) at MIDSTANCE, halfway through this foot's own stance, and highest in mid-flight.
 */
function bodyY(phase: number, shape: GaitShape): number {
  return (
    HIP_BASE_Y +
    shape.bounceHalfPx * Math.cos(4 * Math.PI * (wrapPhase(phase) - stanceEndOf(shape) / 2))
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
 * This asymmetry — the body's bounce present in the swinging foot's screen position and absent from
 * the planted one's — is not a fixture quirk, and it cuts both ways. It is why a single ankle's raw
 * screen y is an unreliable footstrike signal, AND it is the reason differencing the two ankles
 * cannot remove the bounce either: subtraction only cancels a term both feet carry, and in running
 * exactly one of them ever does. `ARTIFACT_SHAPE` below turns that residual up until it produces a
 * second confirmed maximum inside a single stance.
 */
function ankleY(phase: number, shape: GaitShape): number {
  const p = wrapPhase(phase)
  const stanceEnd = stanceEndOf(shape)
  const heelOffStart = heelOffStartOf(shape)
  const stanceLift =
    p <= heelOffStart
      ? 0
      : shape.toeOffLiftPx *
        Math.sin((Math.PI / 2) * ((p - heelOffStart) / (stanceEnd - heelOffStart)))
  if (p <= stanceEnd) return GROUND_Y - stanceLift

  const relAtToeOff = GROUND_Y - shape.toeOffLiftPx - bodyY(stanceEnd, shape)
  const relAtContact = GROUND_Y - bodyY(0, shape)
  const apex = shape.apex ?? APEX
  const relAtApex = relAtContact - APEX_LIFT_PX

  if (p <= apex) {
    const rel =
      relAtApex +
      (relAtToeOff - relAtApex) * Math.cos((Math.PI / 2) * ((p - stanceEnd) / (apex - stanceEnd)))
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

/** The prominence-confirmed maxima of one side's CONTACT series — this ankle's y minus the other's,
 * the signal `detectFootstrikes` actually reads. Used to show what selection had to choose between,
 * never as the thing under test. */
function contactSeriesMaxima(frames: RobustPoseFrame[], side: 'left' | 'right') {
  const own = side === 'left' ? 'left_ankle' : 'right_ankle'
  const other = side === 'left' ? 'right_ankle' : 'left_ankle'
  const series = frames.map((frame) => {
    const a = resolvePoint(frame, own)
    const b = resolvePoint(frame, other)
    return a === null || b === null ? null : { t: frame.timestamp, v: a.y - b.y }
  })
  const minProminenceAbs = DEFAULT_HEURISTICS_CONFIG.footstrikeMinProminenceRatio * TORSO_PX
  return findLocalExtrema(series, minProminenceAbs).filter((extremum) => extremum.kind === 'max')
}

function detectedFrames(frames: RobustPoseFrame[]) {
  return detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG).map(
    (candidate) => [candidate.side, candidate.frameIndex] as [string, number],
  )
}

/**
 * The FALLBACK path alone, on the same clip — the ankle-difference detector, reached directly
 * rather than through `detectFootstrikes`.
 *
 * This is the only way to measure it on a fixture that HAS a bounce: with a fittable bounce present
 * the hip-phase path always wins, so the older path would otherwise be unreachable from exactly the
 * fixtures the comparison needs.
 */
function ankleOnlyFrames(frames: RobustPoseFrame[]) {
  const bodyScale = estimateBodyScale(frames)
  if (bodyScale === null) return []
  const { fit } = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)
  return detectFootstrikesBetweenAnkles(
    frames,
    DEFAULT_HEURISTICS_CONFIG,
    bodyScale.torsoLengthPx,
    fit,
  ).map((candidate) => [candidate.side, candidate.frameIndex] as [string, number])
}

/**
 * Each LEFT candidate's lag behind its own true touchdown, in sampled frames. Left touchdowns are
 * every `FRAMES_PER_STRIDE` frames from 0 by construction, so the nearest one is just the rounded
 * quotient.
 */
function leftLags(detected: Array<[string, number]>) {
  return detected
    .filter(([side]) => side === 'left')
    .map(
      ([, frameIndex]) =>
        frameIndex - Math.round(frameIndex / FRAMES_PER_STRIDE) * FRAMES_PER_STRIDE,
    )
}

describe('detectFootstrikes', () => {
  it('keeps only maxima (footstrikes), not minima, on the single-leg fallback series', () => {
    // extrema.ts's own hand-traced "monotonic rise" case (see extrema.test.ts) with a DESCENT
    // added: raw [0,1,2,3,4,5,4,0,0] at threshold 2 confirms min@index0, then max@index5 once the
    // series has fallen back past it -- only the max is a footstrike candidate.
    //
    // The descent is not decoration. The bare rise [0,1,2,3,4,5] put its maximum on the clip's
    // LAST frame, where `detectFootstrikes` now declines to emit at all: an instant with no frame
    // after it has no reversal to confirm it (`hasFramesEitherSide`). Padding makes the extremum a
    // genuinely CONFIRMED one, which is strictly better evidence for the property this test is
    // about -- that only maxima survive -- than the trailing pivot it used to assert on.
    //
    // The right ankle is left UNRESOLVABLE, which is what isolates the left side now that each
    // ankle is read relative to the other: with no opposite ankle anywhere in the clip there is no
    // contralateral reference, so `buildContactSeries` falls back to raw left ankle-y and this
    // trace means exactly what it says.
    const leftY = [0, 1, 2, 3, 4, 5, 4, 0, 0]
    const frames = leftY.map((y, i) => buildFrame({ ...TORSO_POINTS, left_ankle: { x: 0, y } }, i))

    const result = detectFootstrikes(frames, configWithRatio(0.02)) // 0.02 * 100 = 2

    expect(result).toEqual([{ frameIndex: 5, timestamp: 5, side: 'left' }])
  })

  it('drops a same-side candidate closer than footstrikeMinIntervalSeconds to the last kept one', () => {
    // extrema.test.ts's "hand-traced down-up-down" case with a LEADING RISE added:
    // [6,8,10,8,6,4,6,8,10,8,6] at threshold 3 confirms max@index2, min@index5, max@index8 -- two
    // maxima, i.e. two footstrike candidates before dedup, and both now sit in the series'
    // interior. The bare [10,8,6,4,6,8,10,8,6] put its first maximum on frame 0, where
    // `detectFootstrikes` no longer emits (`hasFramesEitherSide`), which would have left this test
    // asserting that dedup dropped a candidate no longer eligible to be kept in the first place.
    //
    // Timestamps are assigned independently of index/value (smoothing and extrema selection only
    // look at value order, never at timestamp), so the gap between the two maxima's timestamps can
    // be controlled precisely: index2 -> t=0.02, index8 -> t=0.12, a 0.1s gap well under the
    // default 0.25s minimum interval, so the second is dropped as a re-detection of the first
    // rather than a distinct footstrike. Right ankle unresolvable, as above.
    const leftY = [6, 8, 10, 8, 6, 4, 6, 8, 10, 8, 6]
    const timestamps = [0, 0.01, 0.02, 0.04, 0.06, 0.07, 0.08, 0.1, 0.12, 0.13, 0.14]
    const frames = leftY.map((y, i) =>
      buildFrame({ ...TORSO_POINTS, left_ankle: { x: 0, y } }, timestamps[i]),
    )

    const result = detectFootstrikes(frames, configWithRatio(0.03)) // 0.03 * 100 = 3

    expect(result).toEqual([{ frameIndex: 2, timestamp: 0.02, side: 'left' }])
  })

  it('combines both legs into a single timestamp-ordered list, not grouped/appended by side', () => {
    // Two antiphase triangle waves of period 6, so each side's relative series peaks exactly where
    // that side's own ankle is lowest. Left peaks at indices 3 and 9, right at index 6.
    //
    // The single monotone rise/fall pair this test used to carry (left [0..5], right [5..0]) put
    // BOTH of its maxima on a boundary frame -- index 5 for the left and index 0 for the right --
    // and `detectFootstrikes` no longer emits an instant with no frame on one side of it
    // (`hasFramesEitherSide`), so it detected nothing at all. That is unavoidable for a single
    // half-cycle: whichever side's series starts by falling has the extremum scan's phase-1
    // maximum at index 0 by construction. A cycle and a half gives each side one CONFIRMED
    // interior maximum, which is what this test wanted to sort in the first place.
    //
    // Detection appends BOTH of left's candidates before right's single one internally, so the
    // interleaved order asserted below (left, right, left) is reachable only if detectFootstrikes
    // actually re-sorts by timestamp afterward -- a stronger form of the same check.
    const leftY = [0, 2, 4, 6, 4, 2, 0, 2, 4, 6, 4, 2]
    const rightY = [6, 4, 2, 0, 2, 4, 6, 4, 2, 0, 2, 4]
    const frames = leftY.map((y, i) =>
      buildFrame(
        { ...TORSO_POINTS, left_ankle: { x: 0, y }, right_ankle: { x: 0, y: rightY[i] } },
        i,
      ),
    )

    const result = detectFootstrikes(frames, configWithRatio(0.02)) // 0.02 * 100 = 2

    expect(result).toEqual([
      { frameIndex: 3, timestamp: 3, side: 'left' },
      { frameIndex: 6, timestamp: 6, side: 'right' },
      { frameIndex: 9, timestamp: 9, side: 'left' },
    ])
  })

  it('scales the prominence threshold with footstrikeMinProminenceRatio * torsoLengthPx', () => {
    // The first test's padded trace, unchanged: its maximum has to be reachable at all before this
    // test can show a threshold suppressing it.
    const leftY = [0, 1, 2, 3, 4, 5, 4, 0, 0]
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
  /** The pessimistic case for the DIFFERENCED signal: a bouncier runner (36% of torso peak-to-peak)
   * and a long mid-swing hang, which together leave the contact series genuinely multi-modal
   * within a single stance. */
  const ARTIFACT_SHAPE: GaitShape = { bounceHalfPx: 18, hangEnd: 0.9, toeOffLiftPx: 22 }

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

    // None of them survives, and every true contact the fitted bounce has room for does: 6
    // candidates, strictly alternating, each within two sampled frames of its touchdown. The
    // seventh true contact sits on the clip's LAST frame, and the fitted cycle that would carry it
    // predicts a touchdown just past the sampled span, so there is no frame to snap it to — a
    // boundary effect of a clip that ends exactly on a contact, not a missed contact.
    expect(detectedFrames(frames)).toEqual([
      ['left', 1],
      ['right', 16],
      ['left', 31],
      ['right', 47],
      ['left', 62],
      ['right', 77],
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

    // The same contact, now reported one frame after its onset instead of nine — and reported from
    // the hip's own rhythm, which never looked at the plateau at all.
    expect(detectedFrames(frames)).toEqual([
      ['left', 1],
      ['right', 16],
      ['left', 31],
      ['right', 47],
      ['left', 62],
      ['right', 77],
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
    //
    // Six of the fixture's seven contacts, not all seven. The missing one is the closing left
    // touchdown, which `buildGait` deliberately places on the clip's LAST sampled frame — and
    // `detectFootstrikes` no longer emits an instant with no frame after it (`hasFramesEitherSide`).
    // That is the rule doing exactly what it is for rather than a detection failure: the fixture
    // knows by construction that the contact is real, and the CLIP contains no evidence of it, which
    // is the only thing the detector can read. The shapes with a fittable bounce lose the same
    // contact for a different reason (their fitted cycle predicts it just past the sampled span),
    // so every shape in this file now reports six.
    expect(detectedFrames(frames)).toEqual([
      ['left', 2],
      ['right', 17],
      ['left', 32],
      ['right', 47],
      ['left', 62],
      ['right', 77],
    ])
  })

  it('keeps the contact and drops the toe-off hump when the contact series itself is multi-modal', () => {
    // A bouncier runner (36% of torso peak-to-peak, deliberately beyond the 16-25% this repo has
    // measured on its own three clips) with a long mid-swing hang. Differencing the two ankles does
    // NOT remove the body's oscillation here, and cannot: during single support the planted foot
    // carries none of it and the swinging foot carries all of it, so the contact series inherits it
    // inverted and at full strength. Prominence is powerless against that — the bounce is several
    // times the gate — which is exactly why selection is by amplitude instead.
    const frames = buildGait(ARTIFACT_SHAPE)

    // Three prominence-confirmed maxima per stride on the left, where there is one contact:
    // the contact at frame 31, an artifact 10 frames later (one stance duration — the toe-off end
    // of the same stance, where the body has come back up), and a third that is NEGATIVE, meaning
    // the left foot was above the right and cannot have been the one on the ground.
    const secondStride = contactSeriesMaxima(frames, 'left').filter(
      (extremum) => extremum.index >= 30 && extremum.index < 60,
    )
    expect(secondStride.map((extremum) => extremum.index)).toEqual([31, 41, 53])
    expect(secondStride[0].value).toBeGreaterThan(secondStride[1].value)
    expect(secondStride[2].value).toBeLessThan(0)

    // Only the contacts survive, on BOTH paths, for two independent reasons.
    //
    // The fallback rejects the artifact on amplitude: it loses to the contact 0.40 s before it,
    // which is inside this clip's own shortest plausible stride (2 / 1.66 Hz / 1.15 = 1.05 s).
    expect(ankleOnlyFrames(frames)).toEqual([
      ['left', 0],
      ['right', 16],
      ['left', 31],
      ['right', 46],
      ['left', 61],
      ['right', 76],
      ['left', 90],
    ])

    // The shipped path never considers the artifact at all: it emits one instant per fitted bounce
    // cycle, so a second maximum inside one stance has nothing to win.
    expect(detectedFrames(frames)).toEqual([
      ['left', 1],
      ['right', 16],
      ['left', 31],
      ['right', 47],
      ['left', 62],
      ['right', 77],
    ])
  })

  it('falls back to the configured interval floor when the clip has no fittable step rhythm', () => {
    const frames = buildGait(CLEAN_SHAPE)

    // CLEAN_SHAPE has no body oscillation at all, so the hip trace is flat and the shared spectral
    // fit has nothing to lock onto. The rhythm-derived spacing floor is therefore unavailable and
    // `footstrikeMinIntervalSeconds` is what binds — the behaviour that predates the derived floor.
    // Asserted so the clean-signal test above is known to run on the FALLBACK path, not silently on
    // a rhythm that happened to resolve.
    //
    // One short of the fixture's contact count, for the boundary reason the clean-signal test above
    // spells out: the closing touchdown sits on the last sampled frame and is not eligible. The
    // count is what matters here — that every OTHER contact survived a floor which could in
    // principle have deduplicated them away.
    expect(analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG).fit.ok).toBe(false)
    expect(detectedFrames(frames)).toHaveLength(TRUE_CONTACT_FRAMES.length - 1)
  })

  it('reports every candidate within two sampled frames of a true touchdown, on all four shapes', () => {
    for (const shape of [TRAILING_LEG_SHAPE, CLEAN_SHAPE, FLAT_STANCE_SHAPE, ARTIFACT_SHAPE]) {
      const detected = detectedFrames(buildGait(shape))
      // A prefix of the true contacts rather than all of them: the hip-phase path predicts one
      // touchdown per fitted bounce cycle, and the cycle carrying the clip's final contact lands
      // just past the sampled span on the three shapes that have a bounce to fit. Nothing spurious
      // is added and nothing in the interior is missed — only the trailing boundary differs.
      expect(detected.length).toBeGreaterThanOrEqual(TRUE_CONTACT_FRAMES.length - 1)
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

describe('detectFootstrikes — timing derived from the fitted bounce phase', () => {
  const SHAPE = { bounceHalfPx: 12, hangEnd: 0.85, toeOffLiftPx: 22 }

  it('places each instant a quarter fitted period before a fitted low point, one per bounce cycle', () => {
    const frames = buildGait(SHAPE, 4)
    const { fit } = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(fit.ok).toBe(true)
    if (!fit.ok) return

    // `analyzeHipBounce` fits raw image-y, which grows DOWNWARD, so the fitted MAXIMUM is the
    // runner's LOWEST point. Touchdown is the inflection a quarter period before it.
    const period = 1 / fit.frequencyHz
    const omega = 2 * Math.PI * fit.frequencyHz
    const firstLowest = fit.tMeanSeconds + (Math.PI / 2 - fit.phaseRadians) / omega
    const nearestPredicted = (t: number) => {
      const k = Math.round((t - (firstLowest - period / 4)) / period)
      return firstLowest - period / 4 + k * period
    }

    const candidates = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    // Half the median frame interval — the snap tolerance, so "within it" means the instant landed
    // on the nearest frame there was rather than merely somewhere nearby.
    const tolerance = 1 / FPS / 2
    for (const candidate of candidates) {
      expect(Math.abs(candidate.timestamp - nearestPredicted(candidate.timestamp))).toBeLessThanOrEqual(
        tolerance,
      )
    }

    // One per bounce cycle inside the span, and the hip bounces once per STEP — so consecutive
    // instants are one step apart and consecutive SAME-SIDE instants are one stride apart, by
    // construction rather than by a spacing rule.
    const span = frames[frames.length - 1].timestamp - frames[0].timestamp
    expect(candidates.length).toBeGreaterThanOrEqual(Math.floor(span / period) - 1)
    expect(candidates.length).toBeLessThanOrEqual(Math.floor(span / period) + 1)
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i].side).not.toBe(candidates[i - 1].side)
      expect(candidates[i].timestamp - candidates[i - 1].timestamp).toBeCloseTo(period, 1)
    }
  })

  it('names the feet by alternation, and one swapped instant cannot flip the assignment', () => {
    const frames = buildGait(SHAPE, 4)
    const baseline = detectedFrames(frames)

    // A stride is two steps, one per foot, so consecutive touchdowns alternate. The instants are
    // one step apart by construction, so this must hold for every emitted pair.
    for (let i = 1; i < baseline.length; i += 1) {
      expect(baseline[i][0]).not.toBe(baseline[i - 1][0])
    }

    // Swap the two ankles' vertical positions at the FIRST emitted instant — the failure MoveNet
    // actually produces on side-view footage, where the legs cross and occlude every step. Read
    // per-instant, that frame now names the wrong foot. Read as one magnitude-weighted vote across
    // every instant, it is outvoted and nothing moves.
    const swapAt = baseline[0][1]
    const swapped: RobustPoseFrame[] = frames.map((frame, index) => {
      if (index !== swapAt) return frame
      const left = frame.keypoints.find((k) => k.name === 'left_ankle')!
      const right = frame.keypoints.find((k) => k.name === 'right_ankle')!
      return {
        ...frame,
        keypoints: frame.keypoints.map((k) =>
          k.name === 'left_ankle'
            ? { ...k, y: right.y }
            : k.name === 'right_ankle'
              ? { ...k, y: left.y }
              : k,
        ),
      }
    })

    expect(detectedFrames(swapped)).toEqual(baseline)
  })

  it('falls back to the ankle detector when the fit clears its bar but no instant can be attributed', () => {
    // A bouncing body — so the hip fit resolves and clears cadence's bar — but the right ankle is
    // unresolvable in every frame, so no predicted instant contributes any evidence about which
    // foot is which and the parity vote sums to exactly zero. The phase path emits nothing and the
    // clip keeps exactly the single-leg behaviour it had before that path existed.
    const full = buildGait(SHAPE, 4)
    const frames: RobustPoseFrame[] = full.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((keypoint) =>
        keypoint.name === 'right_ankle'
          ? { ...keypoint, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : keypoint,
      ),
    }))

    const { fit } = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(fit.ok && fit.sinusoidR2 >= DEFAULT_HEURISTICS_CONFIG.cadenceMinFitR2).toBe(true)

    // The reference is the ankle detector's own output with the SAME boundary-eligibility rule
    // applied to it, not its raw output. Eligibility is applied once, in `detectFootstrikes`, to
    // whichever path won — so comparing against the raw list would be asserting that the fallback
    // is exempt from a rule the spec states for both paths. What this test is about, and still
    // tests, is the fallback CONDITION: an attributable-instant failure hands the clip to the ankle
    // detector rather than to an empty list.
    const bodyScale = estimateBodyScale(frames)!
    expect(detectedFrames(frames)).toEqual(
      detectFootstrikesBetweenAnkles(
        frames,
        DEFAULT_HEURISTICS_CONFIG,
        bodyScale.torsoLengthPx,
        fit,
      )
        .filter(
          (candidate) =>
            candidate.frameIndex > 0 && candidate.frameIndex < frames.length - 1,
        )
        .map((candidate) => [candidate.side, candidate.frameIndex]),
    )
    expect(detectedFrames(frames).length).toBeGreaterThan(0)
    expect(detectedFrames(frames).every(([side]) => side === 'left')).toBe(true)
  })

  it('emits no instant for a bounce cycle that falls in a sampling gap', () => {
    const full = buildGait(SHAPE, 4)
    // Drop a contiguous run of frames spanning more than a full step, leaving the fit intact (the
    // spectral fit contributes no equations for a gap rather than inventing samples across it) but
    // leaving one predicted touchdown with no frame inside the snap tolerance.
    const gapStart = 45
    const gapEnd = 62
    const frames = full.filter((_, index) => index < gapStart || index > gapEnd)

    const candidates = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    const gapOpens = full[gapStart - 1].timestamp
    const gapCloses = full[gapEnd + 1].timestamp
    for (const candidate of candidates) {
      expect(
        candidate.timestamp <= gapOpens || candidate.timestamp >= gapCloses,
      ).toBe(true)
    }
    // And nothing was snapped onto the frames bracketing the hole, which is what a missing
    // tolerance check would have produced.
    const bracketing = candidates.filter(
      (candidate) => candidate.timestamp === gapOpens || candidate.timestamp === gapCloses,
    )
    expect(bracketing).toHaveLength(0)
  })
})

describe('detectFootstrikes — what each path’s phase residual is a function of', () => {
  const SWING_SHAPE = { bounceHalfPx: 12, hangEnd: 0.9, toeOffLiftPx: 22 }

  /**
   * **The acceptance evidence for moving footstrike timing onto the hip-bounce phase.** Both paths,
   * the same five fixtures, the same measurement.
   *
   * The ankle-difference path reports the maximum of `y_S − y_opposite`, and with S planted that
   * instant is decided entirely by the other ankle: it is the CONTRALATERAL FOOT'S SWING APEX. The
   * contralateral foot touched down half a stride earlier, so its apex falls `apex − 0.5` of a
   * stride after this foot's touchdown, and the emitted lag tracks that one for one — 1 frame to 11
   * across ordinary swing mechanics, 0.04 s to 0.44 s at 25 fps, WIDER THAN A WHOLE STANCE PHASE.
   * No single offset can be right for all five rows, which is why none is applied to it.
   *
   * The hip-phase path does not read the swinging foot at all. Its instants come from the fitted
   * bounce's inflections, so the same sweep moves them by NOTHING.
   */
  it('the ankle path tracks the contralateral swing apex; the hip-phase path does not move at all', () => {
    const apexes = [0.55, 0.6, 0.65, 0.69, 0.75]
    const clips = apexes.map((apex) => buildGait({ ...SWING_SHAPE, apex }, 4))

    // One lag per apex, repeated on every stride — the residual is systematic within a clip, not
    // noise. (The clip's closing frame is a touchdown by construction, so a zero lag there is the
    // boundary, not a sixth value.)
    const ankleLags = clips.map((frames) => [
      ...new Set(leftLags(ankleOnlyFrames(frames)).filter((lag) => lag !== 0)),
    ])
    for (const lags of ankleLags) expect(lags).toHaveLength(1)
    expect(ankleLags.map(([only]) => only)).toEqual([1, 3, 5, 6, 11])

    // Demo 1's measured +0.24 s is 6 frames at 25 fps — the `apex = 0.69` row, a slow jogger's late
    // swing apex. The spread across the five rows is 10 frames, which is what a constant offset
    // would have to be simultaneously right about.
    const ankleSpread = Math.max(...ankleLags.flat()) - Math.min(...ankleLags.flat())
    expect(ankleSpread).toBe(10)

    // The same five clips through the shipped detector: every row identical, spread zero. The
    // 1-to-2 drift WITHIN each row is the frequency grid (1.66 Hz fitted against this fixture's
    // 1.667 Hz true step rate, accumulating ~0.4 frames over four strides) plus integer frame
    // snapping — it is present in every row equally and is not a function of the apex.
    const phaseLags = clips.map((frames) => leftLags(detectedFrames(frames)))
    for (const lags of phaseLags) expect(lags).toEqual(phaseLags[0])
    expect(phaseLags[0]).toEqual([1, 1, 2, 2])
  })

  /**
   * The hip-phase path's OWN residual, and the closed form for it.
   *
   * A single fitted sinusoid puts its inflection exactly a quarter period before its extremum, i.e.
   * it assumes stance lasts exactly half a step. Real stance is longer, so the model lands late by
   * half the excess:
   *
   * ```
   * lag = stance/2 − T/4 = (stance − T/2) / 2
   * ```
   *
   * In this fixture's units a step is half a stride, so with `stanceEnd` in stride units the lag is
   * `(stanceEnd − 0.25) / 2` of a stride. That is the whole of design D3's error budget, and it is
   * what makes weakness 2 ("a single sinusoid forces stance = flight") a measured quantity rather
   * than a worry.
   *
   * The ankle path's residual does NOT track stance — its lag is set by the swing apex, which this
   * sweep holds fixed. The two tests together are the point: each path's error is a function of a
   * different thing, and only one of those things is bounded.
   */
  it('the hip-phase path’s lag follows (stance − halfStep) / 2; the ankle path’s does not', () => {
    const stanceEnds = [0.25, 0.28, 0.3, 0.32, 0.35]
    const clips = stanceEnds.map((stanceEnd) => buildGait({ ...SWING_SHAPE, stanceEnd }, 4))

    // Predicted, from the formula alone, in sampled frames.
    const predicted = stanceEnds.map((stanceEnd) => ((stanceEnd - 0.25) / 2) * FRAMES_PER_STRIDE)
    expect(predicted.map((p) => Number(p.toFixed(2)))).toEqual([0, 0.45, 0.75, 1.05, 1.5])

    // Measured. Every emitted instant is within one frame of its own prediction — the residual is
    // the formula, snapped to the frame grid.
    const measured = clips.map((frames) => leftLags(detectedFrames(frames)))
    measured.forEach((lags, i) => {
      for (const lag of lags) expect(Math.abs(lag - predicted[i])).toBeLessThanOrEqual(1)
    })

    // And it is monotone in stance: a longer stance is later, never earlier.
    const medians = measured.map((lags) => [...lags].sort((a, b) => a - b)[lags.length >> 1])
    for (let i = 1; i < medians.length; i += 1) {
      expect(medians[i]).toBeGreaterThanOrEqual(medians[i - 1])
    }
    expect(medians[medians.length - 1]).toBeGreaterThan(medians[0])

    // The ankle path is blind to this sweep — its lag is set by the swing apex, held fixed here.
    const ankleMedians = clips.map((frames) => {
      const lags = leftLags(ankleOnlyFrames(frames))
      return [...lags].sort((a, b) => a - b)[lags.length >> 1]
    })
    expect(new Set(ankleMedians).size).toBe(1)
  })

  /**
   * The hip-phase path reads NOTHING about the swinging foot's shape. Three fixtures that differ
   * only in swing-hang length and push-off lift — the three that make the ankle-difference signal
   * hard — produce byte-identical instants.
   */
  it('is unaffected by swing-hang length and toe-off lift, which the ankle path is not', () => {
    const shapes = [
      { bounceHalfPx: 12, hangEnd: 0.85, toeOffLiftPx: 22 },
      { bounceHalfPx: 12, hangEnd: APEX, toeOffLiftPx: 0 },
      { bounceHalfPx: 18, hangEnd: 0.9, toeOffLiftPx: 22 },
    ]
    const detected = shapes.map((shape) => detectedFrames(buildGait(shape)))
    for (const frames of detected) expect(frames).toEqual(detected[0])

    // The ankle path is not identical across the same three — its first instant moves.
    const ankle = shapes.map((shape) => ankleOnlyFrames(buildGait(shape)))
    expect(ankle.some((frames) => JSON.stringify(frames) !== JSON.stringify(ankle[0]))).toBe(true)
  })
})


describe('detectFootstrikes — a candidate needs a sampled frame on both sides of it', () => {
  /**
   * The single-leg fallback series (right ankle unresolvable everywhere, so `buildContactSeries`
   * reads raw left ankle-y), with a confirmed maximum at index 5 and a TRAILING pivot on the final
   * frame at index 10 — the higher of the two, so amplitude-ranked selection reaches it first.
   * That is the exact shape measured on Demo 2's background scale pass, which emitted the clip's
   * last frame at ratio +1.38051 against a primary-pass maximum of +0.37568.
   */
  const TRAILING_BOUNDARY_Y = [0, 10, 20, 30, 40, 50, 40, 0, 0, 30, 60]
  /** The mirror image: the extremum scan's phase 1 emits a maximum at index 0 for any series that
   * begins by falling, so a clip that opens mid-descent hands one out for free. Confirmed interior
   * maximum at index 8. */
  const LEADING_BOUNDARY_Y = [60, 30, 0, 0, 10, 20, 30, 40, 50, 40, 0, 0]
  /** Amplitudes are in tens because these run at the DEFAULT prominence ratio (0.05 of a 100px
   * torso = 5px), not the eased ratio the traces at the top of this file use — the fallback path
   * has to be reachable through `detectFootstrikes` and through `ankleOnlyFrames` under one config
   * for the two to be comparable at all. */

  const singleLegFrames = (values: number[]) =>
    values.map((y, i) => buildFrame({ ...TORSO_POINTS, left_ankle: { x: 0, y } }, i))

  it('does not emit a candidate on the last sampled frame, and leaves the interior untouched', () => {
    const frames = singleLegFrames(TRAILING_BOUNDARY_Y)

    // The fixture really does contain the defect: read straight off the ankle detector, with no
    // eligibility applied, the final frame IS emitted — and it outranks the real contact.
    expect(ankleOnlyFrames(frames)).toEqual([
      ['left', 5],
      ['left', 10],
    ])

    expect(detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)).toEqual([
      { frameIndex: 5, timestamp: 5, side: 'left' },
    ])
  })

  it('does not emit a candidate on the first sampled frame either', () => {
    const frames = singleLegFrames(LEADING_BOUNDARY_Y)

    expect(ankleOnlyFrames(frames)).toEqual([
      ['left', 0],
      ['left', 8],
    ])

    expect(detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)).toEqual([
      { frameIndex: 8, timestamp: 8, side: 'left' },
    ])
  })

  it('emits nothing at all when every candidate is a boundary candidate', () => {
    // The bare monotonic rise this file's first test used to run on: its only prominence-confirmed
    // maximum is the trailing pivot on the final frame. Nothing here is a contact this clip can
    // evidence, and the honest answer is an empty list rather than the one instant the series
    // happened to end on.
    const frames = singleLegFrames([0, 10, 20, 30, 40, 50])

    expect(ankleOnlyFrames(frames)).toEqual([['left', 5]])
    expect(detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)).toEqual([])
  })

  it('applies the identical rule to the phase path, which reaches a boundary for its own reason', () => {
    // The fallback lands on a boundary BY CONSTRUCTION — `findLocalExtrema` emits an unconfirmed
    // trailing pivot at the end of every run. The phase path lands there only by coincidence, when
    // the fitted phase happens to put a predicted touchdown within half a frame of an end. Both are
    // excluded, because the rule is applied once to whichever path won rather than inside either.
    //
    // A 30fps synthetic clip sliced to 70 frames is such a coincidence: its own fit predicts a
    // touchdown on frame 69, the last one.
    const full = generateSyntheticGait({
      durationSec: 4,
      fps: 30,
      cadenceStepsPerMin: 170,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 5,
      view: 'side',
    })
    const frames = full.slice(0, 70)
    const lastIndex = frames.length - 1

    // The phase path is what runs here, and it really does predict an instant on the final frame —
    // recomputed from the fit rather than assumed, so this cannot degrade into "some other stage
    // dropped it".
    const { fit } = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(fit.ok && fit.sinusoidR2 >= DEFAULT_HEURISTICS_CONFIG.cadenceMinFitR2).toBe(true)
    if (!fit.ok) return
    const period = 1 / fit.frequencyHz
    const omega = 2 * Math.PI * fit.frequencyHz
    const firstTouchdown =
      fit.tMeanSeconds + (Math.PI / 2 - fit.phaseRadians) / omega - period / 4
    const lastTimestamp = frames[lastIndex].timestamp
    const k = Math.round((lastTimestamp - firstTouchdown) / period)
    expect(Math.abs(firstTouchdown + k * period - lastTimestamp)).toBeLessThanOrEqual(1 / 30 / 2)

    // Six instants, none of them the seventh the fit predicted on the boundary.
    const emitted = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(emitted.map((candidate) => candidate.frameIndex)).toEqual([5, 16, 26, 37, 48, 58])
    expect(emitted.some((candidate) => candidate.frameIndex === lastIndex)).toBe(false)
  })

  it('never emits either boundary, whichever path runs and however the clip is cut', () => {
    // The invariant, swept rather than argued: every prefix of a real gait clip long enough to
    // detect anything, across slice lengths that move the fitted phase through several cycles.
    const full = generateSyntheticGait({
      durationSec: 4,
      fps: 30,
      cadenceStepsPerMin: 170,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 5,
      view: 'side',
    })
    let sawCandidates = false
    for (let end = 45; end <= full.length; end += 1) {
      const frames = full.slice(0, end)
      const emitted = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
      if (emitted.length > 0) sawCandidates = true
      for (const candidate of emitted) {
        expect(candidate.frameIndex).toBeGreaterThan(0)
        expect(candidate.frameIndex).toBeLessThan(frames.length - 1)
      }
    }
    expect(sawCandidates).toBe(true)
  })
})

/// <reference types="node" />
// The `module hygiene` block at the bottom reads this module's own source off disk, so it opts
// into Node's ambient types locally the same way `mp4Demux.test.ts` does — `tsconfig.app.json`'s
// `types` is deliberately just `vite/client`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { BoundingBoxPx } from '../pose/backends/movenetCrop'
import { computeBoundingBoxIoU, computeCropRect } from '../pose/backends/movenetCrop'
import type { VideoMetadata } from '../video/types'
import { buildFrame } from '../heuristics/__fixtures__/testFrames'
import {
  MAX_EXEMPLARS_PER_METRIC,
  MIN_EXEMPLAR_QUALITY,
} from '../heuristics/exemplars'
import { estimateBodyScale } from '../heuristics/bodyScale'
import { estimateTravelDirection } from '../heuristics/travelDirection'
import { trimToPresenceWindow } from '../heuristics/presenceWindow'
import type {
  FormHeuristicsResult,
  MetricExemplar,
  MetricExemplarKind,
  MetricId,
  MetricResult,
  VerticalOscillationCmResult,
  VerticalOscillationResult,
} from '../heuristics/types'
import { findNearestFrame } from './skeletonGeometry'
import {
  EVIDENCE_BASE_OPACITY,
  EVIDENCE_CROP_MIN_SIDE_PX,
  EVIDENCE_CROP_PADDING_MULTIPLIER,
  EVIDENCE_GHOST_BLEND_ALPHA,
  EVIDENCE_GHOST_MARK_OPACITY,
  EVIDENCE_MAX_PAIR_CROP_GROWTH,
  EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS,
  EVIDENCE_NEAR_IDENTICAL_IOU,
  boundingBoxOfPoints,
  computeEvidenceCropRect,
  evidenceOutputSide,
  evidenceCropPaddedSide,
  evidenceFocusOffset,
  evidenceCropSideDemand,
  focusAimedCropRect,
  frameSubjectExtentBox,
  subjectCentredCropRect,
  evidencePairCropGrowth,
  evidenceSnapToleranceSeconds,
  evidenceTravelDirection,
  frameCropBox,
  isNearIdenticalPair,
  isTooCloseInTimePair,
  isTooFarApartPair,
  planClipEvidence,
  planExemplarFrames,
  planExemplarWithFallback,
  planMetricEvidence,
  resolveExemplarFrames,
  resolveInstantAnnotationKeypoints,
  resolveInstantKeypoints,
  resolveInstantSide,
  resolveOutwardSigns,
  snapToSampledFrame,
  summarizeEvidenceCoverage,
  toEvidenceOutputSpace,
} from './evidenceFrames'
import type {
  ClipEvidencePlan,
  EvidenceFrameSize,
  EvidenceUnavailableReason,
} from './evidenceFrames'

const HD: EvidenceFrameSize = { width: 1920, height: 1080 }
/** Both demo clips are 4K, and every crop rect is in native pixels — so the padding/floor math has
 * to be exercised at that scale, not only at 1080p. */
const UHD: EvidenceFrameSize = { width: 3840, height: 2160 }

const HIP_SEED = ['left_hip', 'right_hip'] as const

/** A frame carrying a hip pair centred on `(x, y)` and `width` px apart, so the box a crop is
 * derived from is exactly known. */
function hipFrame(
  timestamp: number,
  x: number,
  y: number,
  width = 100,
  overrides: Parameters<typeof buildFrame>[0] = {},
): RobustPoseFrame {
  return buildFrame(
    {
      left_hip: { x: x - width / 2, y },
      right_hip: { x: x + width / 2, y },
      ...overrides,
    },
    timestamp,
  )
}

/**
 * Two hip frames far enough apart to be unmistakably two positions and close enough that
 * `isTooFarApartPair` does not reject them — the band every paired-plan test below needs, and one
 * that is easy to wander out of by accident, since none of those tests is about separation.
 *
 * The arithmetic, so a future edit can stay inside it: `hipFrame`'s default pair is 100 px wide, so
 * two of them `s` px apart union to `100 + s`, and against a solo crop pinned at the 320 px floor
 * the growth is `max((100 + s) × 1.6, 320) / 320`. `EVIDENCE_MAX_PAIR_CROP_GROWTH` = 2.5 therefore
 * bites at exactly `s = 400`; these sit at `s = 200`, growth 1.5, with the two boxes still a full
 * box-width clear of each other (IoU 0, so they are not near-identical either).
 */
function separatedPair(ghostY: number): RobustPoseFrame[] {
  return [hipFrame(0, 500, 540), hipFrame(0.4, 700, ghostY)]
}

/**
 * Two frames carrying BOTH legs, so a mixed-foot pair's two annotation sets can be told apart by
 * which limb they name rather than only by which names are missing.
 *
 * Stays inside `separatedPair`'s band: each frame's own box is 100x240 (padded 384, above the
 * 320 px floor) and the union is 250x240 (padded 400), so the growth is ~1.04 — far under
 * `EVIDENCE_MAX_PAIR_CROP_GROWTH`, with the two boxes not overlapping at all so the pair is not
 * near-identical either.
 *
 * **Duplicated verbatim in `evidenceAnnotations.test.ts`**, which needs the same two frames to
 * drive the real planner. That copy does not restate the arithmetic above, so an edit to these
 * coordinates has to be carried across by hand — otherwise the other file's fixture can drift out
 * of the guard's band while every assertion in this one still passes.
 */
function leggedFrame(timestamp: number, x: number): RobustPoseFrame {
  return buildFrame(
    {
      left_hip: { x: x - 50, y: 500 },
      right_hip: { x: x + 50, y: 500 },
      left_knee: { x: x - 40, y: 620 },
      right_knee: { x: x + 40, y: 620 },
      left_ankle: { x: x - 30, y: 740 },
      right_ankle: { x: x + 30, y: 740 },
    },
    timestamp,
  )
}

const LEGGED_PAIR: RobustPoseFrame[] = [leggedFrame(0, 500), leggedFrame(0.4, 650)]

/**
 * The pair `overstriding` calls "the usual case" — a furthest-reaching strike on one foot ghosted
 * against a closest-landing one on the other, so `side` is absent and the two per-instant sets are
 * the only carriers of which limb each half is about. Hand-built rather than driven through
 * `computeOverstriding`, for the reason `overstriding.test.ts` records: no offset series reaches a
 * mixed-foot exemplar through that metric's own quality gate.
 */
const MIXED_FOOT_OVERSTRIDE: MetricExemplar = {
  kind: 'overstrideRange',
  timestamp: 0,
  pairedTimestamp: 0.4,
  measuredSide: 'left',
  pairedMeasuredSide: 'right',
  quality: 0.9,
  label: 'test exemplar',
  cropKeypoints: [
    'left_ankle',
    'left_hip',
    'right_hip',
    'right_ankle',
    'left_knee',
    'right_knee',
  ],
  annotationKeypoints: ['left_ankle', 'left_hip', 'right_hip', 'left_knee'],
  pairedAnnotationKeypoints: [
    'right_ankle',
    'left_hip',
    'right_hip',
    'right_knee',
  ],
}

/**
 * A 0.1 s grid whose subject moves 80 px per sample, so a pair's separation — and therefore
 * whether `isTooFarApartPair` rejects it — is a pure function of how many samples apart its two
 * instants are chosen. That is what a fallback test needs: one exemplar's worth of instants where
 * some pairings are drawable and others are not.
 *
 * The arithmetic, so a future edit can stay inside it: two default 100 px-wide hip boxes `s` px
 * apart union to `100 + s`, and against a solo crop pinned at the 320 px floor the growth is
 * `max((100 + s) × 1.6, 320) / 320`. FOUR samples apart (`s` = 320) reads 2.1 and is drawn; FIVE
 * (`s` = 400) reads exactly 2.5 and is rejected, `EVIDENCE_MAX_PAIR_CROP_GROWTH` being inclusive;
 * six reads 2.9. The 5 px of vertical drift per sample keeps the boxes from being byte-identical
 * in shape without materially moving any of those numbers.
 *
 * **Four samples is the tightest drawable pairing on purpose** (`strides-r41`): the grid's median
 * interval is 0.1 s, so `EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS` puts the near floor at three
 * samples, and a fixture whose "drawable" case sat one or two samples apart would be collapsed by
 * that floor before the far-apart guard it is meant to exercise ever ran. Spacing was reduced from
 * 200 px to 80 px per sample to buy that room while keeping the 2.5 boundary landing exactly on a
 * sample.
 */
function crossingFrames(): RobustPoseFrame[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) =>
    hipFrame(Number((i * 0.1).toFixed(2)), 500 + i * 80, 540 + i * 5),
  )
}

/**
 * A frame whose hip pair spans a real 100×100 box with its top-left corner at `(x, y)` — the
 * shape an IoU comparison needs. `hipFrame`'s pair sits at one height, which is a legitimate real
 * shape but a zero-AREA box, and IoU says nothing about those.
 */
function boxFrame(timestamp: number, x: number, y: number): RobustPoseFrame {
  return buildFrame(
    { left_hip: { x, y }, right_hip: { x: x + 100, y: y + 100 } },
    timestamp,
  )
}

/**
 * A 0.1 s sampling grid — median interval 0.1, so the snap tolerance is 0.05 — with the subject
 * travelling 40 px per sample. The motion matters: two frames whose crop boxes are identical are a
 * near-identical pair by construction, so a stationary fixture would demote or drop every pair
 * built on it.
 */
function sampledFrames(count = 11): RobustPoseFrame[] {
  return Array.from({ length: count }, (_, i) =>
    boxFrame(Number((i * 0.1).toFixed(2)), 500 + i * 40, 440),
  )
}

/**
 * `sampledFrames`, but carrying shoulders as well as hips, so a travel direction is actually
 * derivable from it.
 *
 * `boxFrame` carries hips ONLY. `trimToPresenceWindow` requires shoulder-mid AND hip-mid, so it
 * returns an empty window on that fixture, `estimateBodyScale` is then null, and
 * `evidenceTravelDirection` is `0` on every path. A test that asserts a threaded direction against
 * `sampledFrames()` therefore asserts `0 === 0` and passes just as well against an implementation
 * that hardcodes zero, or that recomputes the direction independently per metric. Use this fixture
 * whenever the direction itself is what is under test.
 *
 * Default step of 40 px/sample over 11 samples is 400 px of travel against a 200 px torso — four
 * times the half-torso threshold, so the sign is unambiguous. Pass a negative step to travel the
 * other way (timestamps stay ascending, which reversing the array would not).
 */
function travellingFrames(count = 11, stepPx = 40): RobustPoseFrame[] {
  return Array.from({ length: count }, (_, i) => {
    const x = 500 + i * stepPx
    return buildFrame(
      {
        left_shoulder: { x: x - 50, y: 300 },
        right_shoulder: { x: x + 50, y: 300 },
        left_hip: { x: x - 50, y: 500 },
        right_hip: { x: x + 50, y: 500 },
      },
      Number((i * 0.1).toFixed(2)),
    )
  })
}

function exemplar(overrides: Partial<MetricExemplar> = {}): MetricExemplar {
  return {
    kind: 'trunkLeanRange',
    timestamp: 0.5,
    quality: 0.9,
    label: 'test exemplar',
    cropKeypoints: [...HIP_SEED],
    ...overrides,
  }
}

function metricResult(
  metric: MetricId,
  overrides: Partial<MetricResult> = {},
): MetricResult {
  return {
    metric,
    value: 1,
    unit: 'ratio',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 8,
    caveat: null,
    ...overrides,
  }
}

/**
 * A full `FormHeuristicsResult`. `series`/`fit`/`calibration` are the two richer results' own
 * extra fields; this module reads none of them, so they carry their empty shapes.
 */
function heuristicsResult(
  overrides: Partial<Record<MetricId, Partial<MetricResult>>> = {},
): FormHeuristicsResult {
  const of = (metric: MetricId) => metricResult(metric, overrides[metric])
  return {
    view: {
      view: 'side',
      plausibility: { side: 1, front: 0, ambiguous: 0 },
      confidence: 1,
      diagnostics: {
        bilateralSpreadRatio: 0.1,
        sagittalExcursionRatio: 1,
        sagittalExcursionSampleCount: { left: 30, right: 30 },
        sagittalExcursionInterpolatedFraction: { left: 0, right: 0 },
        frameCoverage: 1,
      },
    },
    verticalOscillation: {
      ...of('verticalOscillation'),
      metric: 'verticalOscillation',
      series: [],
      fit: null,
    } as VerticalOscillationResult,
    verticalRatio: of('verticalRatio'),
    verticalOscillationCm: {
      ...of('verticalOscillationCm'),
      metric: 'verticalOscillationCm',
      calibration: null,
    } as VerticalOscillationCmResult,
    trunkLean: of('trunkLean'),
    overstriding: of('overstriding'),
    cadence: of('cadence'),
    kneeFlexion: of('kneeFlexion'),
    footStrikePattern: of('footStrikePattern'),
    stepWidth: of('stepWidth'),
    stepWidthCm: of('stepWidthCm'),
    kneeDrive: of('kneeDrive'),
    armSwingAmplitude: of('armSwingAmplitude'),
  }
}

function planOf(
  metric: MetricResult,
  frames: RobustPoseFrame[],
  frameSize: EvidenceFrameSize = HD,
) {
  return planMetricEvidence(metric, frames, frameSize)
}

function reasonOf(plan: ReturnType<typeof planMetricEvidence>): string | null {
  return plan.status === 'no-evidence' ? plan.reason : null
}

describe('EVIDENCE_GHOST_BLEND_ALPHA', () => {
  // Both bounds the constant's own doc declares, asserted rather than described. The split exists so
  // the photographic weight and the mark opacity can move independently — which is exactly the
  // condition under which the relationship between them needs a test and not a comment.
  it('stays below the ghost mark opacity, so the photograph is fainter than the marks on it', () => {
    expect(EVIDENCE_GHOST_BLEND_ALPHA).toBeLessThan(EVIDENCE_GHOST_MARK_OPACITY)
  })

  // The floor, from measurement rather than taste: the sweep rendered 0.25 on all three test clips
  // and the ghost disappeared into the background on the lowest-contrast one, leaving a faded
  // skeleton over nothing — the reported bug wearing the other shoe. The true floor is a function of
  // each clip's subject-against-background contrast and cannot be derived from this number alone, so
  // this pins the one value observed to fail rather than a computed limit
  // (`openspec/changes/weight-evidence-ghost-below-base/design.md`).
  it('stays above the weight at which a measured clip lost its ghost entirely', () => {
    expect(EVIDENCE_GHOST_BLEND_ALPHA).toBeGreaterThan(0.25)
  })
})

describe('evidenceSnapToleranceSeconds', () => {
  it('is half the median sampling interval', () => {
    expect(evidenceSnapToleranceSeconds(sampledFrames())).toBeCloseTo(0.05, 10)
  })

  it('takes the median rather than the mean, so one long stall does not widen it', () => {
    const frames = [0, 0.1, 0.2, 0.3, 5].map((t) => hipFrame(t, 960, 540))
    expect(evidenceSnapToleranceSeconds(frames)).toBeCloseTo(0.05, 10)
  })

  it('is null below two frames — there is no interval to measure', () => {
    expect(evidenceSnapToleranceSeconds([])).toBeNull()
    expect(evidenceSnapToleranceSeconds([hipFrame(0, 960, 540)])).toBeNull()
  })
})

describe('snapToSampledFrame', () => {
  it('resolves an instant inside the tolerance to the nearest sampled frame', () => {
    const frames = sampledFrames()
    expect(snapToSampledFrame(frames, 0.52, 0.05)?.timestamp).toBeCloseTo(0.5, 10)
  })

  it('rejects a foreign timestamp that findNearestFrame would silently clamp', () => {
    const frames = sampledFrames()
    // The guard is load-bearing precisely because the reused lookup clamps: on its own it answers
    // the LAST frame for a timestamp far past the end of the clip.
    expect(findNearestFrame(frames, 42)?.timestamp).toBeCloseTo(1, 10)
    expect(snapToSampledFrame(frames, 42, 0.05)).toBeNull()
    expect(snapToSampledFrame(frames, -42, 0.05)).toBeNull()
  })

  it('accepts an instant exactly at the tolerance', () => {
    const frames = sampledFrames()
    expect(snapToSampledFrame(frames, 0.55, 0.05)).not.toBeNull()
  })
})

describe('boundingBoxOfPoints', () => {
  it('is null for an empty set', () => {
    expect(boundingBoxOfPoints([])).toBeNull()
  })

  it('spans every point', () => {
    expect(
      boundingBoxOfPoints([
        { x: 10, y: 40 },
        { x: 30, y: 20 },
      ]),
    ).toEqual({ minX: 10, minY: 20, maxX: 30, maxY: 40 })
  })

  it('skips non-finite coordinates rather than growing unbounded', () => {
    expect(
      boundingBoxOfPoints([
        { x: 10, y: 10 },
        { x: Infinity, y: NaN },
      ]),
    ).toEqual({ minX: 10, minY: 10, maxX: 10, maxY: 10 })
    expect(boundingBoxOfPoints([{ x: NaN, y: NaN }])).toBeNull()
  })
})

describe('frameCropBox', () => {
  it('omits a crop keypoint that does not resolve, rather than anchoring on nothing', () => {
    // `left_heel` is MediaPipe-only; on MoveNet it resolves 'unrecoverable'. A box that trusted it
    // would anchor at the frame origin.
    const frame = hipFrame(0, 960, 540)
    expect(frameCropBox(frame, [...HIP_SEED, 'left_heel'])).toEqual(
      frameCropBox(frame, [...HIP_SEED]),
    )
  })

  it('includes an interpolated keypoint — interpolation penalises, it does not disqualify', () => {
    const frame = buildFrame(
      {
        left_hip: { x: 900, y: 540 },
        right_hip: { x: 1000, y: 540, status: 'interpolated' },
      },
      0,
    )
    expect(frameCropBox(frame, [...HIP_SEED])).toEqual({
      minX: 900,
      minY: 540,
      maxX: 1000,
      maxY: 540,
    })
  })

  it('is null when no crop keypoint resolves at all', () => {
    expect(frameCropBox(buildFrame({}, 0), [...HIP_SEED])).toBeNull()
  })
})

describe('resolveInstantKeypoints', () => {
  it('keeps detected, interpolated and unrecoverable apart', () => {
    const frame = buildFrame(
      {
        left_hip: { x: 900, y: 540 },
        right_hip: { x: 1000, y: 545, status: 'interpolated' },
      },
      0,
    )
    // `left_heel` is MediaPipe-only and unrecoverable on MoveNet — the third state, and the one a
    // two-state "resolvable or not" model would lose.
    expect(
      resolveInstantKeypoints(frame, [...HIP_SEED, 'left_heel']),
    ).toEqual([
      { name: 'left_hip', status: 'detected', x: 900, y: 540 },
      { name: 'right_hip', status: 'interpolated', x: 1000, y: 545 },
      { name: 'left_heel', status: 'unrecoverable' },
    ])
  })

  it('carries no coordinates at all on an unrecoverable point', () => {
    const [mark] = resolveInstantKeypoints(buildFrame({}, 0), ['left_hip'])
    // Not `x: 0` and not `x: null` — the mark has to be DROPPED, and a type with no coordinate
    // arm is what makes drawing one at the origin unreachable rather than merely discouraged.
    expect('x' in mark).toBe(false)
    expect('y' in mark).toBe(false)
  })

  it('preserves the exemplar order and drops a repeated name', () => {
    const frame = hipFrame(0, 960, 540)
    expect(
      resolveInstantKeypoints(frame, [
        'right_hip',
        'left_hip',
        'right_hip',
      ]).map((mark) => mark.name),
    ).toEqual(['right_hip', 'left_hip'])
  })
})

describe('resolveOutwardSigns', () => {
  it('signs each side away from the hip midline', () => {
    // left_hip at 900, right_hip at 1000, midline 950: left is the negative-x side.
    expect(resolveOutwardSigns(hipFrame(0, 950, 540))).toEqual({
      left: -1,
      right: 1,
    })
  })

  it('flips with the hips, because it is per-frame and not clip-wide', () => {
    const mirrored = buildFrame(
      { left_hip: { x: 1000, y: 540 }, right_hip: { x: 900, y: 540 } },
      0,
    )
    expect(resolveOutwardSigns(mirrored)).toEqual({ left: 1, right: -1 })
  })

  it('is null when only one hip resolves — the strict bilateral gate, not the tolerant midpoint', () => {
    // `resolveMidpoint` would happily stand the one hip in for the pair, collapsing the midline
    // onto it and making every sign identically zero. That is the sign-flip bug `stepWidth.ts`
    // was fixed for, so this reads null rather than a fabricated direction.
    const oneHip = buildFrame({ left_hip: { x: 900, y: 540 } }, 0)
    expect(resolveOutwardSigns(oneHip)).toBeNull()
  })

  it('is null when both hips share an x, rather than falling back to +1 like the metric does', () => {
    const degenerate = buildFrame(
      { left_hip: { x: 950, y: 540 }, right_hip: { x: 950, y: 560 } },
      0,
    )
    expect(resolveOutwardSigns(degenerate)).toBeNull()
  })
})

describe('evidenceTravelDirection', () => {
  /** Shoulders and hips both resolvable, so the frame is inside the presence window. */
  function present(t: number, hipX: number): RobustPoseFrame {
    return buildFrame(
      {
        left_shoulder: { x: hipX - 50, y: 300 },
        right_shoulder: { x: hipX + 50, y: 300 },
        left_hip: { x: hipX - 50, y: 500 },
        right_hip: { x: hipX + 50, y: 500 },
      },
      t,
    )
  }

  it('reads the direction the runner is travelling', () => {
    const frames = [0, 1, 2, 3].map((i) => present(i * 0.1, 100 + i * 200))
    expect(evidenceTravelDirection(frames)).toBe(1)
    expect(evidenceTravelDirection([...frames].reverse())).toBe(-1)
  })

  it('is 0 when net displacement is under half a torso length', () => {
    const frames = [0, 1, 2, 3].map((i) => present(i * 0.1, 100 + i * 5))
    expect(evidenceTravelDirection(frames)).toBe(0)
  })

  it('is 0 when no body scale is resolvable at all', () => {
    expect(evidenceTravelDirection([hipFrame(0, 500, 540)])).toBe(0)
  })

  it('matches the metrics by using their presence-trimmed frames, on a clip where the untrimmed array disagrees outright', () => {
    // Frame 0 has hips but no shoulders, so the presence trim excludes it while
    // `estimateTravelDirection` — which reads the first and last frame where HIP-mid resolves at
    // all — would take it as the starting endpoint. Parked at the right edge, it reverses the
    // reading. Design D4 argued this can only happen near the indeterminate threshold; it cannot,
    // because the two arrays do not share endpoints, and both readings below are far clear of it.
    const frames: RobustPoseFrame[] = [
      hipFrame(0, 1900, 500),
      ...[1, 2, 3, 4, 5].map((i) => present(i * 0.1, 100 + (i - 1) * 200)),
    ]

    const untrimmedScale = estimateBodyScale(frames)
    expect(untrimmedScale).not.toBeNull()
    const naive = estimateTravelDirection(frames, untrimmedScale!)

    const metricFrames = trimToPresenceWindow(frames)
    const metricScale = estimateBodyScale(metricFrames)
    expect(metricScale).not.toBeNull()
    const asMetricsSeeIt = estimateTravelDirection(metricFrames, metricScale!)

    // Both confident, and opposite: the disagreement is real, not a threshold artefact.
    expect(naive).toBe(-1)
    expect(asMetricsSeeIt).toBe(1)
    // The plan sides with the metrics, so a mark can never point opposite the card it explains.
    expect(evidenceTravelDirection(frames)).toBe(asMetricsSeeIt)
  })
})

describe('evidenceOutputSide / toEvidenceOutputSpace', () => {
  it('caps without upscaling', () => {
    expect(evidenceOutputSide(900, 640)).toBe(640)
    expect(evidenceOutputSide(320, 640)).toBe(320)
    expect(evidenceOutputSide(0.2, 640)).toBe(1)
  })

  it('scales by outputSide/crop.side, which is not 1 on a fractional crop under the cap', () => {
    const crop = { x: 100, y: 200, side: 500.5 }
    const side = evidenceOutputSide(crop.side, 640)
    // Rounding is in the numerator only, so an uncapped crop still scales.
    expect(side).toBe(501)
    expect(toEvidenceOutputSpace({ x: 100, y: 200 }, crop, side)).toEqual({
      x: 0,
      y: 0,
    })
    // The crop's far corner is one whole crop side from its origin, so it maps to the canvas's
    // far corner — `side`, NOT `crop.side`. A scale hard-coded to 1 (or to
    // `maxOutputSidePx / crop.side`, which is 1.278 here) puts it half a pixel short and every
    // mark inside it proportionally off.
    const corner = toEvidenceOutputSpace(
      { x: 100 + crop.side, y: 200 + crop.side },
      crop,
      side,
    )
    expect(corner.x).toBeCloseTo(side, 10)
    expect(corner.y).toBeCloseTo(side, 10)
    expect(corner.x).not.toBeCloseTo(crop.side, 3)
  })

  it('maps a capped crop into the capped canvas', () => {
    const crop = { x: 0, y: 0, side: 2160 }
    const side = evidenceOutputSide(crop.side, 640)
    expect(toEvidenceOutputSpace({ x: 2160, y: 1080 }, crop, side)).toEqual({
      x: 640,
      y: 320,
    })
  })
})

describe('computeEvidenceCropRect', () => {
  it('is square and floors a degenerate single-point seed at the minimum side', () => {
    const frame = buildFrame({ left_hip: { x: 500, y: 500 } }, 0)
    const crop = computeEvidenceCropRect(
      [frame],
      ['left_hip', 'right_hip'],
      HD,
    )
    // A single point is a zero-area box: `max(w, h) * 1.6` is 0, so without the floor the crop
    // would be empty.
    expect(crop).toEqual({
      x: 500 - EVIDENCE_CROP_MIN_SIDE_PX / 2,
      y: 500 - EVIDENCE_CROP_MIN_SIDE_PX / 2,
      side: EVIDENCE_CROP_MIN_SIDE_PX,
    })
  })

  it('applies the padding multiplier once the padded side clears the floor', () => {
    const frame = hipFrame(0, 960, 540, 400)
    const crop = computeEvidenceCropRect([frame], [...HIP_SEED], HD)
    expect(crop?.side).toBeCloseTo(400 * EVIDENCE_CROP_PADDING_MULTIPLIER, 10)
  })

  it('unions across both frames of a pair, so the ghost is framed by one rect', () => {
    const base = hipFrame(0, 500, 540)
    const ghost = hipFrame(0.5, 900, 540)
    const union = computeEvidenceCropRect([base, ghost], [...HIP_SEED], HD)
    const baseOnly = computeEvidenceCropRect([base], [...HIP_SEED], HD)
    // Union box spans 450..950 = 500 px wide; padded that is 800, well clear of the floor the
    // single-frame box lands on.
    expect(union?.side).toBeCloseTo(500 * EVIDENCE_CROP_PADDING_MULTIPLIER, 10)
    expect(baseOnly?.side).toBe(EVIDENCE_CROP_MIN_SIDE_PX)
  })

  it('clamps at the top-left frame edge without producing a negative origin', () => {
    const frame = buildFrame({ left_hip: { x: 5, y: 5 } }, 0)
    expect(computeEvidenceCropRect([frame], ['left_hip'], HD)).toEqual({
      x: 0,
      y: 0,
      side: EVIDENCE_CROP_MIN_SIDE_PX,
    })
  })

  it('clamps at the bottom-right frame edge without running out of bounds', () => {
    const frame = buildFrame({ left_hip: { x: 1915, y: 1075 } }, 0)
    const crop = computeEvidenceCropRect([frame], ['left_hip'], HD)
    expect(crop).toEqual({
      x: HD.width - EVIDENCE_CROP_MIN_SIDE_PX,
      y: HD.height - EVIDENCE_CROP_MIN_SIDE_PX,
      side: EVIDENCE_CROP_MIN_SIDE_PX,
    })
    expect(crop!.x + crop!.side).toBeLessThanOrEqual(HD.width)
    expect(crop!.y + crop!.side).toBeLessThanOrEqual(HD.height)
  })

  it('never demands more pixels than a small source has — the cap wins over the floor', () => {
    const small: EvidenceFrameSize = { width: 320, height: 240 }
    const frame = buildFrame({ left_hip: { x: 10, y: 230 } }, 0)
    const crop = computeEvidenceCropRect([frame], ['left_hip'], small)
    expect(crop).toEqual({ x: 0, y: 0, side: 240 })
  })

  it('frames a 4K clip the same way, in native pixels', () => {
    const frame = hipFrame(0, 3000, 1800, 500)
    const crop = computeEvidenceCropRect([frame], [...HIP_SEED], UHD)
    expect(crop?.side).toBeCloseTo(500 * EVIDENCE_CROP_PADDING_MULTIPLIER, 10)
    expect(crop!.x + crop!.side).toBeLessThanOrEqual(UHD.width)
    expect(crop!.y + crop!.side).toBeLessThanOrEqual(UHD.height)
  })

  it('is null when nothing resolves, and when the frame size is unusable', () => {
    const frame = hipFrame(0, 960, 540)
    expect(computeEvidenceCropRect([buildFrame({}, 0)], [...HIP_SEED], HD)).toBeNull()
    expect(
      computeEvidenceCropRect([frame], [...HIP_SEED], { width: 0, height: 0 }),
    ).toBeNull()
    expect(
      computeEvidenceCropRect([frame], [...HIP_SEED], {
        width: NaN,
        height: 1080,
      }),
    ).toBeNull()
  })
})

/**
 * A whole body, laid out so every number a crop rule reads is arithmetic rather than anatomy:
 * the head sits at `top`, the ankles at `bottom`, and the torso/limbs span `left`..`right`.
 *
 * `feet` is the backend switch that `strides-e9b` turns on. MoveNet never resolves
 * `left_heel`/`right_heel`/`left_foot_index`/`right_foot_index` — they arrive `'unrecoverable'` —
 * so on the default backend a subject's box stops at the ankles and the shoes hang below it. Pass
 * `feet: true` for the MediaPipe shape, where they resolve 30 px lower.
 */
function bodyFrame({
  timestamp = 0,
  left,
  right,
  top,
  bottom,
  feet = false,
}: {
  timestamp?: number
  left: number
  right: number
  top: number
  bottom: number
  feet?: boolean
}): RobustPoseFrame {
  const midY = (top + bottom) / 2
  return buildFrame(
    {
      nose: { x: (left + right) / 2, y: top },
      left_ear: { x: left, y: top },
      right_ear: { x: right, y: top },
      left_shoulder: { x: left, y: top + (bottom - top) * 0.2 },
      right_shoulder: { x: right, y: top + (bottom - top) * 0.2 },
      left_elbow: { x: left, y: midY },
      right_elbow: { x: right, y: midY },
      left_wrist: { x: left, y: midY },
      right_wrist: { x: right, y: midY },
      left_hip: { x: left, y: midY },
      right_hip: { x: right, y: midY },
      left_knee: { x: left, y: (midY + bottom) / 2 },
      right_knee: { x: right, y: (midY + bottom) / 2 },
      left_ankle: { x: left, y: bottom },
      right_ankle: { x: right, y: bottom },
      ...(feet
        ? {
            left_heel: { x: left, y: bottom + 30 },
            right_heel: { x: right, y: bottom + 30 },
            left_foot_index: { x: left, y: bottom + 30 },
            right_foot_index: { x: right, y: bottom + 30 },
          }
        : {}),
    },
    timestamp,
  )
}

/** Adds a small extra keypoint cluster to a body, so an exemplar can name a LIMB-sized crop set
 * whose box is a fraction of the subject's — the shape the display floor inflates. */
function withLimb(
  frame: RobustPoseFrame,
  box: { minX: number; maxX: number; minY: number; maxY: number },
): RobustPoseFrame {
  const keypoints = frame.keypoints.map((keypoint) => {
    if (keypoint.name === 'left_shoulder')
      return { ...keypoint, x: box.minX, y: box.minY, status: 'detected' as const, score: 0.9 }
    if (keypoint.name === 'left_wrist')
      return { ...keypoint, x: box.maxX, y: box.maxY, status: 'detected' as const, score: 0.9 }
    return keypoint
  })
  return { ...frame, keypoints }
}

const LIMB_SEED = ['left_shoulder', 'left_wrist'] as const

describe('frameSubjectExtentBox', () => {
  it('spans every keypoint that resolves, not just the ones a crop names', () => {
    const frame = bodyFrame({ left: 750, right: 950, top: 250, bottom: 850 })
    expect(frameSubjectExtentBox([frame])).toEqual({
      minX: 750,
      maxX: 950,
      minY: 250,
      maxY: 850,
    })
  })

  it('unions across the drawn frames, because one crop is drawn through both', () => {
    const base = bodyFrame({ left: 750, right: 950, top: 250, bottom: 850 })
    const ghost = bodyFrame({ timestamp: 0.1, left: 850, right: 1050, top: 300, bottom: 900 })
    expect(frameSubjectExtentBox([base, ghost])).toEqual({
      minX: 750,
      maxX: 1050,
      minY: 250,
      maxY: 900,
    })
  })

  it('stops at the ankles on MoveNet and reaches the shoes on MediaPipe', () => {
    const movenet = bodyFrame({ left: 750, right: 950, top: 250, bottom: 850 })
    const mediapipe = bodyFrame({
      left: 750,
      right: 950,
      top: 250,
      bottom: 850,
      feet: true,
    })
    // The difference is exactly the four foot names, and it is 30 px of real runner that the
    // default backend cannot see. Anything reading this box as "where the body ends" mis-frames
    // every MoveNet subject's feet.
    expect(frameSubjectExtentBox([movenet])?.maxY).toBe(850)
    expect(frameSubjectExtentBox([mediapipe])?.maxY).toBe(880)
  })

  it('is null exactly when no keypoint resolves', () => {
    expect(frameSubjectExtentBox([buildFrame({}, 0)])).toBeNull()
    expect(frameSubjectExtentBox([])).toBeNull()
  })

  it('contains the crop box, so a crop that holds it holds the measured region too', () => {
    const frame = withLimb(
      bodyFrame({ left: 750, right: 950, top: 250, bottom: 850 }),
      { minX: 900, maxX: 950, minY: 350, maxY: 450 },
    )
    const subject = frameSubjectExtentBox([frame])!
    const crop = frameCropBox(frame, [...LIMB_SEED])!
    expect(crop.minX).toBeGreaterThanOrEqual(subject.minX)
    expect(crop.maxX).toBeLessThanOrEqual(subject.maxX)
    expect(crop.minY).toBeGreaterThanOrEqual(subject.minY)
    expect(crop.maxY).toBeLessThanOrEqual(subject.maxY)
  })
})

describe('subjectCentredCropRect', () => {
  /** The measured Demo 2 shape at 1080p arithmetic: a 50×100 arm box pads to 160, the 320 px
   * display floor doubles that, and the runner is 200 px wide — narrower than the crop the floor
   * produced and much taller than it. */
  const armFrame = () =>
    withLimb(bodyFrame({ left: 750, right: 950, top: 250, bottom: 850 }), {
      minX: 900,
      maxX: 950,
      minY: 350,
      maxY: 450,
    })

  it('centres a floor-inflated limb crop on the subject instead of on the limb', () => {
    const frame = armFrame()
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    expect(evidenceCropPaddedSide(roi)).toBe(160)
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    expect(crop.side).toBe(EVIDENCE_CROP_MIN_SIDE_PX)
    // Centred on the arm the crop would sit at x = 925 - 160 = 765 and spend 110 px of the floor's
    // own surplus on whatever is to the right of the runner. Centred on the runner it sits at
    // x = 850 - 160 = 690 and holds all 200 px of them with 60 px to spare on each side.
    expect(crop.x).toBe(690)
    // The unqualifying axis does not move: the subject is 600 px tall, the crop 320.
    expect(crop.y).toBe(400 - EVIDENCE_CROP_MIN_SIDE_PX / 2)
  })

  it('keeps the measured region inside the picture when it moves', () => {
    const frame = armFrame()
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    expect(roi.minX).toBeGreaterThanOrEqual(crop.x)
    expect(roi.maxX).toBeLessThanOrEqual(crop.x + crop.side)
    expect(roi.minY).toBeGreaterThanOrEqual(crop.y)
    expect(roi.maxY).toBeLessThanOrEqual(crop.y + crop.side)
  })

  it('never changes the side, so nothing that reads a crop size can observe it', () => {
    const frame = armFrame()
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    const subject = frameSubjectExtentBox([frame])!
    const unplaced = computeCropRect(
      roi,
      HD.width,
      HD.height,
      EVIDENCE_CROP_PADDING_MULTIPLIER,
      EVIDENCE_CROP_MIN_SIDE_PX,
    )
    const placed = subjectCentredCropRect(unplaced, roi, subject, HD)
    expect(placed.side).toBe(unplaced.side)
    expect(placed.x).not.toBe(unplaced.x)
  })

  it('declines when the crop already holds the whole subject — the multiperson kneeFlexion shape', () => {
    // A 116×290 runner and a 99×146 knee box: padded 233.6, floored to 320, which is larger than
    // the runner on BOTH axes. Centring vertically here rides 66 px up the body, which is what
    // promoted a walking bystander from a pair of legs at the top edge into the middle of the
    // picture. The crop must not move.
    const frame = withLimb(
      bodyFrame({ left: 400, right: 516, top: 500, bottom: 790 }),
      { minX: 410, maxX: 509, minY: 600, maxY: 746 },
    )
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    expect(evidenceCropPaddedSide(roi)).toBeCloseTo(233.6, 10)
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    expect(crop.side).toBe(EVIDENCE_CROP_MIN_SIDE_PX)
    expect(crop.x).toBeCloseTo(459.5 - 160, 10)
    expect(crop.y).toBeCloseTo(673 - 160, 10)
  })

  it('declines for a foot close-up, whether or not the backend resolved the feet', () => {
    // The multiperson footStrikePattern shape: a tiny foot box under a runner shorter than the
    // 320 px floor. Centring vertically rides ~100 px up the body and reframes a foot close-up as
    // a whole-body shot with the sole clipped off — the exact failure this clause exists to stop.
    // Asserted on BOTH backend shapes, so the framing of a foot crop cannot depend on whether
    // `left_heel` and friends came back.
    const foot = { minX: 430, maxX: 451, minY: 700, maxY: 775 }
    const movenet = withLimb(
      bodyFrame({ left: 400, right: 535, top: 490, bottom: 779 }),
      foot,
    )
    const mediapipe = withLimb(
      bodyFrame({ left: 400, right: 535, top: 490, bottom: 779, feet: true }),
      foot,
    )
    const cropped = (frame: RobustPoseFrame) =>
      computeEvidenceCropRect([frame], [...LIMB_SEED], HD)
    expect(cropped(movenet)).toEqual(cropped(mediapipe))
    expect(cropped(movenet)).toEqual({
      x: 440.5 - 160,
      y: 737.5 - 160,
      side: EVIDENCE_CROP_MIN_SIDE_PX,
    })
  })

  it('declines when the PADDING, not the floor, made the crop wider than the subject', () => {
    // The Demo 2 `verticalOscillation` shape: a 180×450 hip-to-ankle box pads to 720 on a runner
    // 283 px wide — four times wider than the body, nowhere near the floor. That crop's own
    // bystander is `strides-a8y`, a different mechanism, and this rule must not touch it.
    const portrait: EvidenceFrameSize = { width: 2160, height: 3840 }
    const frame = withLimb(
      bodyFrame({ left: 738, right: 1021, top: 1591, bottom: 2359 }),
      { minX: 800, maxX: 980, minY: 1700, maxY: 2150 },
    )
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    expect(evidenceCropPaddedSide(roi)).toBe(720)
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], portrait)!
    expect(crop.side).toBe(720)
    expect(crop.x).toBe(890 - 360)
    expect(crop.y).toBe(1925 - 360)
  })

  it('declines when the frame cap bound the side — a capped crop can never qualify', () => {
    // `side < paddedSide` whenever the cap wins, and the rule needs `paddedSide <= extent < side`,
    // so the chain is unsatisfiable by arithmetic rather than by a special case.
    const small: EvidenceFrameSize = { width: 400, height: 300 }
    const frame = withLimb(
      bodyFrame({ left: 20, right: 370, top: 10, bottom: 290 }),
      { minX: 40, maxX: 340, minY: 20, maxY: 280 },
    )
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    expect(evidenceCropPaddedSide(roi)).toBeGreaterThan(small.height)
    expect(computeEvidenceCropRect([frame], [...LIMB_SEED], small)).toEqual({
      x: 190 - 150,
      y: 0,
      side: 300,
    })
  })

  it('shifts rather than shrinks at a frame edge, exactly as computeCropRect clamps', () => {
    // Same qualifying shape as the arm case, pushed against the right edge so centring on the
    // subject would run the crop out of the frame. The scenario "A subject near the frame edge
    // yields a valid crop" is the one this must not break.
    const frame = withLimb(
      bodyFrame({ left: 1790, right: 1990, top: 250, bottom: 850 }),
      { minX: 1940, maxX: 1990, minY: 350, maxY: 450 },
    )
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    expect(crop.side).toBe(EVIDENCE_CROP_MIN_SIDE_PX)
    expect(crop.x).toBe(HD.width - EVIDENCE_CROP_MIN_SIDE_PX)
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.side).toBeLessThanOrEqual(HD.width)
    // The same centre through `computeCropRect`'s own clamp lands in the same place — this rule
    // repeats those two lines rather than calling it, and that is what pins them together.
    const viaCropRect = computeCropRect(
      { minX: 1890, maxX: 1890, minY: 400, maxY: 400 },
      HD.width,
      HD.height,
      1,
      EVIDENCE_CROP_MIN_SIDE_PX,
    )
    expect(crop).toEqual(viaCropRect)
  })

  it('is a no-op on an unusable frame size', () => {
    const box: BoundingBoxPx = { minX: 0, maxX: 10, minY: 0, maxY: 10 }
    const crop = { x: 5, y: 5, side: 320 }
    expect(subjectCentredCropRect(crop, box, box, { width: 0, height: 0 })).toBe(
      crop,
    )
  })

  it('can only move vertically on a subject WIDER than the crop, and still holds the crop box', () => {
    // The one shape where MoveNet's missing feet could bias a placement: the vertical axis
    // qualifies only when the subject is wider than the crop and shorter than it, which an upright
    // runner never is — no exemplar on any of the three test clips reaches it. Constructed here so
    // the guarantee that survives it is asserted rather than assumed: the measured region stays in
    // the picture.
    const frame = withLimb(
      bodyFrame({ left: 300, right: 700, top: 400, bottom: 680 }),
      { minX: 480, maxX: 520, minY: 500, maxY: 600 },
    )
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    expect(crop.side).toBe(EVIDENCE_CROP_MIN_SIDE_PX)
    // Vertical moved (subject 280 tall < 320, subject 400 wide >= 320); horizontal did not.
    expect(crop.y).toBe(540 - 160)
    expect(crop.x).toBe(500 - 160)
    expect(roi.minY).toBeGreaterThanOrEqual(crop.y)
    expect(roi.maxY).toBeLessThanOrEqual(crop.y + crop.side)
  })
})

describe('focusAimedCropRect', () => {
  /**
   * `kneeFlexion`'s shape at peak flexion, scaled to 1080p arithmetic: the seed is hip/knee/ankle
   * and the KNEE is the lowest of the three, so the seed box's own centre sits well above it. The
   * limb keypoints stand in for that box and `left_wrist` for the knee.
   */
  const kneeFrame = () =>
    withLimb(bodyFrame({ left: 750, right: 950, top: 250, bottom: 850 }), {
      minX: 800,
      maxX: 900,
      minY: 400,
      maxY: 560,
    })

  it('puts the focus joint in the middle when there is room to', () => {
    const frame = kneeFrame()
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], HD, {
      x: 900,
      y: 560,
    })!
    expect(crop.side).toBe(EVIDENCE_CROP_MIN_SIDE_PX)
    expect(crop.x + crop.side / 2).toBe(900)
    expect(crop.y + crop.side / 2).toBe(560)
  })

  it('takes precedence over centring on the subject', () => {
    // The `kneeDrive` failure on `park-side-landscape.mp4`: the floor made the crop wider than the
    // runner, so the subject rule fired and pulled the crop AWAY from the knee. Same frame, both
    // routes, so the disagreement is the assertion.
    const frame = kneeFrame()
    const subjectCentred = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    const aimed = computeEvidenceCropRect([frame], [...LIMB_SEED], HD, {
      x: 900,
      y: 560,
    })!
    expect(subjectCentred.x).toBe(850 - 160)
    expect(aimed.x).not.toBe(subjectCentred.x)
    expect(aimed.side).toBe(subjectCentred.side)
  })

  it('never pushes the measured region out of the picture', () => {
    // The knee is at the bottom edge of its own seed box, so aiming dead-centre on it would put
    // the hip above the top of the crop. Containment is what stops the angle being drawn against
    // nothing.
    const frame = withLimb(bodyFrame({ left: 750, right: 950, top: 250, bottom: 850 }), {
      minX: 800,
      maxX: 900,
      minY: 300,
      maxY: 600,
    })
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], HD, {
      x: 900,
      y: 600,
    })!
    expect(crop.y + crop.side / 2).toBeGreaterThan(600 - crop.side / 2)
    expect(roi.minX).toBeGreaterThanOrEqual(crop.x)
    expect(roi.maxX).toBeLessThanOrEqual(crop.x + crop.side)
    expect(roi.minY).toBeGreaterThanOrEqual(crop.y)
    expect(roi.maxY).toBeLessThanOrEqual(crop.y + crop.side)
  })

  it('stays inside the frame, and is never worse than not aiming', () => {
    // `park-side-landscape.mp4`'s shipped `kneeFlexion` instant: the runner is two-thirds out of
    // frame left, the crop is already flush at x = 0, and no placement can centre the knee. Aiming
    // must leave it exactly where it was rather than running off the edge.
    const frame = withLimb(bodyFrame({ left: 10, right: 200, top: 900, bottom: 1000 }), {
      minX: 16,
      maxX: 196,
      minY: 920,
      maxY: 990,
    })
    const unaimed = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    const aimed = computeEvidenceCropRect([frame], [...LIMB_SEED], HD, {
      x: 16,
      y: 990,
    })!
    expect(aimed.x).toBe(0)
    expect(unaimed.x).toBe(0)
    expect(aimed.x + aimed.side).toBeLessThanOrEqual(HD.width)
  })

  it('keeps the crop where it was when the frame cap left no room to aim', () => {
    // `side < paddedSide` whenever the cap wins, so the crop can be narrower than the box it must
    // hold and no position contains it. The pre-existing placement is the best available.
    const small: EvidenceFrameSize = { width: 400, height: 300 }
    const box: BoundingBoxPx = { minX: 40, maxX: 340, minY: 20, maxY: 280 }
    const unaimed = { x: 40, y: 0, side: 300 }
    expect(focusAimedCropRect(unaimed, box, { x: 340, y: 280 }, small)).toEqual(
      unaimed,
    )
  })

  it('is a no-op on an unusable frame size', () => {
    const box: BoundingBoxPx = { minX: 0, maxX: 10, minY: 0, maxY: 10 }
    const crop = { x: 5, y: 5, side: 320 }
    expect(focusAimedCropRect(crop, box, { x: 0, y: 0 }, { width: 0, height: 0 })).toBe(
      crop,
    )
  })

  it('never changes the side, so nothing that reads a crop size can observe it', () => {
    const frame = kneeFrame()
    const plain = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    const aimed = computeEvidenceCropRect([frame], [...LIMB_SEED], HD, {
      x: 900,
      y: 560,
    })!
    expect(aimed.side).toBe(plain.side)
  })

  it('keeps a floor-inflated crop on the runner, which is what subject-centring was for', () => {
    // An aimed metric never reaches `subjectCentredCropRect` — `computeEvidenceCropRect` returns
    // before `frameSubjectExtentBox` is even computed — so the bystander guarantee has to come
    // from aiming itself, on the same floor-inflated geometry that rule exists for: a small leg
    // box the 320 px display floor inflates past the runner's own width. The guarantee is
    // structural rather than incidental. The focus joint is one of the RUNNER's keypoints, so the
    // centre of the picture is a point on the runner by construction — a stronger statement than
    // "centred on the subject's midline", which is what subject-centring was reaching for.
    const frame = withLimb(
      bodyFrame({ left: 750, right: 950, top: 250, bottom: 850 }),
      { minX: 860, maxX: 900, minY: 520, maxY: 640 },
    )
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    const subject = frameSubjectExtentBox([frame])!
    // The guarded regime: the floor, not the padding, is what made the crop wider than the runner.
    expect(evidenceCropPaddedSide(roi)).toBe(192)
    // The knee is the lower end of its own seed box, as it is at peak flexion.
    const knee = { x: 900, y: 640 }
    const crop = computeEvidenceCropRect([frame], [...LIMB_SEED], HD, knee)!
    expect(crop.side).toBe(EVIDENCE_CROP_MIN_SIDE_PX)

    const centre = { x: crop.x + crop.side / 2, y: crop.y + crop.side / 2 }
    expect(centre).toEqual(knee)
    expect(centre.x).toBeGreaterThanOrEqual(subject.minX)
    expect(centre.x).toBeLessThanOrEqual(subject.maxX)
    expect(centre.y).toBeGreaterThanOrEqual(subject.minY)
    expect(centre.y).toBeLessThanOrEqual(subject.maxY)
  })

  it('moves a multiperson knee crop DOWN the body, not up into the bystander', () => {
    // The one clause of `subjectCentredCropRect` that `kneeFlexion` used to depend on: on
    // `multiperson-track.mp4` its crop is larger than the runner on BOTH axes, so that rule
    // DECLINED to move it, because riding 66 px up the body promotes a walking bystander from a
    // pair of legs at the top edge into the middle of the picture. Aiming re-places a crop the
    // declining clause left alone, so the direction is the assertion: the knee is the LOWEST seed
    // at peak flexion, so aiming moves the crop away from the top edge, not toward it.
    const frame = withLimb(
      bodyFrame({ left: 400, right: 516, top: 500, bottom: 790 }),
      { minX: 410, maxX: 509, minY: 600, maxY: 746 },
    )
    const roi = frameCropBox(frame, [...LIMB_SEED])!
    const subject = frameSubjectExtentBox([frame])!
    const knee = { x: 509, y: 746 }
    const declined = computeEvidenceCropRect([frame], [...LIMB_SEED], HD)!
    const aimed = computeEvidenceCropRect([frame], [...LIMB_SEED], HD, knee)!

    expect(aimed.y).toBeGreaterThan(declined.y)
    expect(aimed.side).toBe(declined.side)
    expect(aimed.x + aimed.side / 2).toBe(knee.x)
    expect(aimed.y + aimed.side / 2).toBe(knee.y)
    // Still the runner's own knee at the centre, and the measured region still in the picture.
    expect(knee.x).toBeLessThanOrEqual(subject.maxX)
    expect(knee.y).toBeLessThanOrEqual(subject.maxY)
    expect(roi.minY).toBeGreaterThanOrEqual(aimed.y)
    expect(roi.maxY).toBeLessThanOrEqual(aimed.y + aimed.side)
  })
})

describe('evidenceFocusOffset', () => {
  it('is 0 at the centre and 0.5 at an edge', () => {
    const crop = { x: 100, y: 200, side: 320 }
    expect(evidenceFocusOffset(crop, { x: 260, y: 360 })).toBe(0)
    expect(evidenceFocusOffset(crop, { x: 100, y: 360 })).toBe(0.5)
    expect(evidenceFocusOffset(crop, { x: 260, y: 520 })).toBe(0.5)
  })

  it('reads the distance to the NEAREST edge, so one bad axis is not averaged away', () => {
    // Chebyshev, not Euclidean: `park-side-landscape.mp4`'s shipped instant is dead-centre
    // vertically and jammed against the left edge, and a mean of the two axes would call that
    // half-framed.
    const crop = { x: 0, y: 0, side: 320 }
    expect(evidenceFocusOffset(crop, { x: 16, y: 160 })).toBeCloseTo(0.45, 10)
  })
})

describe('resolveExemplarFrames', () => {
  it('reports a single-instant exemplar as having no ghost to resolve', () => {
    const resolved = resolveExemplarFrames(
      exemplar({ kind: 'footStrike' }),
      sampledFrames(),
      0.05,
    )
    expect(resolved?.ghost).toBeNull()
    expect(resolved?.ghostUnresolved).toBe(false)
  })

  it('flags a paired instant that falls outside the snap tolerance', () => {
    const resolved = resolveExemplarFrames(
      exemplar({ pairedTimestamp: 42 }),
      sampledFrames(),
      0.05,
    )
    expect(resolved?.base.timestamp).toBeCloseTo(0.5, 10)
    expect(resolved?.ghostUnresolved).toBe(true)
  })

  it('is null when the base does not snap', () => {
    expect(
      resolveExemplarFrames(exemplar({ timestamp: 42 }), sampledFrames(), 0.05),
    ).toBeNull()
  })
})

describe('isNearIdenticalPair', () => {
  it('fires at the threshold and not just below it', () => {
    const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    // IoU 9950 / 10050 ≈ 0.990
    expect(isNearIdenticalPair(a, { minX: 0.5, minY: 0, maxX: 100.5, maxY: 100 })).toBe(
      true,
    )
    // IoU 9800 / 10200 ≈ 0.961
    expect(isNearIdenticalPair(a, { minX: 2, minY: 0, maxX: 102, maxY: 100 })).toBe(
      false,
    )
    expect(EVIDENCE_NEAR_IDENTICAL_IOU).toBe(0.98)
  })

  it('catches two identical DEGENERATE boxes, which IoU alone cannot see', () => {
    // A bilateral pair resolved at one height is a zero-area box, and `computeBoundingBoxIoU`
    // answers 0 for any zero-area intersection — "completely different" for two boxes that are in
    // fact the same. Exact equality is the guard.
    const flat = { minX: 10, minY: 50, maxX: 110, maxY: 50 }
    expect(isNearIdenticalPair(flat, { ...flat })).toBe(true)
    expect(isNearIdenticalPair(flat, { ...flat, minX: 40, maxX: 140 })).toBe(false)
  })
})

describe('isTooCloseInTimePair', () => {
  // `toleranceSeconds` is half the median sampled interval, so 0.05 models a 0.1 s grid and the
  // floor sits at three intervals = 0.3 s.
  const TOLERANCE = 0.05

  it('rejects a pair fewer than three sampled intervals apart, and keeps one at three', () => {
    expect(isTooCloseInTimePair(3.516667, 3.55, TOLERANCE)).toBe(true)
    expect(isTooCloseInTimePair(0, 0.2, TOLERANCE)).toBe(true)
    expect(isTooCloseInTimePair(0, 0.30001, TOLERANCE)).toBe(false)
    expect(isTooCloseInTimePair(0, 0.4, TOLERANCE)).toBe(false)
    expect(EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS).toBe(3)
    // Deliberately NOT asserted at exactly three intervals: `3 * (2 * 0.05)` is
    // 0.30000000000000004 in binary floating point, so a separation of precisely 0.3 lands on
    // whichever side the representation error puts it. Both neighbours of that point are pinned
    // above, and which way an exact tie falls is not a behaviour worth depending on — a real pair
    // sitting on the boundary to sixteen digits does not occur.
  })

  it('is symmetric — which instant is the base cannot change the verdict', () => {
    expect(isTooCloseInTimePair(3.55, 3.516667, TOLERANCE)).toBe(true)
    expect(isTooCloseInTimePair(0.4, 0, TOLERANCE)).toBe(false)
  })

  it('scales with the sampler, so a sparse clip gets a proportionally wider floor', () => {
    // The same 0.2 s separation is two intervals on a 0.1 s grid and twenty on a 0.01 s one.
    expect(isTooCloseInTimePair(0, 0.2, 0.05)).toBe(true)
    expect(isTooCloseInTimePair(0, 0.2, 0.005)).toBe(false)
  })

  it('declines to fire when there is no interval to judge against', () => {
    // A guard that cannot form its own criterion must not reject everything.
    expect(isTooCloseInTimePair(0, 0.001, 0)).toBe(false)
    expect(isTooCloseInTimePair(0, 0.001, -1)).toBe(false)
    expect(isTooCloseInTimePair(0, 0.001, Number.NaN)).toBe(false)
    expect(isTooCloseInTimePair(0, 0.001, Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('is the guard box IoU cannot be, on the real pair that motivated it', () => {
    // `strides-r41`, measured on `e2e/fixtures/multiperson-track.mp4`: the two-sampled-frame
    // `kneeFlexion` pair reads IoU 0.2476 while Demo 2's legible bounce reads 0.8330, so IoU
    // orders the two BACKWARDS and no threshold on it can separate them. These two boxes
    // reproduce that ordering.
    const brokenBase = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const brokenGhost = { minX: 55, minY: 20, maxX: 175, maxY: 130 }
    const goodBase = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const goodGhost = { minX: 3, minY: 3, maxX: 103, maxY: 103 }
    expect(computeBoundingBoxIoU(brokenBase, brokenGhost)).toBeLessThan(
      computeBoundingBoxIoU(goodBase, goodGhost),
    )
    expect(isNearIdenticalPair(brokenBase, brokenGhost)).toBe(false)
    expect(isNearIdenticalPair(goodBase, goodGhost)).toBe(false)
    // Time separates them where the boxes do not.
    expect(isTooCloseInTimePair(3.516667, 3.55, TOLERANCE)).toBe(true)
    expect(isTooCloseInTimePair(0, 0.1668, 0.008335)).toBe(false)
  })
})

describe('evidencePairCropGrowth / isTooFarApartPair', () => {
  /** `w`×`h`, with its left edge `left` px in. Heights are what dominate a human box, so these are
   * written the way a torso or a leg really sits. */
  const box = (left: number, w: number, h: number) => ({
    minX: left,
    minY: 400,
    maxX: left + w,
    maxY: 400 + h,
  })

  /**
   * The three pairs `strides-ac9.11` measured live and then LOOKED at, reproduced to the pixel from
   * the `[pair-geometry]` probe (real GPU, 3 trials, bit-identical). Between them they bracket the
   * threshold from both sides with images whose readability is a matter of record, not of taste.
   */
  // gh #71: `trunkLean` on `e2e/fixtures/multiperson-track.mp4`, 1920×1080 — the whole-frame crop.
  // Two torso boxes, 34×79 and 53×131, unioning to 1144 px of mostly chain-link fence.
  const BROKEN = [box(300, 34, 79), box(1410, 53, 131)] as const
  // Demo 1's `verticalRatio` `stridePair`, 3840×2160 — the ghost #71 singles out as the BEST of
  // them all ("the stride gap IS the picture"), and the widest legible union measured anywhere.
  const STRIDE_PAIR = [box(300, 143, 551), box(1159, 305, 563)] as const
  // Demo 1's `kneeFlexion`, 3840×2160 — legible, and lopsided: 303 px tall at one instant and
  // 553 px at the other.
  const LOPSIDED = [box(200, 296, 303), box(1034, 225, 553)] as const

  it('reproduces the measured growth of all three live pairs', () => {
    // 5.815, not the 3.375 `strides-ac9.11` recorded: that reading was `1080 / 320` exactly —
    // union at the frame cap over solo at the floor — and `strides-492` reads the crop each side
    // DEMANDS instead, which uncaps the numerator. The broken pair moves AWAY from the threshold.
    expect(evidencePairCropGrowth(BROKEN[0], BROKEN[1], HD)).toBeCloseTo(5.815, 3)
    // Both legible pairs are byte-unchanged: neither union comes near a 4K clip's 2160 cap, so
    // there was nothing for the cap to hide, and the calibration bracket's lower side is untouched.
    // 2.0675, which is what the probe's 3-decimal `2.068` was rounded from.
    expect(
      evidencePairCropGrowth(STRIDE_PAIR[0], STRIDE_PAIR[1], UHD),
    ).toBeCloseTo(2.0675, 4)
    expect(evidencePairCropGrowth(LOPSIDED[0], LOPSIDED[1], UHD)).toBeCloseTo(
      1.915,
      3,
    )
  })

  it('rejects the broken pair and keeps both legible ones', () => {
    expect(isTooFarApartPair(BROKEN[0], BROKEN[1], HD)).toBe(true)
    expect(isTooFarApartPair(STRIDE_PAIR[0], STRIDE_PAIR[1], UHD)).toBe(false)
    expect(isTooFarApartPair(LOPSIDED[0], LOPSIDED[1], UHD)).toBe(false)
    // The threshold sits in the gap those three leave, and nothing measured lands between 2.068
    // and 3.375 — so moving it is a decision to reclassify one of these images, not a tweak.
    expect(EVIDENCE_MAX_PAIR_CROP_GROWTH).toBe(2.5)
  })

  it('measures separation RELATIVE to the subject, not in pixels or seconds', () => {
    // Why the criterion is not "how far apart are they". The LEGIBLE pair has the LARGER absolute
    // union — 1164 px against the broken pair's 1144 — because its subject is four times taller.
    // A separation threshold, and the elapsed-time proxy that stands in for one, both order these
    // two backwards.
    const brokenUnion = BROKEN[1].maxX - BROKEN[0].minX
    const strideUnion = STRIDE_PAIR[1].maxX - STRIDE_PAIR[0].minX
    expect(strideUnion).toBeGreaterThan(brokenUnion)
    expect(
      evidencePairCropGrowth(STRIDE_PAIR[0], STRIDE_PAIR[1], UHD),
    ).toBeLessThan(evidencePairCropGrowth(BROKEN[0], BROKEN[1], HD)!)
  })

  it('takes the LARGER of the two single crops, so a lopsided pair is judged on its better half', () => {
    // Against its SMALLER half the legible `kneeFlexion` pair reads ~3.50, which is 40% past the
    // threshold — so a `min` reading would DROP a picture two reviewers called clearly readable,
    // while the `max` reading keeps it at 1.915.
    const union: BoundingBoxPx = {
      minX: LOPSIDED[0].minX,
      minY: Math.min(LOPSIDED[0].minY, LOPSIDED[1].minY),
      maxX: LOPSIDED[1].maxX,
      maxY: Math.max(LOPSIDED[0].maxY, LOPSIDED[1].maxY),
    }
    const minReading =
      evidenceCropSideDemand(union) /
      Math.min(
        evidenceCropSideDemand(LOPSIDED[0]),
        evidenceCropSideDemand(LOPSIDED[1]),
      )
    expect(minReading).toBeCloseTo(3.495, 3)
    expect(minReading).toBeGreaterThan(EVIDENCE_MAX_PAIR_CROP_GROWTH)
    expect(evidencePairCropGrowth(LOPSIDED[0], LOPSIDED[1], UHD)!).toBeLessThan(
      EVIDENCE_MAX_PAIR_CROP_GROWTH,
    )
    // Order cannot matter: `max` is symmetric, and which instant is base is the metric's choice.
    expect(evidencePairCropGrowth(LOPSIDED[1], LOPSIDED[0], UHD)).toEqual(
      evidencePairCropGrowth(LOPSIDED[0], LOPSIDED[1], UHD),
    )
  })

  it('is 1 when ghosting costs nothing', () => {
    const still = box(300, 400, 400)
    expect(evidencePairCropGrowth(still, { ...still }, UHD)).toBeCloseTo(1, 10)
  })

  it('fires at the threshold and not a hair below it', () => {
    // 400×400 boxes on 4K, where neither the floor nor the cap binds: growth is exactly
    // `(400 + separation) / 400`, so 600 px apart is 2.5 on the nose.
    expect(
      evidencePairCropGrowth(box(300, 400, 400), box(900, 400, 400), UHD),
    ).toBeCloseTo(2.5, 10)
    expect(isTooFarApartPair(box(300, 400, 400), box(900, 400, 400), UHD)).toBe(
      true,
    )
    expect(isTooFarApartPair(box(300, 400, 400), box(880, 400, 400), UHD)).toBe(
      false,
    )
  })

  it('cannot fire on a small source — the FLOOR bounds it there, not the cap', () => {
    // `strides-492` took the frame cap out of this measure, so the small-source safety the old
    // comment credited to the cap has to come from somewhere else. It does, and from the clamp that
    // genuinely cancels: the union's long side cannot exceed the frame's own larger dimension `D`,
    // while the denominator sits on the 320 px floor for any subject a small frame can hold — so
    // growth is bounded by `D × 1.6 / 320`, reaching 2.5 only at `D ≥ 500`. On 320×240 the ceiling
    // is 1.6, and this guard cannot fire there at any separation, for any subject size.
    const tiny: EvidenceFrameSize = { width: 320, height: 240 }
    const inFrame = (left: number, w: number, h: number): BoundingBoxPx => ({
      minX: left,
      minY: 20,
      maxX: left + w,
      maxY: 20 + h,
    })
    const ordinary = [inFrame(20, 40, 120), inFrame(70, 40, 120)] as const
    expect(evidencePairCropGrowth(ordinary[0], ordinary[1], tiny)).toBeCloseTo(
      1,
      10,
    )
    expect(isTooFarApartPair(ordinary[0], ordinary[1], tiny)).toBe(false)

    // Opposite edges of the frame: the worst pair a 320 px-wide source can produce.
    const worst = [inFrame(0, 40, 120), inFrame(280, 40, 120)] as const
    expect(evidencePairCropGrowth(worst[0], worst[1], tiny)).toBeCloseTo(
      (tiny.width * EVIDENCE_CROP_PADDING_MULTIPLIER) /
        EVIDENCE_CROP_MIN_SIDE_PX,
      10,
    )
    expect(isTooFarApartPair(worst[0], worst[1], tiny)).toBe(false)

    // A larger subject only raises the denominator, so the ceiling holds across subject scale.
    const big = [inFrame(0, 100, 200), inFrame(220, 100, 200)] as const
    expect(evidencePairCropGrowth(big[0], big[1], tiny)!).toBeLessThan(
      EVIDENCE_MAX_PAIR_CROP_GROWTH,
    )
  })

  it('sees separation on a 4K frame, where the cap used to erase it', () => {
    // `strides-492`'s measurement, reproduced. A 320×1240 full-body box on 3840×2160 demands a
    // 1984 px solo crop, so the union hits the 2160 cap almost immediately — under the capped
    // formula HALF A FRAME apart and OPPOSITE EDGES both read 1.0887, and the worst pair possible
    // scored 1.09 against a threshold of 2.5. These three must now be distinct and increasing.
    const body = (left: number) => box(left, 320, 1240)
    const adjacent = evidencePairCropGrowth(body(0), body(320), UHD)!
    const halfFrame = evidencePairCropGrowth(body(0), body(1920), UHD)!
    const oppositeEdges = evidencePairCropGrowth(body(0), body(3520), UHD)!

    expect(adjacent).toBeCloseTo(1, 10)
    expect(halfFrame).toBeCloseTo(1.8065, 4)
    expect(oppositeEdges).toBeCloseTo(3.0968, 4)
    expect(adjacent).toBeLessThan(halfFrame)
    expect(halfFrame).toBeLessThan(oppositeEdges)

    // The whole point: the worst pair on the clip is now rejected.
    expect(oppositeEdges).toBeGreaterThan(EVIDENCE_MAX_PAIR_CROP_GROWTH)
    expect(isTooFarApartPair(body(0), body(3520), UHD)).toBe(true)
    expect(isTooFarApartPair(body(0), body(320), UHD)).toBe(false)

    // Both saturated readings the ticket measured, so the regression is pinned from the other side
    // too: under the capped formula these two were the SAME number.
    const capped = (a: BoundingBoxPx, b: BoundingBoxPx) => {
      const side = (bx: BoundingBoxPx) =>
        computeCropRect(
          bx,
          UHD.width,
          UHD.height,
          EVIDENCE_CROP_PADDING_MULTIPLIER,
          EVIDENCE_CROP_MIN_SIDE_PX,
        ).side
      return (
        side({
          minX: Math.min(a.minX, b.minX),
          minY: Math.min(a.minY, b.minY),
          maxX: Math.max(a.maxX, b.maxX),
          maxY: Math.max(a.maxY, b.maxY),
        }) / Math.max(side(a), side(b))
      )
    }
    expect(capped(body(0), body(1920))).toBeCloseTo(
      capped(body(0), body(3520)),
      10,
    )
  })

  it('equals `computeCropRect`\'s own side wherever the cap does not bind', () => {
    // `evidenceCropSideDemand` re-derives two lines of `computeCropRect` rather than calling it, so
    // the padding and the floor could drift apart from the crop that is actually drawn. They must
    // agree everywhere the only clause they differ on is inactive.
    const cases: Array<[BoundingBoxPx, EvidenceFrameSize]> = [
      [box(300, 400, 400), UHD],
      [box(300, 34, 79), HD],
      [box(200, 296, 303), UHD],
      [STRIDE_PAIR[1], UHD],
    ]
    for (const [b, frame] of cases) {
      const drawn = computeCropRect(
        b,
        frame.width,
        frame.height,
        EVIDENCE_CROP_PADDING_MULTIPLIER,
        EVIDENCE_CROP_MIN_SIDE_PX,
      ).side
      expect(drawn).toBeLessThan(Math.min(frame.width, frame.height))
      expect(evidenceCropSideDemand(b)).toBeCloseTo(drawn, 10)
    }
  })

  it('cannot fire on two small boxes the 320 px floor already frames together', () => {
    // Both crops sit on the floor, so ghosting cost nothing a single would not also have paid.
    // Charging the pair for the floor would make this a "subject too small" guard — a different
    // question, about a framing decision the demoted single would inherit anyway.
    expect(
      evidencePairCropGrowth(box(300, 40, 60), box(400, 40, 60), HD),
    ).toBeCloseTo(1, 10)
    expect(isTooFarApartPair(box(300, 40, 60), box(400, 40, 60), HD)).toBe(false)
  })

  it('is null, never a small number, where no ratio can be formed', () => {
    const [a, b] = [box(300, 400, 400), box(900, 400, 400)]
    expect(evidencePairCropGrowth(a, b, { width: 0, height: 1080 })).toBeNull()
    expect(evidencePairCropGrowth(a, b, { width: NaN, height: 1080 })).toBeNull()
    // ...and a ratio that could not be formed must not read as "close enough to keep" either.
    expect(isTooFarApartPair(a, b, { width: 0, height: 1080 })).toBe(false)
  })
})

describe('planExemplarFrames', () => {
  const frames = sampledFrames()

  it('plans a single instant with no ghost', () => {
    const plan = planExemplarFrames(
      'footStrikePattern',
      exemplar({ kind: 'footStrike', side: 'left' }),
      frames,
      HD,
      0.05,
    )
    expect(plan).toMatchObject({
      metric: 'footStrikePattern',
      kind: 'footStrike',
      side: 'left',
      base: { timestamp: 0.5, opacity: EVIDENCE_BASE_OPACITY },
      ghost: null,
      demotion: null,
      // No ghost is drawn, so there is no growth — `null`, not the 1 an unghosted image would
      // trivially score.
      cropGrowth: null,
    })
  })

  it('omits `side` entirely when the exemplar carries none', () => {
    const plan = planExemplarFrames(
      'stepWidth',
      exemplar({ kind: 'stepWidthStrike' }),
      frames,
      HD,
      0.05,
    )
    expect(plan).not.toBeNull()
    expect('side' in plan!).toBe(false)
  })

  it('plans a pair as base at full opacity and ghost at the blend alpha', () => {
    const paired = separatedPair(540)
    const plan = planExemplarFrames(
      'trunkLean',
      exemplar({ timestamp: 0, pairedTimestamp: 0.4 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.base).toMatchObject({
      timestamp: 0,
      opacity: EVIDENCE_BASE_OPACITY,
    })
    expect(plan?.ghost).toMatchObject({
      timestamp: 0.4,
      opacity: EVIDENCE_GHOST_BLEND_ALPHA,
    })
    expect(plan?.demotion).toBeNull()
    // One rect, unioned across both drawn frames.
    expect(plan?.crop).toEqual(
      computeEvidenceCropRect(paired, [...HIP_SEED], HD),
    )
    // The reading `isTooFarApartPair` just cleared, carried on the plan so `[evidence-coverage]`
    // can report what this image actually cost without a probe patch (`strides-492`).
    // `separatedPair`'s two 100 px hip pairs sit 200 px apart, so each instant demands the 320 px
    // floor on its own and the union demands 300 x 1.6 = 480.
    expect(plan?.cropGrowth).toBeCloseTo(
      (300 * EVIDENCE_CROP_PADDING_MULTIPLIER) / EVIDENCE_CROP_MIN_SIDE_PX,
      10,
    )
    expect(plan!.cropGrowth!).toBeLessThan(EVIDENCE_MAX_PAIR_CROP_GROWTH)
  })

  it('reports no growth for a pair that demoted to its base', () => {
    // Two indistinguishable instants collapse to one drawn frame, and an image with no ghost has
    // no ghosting cost to report.
    const plan = planExemplarFrames(
      'stepWidth',
      exemplar({ kind: 'stepWidthStrike', timestamp: 0, pairedTimestamp: 0.01 }),
      [hipFrame(0, 500, 540), hipFrame(0.01, 500, 540)],
      HD,
      0.05,
    )
    expect(plan?.demotion).toBe('collapsed-pair')
    expect(plan?.cropGrowth).toBeNull()
  })

  it('resolves annotation inputs for BOTH instants of a pair, at each instant', () => {
    // Two genuinely different hip positions: an annotation of the ghost that reused the base's
    // positions would draw the second body's marks on the first body.
    const paired = separatedPair(620)
    const plan = planExemplarFrames(
      'trunkLean',
      exemplar({ timestamp: 0, pairedTimestamp: 0.4 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.base.keypoints).toEqual(
      resolveInstantKeypoints(paired[0], [...HIP_SEED]),
    )
    expect(plan?.ghost?.keypoints).toEqual(
      resolveInstantKeypoints(paired[1], [...HIP_SEED]),
    )
    expect(plan?.base.keypoints).not.toEqual(plan?.ghost?.keypoints)
    // And the per-frame sign is per-frame, resolved from each instant's own hips.
    expect(plan?.base.outwardSign).toEqual(resolveOutwardSigns(paired[0]))
    expect(plan?.ghost?.outwardSign).toEqual(resolveOutwardSigns(paired[1]))
  })

  it('gives each half of a stepWidth pair its own, DIFFERENT foot', () => {
    // The pair `stepWidth` builds is opposite-footed by construction, so the frame-level `side` is
    // absent and cannot answer this — which is the whole reason the per-instant field exists.
    const paired = separatedPair(620)
    const plan = planExemplarFrames(
      'stepWidth',
      exemplar({
        kind: 'stepWidthStrike',
        timestamp: 0,
        pairedTimestamp: 0.4,
        measuredSide: 'left',
        pairedMeasuredSide: 'right',
      }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.base.side).toBe('left')
    expect(plan?.ghost?.side).toBe('right')
    expect(plan?.base.side).not.toBe(plan?.ghost?.side)
    // ...and the frame-level field is still absent, because the pair still has no ONE side.
    expect('side' in plan!).toBe(false)
  })

  it('gives each half of an overstride pair its own foot', () => {
    const paired = separatedPair(620)
    const plan = planExemplarFrames(
      'overstriding',
      exemplar({
        kind: 'overstrideRange',
        timestamp: 0,
        pairedTimestamp: 0.4,
        measuredSide: 'right',
        pairedMeasuredSide: 'left',
      }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.base.side).toBe('right')
    expect(plan?.ghost?.side).toBe('left')
  })

  it('carries an explicit absence, never a default side, when the metric named none', () => {
    // `null` rather than `undefined` or a quietly-chosen `'left'`: a caliper anchored on a guessed
    // foot is a confident picture of a measurement nobody took, and nothing downstream could tell.
    const paired = separatedPair(620)
    const plan = planExemplarFrames(
      'trunkLean',
      exemplar({ timestamp: 0, pairedTimestamp: 0.4 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.base.side).toBeNull()
    expect(plan?.ghost?.side).toBeNull()
  })

  it('falls back to the pair-level `side`, which by contract covers both instants', () => {
    // Every same-side metric (`kneeFlexionPeak`, `stridePair`, `armSwingCycle`, `footStrike`)
    // supplies only `side`, whose own contract is "only when both instants share that side" — so
    // attributing it to each instant reads a documented invariant rather than guessing, and those
    // four metrics needed no change to become answerable.
    const paired = separatedPair(620)
    const plan = planExemplarFrames(
      'kneeFlexion',
      exemplar({
        kind: 'kneeFlexionPeak',
        timestamp: 0,
        pairedTimestamp: 0.4,
        side: 'right',
      }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.base.side).toBe('right')
    expect(plan?.ghost?.side).toBe('right')
  })

  it('prefers the per-instant side over the pair-level one, being the narrower claim', () => {
    // `overstriding` emits both whenever its two strikes happen to share a foot. They agree there;
    // this pins which one is authoritative if they ever could not.
    expect(
      resolveInstantSide(
        exemplar({ side: 'left', measuredSide: 'right', pairedMeasuredSide: 'left' }),
        'base',
      ),
    ).toBe('right')
    expect(resolveInstantSide(exemplar({ side: 'left' }), 'ghost')).toBe('left')
    expect(resolveInstantSide(exemplar(), 'base')).toBeNull()
  })

  it('never reads the side off `cropKeypoints` ordering', () => {
    // The measured ankle IS ordered first in both metrics' crop sets today, so an inference from
    // position 0 would pass every other test in this file. It is a private consequence of
    // `seedFor(base)` being concatenated ahead of `seedFor(ghost)`, not a contract — so a crop set
    // that leads with the OTHER foot must still resolve to what the metric actually said.
    const contradicting = exemplar({
      kind: 'stepWidthStrike',
      cropKeypoints: ['right_ankle', 'left_hip', 'right_hip', 'left_ankle'],
      measuredSide: 'left',
    })
    expect(resolveInstantSide(contradicting, 'base')).toBe('left')
    // ...and stripped of the stated side it resolves to nothing, rather than to `'right'`.
    expect(
      resolveInstantSide(
        exemplar({
          kind: 'stepWidthStrike',
          cropKeypoints: ['right_ankle', 'left_hip', 'right_hip', 'left_ankle'],
        }),
        'base',
      ),
    ).toBeNull()
  })

  it('prefers the per-instant annotation set over the crop set, per role', () => {
    // The crop set is the UNION across a pair, because one photograph has to hold both instants.
    // The annotation set is per-instant, because the joint layer is a statement about what THIS
    // moment's measurement was about. Where a metric states the narrower fact, it wins.
    const mixed = exemplar({
      kind: 'overstrideRange',
      cropKeypoints: ['left_ankle', 'left_hip', 'right_hip', 'right_ankle'],
      annotationKeypoints: ['left_ankle', 'left_hip', 'right_hip'],
      pairedAnnotationKeypoints: ['right_ankle', 'left_hip', 'right_hip'],
    })
    expect(resolveInstantAnnotationKeypoints(mixed, 'base')).toEqual([
      'left_ankle',
      'left_hip',
      'right_hip',
    ])
    expect(resolveInstantAnnotationKeypoints(mixed, 'ghost')).toEqual([
      'right_ankle',
      'left_hip',
      'right_hip',
    ])
  })

  it('falls back to `cropKeypoints` per role, independently of the other role', () => {
    // Absent on BOTH: a same-side pair or a single instant, where the crop set IS the per-instant
    // set by construction — so the fallback is independently correct, not an approximation.
    const silent = exemplar({ cropKeypoints: ['left_hip', 'right_hip', 'left_knee'] })
    expect(resolveInstantAnnotationKeypoints(silent, 'base')).toEqual(
      silent.cropKeypoints,
    )
    expect(resolveInstantAnnotationKeypoints(silent, 'ghost')).toEqual(
      silent.cropKeypoints,
    )

    // ...and one role stating it never speaks for the other.
    const halfStated = exemplar({
      cropKeypoints: ['left_ankle', 'left_hip', 'right_hip', 'right_ankle'],
      annotationKeypoints: ['left_ankle', 'left_hip', 'right_hip'],
    })
    expect(resolveInstantAnnotationKeypoints(halfStated, 'base')).toEqual([
      'left_ankle',
      'left_hip',
      'right_hip',
    ])
    expect(resolveInstantAnnotationKeypoints(halfStated, 'ghost')).toEqual(
      halfStated.cropKeypoints,
    )
  })

  it('gives each half of a mixed-foot overstride pair its own leg to draw', () => {
    const plan = planExemplarFrames(
      'overstriding',
      MIXED_FOOT_OVERSTRIDE,
      LEGGED_PAIR,
      HD,
      0.05,
    )
    const drawn = (
      keypoints: ReturnType<typeof resolveInstantKeypoints> | undefined,
    ) => (keypoints ?? []).map((kp) => kp.name)

    expect(drawn(plan?.base.keypoints)).toEqual([
      'left_ankle',
      'left_hip',
      'right_hip',
      'left_knee',
    ])
    expect(drawn(plan?.ghost?.keypoints)).toEqual([
      'right_ankle',
      'left_hip',
      'right_hip',
      'right_knee',
    ])
    // Disjoint on the legs: neither half draws the limb its own caliper did not measure.
    const legOf = (names: string[]) =>
      names.filter((name) => name.endsWith('_ankle') || name.endsWith('_knee'))
    expect(legOf(drawn(plan?.base.keypoints))).toEqual(['left_ankle', 'left_knee'])
    expect(legOf(drawn(plan?.ghost?.keypoints))).toEqual([
      'right_ankle',
      'right_knee',
    ])
  })

  it('leaves the crop untouched by the per-instant annotation sets', () => {
    // The image still has to contain both instants, so the crop keeps reading the UNION. This is
    // the one assertion that stops a future narrowing from leaking out of the joint layer.
    const unstated: MetricExemplar = { ...MIXED_FOOT_OVERSTRIDE }
    delete unstated.annotationKeypoints
    delete unstated.pairedAnnotationKeypoints

    const annotated = planExemplarFrames(
      'overstriding',
      MIXED_FOOT_OVERSTRIDE,
      LEGGED_PAIR,
      HD,
      0.05,
    )
    const plain = planExemplarFrames(
      'overstriding',
      unstated,
      LEGGED_PAIR,
      HD,
      0.05,
    )

    expect(annotated?.crop).toEqual(plain?.crop)
    expect(annotated?.cropGrowth).toEqual(plain?.cropGrowth)
    // ...and the plain plan really does draw the union, so the comparison is not vacuous.
    expect(plain?.base.keypoints.map((kp) => kp.name)).toEqual(
      MIXED_FOOT_OVERSTRIDE.cropKeypoints,
    )
  })

  it('carries an unrecoverable keypoint as unrecoverable rather than dropping or moving it', () => {
    const frames = [
      buildFrame(
        {
          left_hip: { x: 500, y: 540 },
          right_hip: { x: 600, y: 540, status: 'interpolated' },
        },
        0,
      ),
    ]
    const plan = planExemplarFrames(
      'footStrikePattern',
      // `left_heel` is named but unrecoverable on this backend — the crop already tolerates that;
      // the annotation has to KNOW about it rather than silently see two keypoints.
      exemplar({
        kind: 'footStrike',
        timestamp: 0,
        cropKeypoints: [...HIP_SEED, 'left_heel'],
      }),
      frames,
      HD,
      0.05,
    )
    expect(plan?.base.keypoints).toEqual([
      { name: 'left_hip', status: 'detected', x: 500, y: 540 },
      { name: 'right_hip', status: 'interpolated', x: 600, y: 540 },
      { name: 'left_heel', status: 'unrecoverable' },
    ])
  })

  it('carries the clip-wide travel direction, defaulting to the frames it was given', () => {
    // Asserted against a fixture with a REAL direction, and against the literal ±1 rather than
    // against another call to the same function — otherwise this passes against a hardcoded 0.
    const rightward = travellingFrames()
    const leftward = travellingFrames(11, -40)
    expect(evidenceTravelDirection(rightward)).toBe(1)
    expect(evidenceTravelDirection(leftward)).toBe(-1)

    expect(
      planExemplarFrames('trunkLean', exemplar(), rightward, HD, 0.05)
        ?.travelDirection,
    ).toBe(1)
    expect(
      planExemplarFrames('trunkLean', exemplar(), leftward, HD, 0.05)
        ?.travelDirection,
    ).toBe(-1)
  })

  it('takes the travel direction it is threaded, so every item of a clip agrees', () => {
    const plan = planExemplarFrames('trunkLean', exemplar(), frames, HD, 0.05, -1)
    expect(plan?.travelDirection).toBe(-1)
  })

  it('demotes a near-identical pair to its base for a kind that reads as a single', () => {
    const paired = [boxFrame(0, 500, 440), boxFrame(0.4, 500.5, 440)]
    const plan = planExemplarFrames(
      'stepWidth',
      exemplar({ kind: 'stepWidthStrike', timestamp: 0, pairedTimestamp: 0.4 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.ghost).toBeNull()
    expect(plan?.demotion).toBe('collapsed-pair')
    // The crop now frames the base alone — the ghost is not being drawn.
    expect(plan?.crop).toEqual(
      computeEvidenceCropRect([paired[0]], [...HIP_SEED], HD),
    )
  })

  it('drops a near-identical pair for a kind with nothing to say from one instant', () => {
    const paired = [boxFrame(0, 500, 440), boxFrame(0.4, 500.5, 440)]
    for (const kind of [
      'bounceCycle',
      'armSwingCycle',
      'stridePair',
    ] satisfies MetricExemplarKind[]) {
      expect(
        planExemplarFrames(
          'trunkLean',
          exemplar({ kind, timestamp: 0, pairedTimestamp: 0.4 }),
          paired,
          HD,
          0.05,
        ),
      ).toBeNull()
    }
  })

  it('demotes a near-identical range kind, whose card reports a median of single instants', () => {
    // `strides-ddj`, and the same correction `strides-r41` made for `kneeFlexionPeak` above.
    // `computeTrunkLean` returns the median of per-frame angles and `computeOverstriding` the
    // median of per-strike ratios — each measured at ONE instant — so the kind's *name* describes
    // how the exemplar was built, not what the card reports, and the surviving frame still shows
    // the geometry that was measured on it.
    const paired = [boxFrame(0, 500, 440), boxFrame(0.4, 500.5, 440)]
    for (const kind of [
      'trunkLeanRange',
      'overstrideRange',
    ] satisfies MetricExemplarKind[]) {
      const plan = planExemplarFrames(
        'trunkLean',
        exemplar({ kind, timestamp: 0, pairedTimestamp: 0.4 }),
        paired,
        HD,
        0.05,
      )
      expect(plan?.ghost).toBeNull()
      expect(plan?.demotion).toBe('collapsed-pair')
    }
  })

  it('demotes a near-identical peak kind, whose value is a single-instant angle', () => {
    // `strides-r41` for `kneeFlexionPeak`; `kneeDrivePeak` joined the set at birth on the same
    // principle. The peak angle the card reports is read off ONE frame and the annotation
    // draws that frame's own arc, so the surviving still shows exactly what the number is about —
    // unlike a cycle or a range, whose number IS the difference between two instants. Grouping it
    // with those had the effect that the rules meant to REPLACE a bad ghost with an honest still
    // deleted this metric's evidence instead.
    const paired = [boxFrame(0, 500, 440), boxFrame(0.4, 500.5, 440)]
    for (const [metric, kind] of [
      ['kneeFlexion', 'kneeFlexionPeak'],
      ['kneeDrive', 'kneeDrivePeak'],
    ] satisfies Array<[MetricId, MetricExemplarKind]>) {
      const plan = planExemplarFrames(
        metric,
        exemplar({ kind, timestamp: 0, pairedTimestamp: 0.4 }),
        paired,
        HD,
        0.05,
      )
      expect(plan?.ghost).toBeNull()
      expect(plan?.demotion).toBe('collapsed-pair')
    }
  })

  /** Two hip pairs a thousand pixels apart — over `EVIDENCE_MAX_PAIR_CROP_GROWTH` and nowhere near
   * any collapse rule, so the far-apart branch is the only one that can fire. */
  const farApartPair = () => [hipFrame(0, 400, 540), hipFrame(0.4, 1400, 540)]

  it('drops a far-apart pair for a kind whose number IS the difference between two instants', () => {
    // A cycle or a stride pair reports an amplitude or a displacement, so one frame of it depicts
    // no part of the number on the card. `stridePair` additionally cannot be demoted mechanically:
    // its only measurement mark, `strideCaliper`, spans the two hip midpoints and is built under
    // `plan.ghost !== null`, so a demoted stride pair would lose exactly the mark that IS the
    // measurement.
    const paired = farApartPair()
    expect(
      isTooFarApartPair(
        frameCropBox(paired[0], [...HIP_SEED])!,
        frameCropBox(paired[1], [...HIP_SEED])!,
        HD,
      ),
    ).toBe(true)
    for (const kind of [
      'bounceCycle',
      'armSwingCycle',
      'stridePair',
    ] satisfies MetricExemplarKind[]) {
      expect(
        planExemplarFrames(
          'trunkLean',
          exemplar({ kind, timestamp: 0, pairedTimestamp: 0.4 }),
          paired,
          HD,
          0.05,
        ),
      ).toBeNull()
    }
  })

  it('demotes a far-apart pair for every single-instant kind, and says which rule did it', () => {
    // `strides-ddj`. The far-apart rejection establishes that the two instants cannot share one
    // legible crop; it establishes nothing about whether either instant alone is worth showing,
    // and that second question is answered by the same classification a collapsed pair consults.
    const paired = farApartPair()
    for (const kind of [
      'stepWidthStrike',
      'footStrike',
      'kneeFlexionPeak',
      'kneeDrivePeak',
      'trunkLeanRange',
      'overstrideRange',
    ] satisfies MetricExemplarKind[]) {
      const plan = planExemplarFrames(
        'trunkLean',
        exemplar({ kind, timestamp: 0, pairedTimestamp: 0.4 }),
        paired,
        HD,
        0.05,
      )
      expect(plan?.ghost).toBeNull()
      expect(plan?.demotion).toBe('far-apart-pair')
      // Nothing was ghosted, so there is no ghosting cost to report — `null`, never the reading
      // that caused the rejection, which would make the column mean two different things.
      expect(plan?.cropGrowth).toBeNull()
      // The crop derives from the BASE alone, so the whole-frame union of two far-apart instants
      // — the gh #71 image this guard exists to prevent — is unreachable by construction.
      expect(plan?.crop).toEqual(
        computeEvidenceCropRect([paired[0]], [...HIP_SEED], HD),
      )
    }
  })

  it('leaves a SINGLE-instant exemplar alone however wide its frame', () => {
    // The guard is about what ghosting costs, so an exemplar with no ghost can never reach it —
    // including one whose own box is small enough that a pair built from it would be rejected.
    const plan = planExemplarFrames(
      'footStrikePattern',
      exemplar({ kind: 'footStrike', timestamp: 0, side: 'left' }),
      [hipFrame(0, 400, 540, 40), hipFrame(0.1, 1400, 540, 40)],
      HD,
      0.05,
    )
    expect(plan?.ghost).toBeNull()
    expect(plan?.demotion).toBeNull()
  })

  it('keeps a pair whose boxes overlap just below the threshold', () => {
    const paired = [boxFrame(0, 500, 440), boxFrame(0.4, 502, 440)]
    const plan = planExemplarFrames(
      'trunkLean',
      exemplar({ timestamp: 0, pairedTimestamp: 0.4 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.ghost?.timestamp).toBe(0.4)
  })

  it('collapses a pair whose two instants snap to the same sampled frame', () => {
    const plan = planExemplarFrames(
      'stepWidth',
      exemplar({
        kind: 'stepWidthStrike',
        timestamp: 0.5,
        pairedTimestamp: 0.52,
      }),
      frames,
      HD,
      0.05,
    )
    expect(plan?.ghost).toBeNull()
    expect(plan?.demotion).toBe('collapsed-pair')
  })

  it('collapses a pair whose ghost falls outside the snap tolerance', () => {
    const demoted = planExemplarFrames(
      'stepWidthCm',
      exemplar({ kind: 'stepWidthStrike', pairedTimestamp: 42 }),
      frames,
      HD,
      0.05,
    )
    expect(demoted?.ghost).toBeNull()
    expect(demoted?.demotion).toBe('collapsed-pair')

    expect(
      planExemplarFrames(
        'verticalOscillation',
        exemplar({ kind: 'bounceCycle', pairedTimestamp: 42 }),
        frames,
        HD,
        0.05,
      ),
    ).toBeNull()
  })

  it('collapses a pair whose ghost frame has no resolvable crop keypoint', () => {
    const paired = [hipFrame(0, 500, 540), buildFrame({}, 0.4)]
    expect(
      planExemplarFrames(
        'stepWidth',
        exemplar({ kind: 'stepWidthStrike', timestamp: 0, pairedTimestamp: 0.4 }),
        paired,
        HD,
        0.05,
      )?.ghost,
    ).toBeNull()
    expect(
      planExemplarFrames(
        'verticalOscillation',
        exemplar({ kind: 'bounceCycle', timestamp: 0, pairedTimestamp: 0.4 }),
        paired,
        HD,
        0.05,
      ),
    ).toBeNull()
  })

  it('is null when the base does not snap, or its frame has no crop region', () => {
    expect(
      planExemplarFrames(
        'trunkLean',
        exemplar({ timestamp: 42 }),
        frames,
        HD,
        0.05,
      ),
    ).toBeNull()
    const blank = [buildFrame({}, 0), buildFrame({}, 0.1)]
    expect(
      planExemplarFrames(
        'trunkLean',
        exemplar({ timestamp: 0 }),
        blank,
        HD,
        0.05,
      ),
    ).toBeNull()
  })
})

describe('planExemplarWithFallback', () => {
  const FRAMES = crossingFrames()
  /** `crossingFrames`' median interval is 0.1 s, so this is what `planMetricEvidence` derives. */
  const TOLERANCE = 0.05

  function range(
    timestamp: number,
    pairedTimestamp: number,
    quality: number,
    alternates?: MetricExemplar[],
  ): MetricExemplar {
    return exemplar({
      timestamp,
      pairedTimestamp,
      quality,
      ...(alternates === undefined ? {} : { alternates }),
    })
  }

  const planFor = (candidate: MetricExemplar) =>
    planExemplarWithFallback('trunkLean', candidate, FRAMES, HD, TOLERANCE)

  it('draws the winner and reports no alternative when the winner is drawable', () => {
    // Four samples apart: growth 2.1, comfortably inside the guard and clear of the near floor.
    // The alternative exists purely so that "it walked past the winner" would be observable if it
    // happened.
    const plan = planFor(range(0, 0.4, 0.9, [range(0.1, 0.5, 0.6)]))

    expect(plan!.base.timestamp).toBe(0)
    expect(plan!.ghost!.timestamp).toBeCloseTo(0.4, 10)
    expect(plan!.quality).toBe(0.9)
    expect(plan!.cropGrowth).toBeCloseTo(2.1, 10)
  })

  it('falls back past every undrawable pair to the best-ranked drawable one', () => {
    // Winner six samples apart (growth 2.9) and first alternative five apart (exactly 2.5, the
    // inclusive boundary) — both rejected — so the walk has to reach the third entry.
    const plan = planFor(
      range(0, 0.6, 0.9, [range(0, 0.5, 0.7), range(0, 0.4, 0.6)]),
    )

    expect(plan).not.toBeNull()
    expect(plan!.base.timestamp).toBe(0)
    expect(plan!.ghost!.timestamp).toBeCloseTo(0.4, 10)
  })

  it('reports the pair it drew, never the pair it rejected', () => {
    // The whole point of the walk being observable: `quality` and `cropGrowth` ride to the
    // `[evidence-coverage]` line, and a reader told about the winner would be told about an image
    // that was never rendered.
    const plan = planFor(range(0, 0.6, 0.9, [range(0, 0.4, 0.6)]))

    expect(plan!.quality).toBe(0.6)
    expect(plan!.cropGrowth).toBeCloseTo(2.1, 10)
    expect(plan!.ghost!.timestamp).not.toBeCloseTo(0.6, 10)
  })

  it('falls back on a failure that is not the far-apart guard', () => {
    // A ghost outside the snap tolerance collapses the pair — undrawable for a completely
    // different reason, and just as recoverable.
    const plan = planFor(range(0, 9, 0.9, [range(0, 0.4, 0.6)]))

    expect(plan!.ghost!.timestamp).toBeCloseTo(0.4, 10)
    expect(plan!.demotion).toBeNull()
  })

  it('prefers a drawable lower-ranked pair over a demoted higher-ranked one', () => {
    // `strides-ddj`'s load-bearing ordering, on the exact shape it protects: `trunkLeanRange` is
    // demotable now, so without last-resort ordering the winner would stop at its own base and the
    // walk would never reach the drawable alternate. Measured on Demo 1, where `trunkLean`'s
    // winner demands 6.1-6.8 growth and its alternate draws at 1.866, that turns a good ghost into
    // a lone frame — and the coverage line still reports an image, so the regression reads as a
    // fix.
    const plan = planFor(range(0, 0.6, 0.9, [range(0, 0.4, 0.6)]))

    expect(plan!.demotion).toBeNull()
    expect(plan!.ghost!.timestamp).toBeCloseTo(0.4, 10)
    expect(plan!.quality).toBe(0.6)
  })

  it('demotes the winner only once no offered pair can be drawn as a pair', () => {
    // Every candidate far apart, so there is no ghost to be had anywhere — the demoted single is
    // the last resort rather than a competitor.
    const plan = planFor(range(0, 0.6, 0.9, [range(0, 0.5, 0.7)]))

    expect(plan!.demotion).toBe('far-apart-pair')
    expect(plan!.ghost).toBeNull()
    // The FIRST demotable candidate's, not the last: candidates arrive best-first.
    expect(plan!.quality).toBe(0.9)
    expect(plan!.base.timestamp).toBe(0)
  })

  it('is null when no offered pair can be drawn and the kind cannot be demoted', () => {
    // The honest empty result: falling back is not permission to render something that failed a
    // drop rule, and a `bounceCycle`'s number IS the difference between its two instants.
    const cycle = (pairedTimestamp: number, quality: number, alternates?: MetricExemplar[]) =>
      exemplar({
        kind: 'bounceCycle',
        timestamp: 0,
        pairedTimestamp,
        quality,
        ...(alternates === undefined ? {} : { alternates }),
      })

    expect(planFor(cycle(0.6, 0.9, [cycle(0.5, 0.7)]))).toBeNull()
    expect(planFor(cycle(0.6, 0.9))).toBeNull()
  })

  it('will not fall back onto a pair below the shared minimum quality', () => {
    const belowGate = range(0, 0.4, MIN_EXEMPLAR_QUALITY - 0.001)

    // The sub-gate alternate is drawable AS A PAIR and is still not reached, so what comes back is
    // the winner demoted to its base — proof the gate outranks even the last-resort rule, which
    // would otherwise have a drawable pair to prefer.
    const plan = planFor(range(0, 0.6, 0.9, [belowGate]))

    expect(plan!.demotion).toBe('far-apart-pair')
    expect(plan!.quality).toBe(0.9)
  })

  it('leaves a single-instant exemplar alone', () => {
    // No `pairedTimestamp`, so nothing to fall back from — and `alternates` is absent on every
    // exemplar this repo emits that is not a range.
    const plan = planFor(exemplar({ kind: 'footStrike', timestamp: 0.1, quality: 0.9 }))

    expect(plan!.ghost).toBeNull()
    expect(plan!.base.timestamp).toBeCloseTo(0.1, 10)
  })

  describe('breaking a tie on framing', () => {
    /**
     * Two candidates the metric scored IDENTICALLY, one of which puts its focus joint in the
     * middle of the picture and the other at the edge. This is `kneeFlexion`'s shape on
     * `park-side-landscape.mp4`, where an even peak pool makes the two middle values exactly
     * equidistant from the median and their qualities bit-identical, so the emitting sort is
     * indifferent and iteration order decided.
     */
    const focused = (
      timestamp: number,
      pairedTimestamp: number,
      quality: number,
      alternates?: MetricExemplar[],
    ): MetricExemplar =>
      exemplar({
        kind: 'kneeFlexionPeak',
        timestamp,
        pairedTimestamp,
        quality,
        cropFocus: 'left_hip',
        ...(alternates === undefined ? {} : { alternates }),
      })

    /**
     * The subject walking rightwards from the left frame edge at 40 px a sample, so an instant
     * early in the clip cannot be centred on — its crop is already clamped at `x = 0` — and one a
     * few samples later can. That is `park-side-landscape.mp4`'s shape with the runner's exit
     * mirrored to an entry.
     */
    const edgeFrames = () =>
      [0, 1, 2, 3, 4, 5, 6].map((i) =>
        hipFrame(Number((i * 0.1).toFixed(2)), 60 + i * 40, 540),
      )

    const planAt = (candidate: MetricExemplar) =>
      planExemplarWithFallback('kneeFlexion', candidate, edgeFrames(), HD, TOLERANCE)

    it('prefers the better-framed of two equally-scored candidates', () => {
      // Both pairs span four sampled intervals and both draw as pairs, so the last-resort rule is
      // not what decides here — framing is.
      const plan = planAt(focused(0, 0.4, 0.9, [focused(0.2, 0.6, 0.9)]))

      expect(plan!.demotion).toBeNull()
      expect(plan!.base.timestamp).toBeCloseTo(0.2, 10)
      expect(plan!.quality).toBe(0.9)
      expect(plan!.focusOffset).toBeLessThan(0.4)
    })

    it('never lets framing outrank the metric’s own score', () => {
      // The better-framed candidate is a whole tier down, and being well-placed is not being
      // representative: a card showing a well-framed atypical instant is a worse claim than a
      // well-scored awkward one.
      const plan = planAt(focused(0, 0.4, 0.9, [focused(0.2, 0.6, 0.8)]))

      expect(plan!.base.timestamp).toBe(0)
      expect(plan!.quality).toBe(0.9)
      expect(plan!.focusOffset).toBeGreaterThan(0.4)
    })

    it('orders the demoted pool by framing too, since a demoted single can be the outcome', () => {
      // Both pairs are one sampled interval apart, under
      // `EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS`, so both collapse and this pool IS the result.
      // Leaving it to arrival order would put the iteration-order tie-break straight back — which
      // is exactly the case on `park-side-landscape.mp4`, where every `kneeFlexion` candidate at
      // the winning quality collapses.
      const plan = planAt(focused(0, 0.1, 0.9, [focused(0.3, 0.4, 0.9)]))

      expect(plan!.demotion).toBe('collapsed-pair')
      expect(plan!.base.timestamp).toBeCloseTo(0.3, 10)
    })

    it('abstains rather than reading an unresolved focus joint as perfectly centred', () => {
      // `focusOffset` is `null` for two different reasons — the exemplar named no focus joint, or
      // it named one the pipeline LOST at that instant — and only the first is uniform across a
      // metric's candidates. Reading either as `0` would make the candidate whose crop was never
      // aimed, and which therefore fell through to `computeCropRect`'s own placement, beat every
      // aimed one: exactly the inversion this ordering exists to remove. Not reachable through
      // either knee metric today, whose focus joint is a seed of their own series, but the field
      // is designed for reuse and the failure is silent.
      const withKnee = [0, 1, 2, 3, 4, 5, 6].map((i) =>
        hipFrame(Number((i * 0.1).toFixed(2)), 60 + i * 40, 540, 100, {
          // Lost at the first instant only — the alternate's base, not the head's.
          ...(i === 0 ? {} : { left_knee: { x: 60 + i * 40, y: 640 } }),
        }),
      )
      const kneeFocused = (
        timestamp: number,
        pairedTimestamp: number,
        alternates?: MetricExemplar[],
      ): MetricExemplar =>
        exemplar({
          kind: 'kneeFlexionPeak',
          timestamp,
          pairedTimestamp,
          quality: 0.9,
          cropFocus: 'left_knee',
          ...(alternates === undefined ? {} : { alternates }),
        })

      const plan = planExemplarWithFallback(
        'kneeFlexion',
        kneeFocused(0.2, 0.6, [kneeFocused(0, 0.4)]),
        withKnee,
        HD,
        TOLERANCE,
      )

      // The head is aimed and off-centre; the alternate is not aimed at all. The head keeps.
      expect(plan!.base.timestamp).toBeCloseTo(0.2, 10)
      expect(plan!.focusOffset).toBeGreaterThan(0)
    })

    it('leaves an exemplar naming no focus joint on first-wins ordering', () => {
      // Every plan then reports no offset, so no comparison can ever be true and the walk returns
      // exactly what it returned before framing entered the ordering.
      const plan = planFor(range(0, 0.4, 0.9, [range(0.1, 0.5, 0.9)]))

      expect(plan!.focusOffset).toBeNull()
      expect(plan!.base.timestamp).toBe(0)
    })
  })
})

describe('planMetricEvidence', () => {
  it('spends one slot per exemplar however many alternatives each carries', () => {
    // Alternatives are other ways to draw ONE image, so they must not reach the budget as if they
    // were extra exemplars. Every winner here is rejected by the far-apart guard and every
    // alternative is drawable, so all three exemplars produce an image and the cap is what bites.
    const frames = crossingFrames()
    const withAlternates = (quality: number) =>
      exemplar({
        timestamp: 0,
        pairedTimestamp: 0.3,
        quality,
        alternates: [
          exemplar({ timestamp: 0, pairedTimestamp: 0.2, quality: quality - 0.05 }),
          exemplar({ timestamp: 0, pairedTimestamp: 0.1, quality: quality - 0.1 }),
        ],
      })

    const plan = planOf(
      metricResult('trunkLean', {
        exemplars: [withAlternates(0.9), withAlternates(0.8), withAlternates(0.7)],
      }),
      frames,
    )

    expect(plan.status).toBe('planned')
    expect(plan.status === 'planned' && plan.items).toHaveLength(MAX_EXEMPLARS_PER_METRIC)
  })

  it('reports undrawable when no exemplar offers a drawable pair', () => {
    // A `bounceCycle`, whose reported amplitude IS the difference between its two instants, so
    // there is no demoted single to fall back to and the metric genuinely loses its evidence.
    const plan = planOf(
      metricResult('verticalOscillation', {
        exemplars: [
          exemplar({
            kind: 'bounceCycle',
            timestamp: 0,
            pairedTimestamp: 0.6,
            quality: 0.9,
            alternates: [
              exemplar({
                kind: 'bounceCycle',
                timestamp: 0,
                pairedTimestamp: 0.5,
                quality: 0.7,
              }),
            ],
          }),
        ],
      }),
      crossingFrames(),
    )

    expect(reasonOf(plan)).toBe('undrawable')
  })

  it('renders a demoted single rather than gating a single-instant metric out entirely', () => {
    // The user-visible half of `strides-ddj`: on Demo 1 `overstriding` had exactly one possible
    // pair (two surviving strikes), it demanded 2.881x growth, and the card showed nothing at all.
    const plan = planOf(
      metricResult('overstriding', {
        exemplars: [
          exemplar({
            kind: 'overstrideRange',
            timestamp: 0,
            pairedTimestamp: 0.6,
            quality: 0.9,
          }),
        ],
      }),
      crossingFrames(),
    )

    expect(plan.status).toBe('planned')
    expect(plan.status === 'planned' && plan.items[0].demotion).toBe('far-apart-pair')
  })


  const frames = sampledFrames()

  it('plans the surviving exemplars in the order the metric emitted them', () => {
    const plan = planOf(
      metricResult('trunkLean', {
        exemplars: [
          exemplar({ label: 'first' }),
          exemplar({ label: 'second', timestamp: 0.8 }),
        ],
      }),
      frames,
    )
    expect(plan.status).toBe('planned')
    expect(plan.status === 'planned' && plan.items.map((i) => i.label)).toEqual([
      'first',
      'second',
    ])
  })

  it('re-applies the per-metric budget after its own drops, without re-ranking', () => {
    const plan = planOf(
      metricResult('trunkLean', {
        exemplars: [
          // Unresolvable here: dropped, so it does not consume a slot.
          exemplar({ label: 'unresolvable', timestamp: 42 }),
          exemplar({ label: 'first', timestamp: 0.3 }),
          exemplar({ label: 'second', timestamp: 0.5 }),
          exemplar({ label: 'third', timestamp: 0.8 }),
        ],
      }),
      frames,
    )
    expect(plan.status === 'planned' && plan.items.map((i) => i.label)).toEqual([
      'first',
      'second',
    ])
  })

  it('reports metric-excluded for a metric that renders no card', () => {
    expect(
      reasonOf(planOf(metricResult('trunkLean', { value: null }), frames)),
    ).toBe('metric-excluded')
    expect(
      reasonOf(
        planOf(metricResult('trunkLean', { viewFit: 'unsuitable' }), frames),
      ),
    ).toBe('metric-excluded')
  })

  it('reports not-emitted for cadence, which is a property of a sequence', () => {
    expect(
      reasonOf(
        planOf(
          metricResult('cadence', { exemplars: [exemplar()] }),
          frames,
        ),
      ),
    ).toBe('not-emitted')
  })

  it('reports frames-unavailable when there is no sampling grid or no frame size', () => {
    const metric = metricResult('trunkLean', { exemplars: [exemplar()] })
    expect(reasonOf(planOf(metric, []))).toBe('frames-unavailable')
    expect(reasonOf(planOf(metric, [hipFrame(0.5, 960, 540)]))).toBe(
      'frames-unavailable',
    )
    expect(
      reasonOf(planOf(metric, frames, { width: 0, height: 0 })),
    ).toBe('frames-unavailable')
  })

  it('reports no-candidates when the metric emitted nothing this run', () => {
    expect(reasonOf(planOf(metricResult('trunkLean'), frames))).toBe(
      'no-candidates',
    )
  })

  it('reports undrawable when every candidate fails to resolve here', () => {
    expect(
      reasonOf(
        planOf(
          metricResult('trunkLean', {
            exemplars: [exemplar({ timestamp: 42 })],
          }),
          frames,
        ),
      ),
    ).toBe('undrawable')
  })

  // `strides-tj5`: which layer withheld the image is the whole point of these three verdicts, and
  // the failure they were split out of was a single string that named rules which had not run. One
  // metric, three inputs differing only in what it offered, three distinct answers — so a collapse
  // back to one string fails here rather than in a live A/B months later.
  it('tells apart offering nothing, offering too little, and offering the undrawable', () => {
    const offeredNothing = reasonOf(planOf(metricResult('trunkLean'), frames))
    const belowGate = reasonOf(
      planOf(
        metricResult('trunkLean', {
          exemplars: [
            exemplar({ quality: MIN_EXEMPLAR_QUALITY - Number.EPSILON * 4 }),
          ],
        }),
        frames,
      ),
    )
    const cannotDraw = reasonOf(
      planOf(
        metricResult('trunkLean', {
          exemplars: [exemplar({ quality: 1, timestamp: 42 })],
        }),
        frames,
      ),
    )

    expect([offeredNothing, belowGate, cannotDraw]).toEqual([
      'no-candidates',
      'below-quality-gate',
      'undrawable',
    ])
    expect(new Set([offeredNothing, belowGate, cannotDraw]).size).toBe(3)
  })

  it('re-applies the quality gate at exactly the shared threshold', () => {
    const keep = planOf(
      metricResult('trunkLean', {
        exemplars: [exemplar({ quality: MIN_EXEMPLAR_QUALITY })],
      }),
      frames,
    )
    expect(keep.status).toBe('planned')

    const drop = planOf(
      metricResult('trunkLean', {
        exemplars: [
          exemplar({ quality: MIN_EXEMPLAR_QUALITY - Number.EPSILON * 4 }),
        ],
      }),
      frames,
    )
    expect(reasonOf(drop)).toBe('below-quality-gate')
  })
})

describe('planClipEvidence', () => {
  const frames = sampledFrames()

  it('returns one entry per metric, so an absent key never means "not computed yet"', () => {
    const plan = planClipEvidence(heuristicsResult(), frames, HD)
    expect(Object.keys(plan)).toHaveLength(12)
    expect(plan.cadence).toEqual({ status: 'no-evidence', reason: 'not-emitted' })
    expect(plan.trunkLean).toEqual({
      status: 'no-evidence',
      reason: 'no-candidates',
    })
  })

  it('plans a metric that emitted exemplars', () => {
    const plan = planClipEvidence(
      heuristicsResult({
        overstriding: { exemplars: [exemplar({ kind: 'overstrideRange' })] },
      }),
      frames,
      HD,
    )
    expect(plan.overstriding.status).toBe('planned')
  })

  it('gives every metric of a clip the same travel direction', () => {
    // Must run on a fixture with a NON-ZERO direction. On a hips-only fixture every value is 0,
    // so `new Set(...).size === 1` holds even for an implementation that recomputes the direction
    // independently per metric — which is the exact property this test claims to pin.
    const travelling = travellingFrames()
    expect(evidenceTravelDirection(travelling)).toBe(1)

    const plan = planClipEvidence(
      heuristicsResult({
        overstriding: { exemplars: [exemplar({ kind: 'overstrideRange' })] },
        trunkLean: { exemplars: [exemplar()] },
        footStrikePattern: {
          exemplars: [exemplar({ kind: 'footStrike', side: 'left' })],
        },
      }),
      travelling,
      HD,
    )
    const directions = Object.values(plan).flatMap((entry) =>
      entry.status === 'planned' ? entry.items.map((i) => i.travelDirection) : [],
    )
    expect(directions).toHaveLength(3)
    expect(directions).toEqual([1, 1, 1])
  })

  it('produces a well-formed plan from metadata whose duration is Infinity', () => {
    // MediaRecorder WebM blobs commonly report an infinite duration and `useVideoSource` copies it
    // in unguarded — nothing here may derive a timestamp from it.
    const metadata: VideoMetadata = {
      durationSec: Infinity,
      width: 1920,
      height: 1080,
      frameRate: null,
    }
    const plan = planClipEvidence(
      heuristicsResult({
        trunkLean: { exemplars: [exemplar({ pairedTimestamp: 0.9 })] },
      }),
      frames,
      metadata,
    )
    expect(plan.trunkLean.status).toBe('planned')
    const item =
      plan.trunkLean.status === 'planned' ? plan.trunkLean.items[0] : null
    expect(item?.base.timestamp).toBeCloseTo(0.5, 10)
    expect(item?.ghost?.timestamp).toBeCloseTo(0.9, 10)
    expect(Number.isFinite(item!.crop.side)).toBe(true)
  })

  it('resolves an exemplar against the UNTRIMMED frames the UI holds', () => {
    // Heuristics run over a presence-trimmed slice while this layer holds the full array. `slice`
    // copies references, so a timestamp is valid on both sides of that boundary — an index would
    // not be, which is why exemplars carry no index at all.
    const untrimmed = sampledFrames()
    const trimmed = untrimmed.slice(3, 8)
    const plan = planClipEvidence(
      heuristicsResult({
        trunkLean: { exemplars: [exemplar({ timestamp: trimmed[1].timestamp })] },
      }),
      untrimmed,
      HD,
    )
    const item =
      plan.trunkLean.status === 'planned' ? plan.trunkLean.items[0] : null
    expect(item?.base.timestamp).toBe(trimmed[1].timestamp)
    expect(findNearestFrame(untrimmed, item!.base.timestamp)).toBe(trimmed[1])
  })
})

/**
 * `strides-3a1`. The background scale pass measures `verticalOscillationCm` and `stepWidthCm` from
 * ITS OWN frames and then grafts the numbers onto a result whose other metrics — and, until this
 * change, whose only frames — are the primary pass's.
 *
 * The fixtures below reduce the two passes' disagreement to its essential form: the SAME body at
 * the SAME instants, with the two hips LABELLED the opposite way round. That is not a contrived
 * shape. Measured live on 2026-08-31 (real GPU, both passes' frames captured at the graft), the
 * two detectors order the hips oppositely on 15/57 instants of the side-view demo, 15/87 of the
 * multi-person clip, and 0/98 of the front-approach demo — the front view separates the hips by a
 * median 93 px, while the other two leave them 9-32 px apart, where a few pixels of detector
 * disagreement flips the sign. Three of the twelve grafted exemplar instants those clips plan
 * carry the inverse ordering.
 *
 * Swapping the labels and nothing else is deliberate: the hip point SET is identical, so every
 * crop box, every gate and the travel direction are identical too, and the only thing the two
 * arrays can disagree about is the one thing under test.
 */
describe('planClipEvidence with the grafting pass’s own frames', () => {
  /** Eleven samples travelling +x, with the hip (and shoulder) LABELS swapped when asked. */
  function labelledFrames(swapped: boolean): RobustPoseFrame[] {
    return Array.from({ length: 11 }, (_, i) => {
      const x = 500 + i * 40
      const leftX = swapped ? x + 50 : x - 50
      const rightX = swapped ? x - 50 : x + 50
      return buildFrame(
        {
          left_shoulder: { x: leftX, y: 300 },
          right_shoulder: { x: rightX, y: 300 },
          left_hip: { x: leftX, y: 500 },
          right_hip: { x: rightX, y: 500 },
        },
        Number((i * 0.1).toFixed(2)),
      )
    })
  }

  /** Both step-width metrics, same single-instant exemplar, so one plan answers the A/B. */
  function stepWidthPair() {
    const strike = () =>
      exemplar({ kind: 'stepWidthStrike', timestamp: 0.5, measuredSide: 'left' })
    return heuristicsResult({
      stepWidth: { exemplars: [strike()] },
      stepWidthCm: { exemplars: [strike()] },
    })
  }

  function outwardSignOf(plan: ClipEvidencePlan, metric: MetricId) {
    const entry = plan[metric]
    return entry.status === 'planned' ? entry.items[0].base.outwardSign : null
  }

  it('reads a grafted metric’s hip polarity from the pass that measured it', () => {
    const primary = labelledFrames(false)
    const scale = labelledFrames(true)
    // The premise: the same instant, ordered oppositely by the two passes.
    expect(resolveOutwardSigns(primary[5])).toEqual({ left: -1, right: 1 })
    expect(resolveOutwardSigns(scale[5])).toEqual({ left: 1, right: -1 })

    const plan = planClipEvidence(stepWidthPair(), primary, HD, scale)

    // `stepWidthCm` arrives by graft, so its caliper's polarity must come from `scale`...
    expect(outwardSignOf(plan, 'stepWidthCm')).toEqual({ left: 1, right: -1 })
    // ...while `stepWidth` is the primary pass's own and must be untouched by the routing.
    expect(outwardSignOf(plan, 'stepWidth')).toEqual({ left: -1, right: 1 })
  })

  it('carries the OLD, wrong polarity when the grafting pass’s frames are withheld', () => {
    // The defect, stated as a test rather than as a comment: hand the same plan only the primary
    // pass's frames and `stepWidthCm` reports the primary's ordering under a number the scale
    // pass measured — the inverse of the assertion above, from identical inputs.
    const plan = planClipEvidence(stepWidthPair(), labelledFrames(false), HD)
    expect(outwardSignOf(plan, 'stepWidthCm')).toEqual({ left: -1, right: 1 })
  })

  it('draws a grafted metric’s joints at the positions its own pass estimated', () => {
    // Polarity is one field of a frame; every drawn joint is the rest of it. Measured live, the
    // two passes' hip-mid lands a median 31.5 px apart on the side-view demo — about 7% of a
    // torso — so this is a visible mis-registration, not a rounding difference.
    const primary = sampledFrames()
    const scale = primary.map((frame) =>
      boxFrame(frame.timestamp, 500 + frame.timestamp * 400, 640),
    )
    const plan = planClipEvidence(
      heuristicsResult({
        stepWidth: { exemplars: [exemplar({ timestamp: 0.5 })] },
        stepWidthCm: { exemplars: [exemplar({ timestamp: 0.5 })] },
      }),
      primary,
      HD,
      scale,
    )
    const yOf = (metric: MetricId) => {
      const entry = plan[metric]
      if (entry.status !== 'planned') return undefined
      const hip = entry.items[0].base.keypoints.find((k) => k.name === 'left_hip')
      return hip !== undefined && hip.status !== 'unrecoverable' ? hip.y : undefined
    }
    // `boxFrame` puts `left_hip` at the box's own top-left corner, so the two arrays' 440 vs 640
    // seeds separate cleanly.
    expect(yOf('stepWidth')).toBe(440)
    expect(yOf('stepWidthCm')).toBe(640)
  })

  it('gives a grafted metric the travel direction ITS pass sampled', () => {
    // The direction is a property of the clip as each pass saw it, so it is derived per array
    // rather than computed once and shared. Two arrays travelling opposite ways is the only
    // fixture that can tell a per-array derivation from a single shared one.
    const primary = travellingFrames()
    const scale = travellingFrames(11, -40)
    expect(evidenceTravelDirection(primary)).toBe(1)
    expect(evidenceTravelDirection(scale)).toBe(-1)

    const plan = planClipEvidence(
      heuristicsResult({
        trunkLean: { exemplars: [exemplar()] },
        stepWidthCm: { exemplars: [exemplar({ kind: 'stepWidthStrike' })] },
      }),
      primary,
      HD,
      scale,
    )
    const directionOf = (metric: MetricId) => {
      const entry = plan[metric]
      return entry.status === 'planned' ? entry.items[0].travelDirection : null
    }
    expect(directionOf('trunkLean')).toBe(1)
    expect(directionOf('stepWidthCm')).toBe(-1)
  })

  it('resolves a grafted instant the primary pass never sampled', () => {
    // The two passes share every timestamp on all three test clips today, so this is a
    // structural guarantee rather than an observed case — but the old code resolved a grafted
    // timestamp by snapping it into the PRIMARY array, so an instant only the scale pass sampled
    // was evidence the app could not show. It has one frame; it is not a missing frame.
    const primary = sampledFrames()
    const scale = [...primary, boxFrame(5, 900, 440)]
    const plan = planClipEvidence(
      heuristicsResult({
        stepWidthCm: { exemplars: [exemplar({ timestamp: 5 })] },
      }),
      primary,
      HD,
      scale,
    )
    expect(plan.stepWidthCm.status).toBe('planned')
    expect(reasonOf(planClipEvidence(
      heuristicsResult({ stepWidthCm: { exemplars: [exemplar({ timestamp: 5 })] } }),
      primary,
      HD,
    ).stepWidthCm)).toBe('undrawable')
  })

  it('leaves every non-grafted metric byte-identical to the un-routed plan', () => {
    // The routing must be invisible to the other nine metrics: they are planned from the same
    // array, with the same shared travel direction, as they were before this parameter existed.
    const primary = travellingFrames()
    const heuristics = heuristicsResult({
      trunkLean: { exemplars: [exemplar()] },
      overstriding: { exemplars: [exemplar({ kind: 'overstrideRange' })] },
      footStrikePattern: {
        exemplars: [exemplar({ kind: 'footStrike', side: 'left' })],
      },
    })
    const withGraft = planClipEvidence(heuristics, primary, HD, travellingFrames(11, -40))
    const without = planClipEvidence(heuristics, primary, HD)
    for (const metric of ['trunkLean', 'overstriding', 'footStrikePattern'] as MetricId[]) {
      expect(withGraft[metric]).toEqual(without[metric])
    }
  })
})

describe('summarizeEvidenceCoverage', () => {
  const frames = sampledFrames()

  function samplePlan(): ClipEvidencePlan {
    return planClipEvidence(
      heuristicsResult({
        trunkLean: {
          exemplars: [exemplar({ pairedTimestamp: 0.9, side: 'left' })],
        },
        stepWidth: {
          exemplars: [
            exemplar({ kind: 'stepWidthStrike', timestamp: 0.2, pairedTimestamp: 0.22 }),
          ],
        },
        verticalOscillation: { value: null },
      }),
      frames,
      HD,
    )
  }

  it('carries per-metric status/reason and per-exemplar plan facts', () => {
    const payload = summarizeEvidenceCoverage(
      [{ clipIndex: 0, frameCount: frames.length, plan: samplePlan() }],
      { trunkLean: 0, stepWidth: 1 },
    )
    expect(payload.clips).toHaveLength(1)
    expect(payload.clips[0].frameCount).toBe(frames.length)
    expect(payload.sourceIndices).toEqual({ trunkLean: 0, stepWidth: 1 })

    expect(payload.clips[0].metrics.trunkLean).toEqual({
      status: 'planned',
      reason: null,
      exemplars: [
        {
          kind: 'trunkLeanRange',
          side: 'left',
          quality: 0.9,
          timestamp: 0.5,
          pairedTimestamp: 0.9,
          demotion: null,
          // Union across the two drawn frames: 700..960 px wide, padded by 1.6.
          cropSidePx: 260 * EVIDENCE_CROP_PADDING_MULTIPLIER,
          // Each instant's own 100 px-wide hip pair pads to 160 and lands on the 320 px floor, so
          // ghosting cost this image 416/320.
          cropGrowth:
            (260 * EVIDENCE_CROP_PADDING_MULTIPLIER) / EVIDENCE_CROP_MIN_SIDE_PX,
          // `trunkLeanRange` names no focus joint — a range is about a RELATION between two
          // instants, not about one joint — so there is no aim to report.
          focusOffset: null,
        },
      ],
    })
    // The step-width pair collapsed onto one frame, so it reports as a demoted single.
    // A demoted pair draws no ghost, so there is no growth to report — `null`, never 1.
    expect(payload.clips[0].metrics.stepWidth?.exemplars[0]).toMatchObject({
      pairedTimestamp: null,
      demotion: 'collapsed-pair',
      cropGrowth: null,
    })
    expect(payload.clips[0].metrics.cadence).toEqual({
      status: 'no-evidence',
      reason: 'not-emitted',
      exemplars: [],
    })
    expect(payload.clips[0].metrics.verticalOscillation?.reason).toBe(
      'metric-excluded',
    )
  })

  it('reports how far an aimed crop left its focus joint from the centre', () => {
    // On the line for `cropGrowth`'s reason, which bites harder here: this IS the quantity
    // `strides-dxd`'s acceptance criterion is stated in, and re-checking it needed a probe patch
    // and a private console prefix — so on one of the two clips the fix was for, the standing A/B
    // could not see the effect of the change at all and a later aiming regression would ship green.
    const plan = planClipEvidence(
      heuristicsResult({
        kneeFlexion: {
          exemplars: [
            exemplar({
              kind: 'kneeFlexionPeak',
              pairedTimestamp: 0.9,
              cropFocus: 'left_hip',
            }),
          ],
        },
      }),
      frames,
      HD,
    )
    const payload = summarizeEvidenceCoverage(
      [{ clipIndex: 0, frameCount: frames.length, plan }],
      {},
    )
    const [item] = payload.clips[0].metrics.kneeFlexion!.exemplars

    expect(item.focusOffset).toBeTypeOf('number')
    expect(item.focusOffset).toBeGreaterThanOrEqual(0)
    expect(item.focusOffset).toBeLessThanOrEqual(0.5)
  })

  it('round-trips through JSON unchanged', () => {
    const payload = summarizeEvidenceCoverage(
      [{ clipIndex: 0, frameCount: frames.length, plan: samplePlan() }],
      { trunkLean: 0 },
    )
    const serialized = JSON.stringify(payload)
    expect(JSON.parse(serialized)).toEqual(payload)
    // Two summaries of the same plan serialize byte-identically, so two runs diff cleanly.
    expect(
      JSON.stringify(
        summarizeEvidenceCoverage(
          [{ clipIndex: 0, frameCount: frames.length, plan: samplePlan() }],
          { trunkLean: 0 },
        ),
      ),
    ).toBe(serialized)
  })

  it('reports every no-evidence reason verbatim, including one substituted upstream', () => {
    const reasons: EvidenceUnavailableReason[] = [
      'not-emitted',
      'no-candidates',
      'below-quality-gate',
      'undrawable',
      'metric-excluded',
      'frames-unavailable',
      // Never produced by this module — the extraction layer substitutes it before summarizing.
      'extraction-failed',
    ]
    const plan = planClipEvidence(heuristicsResult(), frames, HD)
    const metrics: MetricId[] = [
      'trunkLean',
      'overstriding',
      'kneeFlexion',
      'kneeDrive',
      'footStrikePattern',
      'stepWidth',
      'stepWidthCm',
    ]
    // One metric per reason, so the round trip cannot pass by coincidence with a reason unexercised.
    expect(metrics).toHaveLength(reasons.length)
    metrics.forEach((metric, i) => {
      plan[metric] = { status: 'no-evidence', reason: reasons[i] }
    })
    const payload = summarizeEvidenceCoverage(
      [{ clipIndex: 3, frameCount: 0, plan }],
      {},
    )
    metrics.forEach((metric, i) => {
      expect(payload.clips[0].metrics[metric]).toEqual({
        status: 'no-evidence',
        reason: reasons[i],
        exemplars: [],
      })
    })
    expect(payload.clips[0].clipIndex).toBe(3)
  })

  it('carries nothing image-shaped and no metric value or confidence', () => {
    const payload = summarizeEvidenceCoverage(
      [{ clipIndex: 0, frameCount: frames.length, plan: samplePlan() }],
      { trunkLean: 0 },
    )
    const serialized = JSON.stringify(payload)
    for (const forbidden of [
      'value',
      'confidence',
      'blob:',
      'data:',
      'canvas',
      'ImageBitmap',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('omits `side` for an exemplar that has none', () => {
    const payload = summarizeEvidenceCoverage(
      [{ clipIndex: 0, frameCount: frames.length, plan: samplePlan() }],
      {},
    )
    expect('side' in payload.clips[0].metrics.stepWidth!.exemplars[0]).toBe(false)
  })
})

describe('module hygiene', () => {
  // Resolved off `process.cwd()`, not `import.meta.url`: under vitest's jsdom environment the
  // latter is a simulated `http://localhost` document URL, not a `file://` one.
  const source = readFileSync(
    join(process.cwd(), 'src/results/evidenceFrames.ts'),
    'utf8',
  )
  // Comments are stripped before scanning: the module's doc NAMES the things it must not touch
  // (that is the point of the doc), so scanning prose would make every explanation a failure.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('never names durationSec — every timestamp comes from a sampled frame', () => {
    expect(code).not.toContain('durationSec')
    // ...and the prose does mention it, so the stripper is not silently blanking the file.
    expect(source).toContain('durationSec')
    expect(code).toContain('computeCropRect')
  })

  it('touches no DOM or canvas global, so it is importable outside a browser', () => {
    for (const global of [
      'document',
      'window',
      'HTMLVideoElement',
      'HTMLCanvasElement',
      'ImageBitmap',
      'createObjectURL',
      'getContext',
      'drawImage',
    ]) {
      expect(code).not.toContain(global)
    }
  })
})

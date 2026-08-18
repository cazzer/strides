/// <reference types="node" />
// The `module hygiene` block at the bottom reads this module's own source off disk, so it opts
// into Node's ambient types locally the same way `mp4Demux.test.ts` does — `tsconfig.app.json`'s
// `types` is deliberately just `vite/client`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { BoundingBoxPx } from '../pose/backends/movenetCrop'
import { computeCropRect } from '../pose/backends/movenetCrop'
import type { VideoMetadata } from '../video/types'
import { buildFrame } from '../heuristics/__fixtures__/testFrames'
import { MIN_EXEMPLAR_QUALITY } from '../heuristics/exemplars'
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
  EVIDENCE_GHOST_OPACITY,
  EVIDENCE_MAX_PAIR_CROP_GROWTH,
  EVIDENCE_NEAR_IDENTICAL_IOU,
  boundingBoxOfPoints,
  computeEvidenceCropRect,
  evidenceOutputSide,
  evidencePairCropGrowth,
  evidenceSnapToleranceSeconds,
  evidenceTravelDirection,
  frameCropBox,
  isNearIdenticalPair,
  isTooFarApartPair,
  planClipEvidence,
  planExemplarFrames,
  planMetricEvidence,
  resolveExemplarFrames,
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
  return [hipFrame(0, 500, 540), hipFrame(0.1, 700, ghostY)]
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
      confidence: 1,
      diagnostics: {
        bilateralSpreadRatio: 0.1,
        sagittalExcursionRatio: 1,
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
    armSwingSymmetry: of('armSwingSymmetry'),
    footStrikePattern: of('footStrikePattern'),
    stepWidth: of('stepWidth'),
    stepWidthCm: of('stepWidthCm'),
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
    expect(evidencePairCropGrowth(BROKEN[0], BROKEN[1], HD)).toBeCloseTo(3.375, 3)
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
    // Against its SMALLER half the legible `kneeFlexion` pair reads ~3.50 — worse than the broken
    // one's 3.375 — so a `min` reading does not merely blur the boundary, it inverts it.
    const soloSide = (b: BoundingBoxPx) =>
      computeCropRect(
        b,
        UHD.width,
        UHD.height,
        EVIDENCE_CROP_PADDING_MULTIPLIER,
        EVIDENCE_CROP_MIN_SIDE_PX,
      ).side
    const union: BoundingBoxPx = {
      minX: LOPSIDED[0].minX,
      minY: Math.min(LOPSIDED[0].minY, LOPSIDED[1].minY),
      maxX: LOPSIDED[1].maxX,
      maxY: Math.max(LOPSIDED[0].maxY, LOPSIDED[1].maxY),
    }
    const minReading =
      soloSide(union) /
      Math.min(soloSide(LOPSIDED[0]), soloSide(LOPSIDED[1]))
    expect(minReading).toBeGreaterThan(
      evidencePairCropGrowth(BROKEN[0], BROKEN[1], HD)!,
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

  it('cannot fire on a source too small to crop, where the cap binds on both sides', () => {
    // `computeCropRect` caps every crop at `min(frameWidth, frameHeight)`, so on a small clip the
    // pair's crop and the single's are the SAME rect and the ratio collapses to 1. A criterion
    // written on the cap itself — the visible symptom of #71 — would instead delete every ghost on
    // every webcam clip.
    const tiny: EvidenceFrameSize = { width: 320, height: 240 }
    expect(
      evidencePairCropGrowth(BROKEN[0], BROKEN[1], tiny),
    ).toBeCloseTo(1, 10)
    expect(isTooFarApartPair(BROKEN[0], BROKEN[1], tiny)).toBe(false)
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
      demotedFromPair: false,
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

  it('plans a pair as base at full opacity and ghost at half', () => {
    const paired = separatedPair(540)
    const plan = planExemplarFrames(
      'trunkLean',
      exemplar({ timestamp: 0, pairedTimestamp: 0.1 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.base).toMatchObject({
      timestamp: 0,
      opacity: EVIDENCE_BASE_OPACITY,
    })
    expect(plan?.ghost).toMatchObject({
      timestamp: 0.1,
      opacity: EVIDENCE_GHOST_OPACITY,
    })
    expect(plan?.demotedFromPair).toBe(false)
    // One rect, unioned across both drawn frames.
    expect(plan?.crop).toEqual(
      computeEvidenceCropRect(paired, [...HIP_SEED], HD),
    )
  })

  it('resolves annotation inputs for BOTH instants of a pair, at each instant', () => {
    // Two genuinely different hip positions: an annotation of the ghost that reused the base's
    // positions would draw the second body's marks on the first body.
    const paired = separatedPair(620)
    const plan = planExemplarFrames(
      'trunkLean',
      exemplar({ timestamp: 0, pairedTimestamp: 0.1 }),
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
        pairedTimestamp: 0.1,
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
        pairedTimestamp: 0.1,
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
      exemplar({ timestamp: 0, pairedTimestamp: 0.1 }),
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
        pairedTimestamp: 0.1,
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
    const paired = [boxFrame(0, 500, 440), boxFrame(0.1, 500.5, 440)]
    const plan = planExemplarFrames(
      'stepWidth',
      exemplar({ kind: 'stepWidthStrike', timestamp: 0, pairedTimestamp: 0.1 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.ghost).toBeNull()
    expect(plan?.demotedFromPair).toBe(true)
    // The crop now frames the base alone — the ghost is not being drawn.
    expect(plan?.crop).toEqual(
      computeEvidenceCropRect([paired[0]], [...HIP_SEED], HD),
    )
  })

  it('drops a near-identical pair for a kind with nothing to say from one instant', () => {
    const paired = [boxFrame(0, 500, 440), boxFrame(0.1, 500.5, 440)]
    for (const kind of [
      'trunkLeanRange',
      'overstrideRange',
      'bounceCycle',
      'armSwingCycle',
      'stridePair',
      'kneeFlexionPeak',
    ] satisfies MetricExemplarKind[]) {
      expect(
        planExemplarFrames(
          'trunkLean',
          exemplar({ kind, timestamp: 0, pairedTimestamp: 0.1 }),
          paired,
          HD,
          0.05,
        ),
      ).toBeNull()
    }
  })

  it('drops a far-apart pair for EVERY kind, including the ones a collapse would demote', () => {
    // The asymmetry with the near-identical rule above, asserted rather than described: a
    // near-identical `stepWidthStrike` demotes to its base, a far-apart one does not. Its label
    // ('Opposite-foot plants either side of the hip midline') is a statement about two instants,
    // and here both instants are real and simply cannot share a frame — so keeping one under that
    // caption would picture a measurement the image does not show.
    const paired = [hipFrame(0, 400, 540), hipFrame(0.1, 1400, 540)]
    expect(
      frameCropBox(paired[0], [...HIP_SEED]) &&
        frameCropBox(paired[1], [...HIP_SEED]) &&
        isTooFarApartPair(
          frameCropBox(paired[0], [...HIP_SEED])!,
          frameCropBox(paired[1], [...HIP_SEED])!,
          HD,
        ),
    ).toBe(true)
    for (const kind of [
      'stepWidthStrike',
      'footStrike',
      'trunkLeanRange',
      'overstrideRange',
      'bounceCycle',
      'armSwingCycle',
      'stridePair',
      'kneeFlexionPeak',
    ] satisfies MetricExemplarKind[]) {
      expect(
        planExemplarFrames(
          'trunkLean',
          exemplar({ kind, timestamp: 0, pairedTimestamp: 0.1 }),
          paired,
          HD,
          0.05,
        ),
      ).toBeNull()
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
    expect(plan?.demotedFromPair).toBe(false)
  })

  it('keeps a pair whose boxes overlap just below the threshold', () => {
    const paired = [boxFrame(0, 500, 440), boxFrame(0.1, 502, 440)]
    const plan = planExemplarFrames(
      'trunkLean',
      exemplar({ timestamp: 0, pairedTimestamp: 0.1 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.ghost?.timestamp).toBe(0.1)
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
    expect(plan?.demotedFromPair).toBe(true)
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
    expect(demoted?.demotedFromPair).toBe(true)

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
    const paired = [hipFrame(0, 500, 540), buildFrame({}, 0.1)]
    expect(
      planExemplarFrames(
        'stepWidth',
        exemplar({ kind: 'stepWidthStrike', timestamp: 0, pairedTimestamp: 0.1 }),
        paired,
        HD,
        0.05,
      )?.ghost,
    ).toBeNull()
    expect(
      planExemplarFrames(
        'trunkLean',
        exemplar({ timestamp: 0, pairedTimestamp: 0.1 }),
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

describe('planMetricEvidence', () => {
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

  it('reports all-gated-out when the metric emitted nothing this run', () => {
    expect(reasonOf(planOf(metricResult('trunkLean'), frames))).toBe(
      'all-gated-out',
    )
  })

  it('reports all-gated-out when every candidate fails to resolve here', () => {
    expect(
      reasonOf(
        planOf(
          metricResult('trunkLean', {
            exemplars: [exemplar({ timestamp: 42 })],
          }),
          frames,
        ),
      ),
    ).toBe('all-gated-out')
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
    expect(reasonOf(drop)).toBe('all-gated-out')
  })
})

describe('planClipEvidence', () => {
  const frames = sampledFrames()

  it('returns one entry per metric, so an absent key never means "not computed yet"', () => {
    const plan = planClipEvidence(heuristicsResult(), frames, HD)
    expect(Object.keys(plan)).toHaveLength(11)
    expect(plan.cadence).toEqual({ status: 'no-evidence', reason: 'not-emitted' })
    expect(plan.trunkLean).toEqual({
      status: 'no-evidence',
      reason: 'all-gated-out',
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
          demotedFromPair: false,
          // Union across the two drawn frames: 700..960 px wide, padded by 1.6.
          cropSidePx: 260 * EVIDENCE_CROP_PADDING_MULTIPLIER,
        },
      ],
    })
    // The step-width pair collapsed onto one frame, so it reports as a demoted single.
    expect(payload.clips[0].metrics.stepWidth?.exemplars[0]).toMatchObject({
      pairedTimestamp: null,
      demotedFromPair: true,
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
      'all-gated-out',
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
      'stepWidth',
      'stepWidthCm',
    ]
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

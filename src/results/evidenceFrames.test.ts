/// <reference types="node" />
// The `module hygiene` block at the bottom reads this module's own source off disk, so it opts
// into Node's ambient types locally the same way `mp4Demux.test.ts` does — `tsconfig.app.json`'s
// `types` is deliberately just `vite/client`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { VideoMetadata } from '../video/types'
import { buildFrame } from '../heuristics/__fixtures__/testFrames'
import { MIN_EXEMPLAR_QUALITY } from '../heuristics/exemplars'
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
  EVIDENCE_NEAR_IDENTICAL_IOU,
  boundingBoxOfPoints,
  computeEvidenceCropRect,
  evidenceSnapToleranceSeconds,
  frameCropBox,
  isNearIdenticalPair,
  planClipEvidence,
  planExemplarFrames,
  planMetricEvidence,
  resolveExemplarFrames,
  snapToSampledFrame,
  summarizeEvidenceCoverage,
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
    const paired = [hipFrame(0, 500, 540), hipFrame(0.1, 900, 540)]
    const plan = planExemplarFrames(
      'trunkLean',
      exemplar({ timestamp: 0, pairedTimestamp: 0.1 }),
      paired,
      HD,
      0.05,
    )
    expect(plan?.base).toEqual({ timestamp: 0, opacity: EVIDENCE_BASE_OPACITY })
    expect(plan?.ghost).toEqual({ timestamp: 0.1, opacity: EVIDENCE_GHOST_OPACITY })
    expect(plan?.demotedFromPair).toBe(false)
    // One rect, unioned across both drawn frames.
    expect(plan?.crop).toEqual(
      computeEvidenceCropRect(paired, [...HIP_SEED], HD),
    )
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

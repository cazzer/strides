import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import type { BoundingBoxPx } from '../pose/backends/movenetCrop'
import { assessScalePassSubjectAgreement } from './scalePassSubjectAgreement'
import type { PersonSelectionDiagnostics } from './retroactivePersonSelection'
import { DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG } from './retroactivePersonSelection'

const BOUNDS = DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG

/**
 * A frame whose 12 non-excluded keypoints hull to exactly `box`. The four corners carry the
 * extremes; everything else (head and foot points included, which `deriveBoundingBox` excludes
 * anyway) sits at the centre, so the derived box is `box` regardless of which names are excluded.
 */
function frameWithBox(
  timestamp: number,
  box: BoundingBoxPx,
  status: RobustKeypoint['status'] = 'detected',
): RobustPoseFrame {
  const centerX = (box.minX + box.maxX) / 2
  const centerY = (box.minY + box.maxY) / 2
  const corners: Partial<Record<string, [number, number]>> = {
    left_shoulder: [box.minX, box.minY],
    right_shoulder: [box.maxX, box.minY],
    left_hip: [box.minX, box.maxY],
    right_hip: [box.maxX, box.maxY],
  }
  return {
    timestamp,
    keypoints: COMMON_KEYPOINT_NAMES.map((name) => {
      const [x, y] = corners[name] ?? [centerX, centerY]
      return {
        name,
        x: status === 'unrecoverable' ? null : x,
        y: status === 'unrecoverable' ? null : y,
        score: status === 'unrecoverable' ? 0 : 0.9,
        status,
      }
    }),
    source: status === 'detected' ? 'detected' : 'missing',
    pixelsPerMeter: null,
  }
}

function selected(): PersonSelectionDiagnostics {
  return {
    status: 'selected',
    skipReason: null,
    minBoundingBoxAreaPx: 1658.88,
    totalSamples: 10,
    detectedSamplesIn: 10,
    detectedSamplesOut: 10,
    rejectedBelowFloor: 0,
    rejectedOtherSegment: 0,
    rejectedOutsideEvidence: 0,
    segmentCount: 1,
    bridgedCuts: 0,
    segments: [],
    separationRatio: null,
  }
}

function skipped(
  skipReason: Exclude<PersonSelectionDiagnostics['skipReason'], null>,
): PersonSelectionDiagnostics {
  return { ...selected(), status: 'skipped', skipReason }
}

/** A 100x200 box at `(x, y)` — side 200, so the centre-speed budget is 800px per second. */
function boxAt(x: number, y: number): BoundingBoxPx {
  return { minX: x, minY: y, maxX: x + 100, maxY: y + 200 }
}

/** `count` frames at 0.2s spacing, all carrying the same box. */
function track(count: number, box: (index: number) => BoundingBoxPx): RobustPoseFrame[] {
  return Array.from({ length: count }, (_, index) =>
    frameWithBox(index * 0.2, box(index)),
  )
}

describe('assessScalePassSubjectAgreement', () => {
  it('reports agreement when both passes tracked identical boxes', () => {
    const frames = track(12, () => boxAt(400, 300))

    const result = assessScalePassSubjectAgreement(
      { frames, personSelection: selected() },
      { frames, personSelection: selected() },
      BOUNDS,
    )

    expect(result.status).toBe('agreed')
    expect(result.reason).toBeNull()
    expect(result.comparedInstants).toBe(12)
    expect(result.agreeingInstants).toBe(12)
  })

  it('reports agreement across offset timestamps and modestly different boxes', () => {
    // The same runner, seen by two backends: sampled ~30ms apart, with MediaPipe's box a few
    // percent larger and slightly displaced because its visibility gate keeps a limb MoveNet's
    // score gate drops.
    const primary = track(12, () => boxAt(400, 300))
    const scale = Array.from({ length: 12 }, (_, index) =>
      frameWithBox(index * 0.2 + 0.03, {
        minX: 392,
        minY: 295,
        maxX: 505,
        maxY: 508,
      }),
    )

    const result = assessScalePassSubjectAgreement(
      { frames: primary, personSelection: selected() },
      { frames: scale, personSelection: selected() },
      BOUNDS,
    )

    expect(result.status).toBe('agreed')
    expect(result.comparedInstants).toBe(12)
    expect(result.agreeingInstants).toBe(12)
  })

  it('reports divergence when the scale pass tracked a bystander elsewhere in frame', () => {
    const primary = track(12, () => boxAt(200, 300))
    // 900px away with a 200px side and a 30ms gap: IoU is 0 and the centre-speed budget is 24px.
    const scale = Array.from({ length: 12 }, (_, index) =>
      frameWithBox(index * 0.2 + 0.03, boxAt(1100, 300)),
    )

    const result = assessScalePassSubjectAgreement(
      { frames: primary, personSelection: selected() },
      { frames: scale, personSelection: selected() },
      BOUNDS,
    )

    expect(result.status).toBe('diverged')
    expect(result.reason).toBeNull()
    expect(result.comparedInstants).toBe(12)
    expect(result.agreeingInstants).toBe(0)
  })

  it('reports divergence on scale alone when the boxes are co-located', () => {
    // A bystander much nearer the camera, standing in front of the runner: every box overlaps, so
    // position continuity passes and only the area band can catch it. ~10x area against a 4x
    // bound.
    const primary = track(12, () => ({ minX: 400, minY: 300, maxX: 500, maxY: 500 }))
    const scale = track(12, () => ({ minX: 290, minY: 190, maxX: 610, maxY: 810 }))

    const result = assessScalePassSubjectAgreement(
      { frames: primary, personSelection: selected() },
      { frames: scale, personSelection: selected() },
      BOUNDS,
    )

    expect(result.status).toBe('diverged')
    expect(result.agreeingInstants).toBe(0)
  })

  it.each([
    'disabled',
    'unknown-frame-size',
    'no-detections',
    'no-detection-above-floor',
  ] as const)(
    'has no opinion when the primary pass skipped selection (%s)',
    (skipReason) => {
      const frames = track(12, () => boxAt(400, 300))
      const elsewhere = track(12, () => boxAt(1400, 300))

      const result = assessScalePassSubjectAgreement(
        { frames, personSelection: skipped(skipReason) },
        { frames: elsewhere, personSelection: selected() },
        BOUNDS,
      )

      expect(result).toEqual({
        status: 'no-opinion',
        reason: 'primary-not-selected',
        comparedInstants: 0,
        agreeingInstants: 0,
      })
    },
  )

  it.each([
    'disabled',
    'unknown-frame-size',
    'no-detections',
    'no-detection-above-floor',
  ] as const)('has no opinion when the scale pass skipped selection (%s)', (skipReason) => {
    const frames = track(12, () => boxAt(400, 300))
    const elsewhere = track(12, () => boxAt(1400, 300))

    const result = assessScalePassSubjectAgreement(
      { frames, personSelection: selected() },
      { frames: elsewhere, personSelection: skipped(skipReason) },
      BOUNDS,
    )

    expect(result).toEqual({
      status: 'no-opinion',
      reason: 'scale-not-selected',
      comparedInstants: 0,
      agreeingInstants: 0,
    })
  })

  it('has no opinion when no instants pair within the tolerance', () => {
    // Two passes that sampled disjoint halves of the clip: every nearest neighbour is seconds
    // away, so nothing is comparable even though both selected a subject.
    const primary = track(12, () => boxAt(400, 300))
    const scale = Array.from({ length: 12 }, (_, index) =>
      frameWithBox(100 + index * 0.2, boxAt(400, 300)),
    )

    const result = assessScalePassSubjectAgreement(
      { frames: primary, personSelection: selected() },
      { frames: scale, personSelection: selected() },
      BOUNDS,
    )

    expect(result.status).toBe('no-opinion')
    expect(result.reason).toBe('too-few-comparable-instants')
    expect(result.comparedInstants).toBe(0)
  })

  it('withholds an opinion below the comparable-instant floor even when every pair disagrees', () => {
    const primary = track(9, () => boxAt(200, 300))
    const scale = track(9, () => boxAt(1400, 300))

    const result = assessScalePassSubjectAgreement(
      { frames: primary, personSelection: selected() },
      { frames: scale, personSelection: selected() },
      BOUNDS,
    )

    expect(result.status).toBe('no-opinion')
    expect(result.reason).toBe('too-few-comparable-instants')
    expect(result.comparedInstants).toBe(9)
    expect(result.agreeingInstants).toBe(0)
  })

  it('treats an exact half of agreeing instants as agreement, and one fewer as divergence', () => {
    const primary = track(10, () => boxAt(200, 300))
    const agreeingAt = (agreeCount: number) =>
      track(10, (index) => (index < agreeCount ? boxAt(200, 300) : boxAt(1400, 300)))

    const tied = assessScalePassSubjectAgreement(
      { frames: primary, personSelection: selected() },
      { frames: agreeingAt(5), personSelection: selected() },
      BOUNDS,
    )
    expect(tied.comparedInstants).toBe(10)
    expect(tied.agreeingInstants).toBe(5)
    expect(tied.status).toBe('agreed')

    const majorityAgainst = assessScalePassSubjectAgreement(
      { frames: primary, personSelection: selected() },
      { frames: agreeingAt(4), personSelection: selected() },
      BOUNDS,
    )
    expect(majorityAgainst.comparedInstants).toBe(10)
    expect(majorityAgainst.agreeingInstants).toBe(4)
    expect(majorityAgainst.status).toBe('diverged')
  })

  it('ignores frames whose keypoints are all interpolated or unrecoverable', () => {
    // Interleaved gap-filled frames yield no box: they are not evidence about anybody's identity,
    // and counting them would let interpolation quietly inflate the comparable-instant count.
    const withGaps = [
      ...track(10, () => boxAt(400, 300)),
      frameWithBox(2.0, boxAt(400, 300), 'interpolated'),
      frameWithBox(2.2, boxAt(400, 300), 'unrecoverable'),
    ]
    const scale = [
      ...track(10, () => boxAt(400, 300)),
      frameWithBox(2.0, boxAt(400, 300), 'interpolated'),
      frameWithBox(2.2, boxAt(400, 300), 'unrecoverable'),
    ]

    const result = assessScalePassSubjectAgreement(
      { frames: withGaps, personSelection: selected() },
      { frames: scale, personSelection: selected() },
      BOUNDS,
    )

    expect(result.status).toBe('agreed')
    expect(result.comparedInstants).toBe(10)
    expect(result.agreeingInstants).toBe(10)
  })

  it('mutates neither input', () => {
    const primary = track(12, () => boxAt(400, 300))
    const scale = track(12, () => boxAt(1400, 300))
    const before = JSON.stringify({ primary, scale })

    assessScalePassSubjectAgreement(
      { frames: primary, personSelection: selected() },
      { frames: scale, personSelection: selected() },
      BOUNDS,
    )

    expect(JSON.stringify({ primary, scale })).toBe(before)
  })

  it('reuses the caller bounds rather than a threshold of its own', () => {
    // A 6x area jump between co-located boxes: divergence under the shipped `maxAreaRatio: 4`,
    // agreement under a loosened one. The check must have no geometric opinion of its own, so a
    // dev override that loosens continuity loosens this identically.
    const primary = track(12, () => ({ minX: 400, minY: 300, maxX: 500, maxY: 500 }))
    const scale = track(12, () => ({ minX: 328, minY: 155, maxX: 572, maxY: 645 }))

    expect(
      assessScalePassSubjectAgreement(
        { frames: primary, personSelection: selected() },
        { frames: scale, personSelection: selected() },
        BOUNDS,
      ).status,
    ).toBe('diverged')

    expect(
      assessScalePassSubjectAgreement(
        { frames: primary, personSelection: selected() },
        { frames: scale, personSelection: selected() },
        { ...BOUNDS, maxAreaRatio: 12 },
      ).status,
    ).toBe('agreed')
  })
})

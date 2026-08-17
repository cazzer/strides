import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG,
  selectRetroactivePersonOfInterest,
} from './retroactivePersonSelection'
import type { RetroactivePersonSelectionConfig } from './retroactivePersonSelection'
import type { PoseSample } from '../pose/robustness/types'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'

const WIDTH_1080P = 1920
const HEIGHT_1080P = 1080
/** `2e-4 * 1920 * 1080` — the default floor at 1080p. */
const FLOOR_1080P = 414.72

/** The shipped defaults. Spread rather than used directly so these cases keep asserting the
 * algorithm's behaviour even if the `enabled` default is flipped again — the kill switch's own
 * behaviour has its own test. */
const CONFIG: RetroactivePersonSelectionConfig = {
  ...DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG,
  enabled: true,
}

/**
 * A detected sample whose `deriveBoundingBox` output is exactly the axis-aligned box
 * `[x, x + width] × [y, y + height]`. Four confident corner keypoints (the first four
 * COMMON_KEYPOINT_NAMES entries, none of them head/foot-excluded) clear the default
 * `minConfidentKeypoints: 4`; every other keypoint is present at score 0 so it neither counts nor
 * widens the box.
 */
function detected(
  timestamp: number,
  x: number,
  y: number,
  width: number,
  height: number = width,
): PoseSample {
  const corners = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
  ]
  return {
    timestamp,
    frame: {
      timestamp,
      keypoints: COMMON_KEYPOINT_NAMES.map((name, i) => {
        const corner = corners[i]
        return corner
          ? { name, x: corner[0], y: corner[1], score: 0.9 }
          : { name, x, y, score: 0 }
      }),
    },
  }
}

/** A sample whose frame exists but yields NO bounding box — fewer confident keypoints than
 * `minConfidentKeypoints`. Distinct from `{ frame: null }` (no detection at all). */
function boxless(timestamp: number): PoseSample {
  return {
    timestamp,
    frame: {
      timestamp,
      keypoints: COMMON_KEYPOINT_NAMES.map((name, i) => ({
        name,
        x: 500,
        y: 500,
        // Only three confident points — one below minConfidentKeypoints: 4.
        score: i < 3 ? 0.9 : 0,
      })),
    },
  }
}

function missing(timestamp: number): PoseSample {
  return { timestamp, frame: null }
}

/**
 * A sample with enough confident keypoints to yield a box, but every one of them at NaN
 * coordinates. `deriveBoundingBox` leaves its `±Infinity` sentinels untouched (every `<`/`>`
 * against NaN is false), so the derived box is
 * `{ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }` and its area is
 * `(-Infinity) * (-Infinity) = +Infinity`.
 */
function nanCoordinates(timestamp: number): PoseSample {
  return {
    timestamp,
    frame: {
      timestamp,
      keypoints: COMMON_KEYPOINT_NAMES.map((name) => ({
        name,
        x: Number.NaN,
        y: Number.NaN,
        score: 0.9,
      })),
    },
  }
}

/** `√FLOOR_1080P ≈ 20.36` — a square this wide sits exactly at the floor. A square side of 25
 * (625 px²) clears it; 15 (225 px²) does not. */
const ABOVE_FLOOR_SIDE = 25
const BELOW_FLOOR_SIDE = 15

function select(samples: PoseSample[], cfg = CONFIG) {
  return selectRetroactivePersonOfInterest(samples, WIDTH_1080P, HEIGHT_1080P, cfg)
}

describe('selectRetroactivePersonOfInterest', () => {
  describe('single smooth track', () => {
    const SMOOTH: PoseSample[] = [
      detected(0, 100, 100, 300),
      detected(0.05, 108, 102, 302),
      detected(0.1, 116, 101, 298),
      detected(0.15, 124, 103, 301),
      detected(0.2, 132, 100, 300),
    ]

    it('produces exactly one segment and keeps every frame by reference', () => {
      const { samples, diagnostics } = select(SMOOTH)

      expect(diagnostics.status).toBe('selected')
      expect(diagnostics.skipReason).toBeNull()
      expect(diagnostics.segmentCount).toBe(1)
      expect(diagnostics.rejectedBelowFloor).toBe(0)
      expect(diagnostics.rejectedOtherSegment).toBe(0)
      expect(diagnostics.detectedSamplesIn).toBe(5)
      expect(diagnostics.detectedSamplesOut).toBe(5)
      expect(diagnostics.separationRatio).toBeNull()
      // Nothing was discontinuous in the first place, so splice tolerance never had anything to
      // decline -- one segment here means "never cut", not "cut and healed".
      expect(diagnostics.bridgedCuts).toBe(0)

      samples.forEach((sample, i) => {
        expect(sample).toBe(SMOOTH[i])
      })
    })

    it('reports the one segment spanning the whole clip', () => {
      const { diagnostics } = select(SMOOTH)
      expect(diagnostics.segments).toHaveLength(1)
      expect(diagnostics.segments[0].startTimestamp).toBe(0)
      expect(diagnostics.segments[0].endTimestamp).toBe(0.2)
      expect(diagnostics.segments[0].frameCount).toBe(5)
      // Areas are 300², 302², 298², 301², 300² — median 300².
      expect(diagnostics.segments[0].medianAreaPx).toBeCloseTo(300 * 300, 5)
    })

    it('returns one output sample per input sample, at the same timestamps, and mutates nothing', () => {
      const snapshot = JSON.stringify(SMOOTH)
      const { samples } = select(SMOOTH)

      expect(samples).toHaveLength(SMOOTH.length)
      expect(samples.map((s) => s.timestamp)).toEqual(SMOOTH.map((s) => s.timestamp))
      expect(JSON.stringify(SMOOTH)).toBe(snapshot)
    })
  })

  describe('the measured #51 trace', () => {
    // Modelled from the anchor trace in issue #51's measurement comment, compressed in frame
    // count but preserving the three spans' relative integrated areas:
    //   bystander  t=0.05-2.05  ~120 frames @ ~2,000 px²   -> ~240K
    //   runner     t=2.15-3.55   ~90 frames @ ~32,000 px²  -> ~2.9M
    //   bystander  t=3.73-3.90   ~12 frames @ ~3,500 px²   -> ~42K
    // (Areas are exact here; the real clip's varied frame to frame.)
    function span(
      from: number,
      count: number,
      step: number,
      x: number,
      y: number,
      side: number,
    ): PoseSample[] {
      return Array.from({ length: count }, (_, i) =>
        detected(Number((from + i * step).toFixed(4)), x, y, side),
      )
    }

    // ~45 px box = 2,025 px²; ~179 px = 32,041 px²; ~59 px = 3,481 px².
    const TRACE: PoseSample[] = [
      ...span(0.05, 120, 1 / 60, 60, 600, 45),
      ...span(2.15, 90, 1 / 60, 1248, 640, 179),
      ...span(3.73, 12, 1 / 60, 110, 600, 59),
    ]

    it('picks the runner, by roughly the measured 12x margin', () => {
      const { diagnostics } = select(TRACE)

      expect(diagnostics.status).toBe('selected')
      expect(diagnostics.segmentCount).toBe(3)
      // The three spans stay separate under splice tolerance, and that is a stated fact rather
      // than an inference from the count: both transitions fail the bridge on area ratio
      // (179²/45² = 15.8 and 179²/59² = 9.2, against a bound of 4), so neither pair either side of
      // a span boundary is continuous with the other.
      expect(diagnostics.bridgedCuts).toBe(0)
      // The winner is the runner's span: ~90 frames of ~32,000 px².
      expect(diagnostics.segments[0].frameCount).toBe(90)
      expect(diagnostics.segments[0].medianAreaPx).toBeCloseTo(179 * 179, 5)
      expect(diagnostics.segments[0].integratedAreaPx).toBeCloseTo(90 * 179 * 179, 5)
      // ~2.88M vs the leading bystander's ~243K.
      expect(diagnostics.separationRatio).toBeGreaterThan(11)
      expect(diagnostics.separationRatio).toBeLessThan(13)
    })

    it('keeps only the runner frames and nulls both bystander spans', () => {
      const { samples, diagnostics } = select(TRACE)

      expect(diagnostics.detectedSamplesIn).toBe(222)
      expect(diagnostics.detectedSamplesOut).toBe(90)
      expect(diagnostics.rejectedOtherSegment).toBe(132)

      const survivors = samples.filter((s) => s.frame !== null)
      expect(survivors).toHaveLength(90)
      expect(survivors[0].timestamp).toBeCloseTo(2.15, 4)
    })
  })

  describe('the minimum area floor', () => {
    it('nulls sub-floor detections and does not let them start or cut a segment', () => {
      // One continuous real track, interrupted by a run of degenerate 5-183 px² detections
      // parked at a fixed, far-away screen position -- the repro clip's t=0.47-0.93 stretch.
      // Without the floor those would cut the track in two AND form their own segment.
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 105, 100, 300),
        detected(0.1, 493, 493, 3), // 9 px²
        detected(0.15, 493, 493, 10), // 100 px²
        detected(0.2, 493, 493, 13), // 169 px²
        detected(0.25, 120, 100, 300),
        detected(0.3, 125, 100, 300),
      ]

      const { samples: out, diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(1)
      expect(diagnostics.rejectedBelowFloor).toBe(3)
      expect(diagnostics.rejectedOtherSegment).toBe(0)
      expect(diagnostics.detectedSamplesOut).toBe(4)
      expect(diagnostics.minBoundingBoxAreaPx).toBeCloseTo(FLOOR_1080P, 6)

      expect(out[2]).toEqual({ timestamp: 0.1, frame: null })
      expect(out[3]).toEqual({ timestamp: 0.15, frame: null })
      expect(out[4]).toEqual({ timestamp: 0.2, frame: null })
      expect(out[5]).toBe(samples[5])
    })

    it('nulls a sub-floor detection even inside the winning segment', () => {
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 100, 100, BELOW_FLOOR_SIDE),
        detected(0.1, 110, 100, 300),
      ]

      const { samples: out, diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(1)
      expect(diagnostics.rejectedBelowFloor).toBe(1)
      expect(out[1]).toEqual({ timestamp: 0.05, frame: null })
    })

    it('skips without changing anything when nothing clears the floor', () => {
      const samples: PoseSample[] = [
        detected(0, 100, 100, BELOW_FLOOR_SIDE),
        detected(0.05, 200, 200, BELOW_FLOOR_SIDE),
      ]

      const { samples: out, diagnostics } = select(samples)

      expect(diagnostics.status).toBe('skipped')
      expect(diagnostics.skipReason).toBe('no-detection-above-floor')
      expect(diagnostics.detectedSamplesOut).toBe(2)
      expect(diagnostics.rejectedBelowFloor).toBe(0)
      expect(out).toBe(samples)
    })

    it('treats a non-finite bbox area as below-floor, so one NaN-coordinate frame cannot take the clip', () => {
      // `deriveBoundingBox` returns its +/-Infinity sentinels unchanged when every confident
      // keypoint has NaN coordinates, and that box's area is +Infinity. Unguarded, `Infinity <
      // floor` is false, so the frame survives, its segment's integratedAreaPx is Infinity and
      // beats every real track, and separationRatio goes non-finite and reports null -- i.e. the
      // whole clip is nulled except that one frame, with the field that would have flagged it
      // suppressed. It must be rejected exactly like a sub-floor detection instead.
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 105, 100, 300),
        // Far from the real track in both position and (would-be) scale, so if it ever survived it
        // would cut its own segment rather than merge into the runner's.
        nanCoordinates(0.1),
        detected(0.15, 110, 100, 300),
        detected(0.2, 115, 100, 300),
      ]

      const { samples: out, diagnostics } = select(samples)

      // Counted as a floor rejection, and it neither started nor cut a segment.
      expect(diagnostics.rejectedBelowFloor).toBe(1)
      expect(diagnostics.segmentCount).toBe(1)
      expect(diagnostics.rejectedOtherSegment).toBe(0)
      // The real track is intact: four frames kept by reference, only the NaN frame nulled.
      expect(diagnostics.detectedSamplesIn).toBe(5)
      expect(diagnostics.detectedSamplesOut).toBe(4)
      expect(out[2]).toEqual({ timestamp: 0.1, frame: null })
      for (const i of [0, 1, 3, 4]) {
        expect(out[i]).toBe(samples[i])
      }
      // The winner's score is the four real boxes' area and nothing else -- no Infinity leaked in.
      expect(diagnostics.segments[0].integratedAreaPx).toBeCloseTo(4 * 300 * 300, 5)
      expect(Number.isFinite(diagnostics.segments[0].integratedAreaPx)).toBe(true)
      expect(Number.isFinite(diagnostics.segments[0].medianAreaPx)).toBe(true)
    })

    it('skips when the ONLY detection has a non-finite area, rather than selecting it', () => {
      const samples: PoseSample[] = [nanCoordinates(0), nanCoordinates(0.05)]

      const { samples: out, diagnostics } = select(samples)

      expect(diagnostics.status).toBe('skipped')
      expect(diagnostics.skipReason).toBe('no-detection-above-floor')
      // Fails open: nothing was nulled.
      expect(out).toBe(samples)
      expect(diagnostics.detectedSamplesOut).toBe(2)
    })

    it('is resolution-independent: identical geometry at 1080p and 4K decides identically', () => {
      // Same scene, same subject-to-frame proportions, twice the pixels in each dimension. An
      // ABSOLUTE px^2 floor would be 4x more permissive at 4K; a frame-area FRACTION is not.
      const at1080p: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 110, 100, 300),
        detected(0.1, 400, 400, ABOVE_FLOOR_SIDE),
        detected(0.15, 402, 400, ABOVE_FLOOR_SIDE),
        detected(0.2, 700, 700, BELOW_FLOOR_SIDE),
      ]
      const at4k = at1080p.map((sample) => ({
        timestamp: sample.timestamp,
        frame: sample.frame && {
          timestamp: sample.frame.timestamp,
          keypoints: sample.frame.keypoints.map((k) => ({
            ...k,
            x: k.x * 2,
            y: k.y * 2,
          })),
        },
      }))

      const a = select(at1080p)
      const b = selectRetroactivePersonOfInterest(at4k, WIDTH_1080P * 2, HEIGHT_1080P * 2, CONFIG)

      expect(b.diagnostics.status).toBe(a.diagnostics.status)
      expect(b.diagnostics.segmentCount).toBe(a.diagnostics.segmentCount)
      expect(b.diagnostics.rejectedBelowFloor).toBe(a.diagnostics.rejectedBelowFloor)
      expect(b.diagnostics.rejectedOtherSegment).toBe(a.diagnostics.rejectedOtherSegment)
      expect(b.diagnostics.detectedSamplesOut).toBe(a.diagnostics.detectedSamplesOut)
      // Same frames kept, same frames nulled.
      expect(b.samples.map((s) => s.frame === null)).toEqual(
        a.samples.map((s) => s.frame === null),
      )
      // ...and the areas really did scale by 4x, so this was not a vacuous comparison.
      expect(b.diagnostics.segments[0].integratedAreaPx).toBeCloseTo(
        a.diagnostics.segments[0].integratedAreaPx * 4,
        5,
      )
    })
  })

  describe('segmentation', () => {
    it('does NOT cut across an interior gap of undetected frames', () => {
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        missing(0.05),
        missing(0.1),
        detected(0.15, 130, 100, 300),
      ]

      const { samples: out, diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(1)
      expect(diagnostics.rejectedOtherSegment).toBe(0)
      expect(out).toEqual(samples)
    })

    it('DOES cut when the gap between surviving detections exceeds maxContinuityGapSeconds', () => {
      // Geometrically continuous (same place, same size), but 1.5s apart with the default 1.0s
      // tolerance -- across that long a gap the speed bound would permit almost anything.
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 105, 100, 300),
        detected(1.6, 110, 100, 300),
      ]

      const { diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(2)
    })

    it('a boxless frame rides with its segment and contributes no area', () => {
      const withBoxless: PoseSample[] = [
        detected(0, 100, 100, 300),
        boxless(0.05),
        detected(0.1, 110, 100, 300),
      ]
      const withoutBoxless: PoseSample[] = [withBoxless[0], withBoxless[2]]

      const a = select(withBoxless)
      const b = select(withoutBoxless)

      expect(a.diagnostics.segmentCount).toBe(1)
      expect(a.diagnostics.segments[0].frameCount).toBe(2)
      expect(a.diagnostics.segments[0].integratedAreaPx).toBe(
        b.diagnostics.segments[0].integratedAreaPx,
      )
      // It rides along: still there, unchanged, because its segment won.
      expect(a.samples[1]).toBe(withBoxless[1])
      expect(a.diagnostics.rejectedBelowFloor).toBe(0)
      expect(a.diagnostics.rejectedOtherSegment).toBe(0)
    })

    it('a boxless frame in a LOSING segment is nulled with the rest of it', () => {
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 105, 100, 300),
        detected(0.1, 1500, 700, 60),
        boxless(0.15),
        detected(0.2, 1505, 700, 60),
      ]

      const { samples: out, diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(2)
      expect(out[3]).toEqual({ timestamp: 0.15, frame: null })
      expect(diagnostics.rejectedOtherSegment).toBe(3)
    })

    it('cuts on a 10x area change at the same position', () => {
      // Position continuity passes trivially (identical centre, full overlap); only the scale
      // test can catch a different person at a very different distance from the camera.
      const samples: PoseSample[] = [
        detected(0, 500, 500, 300),
        detected(0.05, 500, 500, 300),
        // Same centre, ~1/10 the area.
        detected(0.1, 605, 605, 95),
        detected(0.15, 605, 605, 95),
      ]

      const { diagnostics } = select(samples)
      expect(diagnostics.segmentCount).toBe(2)
    })

    it('cuts on a teleport over a short elapsed time but not over a long one', () => {
      // 700px of centre displacement against a 300px box side = ~2.3 sides. At 3 sides/second
      // that is reachable in 0.78s but not in 0.05s. The boxes are disjoint ([100,400] vs
      // [800,1100] in x), so IoU cannot rescue either case.
      const near: PoseSample[] = [detected(0, 100, 100, 300), detected(0.05, 800, 100, 300)]
      const far: PoseSample[] = [detected(0, 100, 100, 300), detected(0.9, 800, 100, 300)]

      expect(select(near).diagnostics.segmentCount).toBe(2)
      // Same jump, same boxes -- only the elapsed time differs, and it is inside the 1.0s
      // continuity-gap tolerance.
      expect(select(far).diagnostics.segmentCount).toBe(1)
    })

    it('pins maxCenterSpeedSidesPerSecond: the offline bound of 4 keeps a pair that 3 would cut', () => {
      // The ONLY test that the offline centre-speed bound is load-bearing. Every other
      // discontinuity in this suite fails on scale or on time, so before this existed the bound
      // could be reverted 4 -> 3 with the whole suite still green, and its only evidence was a
      // live A/B that CI cannot run (design.md D4).
      //
      // Scaled from the real Demo 1 measurement that D4 exists for: the runner's own t=4.24 and
      // t=4.36 boxes travel 273.2px of centre displacement against a 253.9px budget at 3 sides/s
      // -- a 7.6% shortfall -- while overlapping not at all and differing in area by only 1.55x.
      // This fixture reproduces that shape with round numbers.
      //
      // Reference box [100,300]x[100,800]: centre (200,450), area 140,000, longest side 700.
      // Candidate box [353,593]x[100,800]: centre (473,450), area 168,000.
      //   - centre displacement is exactly 273px, purely horizontal
      //   - budget at 3 sides/s over 0.12s = 3 x 700 x 0.12 = 252  -> 273 > 252, CUTS
      //   - budget at 4 sides/s over 0.12s = 4 x 700 x 0.12 = 336  -> 273 < 336, continuous
      // The other two terms are deliberately held far from their bounds so neither can be what
      // decides: the boxes are disjoint in x (300 < 353) so IoU is 0 and the overlap half of the
      // position test cannot rescue either case, the area ratio is 1.2 against a bound of 4, and
      // 0.12s is nowhere near the 1.0s continuity gap.
      const samples: PoseSample[] = [
        detected(0, 100, 100, 200, 700),
        detected(0.12, 353, 100, 240, 700),
      ]

      // Against the SHIPPED default -- fails if `maxCenterSpeedSidesPerSecond` is reverted to 3.
      const shipped = select(samples)
      expect(shipped.diagnostics.segmentCount).toBe(1)
      expect(shipped.diagnostics.detectedSamplesOut).toBe(2)
      // Two samples, so a cut here has no lookahead target and splice tolerance is not involved
      // either way -- this isolates the bound, not the bridge.
      expect(shipped.diagnostics.bridgedCuts).toBe(0)

      // The counterfactual, so this proves the bound is load-bearing rather than merely passing:
      // the identical fixture at the online gate's 3 still cuts.
      const atThree = select(samples, { ...CONFIG, maxCenterSpeedSidesPerSecond: 3 })
      expect(atThree.diagnostics.segmentCount).toBe(2)

      // ...and it is the SPEED term deciding, not the scale one: at 3 sides/s it cuts even with the
      // area bound thrown wide open.
      const atThreeWideArea = select(samples, {
        ...CONFIG,
        maxCenterSpeedSidesPerSecond: 3,
        maxAreaRatio: 1000,
      })
      expect(atThreeWideArea.diagnostics.segmentCount).toBe(2)
    })

    it('every sample belongs to exactly one segment, and the segments tile the clip', () => {
      const samples: PoseSample[] = [
        missing(0),
        detected(0.05, 100, 100, 300),
        detected(0.1, 105, 100, 300),
        detected(0.15, 1500, 700, 60),
        missing(0.2),
        detected(0.25, 1505, 700, 60),
        missing(0.3),
      ]

      const { diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(2)
      const chronological = [...diagnostics.segments].sort(
        (a, b) => a.startTimestamp - b.startTimestamp,
      )
      // Segment 0 reaches back to index 0 (the leading undetected frame), the last reaches
      // forward to the end (the trailing one) -- no sample is outside the partition.
      expect(chronological[0].startTimestamp).toBe(0)
      expect(chronological[chronological.length - 1].endTimestamp).toBe(0.3)
      // ...and they abut without overlapping.
      expect(chronological[0].endTimestamp).toBe(0.1)
      expect(chronological[1].startTimestamp).toBe(0.15)
    })

    it('a single isolated detection is its own segment, wins, and survives', () => {
      const samples: PoseSample[] = [missing(0), detected(0.05, 100, 100, 300), missing(0.1)]

      const { samples: out, diagnostics } = select(samples)

      expect(diagnostics.status).toBe('selected')
      expect(diagnostics.segmentCount).toBe(1)
      expect(diagnostics.detectedSamplesOut).toBe(1)
      expect(out[1]).toBe(samples[1])
    })
  })

  describe('splice tolerance', () => {
    // The measured Demo 1 wedge, scaled into this file's fixture space. On the real clip a
    // collapsed 24,473 px² detection at t=4.32, displaced ~400px from where the runner actually
    // is, sits between the runner's own 167,867 px² and 108,121 px² boxes and fails continuity
    // against BOTH of them -- on POSITION against the first (IoU 0, ~12 sides/s against a 3
    // sides/s bound) and on SCALE against the second (4.4 vs the bound of 4). It splits one
    // person's continuous 55-frame track into 5 + 1 + 49 and the 5-frame prefix loses.
    //
    // Hand-checked here, against the default 1080p config:
    //   (a,b): IoU 0, 588px of centre travel against a 96px budget, area ratio 7.1  -> both fail
    //   (b,c): IoU 0, 542px against an 18px budget, area ratio 4.55                 -> both fail
    //   (a,c): IoU 0.64, area ratio 1.5625, elapsed 0.12s                           -> continuous
    const WEDGE: PoseSample[] = [
      detected(0, 100, 100, 400),
      detected(0.08, 800, 100, 150),
      detected(0.12, 180, 100, 320),
      detected(0.16, 200, 100, 320),
    ]

    it('does NOT cut at a collapsed detection when its neighbours are continuous with each other', () => {
      const { samples: out, diagnostics } = select(WEDGE)

      expect(diagnostics.segmentCount).toBe(1)
      // ONE event, not two: declining the cut in front of the wedge also stops the cut behind it
      // from ever being evaluated, because the wedge never becomes the reference.
      expect(diagnostics.bridgedCuts).toBe(1)
      expect(diagnostics.rejectedOtherSegment).toBe(0)
      expect(diagnostics.rejectedBelowFloor).toBe(0)
      expect(diagnostics.detectedSamplesOut).toBe(4)
      // Bridge-and-keep: the offending frame stays in the segment and contributes its area.
      expect(diagnostics.segments[0].frameCount).toBe(4)
      out.forEach((sample, i) => {
        expect(sample).toBe(WEDGE[i])
      })
    })

    it('still cuts when the discontinuity survives removing the offending frame', () => {
      // The negative control for the case above, so it is not vacuous. Same first two boxes, but
      // the track really does jump: the last two sit across the frame, continuous with each other
      // and with nothing else. `(a,c)` now fails on position, so the bridge is refused and the
      // cuts stand.
      const samples: PoseSample[] = [
        detected(0, 100, 100, 400),
        detected(0.08, 800, 100, 150),
        detected(0.12, 1500, 600, 320),
        detected(0.16, 1520, 600, 320),
      ]

      const { diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(3)
      expect(diagnostics.bridgedCuts).toBe(0)
    })

    it('two consecutive discontinuous detections still cut', () => {
      // Bounds the tolerance to exactly one detection. The second and third boxes are continuous
      // with each other but not with the first, so the bridge from the first over the second lands
      // on a third frame that is just as discontinuous -- no bridge, and the pair forms its own
      // segment rather than being swallowed.
      const samples: PoseSample[] = [
        detected(0, 100, 100, 400),
        detected(0.08, 800, 100, 150),
        detected(0.12, 810, 100, 150),
        detected(0.16, 180, 100, 320),
      ]

      const { diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(3)
      expect(diagnostics.bridgedCuts).toBe(0)
    })

    it('does not bridge across a time gap, even when the geometry would allow it', () => {
      // The wedge fixture's geometry exactly, with the last two frames pushed out past the 1.0s
      // continuity-gap tolerance. `(a,c)` is still geometrically continuous (IoU 0.64, ratio
      // 1.5625) -- only the elapsed time differs, and it is the term a geometry-only bridge would
      // omit. See the 12-segment case in 'diagnostics reporting' for the same trap at scale.
      const samples: PoseSample[] = [
        detected(0, 100, 100, 400),
        detected(0.08, 800, 100, 150),
        detected(1.2, 180, 100, 320),
        detected(1.24, 200, 100, 320),
      ]

      const { diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(3)
      expect(diagnostics.bridgedCuts).toBe(0)
    })

    it('CAN merge an alternating two-person stream end to end — the bound is on CONSECUTIVE bridges only', () => {
      // The boundary of the tolerance, pinned deliberately rather than left to be discovered on a
      // real clip. Not advancing the reference bounds CONSECUTIVE bridging -- two bad frames in a
      // row still cut (the case above) -- but it does NOT bound bridging on every OTHER frame.
      // Here a runner and a bystander alternate at 0.04s spacing, and each is continuous with
      // itself across the 0.08s skip, so every single bridge is individually legal: each one
      // merges a pair the unmodified predicate accepts. The stage nonetheless keeps all seven
      // detections, the bystander's three included. Without the bridge this fixture is 7 segments
      // and 1 surviving detection.
      //
      // This is the shape the multi-person A/B gate (winner medianAreaPx, separationRatio) exists
      // to catch on real footage, and it is why bridgedCuts is reported: bridgedCuts >> 1 on a
      // clip means "check whether two people got stitched together", not "a wedge was healed".
      const samples: PoseSample[] = [
        detected(0, 100, 100, 400),
        detected(0.04, 1500, 700, 60),
        detected(0.08, 110, 100, 400),
        detected(0.12, 1510, 700, 60),
        detected(0.16, 120, 100, 400),
        detected(0.2, 1520, 700, 60),
        detected(0.24, 130, 100, 400),
      ]

      const { diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(1)
      expect(diagnostics.bridgedCuts).toBe(3)
      expect(diagnostics.detectedSamplesOut).toBe(7)
      // Bounded at one bridge per two surviving detections -- ceil(n / 2) is the ceiling, and a
      // 7-frame alternating stream hits 3, not 6.
      expect(diagnostics.bridgedCuts).toBeLessThanOrEqual(Math.ceil(samples.length / 2))
    })
  })

  describe('never substitutes another person for a rejected one', () => {
    it('every survivor is its input by reference and every rejection is exactly a null frame', () => {
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 105, 100, 300),
        detected(0.1, 110, 100, BELOW_FLOOR_SIDE),
        detected(0.15, 1500, 700, 60),
        detected(0.2, 1505, 700, 60),
        missing(0.25),
      ]

      const { samples: out } = select(samples)

      out.forEach((sample, i) => {
        if (sample.frame !== null) {
          // Kept: the original object, not a copy, not a blend of neighbours.
          expect(sample).toBe(samples[i])
        } else {
          expect(sample).toEqual({ timestamp: samples[i].timestamp, frame: null })
        }
      })
      // ...and something really was rejected, so the loop above was not vacuous.
      expect(out.filter((s) => s.frame === null)).toHaveLength(4)
    })
  })

  describe('fails open', () => {
    it('returns the input untouched when disabled — the revert path', () => {
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 1500, 700, 60),
      ]

      // The stage ships ON, so `enabled: false` is the revert path rather than the default. These
      // samples are deliberately discontinuous: with the stage running, one of them WOULD be
      // nulled, so `toBe(samples)` below only holds because the kill switch genuinely short-
      // circuits.
      const { samples: out, diagnostics } = select(samples, {
        ...DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG,
        enabled: false,
      })

      expect(out).toBe(samples)
      expect(diagnostics.status).toBe('skipped')
      expect(diagnostics.skipReason).toBe('disabled')
      expect(diagnostics.detectedSamplesOut).toBe(2)
      expect(diagnostics.segmentCount).toBe(0)
      expect(diagnostics.bridgedCuts).toBe(0)
      expect(diagnostics.minBoundingBoxAreaPx).toBe(0)
    })

    it.each([
      ['zero width', 0, 1080],
      ['zero height', 1920, 0],
      ['negative', -1920, 1080],
      ['NaN', Number.NaN, 1080],
      ['Infinity', Number.POSITIVE_INFINITY, 1080],
    ])('skips on an unusable frame size (%s)', (_label, width, height) => {
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 1500, 700, 60),
      ]

      const { samples: out, diagnostics } = selectRetroactivePersonOfInterest(
        samples,
        width,
        height,
        CONFIG,
      )

      expect(out).toBe(samples)
      expect(diagnostics.skipReason).toBe('unknown-frame-size')
      expect(diagnostics.detectedSamplesOut).toBe(2)
    })

    it('handles an empty clip without throwing', () => {
      const { samples, diagnostics } = select([])

      expect(samples).toEqual([])
      expect(diagnostics.skipReason).toBe('no-detections')
      expect(diagnostics.totalSamples).toBe(0)
      expect(diagnostics.detectedSamplesIn).toBe(0)
    })

    it('handles an all-undetected clip without throwing', () => {
      const samples = [missing(0), missing(0.05), missing(0.1)]
      const { samples: out, diagnostics } = select(samples)

      expect(out).toBe(samples)
      expect(diagnostics.skipReason).toBe('no-detections')
      expect(diagnostics.totalSamples).toBe(3)
    })

    it('skips when every frame is boxless — detections existed, but none was usable', () => {
      const samples = [boxless(0), boxless(0.05)]
      const { samples: out, diagnostics } = select(samples)

      expect(out).toBe(samples)
      expect(diagnostics.skipReason).toBe('no-detection-above-floor')
      expect(diagnostics.detectedSamplesIn).toBe(2)
      expect(diagnostics.detectedSamplesOut).toBe(2)
    })
  })

  describe('diagnostics reporting', () => {
    it('sorts segments by integrated area descending and caps the reported list at 10', () => {
      // 12 mutually discontinuous single-frame segments of strictly increasing size.
      const samples: PoseSample[] = Array.from({ length: 12 }, (_, i) =>
        // Alternating sides of the frame at 2s spacing: both the time and the geometry cut.
        detected(i * 2, i % 2 === 0 ? 50 : 1400, 50, 40 + i * 10),
      )

      const { diagnostics } = select(samples)

      expect(diagnostics.segmentCount).toBe(12)
      // The splice-tolerance landmine, asserted rather than left implicit. Frames i-1 and i+1
      // share parity here, so they sit at the SAME centre x with an area ratio of at most 2.25 --
      // geometrically continuous with each other, inside the bound of 4, IoU 0.444. Only the 4s
      // between them refuses the bridge.
      //
      // Simulated against this fixture's real box math, a bridge that checked geometry without
      // re-applying maxContinuityGapSeconds gives 4 segments and 8 bridged cuts. The damage is
      // worse than the parity overlap alone suggests, because the speed bound is
      // 3 x referenceSide x elapsed: with the time term gone, a bridge over a LONGER gap gets a
      // proportionally larger displacement budget, so once the reference sticks it swallows a run
      // of frames on the far side of the frame too (measured: one reference bridged six
      // consecutive frames).
      expect(diagnostics.bridgedCuts).toBe(0)
      expect(diagnostics.segments).toHaveLength(10)
      const areas = diagnostics.segments.map((s) => s.integratedAreaPx)
      expect([...areas].sort((a, b) => b - a)).toEqual(areas)
      // The largest box (side 150) is the winner and heads the list.
      expect(diagnostics.segments[0].medianAreaPx).toBeCloseTo(150 * 150, 5)
    })

    it('reports no separation ratio for a single segment', () => {
      const { diagnostics } = select([detected(0, 100, 100, 300), detected(0.05, 105, 100, 300)])
      expect(diagnostics.separationRatio).toBeNull()
    })

    it('detectedSamplesOut equals detectedSamplesIn minus both rejection counts', () => {
      const samples: PoseSample[] = [
        detected(0, 100, 100, 300),
        detected(0.05, 100, 100, BELOW_FLOOR_SIDE),
        detected(0.1, 105, 100, 300),
        detected(0.15, 1500, 700, 60),
        detected(0.2, 1500, 700, BELOW_FLOOR_SIDE),
      ]

      const { samples: out, diagnostics } = select(samples)

      expect(diagnostics.detectedSamplesOut).toBe(
        diagnostics.detectedSamplesIn -
          diagnostics.rejectedBelowFloor -
          diagnostics.rejectedOtherSegment,
      )
      expect(out.filter((s) => s.frame !== null)).toHaveLength(diagnostics.detectedSamplesOut)
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  estimateBodyScale,
  estimateHipWidth,
  estimateLocalTorsoLengths,
  torsoLengthAt,
} from './bodyScale'
import { buildFrame } from './__fixtures__/testFrames'

describe('estimateBodyScale', () => {
  it('computes the median torso length across frames with a straight vertical torso', () => {
    // shoulder-mid (0,0), hip-mid (0,100) -> distance 100 for every frame
    const frames = [
      buildFrame({
        left_shoulder: { x: -5, y: 0 },
        right_shoulder: { x: 5, y: 0 },
        left_hip: { x: -5, y: 100 },
        right_hip: { x: 5, y: 100 },
      }),
      buildFrame({
        left_shoulder: { x: -5, y: 0 },
        right_shoulder: { x: 5, y: 0 },
        left_hip: { x: -5, y: 100 },
        right_hip: { x: 5, y: 100 },
      }),
    ]

    const result = estimateBodyScale(frames)
    expect(result).not.toBeNull()
    expect(result?.torsoLengthPx).toBeCloseTo(100)
    expect(result?.sampleCoverage).toBe(1)
  })

  it('uses the median, not the mean, so one outlier frame does not dominate', () => {
    const goodFrame = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      right_shoulder: { x: 0, y: 0 },
      left_hip: { x: 0, y: 100 },
      right_hip: { x: 0, y: 100 },
    })
    const outlierFrame = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      right_shoulder: { x: 0, y: 0 },
      left_hip: { x: 0, y: 1000 },
      right_hip: { x: 0, y: 1000 },
    })
    const frames = [goodFrame, goodFrame, goodFrame, outlierFrame]

    const result = estimateBodyScale(frames)
    expect(result?.torsoLengthPx).toBeCloseTo(100)
  })

  it('excludes frames where shoulder-mid or hip-mid cannot resolve, reflected in sampleCoverage', () => {
    const resolvable = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      right_shoulder: { x: 0, y: 0 },
      left_hip: { x: 0, y: 100 },
      right_hip: { x: 0, y: 100 },
    })
    const unresolvable = buildFrame({
      left_shoulder: null,
      right_shoulder: null,
      left_hip: { x: 0, y: 100 },
      right_hip: { x: 0, y: 100 },
    })
    const frames = [resolvable, resolvable, unresolvable, unresolvable]

    const result = estimateBodyScale(frames)
    expect(result?.sampleCoverage).toBe(0.5)
  })

  it('returns null when zero frames have a resolvable body scale', () => {
    const unresolvable = buildFrame({ left_shoulder: null, right_shoulder: null })
    const result = estimateBodyScale([unresolvable, unresolvable])
    expect(result).toBeNull()
  })

  it('returns null for an empty frame list', () => {
    expect(estimateBodyScale([])).toBeNull()
  })
})

describe('estimateHipWidth', () => {
  it('computes the median hip separation across frames', () => {
    const frames = [
      buildFrame({ left_hip: { x: -20, y: 100 }, right_hip: { x: 20, y: 100 } }),
      buildFrame({ left_hip: { x: -20, y: 100 }, right_hip: { x: 20, y: 100 } }),
    ]

    const result = estimateHipWidth(frames)
    expect(result).not.toBeNull()
    expect(result?.hipWidthPx).toBeCloseTo(40)
    expect(result?.sampleCoverage).toBe(1)
  })

  it('uses the median, not the mean, so one outlier frame does not dominate', () => {
    const goodFrame = buildFrame({ left_hip: { x: -20, y: 100 }, right_hip: { x: 20, y: 100 } })
    const outlierFrame = buildFrame({
      left_hip: { x: -200, y: 100 },
      right_hip: { x: 200, y: 100 },
    })
    const frames = [goodFrame, goodFrame, goodFrame, outlierFrame]

    const result = estimateHipWidth(frames)
    expect(result?.hipWidthPx).toBeCloseTo(40)
  })

  it('excludes frames where both hips cannot resolve together, reflected in sampleCoverage', () => {
    const resolvable = buildFrame({ left_hip: { x: -20, y: 100 }, right_hip: { x: 20, y: 100 } })
    const unresolvable = buildFrame({ left_hip: null, right_hip: { x: 20, y: 100 } })
    const frames = [resolvable, resolvable, unresolvable, unresolvable]

    const result = estimateHipWidth(frames)
    expect(result?.sampleCoverage).toBe(0.5)
  })

  it('returns null when zero frames have both hips resolvable', () => {
    const unresolvable = buildFrame({ left_hip: null, right_hip: null })
    const result = estimateHipWidth([unresolvable, unresolvable])
    expect(result).toBeNull()
  })

  it('returns null for an empty frame list', () => {
    expect(estimateHipWidth([])).toBeNull()
  })
})

/** A frame whose torso (shoulder-mid at the origin, hip-mid straight below) is exactly `length`. */
function torsoFrame(
  length: number,
  timestamp: number,
  status: 'detected' | 'interpolated' = 'detected',
) {
  return buildFrame(
    {
      left_shoulder: { x: 0, y: 0, status },
      right_shoulder: { x: 0, y: 0, status },
      left_hip: { x: 0, y: length, status },
      right_hip: { x: 0, y: length, status },
    },
    timestamp,
  )
}

/** A frame with hips but no shoulders, so `torsoLengthAt` cannot resolve it. */
function torsolessFrame(timestamp: number) {
  return buildFrame({ left_hip: { x: 0, y: 100 }, right_hip: { x: 0, y: 100 } }, timestamp)
}

/** Torso grows linearly in TIME, 100 px at t = 0 plus 100 px per second, sampled at `fps`. */
function rampFrames(fps: number, durationSec: number) {
  return Array.from({ length: Math.round(durationSec * fps) + 1 }, (_, i) =>
    torsoFrame(100 + 100 * (i / fps), i / fps),
  )
}

describe('torsoLengthAt', () => {
  it('is the shoulder-mid to hip-mid distance, and null when either midpoint cannot resolve', () => {
    expect(torsoLengthAt(torsoFrame(87.5, 0))).toBe(87.5)
    expect(torsoLengthAt(torsolessFrame(0))).toBeNull()
  })
})

describe('estimateLocalTorsoLengths', () => {
  it('returns the constant torso, bit for bit, on every frame of a constant-distance clip', () => {
    // Bit-exactness is the property the SER rescale depends on: `torsoRef / localTorso` must be
    // EXACTLY 1 wherever the runner's size is constant, so a constant-distance clip's view numbers
    // do not move by a single ulp. 123.456 is deliberately not a binary fraction.
    const frames = Array.from({ length: 90 }, (_, i) => torsoFrame(123.456, i / 30))

    const local = estimateLocalTorsoLengths(frames, 0.5)

    expect(local).toHaveLength(90)
    for (const value of local) expect(value).toBe(123.456)
    expect(local[0]).toBe(estimateBodyScale(frames)?.torsoLengthPx)
  })

  it('takes a centred median in the interior and a TRUNCATED one at the edges of a ramp', () => {
    // 30 fps, torso 100 px + 100 px/s over 3 s. Interior (t = 1.5): the ±0.5 s window is frames
    // 30..60, symmetric about frame 45, so the median IS frame 45's own value, 250.
    const local = estimateLocalTorsoLengths(rampFrames(30, 3), 0.5)

    expect(local[45]).toBeCloseTo(250, 9)
    // First frame: the window is truncated to frames 0..15 (t 0..0.5), whose median sits at
    // t = 0.25 -> 125. A window SHIFTED to keep its full second would read t = 0.5 -> 150; the
    // frame's own value is 100. Truncation never borrows from further away than the window.
    expect(local[0]).toBeCloseTo(125, 9)
    // Last frame (t = 3): frames 75..90, median at t = 2.75 -> 375.
    expect(local[90]).toBeCloseTo(375, 9)
  })

  it('windows over SECONDS, not frames: the same motion at 30 and 60 fps reads the same', () => {
    // Same ramp, two frame rates. A time window covers the same 0.5 s at either rate, so the
    // truncated first-frame median lands at t = 0.25 both times. A 15-FRAME window would cover
    // 0.5 s at 30 fps but 0.25 s at 60 fps, and read 112.5 at the higher rate.
    const at30 = estimateLocalTorsoLengths(rampFrames(30, 3), 0.5)
    const at60 = estimateLocalTorsoLengths(rampFrames(60, 3), 0.5)

    expect(at30[0]).toBeCloseTo(125, 9)
    expect(at60[0]).toBeCloseTo(125, 9)
    // The same instant in the interior, t = 1.5 (frame 45 at 30 fps, frame 90 at 60 fps).
    expect(at60[90]).toBeCloseTo(at30[45] as number, 9)
  })

  it('is null exactly where nothing within the window resolves a torso', () => {
    // 30 fps; frames 20..59 (t 0.667..1.967, a 1.33 s run) carry no shoulders. Frame i still sees
    // a resolvable torso while one lies within 15 frames (0.5 s): the last before the run is 19,
    // the first after it 60. So frames 35..44 — and only those — have an empty window.
    const frames = Array.from({ length: 90 }, (_, i) =>
      i >= 20 && i <= 59 ? torsolessFrame(i / 30) : torsoFrame(100, i / 30),
    )

    const local = estimateLocalTorsoLengths(frames, 0.5)

    const nullIndices = local.flatMap((value, i) => (value === null ? [i] : []))
    expect(nullIndices).toEqual([35, 36, 37, 38, 39, 40, 41, 42, 43, 44])
    // A frame INSIDE the run but within reach of a resolvable one still gets that one's torso.
    expect(local[34]).toBe(100)
    expect(local[45]).toBe(100)
  })

  it('keeps interpolated torso points, as the clip-wide median does', () => {
    const frames = [torsoFrame(80, 0, 'interpolated'), torsoFrame(80, 0.1, 'interpolated')]
    expect(estimateLocalTorsoLengths(frames, 0.5)).toEqual([80, 80])
  })

  it('returns an empty array for an empty clip', () => {
    expect(estimateLocalTorsoLengths([], 0.5)).toEqual([])
  })

  it('throws on frames out of presentation order rather than scanning a wrong window', () => {
    const frames = [torsoFrame(100, 0), torsoFrame(100, 0.2), torsoFrame(100, 0.1)]
    expect(() => estimateLocalTorsoLengths(frames, 0.5)).toThrow(RangeError)
  })

  it('throws on a negative or non-finite half-window', () => {
    const frames = [torsoFrame(100, 0)]
    expect(() => estimateLocalTorsoLengths(frames, -0.1)).toThrow(RangeError)
    expect(() => estimateLocalTorsoLengths(frames, Number.NaN)).toThrow(RangeError)
    expect(() => estimateLocalTorsoLengths(frames, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

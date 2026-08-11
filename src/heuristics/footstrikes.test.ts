import { describe, expect, it } from 'vitest'
import { detectFootstrikes } from './footstrikes'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig } from './types'
import { buildFrame } from './__fixtures__/testFrames'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'

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

describe('detectFootstrikes', () => {
  it('keeps only ankle-y maxima (footstrikes), not minima, for a side with a clean bump', () => {
    // Reuses extrema.ts's own hand-traced "monotonic rise" case (see extrema.test.ts): raw
    // [0,1,2,3,4,5] at threshold 2 confirms min@index0 then max@index5 -- only the max is a
    // footstrike candidate. Right ankle held constant so it contributes zero extrema, isolating
    // the "maxima only" behavior to a single side.
    const leftY = [0, 1, 2, 3, 4, 5]
    const frames = leftY.map((y, i) =>
      buildFrame({ ...TORSO_POINTS, left_ankle: { x: 0, y }, right_ankle: { x: 0, y: 300 } }, i),
    )

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
    // first rather than a distinct footstrike.
    const leftY = [10, 8, 6, 4, 6, 8, 10, 8, 6]
    const timestamps = [0, 0.02, 0.04, 0.06, 0.08, 0.09, 0.1, 0.12, 0.14]
    const frames = leftY.map((y, i) =>
      buildFrame(
        { ...TORSO_POINTS, left_ankle: { x: 0, y }, right_ankle: { x: 0, y: 300 } },
        timestamps[i],
      ),
    )

    const result = detectFootstrikes(frames, configWithRatio(0.03)) // 0.03 * 100 = 3

    expect(result).toEqual([{ frameIndex: 0, timestamp: 0, side: 'left' }])
  })

  it('combines both legs into a single timestamp-ordered list, not grouped/appended by side', () => {
    // Left ankle-y rises monotonically (max at the end, index 5); right ankle-y falls
    // monotonically (max at the start, index 0) -- mirror-image traces of the same "monotonic
    // rise" extrema.ts case. Detection appends left's candidates before right's internally, so
    // the assertion on order below only holds if detectFootstrikes actually re-sorts by
    // timestamp afterward.
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
    const frames = leftY.map((y, i) =>
      buildFrame({ ...TORSO_POINTS, left_ankle: { x: 0, y }, right_ankle: { x: 0, y: 300 } }, i),
    )

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

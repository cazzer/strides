import { describe, expect, it } from 'vitest'
import { createFrameSelector } from './sequentialSamplingStep'

/** Builds a CFR timestamp sequence: `count` frames at `fps`, starting at 0. */
function cfrTimestamps(fps: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => i / fps)
}

describe('createFrameSelector', () => {
  it('selects every frame when targetSamplesPerSecond is null', () => {
    const select = createFrameSelector({ targetSamplesPerSecond: null })
    const timestamps = cfrTimestamps(30, 10)

    expect(timestamps.map(select)).toEqual(timestamps.map(() => true))
  })

  it('downsamples CFR 30fps to a 10 samples/sec target: exactly every 3rd frame', () => {
    const select = createFrameSelector({ targetSamplesPerSecond: 10 })
    const timestamps = cfrTimestamps(30, 30) // one second's worth

    const selectedIndices = timestamps
      .map((t, i) => (select(t) ? i : null))
      .filter((i): i is number => i !== null)

    expect(selectedIndices).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27])
  })

  it('downsamples CFR 60fps to a 10 samples/sec target: exactly every 6th frame', () => {
    const select = createFrameSelector({ targetSamplesPerSecond: 10 })
    const timestamps = cfrTimestamps(60, 60) // one second's worth

    const selectedIndices = timestamps
      .map((t, i) => (select(t) ? i : null))
      .filter((i): i is number => i !== null)

    expect(selectedIndices).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48, 54])
  })

  it('selects every frame when targetSamplesPerSecond exceeds the source frame rate', () => {
    const select = createFrameSelector({ targetSamplesPerSecond: 30 })
    const timestamps = cfrTimestamps(10, 10) // 10fps source, well under the 30/s target

    expect(timestamps.map(select)).toEqual(timestamps.map(() => true))
  })

  it('is PTS-bucket based, not index-modulo, on variable-frame-rate content', () => {
    // Irregular gaps: two frames close together, a long gap, two more close together, a longer
    // gap still. An index-modulo stride (e.g. "every 2nd frame") would pick a fixed pattern of
    // indices regardless of timing; a PTS-bucket selector's picks depend on where each frame
    // actually lands in time.
    const timestamps = [0, 0.05, 0.06, 0.2, 0.21, 0.4, 0.9, 1.0, 1.05]
    const select = createFrameSelector({ targetSamplesPerSecond: 5 }) // 0.2s buckets

    // bucket = floor(t * 5): 0, 0, 0, 1, 1, 2, 4, 5, 5
    const buckets = timestamps.map((t) => Math.floor(t * 5))
    expect(buckets).toEqual([0, 0, 0, 1, 1, 2, 4, 5, 5])

    const selected = timestamps.map(select)
    // First frame in each new bucket is selected: indices 0, 3, 5, 6, 7.
    expect(selected).toEqual([true, false, false, true, false, true, true, true, false])
  })

  it('never selects twice within the same bucket, even across many frames', () => {
    const select = createFrameSelector({ targetSamplesPerSecond: 1 })
    // 20 frames within the same one-second bucket (bucket 0), all at sub-second timestamps.
    const timestamps = Array.from({ length: 20 }, (_, i) => i * 0.04)

    const results = timestamps.map(select)

    expect(results[0]).toBe(true)
    expect(results.slice(1)).toEqual(results.slice(1).map(() => false))
  })

  it('is a factory: each call returns an independent selector with its own state', () => {
    const selectA = createFrameSelector({ targetSamplesPerSecond: 10 })
    const selectB = createFrameSelector({ targetSamplesPerSecond: 10 })

    expect(selectA(0)).toBe(true)
    expect(selectA(0.05)).toBe(false)
    // selectB's state is independent -- its first call also lands in a fresh, unselected bucket.
    expect(selectB(0)).toBe(true)
  })
})

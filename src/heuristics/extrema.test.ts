import { describe, expect, it } from 'vitest'
import { findLocalExtrema } from './extrema'

describe('findLocalExtrema', () => {
  it('finds a min then a max on a monotonic rise (hand-traced: n<=2-length runs skip smoothing entirely, but this run is long enough to hit the general path — see the "down-up-down" test for a fully-smoothed trace)', () => {
    // v = [0, 1, 2, 3, 4, 5], threshold 2. Phase 1 confirms once the running high/low spread
    // first reaches 2 (at i=2: high=2, low=0, spread=2) -> low (index 0) came first, so it's the
    // initial min; trend flips 'up' and the pivot rides the rise to the end (index 5), emitted as
    // the trailing max since nothing after it reverses.
    const series = [0, 1, 2, 3, 4, 5].map((v, i) => ({ t: i, v }))

    const extrema = findLocalExtrema(series, 2)

    expect(extrema).toEqual([
      { index: 0, timestamp: 0, value: 0, kind: 'min' },
      { index: 5, timestamp: 5, value: 5, kind: 'max' },
    ])
  })

  it('hand-traced down-up-down through the 3-sample smoothing pass', () => {
    // Raw v = [10, 8, 6, 4, 6, 8, 10, 8, 6], threshold 3.
    //
    // Smoothed (boundary samples average with their one neighbor; interior samples average
    // themselves + both neighbors):
    //   sm[0] = (10+8)/2 = 9
    //   sm[1] = (10+8+6)/3 = 8
    //   sm[2] = (8+6+4)/3 = 6
    //   sm[3] = (6+4+6)/3 = 5.333
    //   sm[4] = (4+6+8)/3 = 6
    //   sm[5] = (6+8+10)/3 = 8
    //   sm[6] = (8+10+8)/3 = 8.667
    //   sm[7] = (10+8+6)/3 = 8
    //   sm[8] = (8+6)/2 = 7
    //
    // Phase 1: high/low spread first reaches 3 at i=2 (high=sm[0]=9, low=sm[2]=6, spread=3) ->
    // high came first (index 0), so index 0 is the initial max; trend flips 'down', pivot=index2.
    // Phase 2: pivot rides down to index 3 (sm=5.333, the run's lowest smoothed value) since
    // i=4,5 never reverse by 3 from it (6-5.333=0.667, 8-5.333=2.667, both under 3) -> confirmed
    // at i=6 (8.667-5.333=3.333 >= 3): index 3 emitted as min, trend flips 'up', pivot=index6.
    // From index 6, i=7,8 never reverse by 3 (8.667-8=0.667, 8.667-7=1.667, both under 3) -> the
    // run ends with index 6 still the (unconfirmed but guaranteed-prominent) pivot, emitted as
    // the trailing max.
    //
    // Reported `value`s are the RAW samples at each selected index, not the smoothed ones.
    const raw = [10, 8, 6, 4, 6, 8, 10, 8, 6]
    const series = raw.map((v, i) => ({ t: i, v }))

    const extrema = findLocalExtrema(series, 3)

    expect(extrema).toEqual([
      { index: 0, timestamp: 0, value: 10, kind: 'max' },
      { index: 3, timestamp: 3, value: 4, kind: 'min' },
      { index: 6, timestamp: 6, value: 10, kind: 'max' },
    ])
  })

  it('never smooths or pairs extrema across a gap: two runs are detected fully independently', () => {
    // Run 1 (indices 0-1): [0, 10] -> min@0, max@1 (rises straight to the end).
    // Run 2 (indices 3-4, after a gap at index 2): [10, 0] -> max@3, min@4 (falls straight from
    // the start). Note extrema[1] and extrema[2] are BOTH 'max' — this is exactly the case
    // armSwingSymmetry.ts's amplitude-pairing loop has to guard against, since a naive
    // "pair every consecutive pair" would fabricate an amplitude across the gap.
    const series = [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
      null,
      { t: 3, v: 10 },
      { t: 4, v: 0 },
    ]

    const extrema = findLocalExtrema(series, 5)

    expect(extrema).toEqual([
      { index: 0, timestamp: 0, value: 0, kind: 'min' },
      { index: 1, timestamp: 1, value: 10, kind: 'max' },
      { index: 3, timestamp: 3, value: 10, kind: 'max' },
      { index: 4, timestamp: 4, value: 0, kind: 'min' },
    ])
  })

  it('reports no extrema when the run never moves by at least minProminenceAbs (pure jitter)', () => {
    const series = [5, 5.5, 5, 5.5, 5].map((v, i) => ({ t: i, v }))
    expect(findLocalExtrema(series, 2)).toEqual([])
  })

  it('reports no extrema for an isolated single-sample run (direction is undefined from one point)', () => {
    const series = [null, { t: 1, v: 5 }, null]
    expect(findLocalExtrema(series, 1)).toEqual([])
  })

  it('returns an empty array for an empty series', () => {
    expect(findLocalExtrema([], 1)).toEqual([])
  })

  it('returns an empty array for an all-gap series', () => {
    expect(findLocalExtrema([null, null, null], 1)).toEqual([])
  })
})

export interface Extremum {
  /** Index into the original `series` array passed to `findLocalExtrema`. */
  index: number
  timestamp: number
  value: number
  kind: 'min' | 'max'
}

interface Sample {
  t: number
  v: number
}

/**
 * 3-sample centered moving average, computed independently within one contiguous run of real
 * samples — this function is only ever called on a single run, never across a `null` gap, so a
 * gap in the tracked point (e.g. a stretch the robustness layer marked `unrecoverable`) never
 * gets blended into a smoothed value on either side of it. Boundary samples average with their
 * one available neighbor instead of reaching past the run's edge.
 */
function smoothRun(values: number[]): number[] {
  const n = values.length
  if (n <= 2) return values.slice()

  const smoothed = new Array<number>(n)
  smoothed[0] = (values[0] + values[1]) / 2
  smoothed[n - 1] = (values[n - 2] + values[n - 1]) / 2
  for (let i = 1; i < n - 1; i += 1) {
    smoothed[i] = (values[i - 1] + values[i] + values[i + 1]) / 3
  }
  return smoothed
}

/**
 * Single-pass "zig-zag" prominence scan over one contiguous run. Tracks a running pivot (the
 * current best candidate for the next extremum) and only confirms it — emitting an `Extremum`
 * and flipping trend direction — once the series has since moved at least `minProminenceAbs`
 * away from it in the opposite direction. This is what keeps a stretch of small back-and-forth
 * tracking jitter (smaller than `minProminenceAbs`) from fragmenting into many spurious "cycles",
 * which a naive derivative-sign-change detector would be defenseless against on real
 * pose-tracking noise.
 *
 * Detection (which samples become pivots) runs on the smoothed series, but the `value` reported
 * for each confirmed extremum is the RAW sample at that index, not the smoothed one — smoothing
 * exists only to make index selection robust to jitter; the reported magnitude should reflect the
 * actual observed position, not a slightly-blunted average of it.
 *
 * The trailing pivot (wherever the trend was heading when the run's data ran out) is always
 * emitted too, even though nothing after it confirmed a reversal. This is sound, not a loophole:
 * by construction, the pivot is set the moment a move of at least `minProminenceAbs` away from
 * the previous confirmed extremum is observed, and only ever moves further in that same
 * direction afterward — so the trailing pivot's distance from the prior extremum is always
 * *itself* at least `minProminenceAbs`, the same guarantee every other reported extremum carries.
 */
function findExtremaInRun(
  smoothed: number[],
  rawValues: number[],
  originalIndices: number[],
  timestamps: number[],
  minProminenceAbs: number,
): Extremum[] {
  const n = smoothed.length
  const extrema: Extremum[] = []
  if (n === 0) return extrema

  const toExtremum = (localIdx: number, kind: 'min' | 'max'): Extremum => ({
    index: originalIndices[localIdx],
    timestamp: timestamps[localIdx],
    value: rawValues[localIdx],
    kind,
  })

  // Phase 1: direction not yet established. Track the running highest and lowest smoothed
  // sample seen since the start of the run — both start at the run's first sample — until their
  // spread first reaches minProminenceAbs. Whichever of the two occurred earlier in time becomes
  // the run's first confirmed extremum (a rise-then-later-established-high means the early low
  // was the pivot; a fall means the early high was).
  let highIdx = 0
  let lowIdx = 0
  let trend: 'up' | 'down' | null = null
  let pivotIdx = 0

  let i = 1
  for (; i < n && trend === null; i += 1) {
    if (smoothed[i] > smoothed[highIdx]) highIdx = i
    if (smoothed[i] < smoothed[lowIdx]) lowIdx = i
    if (smoothed[highIdx] - smoothed[lowIdx] >= minProminenceAbs) {
      if (lowIdx < highIdx) {
        extrema.push(toExtremum(lowIdx, 'min'))
        trend = 'up'
        pivotIdx = highIdx
      } else {
        extrema.push(toExtremum(highIdx, 'max'))
        trend = 'down'
        pivotIdx = lowIdx
      }
    }
  }

  // The run never moved by minProminenceAbs in either direction — no cycle to report.
  if (trend === null) return extrema

  // Phase 2: direction established. Extend the pivot while the trend continues; confirm and
  // flip once the series reverses by at least minProminenceAbs from the pivot.
  for (; i < n; i += 1) {
    if (trend === 'up') {
      if (smoothed[i] >= smoothed[pivotIdx]) {
        pivotIdx = i
      } else if (smoothed[pivotIdx] - smoothed[i] >= minProminenceAbs) {
        extrema.push(toExtremum(pivotIdx, 'max'))
        trend = 'down'
        pivotIdx = i
      }
    } else {
      if (smoothed[i] <= smoothed[pivotIdx]) {
        pivotIdx = i
      } else if (smoothed[i] - smoothed[pivotIdx] >= minProminenceAbs) {
        extrema.push(toExtremum(pivotIdx, 'min'))
        trend = 'up'
        pivotIdx = i
      }
    }
  }

  extrema.push(toExtremum(pivotIdx, trend === 'up' ? 'max' : 'min'))

  return extrema
}

/**
 * Finds local minima/maxima across a possibly-gappy time series, treating each contiguous run of
 * non-null samples as its own independent smoothing/detection domain. Shared by vertical
 * oscillation (hip-mid y — bounce extrema) and overstriding (ankle y — footstrike extrema).
 *
 * `series[i] === null` represents a gap: a frame where the tracked point wasn't resolvable (e.g.
 * `RobustKeypoint.status === 'unrecoverable'`). Gaps split the series into runs; extrema are
 * never paired or smoothed across a gap boundary, since there's no basis for assuming what the
 * signal did during the missing stretch.
 */
export function findLocalExtrema(
  series: Array<{ t: number; v: number } | null>,
  minProminenceAbs: number,
): Extremum[] {
  const extrema: Extremum[] = []
  let run: Sample[] = []
  let runIndices: number[] = []

  const flushRun = () => {
    if (run.length === 0) return
    const rawValues = run.map((s) => s.v)
    const timestamps = run.map((s) => s.t)
    const smoothed = smoothRun(rawValues)
    extrema.push(
      ...findExtremaInRun(
        smoothed,
        rawValues,
        runIndices,
        timestamps,
        minProminenceAbs,
      ),
    )
    run = []
    runIndices = []
  }

  series.forEach((sample, i) => {
    if (sample === null) {
      flushRun()
      return
    }
    run.push(sample)
    runIndices.push(i)
  })
  flushRun()

  return extrema
}

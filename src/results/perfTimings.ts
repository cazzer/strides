/**
 * Dev-only wall-clock instrumentation for the analysis pipeline (`strides-e4c.1`): one
 * `[perf-timings]` console line per stage occurrence, carrying a single `JSON.stringify` payload,
 * matched by `text.startsWith('[perf-timings]')`. Same contract as `[analysis-diagnostics]` and
 * `[evidence-coverage]`: gated on `import.meta.env.DEV`, so the bundler drops the line — prefix
 * included — from a production build, and nothing image-shaped ever rides on it.
 *
 * Call sites measure with `performance.now()` and hand plain numbers here. Measuring is left
 * running in production on purpose: it is a few clock reads per sampled frame against a detection
 * call that costs tens of milliseconds, and gating every read would scatter `DEV` checks through
 * the per-frame loops this exists to observe.
 *
 * Every line carries `atMs`, `performance.now()` at emission, so a driver can line stages up on
 * the page's own clock without a second instrument.
 */

export interface DurationSummary {
  count: number
  sumMs: number
  /** `null` for an empty series — there is no median of nothing, and `0` would read as fast. */
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}

/** What a sampler measured about its own run, reported once when it settles normally. */
export interface SamplerTimings {
  path: 'sequential' | 'playback'
  /** From the sampler being called to its promise settling. */
  totalMs: number
  /** One entry per detection attempt, from `estimatePose` being called to it settling. */
  detectMs: DurationSummary
  /** Sequential path only. `0` read time, and the wait on the shared track as `demuxMs`, when
   * this pass reused a track another pass demuxed (`clipBytesCache.ts`). */
  arrayBufferMs?: number
  demuxMs?: number
  decoderOpenMs?: number
  /** Sequential path only: the `drawImage` of each decoded frame onto the detector canvas. */
  drawMs?: DurationSummary
  /** Sequential path only: time spent waiting on the decoder for the next selected frame. */
  decodeWaitMs?: DurationSummary
  /** Playback path only: `requestVideoFrameCallback` firings, and those dropped while a
   * detection was still in flight. */
  frameCallbacks?: number
  droppedWhileInFlight?: number
}

/** Rounded to a hundredth of a millisecond — finer than `performance.now()` is precise anyway. */
export function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100
}

function percentile(sorted: readonly number[], fraction: number): number {
  // Nearest-rank: the value at or above `fraction` of the series, never an interpolation between
  // two frames that each actually happened.
  const rank = Math.ceil(fraction * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

export function summarizeDurations(durationsMs: readonly number[]): DurationSummary {
  if (durationsMs.length === 0) {
    return { count: 0, sumMs: 0, p50Ms: null, p95Ms: null, maxMs: null }
  }
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    count: sorted.length,
    sumMs: roundMs(sum),
    p50Ms: roundMs(percentile(sorted, 0.5)),
    p95Ms: roundMs(percentile(sorted, 0.95)),
    maxMs: roundMs(sorted[sorted.length - 1]),
  }
}

export function logPerfTimings(stage: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return
  console.log(
    '[perf-timings]',
    JSON.stringify({ stage, atMs: roundMs(performance.now()), ...payload }),
  )
}

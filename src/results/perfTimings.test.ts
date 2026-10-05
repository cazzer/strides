import { afterEach, describe, expect, it, vi } from 'vitest'
import { logPerfTimings, roundMs, summarizeDurations } from './perfTimings'

describe('summarizeDurations', () => {
  it('reports nulls rather than zeros for an empty series', () => {
    expect(summarizeDurations([])).toEqual({
      count: 0,
      sumMs: 0,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    })
  })

  it('uses nearest-rank percentiles, so every reported value is one that actually occurred', () => {
    const series = Array.from({ length: 20 }, (_, i) => 20 - i) // 20..1, unsorted on purpose
    expect(summarizeDurations(series)).toEqual({
      count: 20,
      sumMs: 210,
      p50Ms: 10,
      p95Ms: 19,
      maxMs: 20,
    })
  })

  it('handles a single sample', () => {
    expect(summarizeDurations([3.14159])).toEqual({
      count: 1,
      sumMs: 3.14,
      p50Ms: 3.14,
      p95Ms: 3.14,
      maxMs: 3.14,
    })
  })

  it('does not reorder the caller’s array', () => {
    const series = [3, 1, 2]
    summarizeDurations(series)
    expect(series).toEqual([3, 1, 2])
  })
})

describe('roundMs', () => {
  it('rounds to a hundredth of a millisecond', () => {
    expect(roundMs(1.23456)).toBe(1.23)
    expect(roundMs(1.235001)).toBe(1.24)
  })
})

describe('logPerfTimings', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs one prefixed line whose remainder is a single JSON payload', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    logPerfTimings('analysis-pass', { pass: 'primary', totalMs: 12.5 })

    expect(log).toHaveBeenCalledTimes(1)
    const [prefix, json] = log.mock.calls[0] as [string, string]
    expect(prefix).toBe('[perf-timings]')
    const payload = JSON.parse(json) as Record<string, unknown>
    expect(payload).toMatchObject({ stage: 'analysis-pass', pass: 'primary', totalMs: 12.5 })
    expect(typeof payload.atMs).toBe('number')
  })
})

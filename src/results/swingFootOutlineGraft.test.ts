import { describe, expect, it } from 'vitest'
import { makeHeuristics } from './__fixtures__/metricResult'
import {
  OUTLINE_FAILED_CAVEAT,
  OUTLINE_PLAYBACK_PATH_CAVEAT,
  graftOutlineResult,
  withOutlineUnavailable,
} from './swingFootOutlineGraft'
import type { FormHeuristicsResult, SwingFootLateralExcursionResult } from '../heuristics/types'

const summarized: SwingFootLateralExcursionResult = {
  metric: 'swingFootLateralExcursion',
  value: 0,
  unit: 'percent',
  confidence: 0.9,
  viewFit: 'primary',
  interpolatedFraction: 0,
  frameCoverage: 1,
  sampleSize: 4,
  caveat: 'inside',
  outlinePlan: null,
  outline: null,
}

function expectOnlyOutlineMetricReplaced(before: FormHeuristicsResult, after: FormHeuristicsResult) {
  for (const key of Object.keys(before) as Array<keyof FormHeuristicsResult>) {
    if (key === 'swingFootLateralExcursion') continue
    expect(after[key], key).toBe(before[key])
  }
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
}

describe('graftOutlineResult', () => {
  it('replaces swingFootLateralExcursion and keeps every other key by reference', () => {
    const primary = makeHeuristics()
    const grafted = graftOutlineResult(primary, summarized)
    expect(grafted.swingFootLateralExcursion).toBe(summarized)
    expectOnlyOutlineMetricReplaced(primary, grafted)
  })
})

describe('withOutlineUnavailable', () => {
  it.each([
    ['failed', OUTLINE_FAILED_CAVEAT],
    ['playback-path', OUTLINE_PLAYBACK_PATH_CAVEAT],
  ] as const)('%s: value null, confidence 0, its caveat, no evidence, nothing else touched', (reason, caveat) => {
    const primary = makeHeuristics()
    const result = withOutlineUnavailable(primary, reason)
    expect(result.swingFootLateralExcursion).toMatchObject({ value: null, confidence: 0, caveat })
    expect(result.swingFootLateralExcursion.exemplars).toBeUndefined()
    expectOnlyOutlineMetricReplaced(primary, result)
  })
})

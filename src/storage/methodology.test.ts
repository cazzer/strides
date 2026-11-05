import { describe, expect, it } from 'vitest'
import type { MetricId } from '../heuristics/types'
import { METRIC_LABELS } from '../results/metricConfidence'
import {
  METHODOLOGY_HISTORY,
  METHODOLOGY_VERSION,
  METRIC_DEFINITION_VERSIONS,
} from './methodology'
import { buildInfo } from './buildInfo'

const ALL_METRICS = Object.keys(METRIC_LABELS) as MetricId[]

describe('methodology versions', () => {
  it('covers every MetricId with a positive integer version', () => {
    expect(Object.keys(METRIC_DEFINITION_VERSIONS).sort()).toEqual([...ALL_METRICS].sort())
    for (const metric of ALL_METRICS) {
      const v = METRIC_DEFINITION_VERSIONS[metric]
      expect(Number.isInteger(v) && v >= 1).toBe(true)
    }
  })

  it('has history versions strictly increasing from 1', () => {
    METHODOLOGY_HISTORY.forEach((entry, i) => expect(entry.version).toBe(i + 1))
  })

  it('ends history at the current methodology and the current metric definitions', () => {
    const last = METHODOLOGY_HISTORY[METHODOLOGY_HISTORY.length - 1]
    expect(last.version).toBe(METHODOLOGY_VERSION)
    expect(last.metricDefinitions).toEqual(METRIC_DEFINITION_VERSIONS)
  })

  it('never lowers a metric definition version, and every entry names every metric', () => {
    for (let i = 0; i < METHODOLOGY_HISTORY.length; i++) {
      const entry = METHODOLOGY_HISTORY[i]
      expect(Object.keys(entry.metricDefinitions).sort()).toEqual([...ALL_METRICS].sort())
      if (i === 0) continue
      const previous = METHODOLOGY_HISTORY[i - 1]
      for (const metric of ALL_METRICS) {
        expect(entry.metricDefinitions[metric]).toBeGreaterThanOrEqual(
          previous.metricDefinitions[metric],
        )
      }
    }
  })

  it('dates every entry as an ISO day', () => {
    for (const entry of METHODOLOGY_HISTORY) expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('is frozen so history cannot be edited at runtime', () => {
    expect(Object.isFrozen(METHODOLOGY_HISTORY)).toBe(true)
    expect(Object.isFrozen(METRIC_DEFINITION_VERSIONS)).toBe(true)
  })
})

describe('buildInfo', () => {
  it('reads unknown when no commit was stamped', () => {
    expect(buildInfo().commit).toBe('unknown')
  })
})

import { describe, expect, it } from 'vitest'
import { bounceDerivation } from '../guidance/compositeReadings'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import { bindRunnerParams } from '../runner/runnerParams'
import { makeHeuristics, makeMetric, makeVerticalOscillation } from './__fixtures__/metricResult'
import { fuseFormHeuristicsResults, fusionSourceIndices } from './fuseHeuristics'
import { metricTier } from './metricConfidence'
import { ratioClipBounceFor } from './ratioClipBounce'
import { summaryRows } from './summary/summaryRows'

/**
 * The 3-clip demo's shape: vertical ratio wins on clip 0 (side), the relative bounce on clip 1
 * (another side clip, more confident), the front clip measures neither well.
 */
function demoShapedClips(): FormHeuristicsResult[] {
  return [
    makeHeuristics({
      verticalRatio: makeMetric('verticalRatio', { value: 0.0246, confidence: 0.9 }),
      verticalOscillation: makeVerticalOscillation({ value: 0.154, confidence: 0.6 }),
    }),
    makeHeuristics({
      verticalRatio: makeMetric('verticalRatio', { value: 0.03, confidence: 0.5 }),
      verticalOscillation: makeVerticalOscillation({ value: 0.172, confidence: 0.8 }),
    }),
    makeHeuristics({
      verticalRatio: makeMetric('verticalRatio', { value: 0.05, confidence: 0.1 }),
      verticalOscillation: makeVerticalOscillation({ value: 0.2, confidence: 0.1 }),
    }),
  ]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

describe('ratioClipBounceFor', () => {
  it("reads the relative bounce off vertical ratio's winning clip, with that result's tier", () => {
    const clips = demoShapedClips()
    const sourceIndices = fusionSourceIndices(clips)
    expect(sourceIndices.verticalRatio).toBe(0)
    expect(sourceIndices.verticalOscillation).toBe(1)
    expect(ratioClipBounceFor(clips, sourceIndices)).toEqual({
      value: 0.154,
      tier: metricTier(clips[0].verticalOscillation),
    })
  })

  it('is null until fused, or when that clip has no result', () => {
    expect(ratioClipBounceFor(demoShapedClips(), null)).toBeNull()
    const indices = fusionSourceIndices(demoShapedClips())
    expect(ratioClipBounceFor([null, null, null], indices)).toBeNull()
  })

  it('is presentation only: every fused value and every clip choice is unchanged, and no input is touched', () => {
    const clips = demoShapedClips()
    const fusedBefore = structuredClone(fuseFormHeuristicsResults(demoShapedClips()))
    const indicesBefore = structuredClone(fusionSourceIndices(demoShapedClips()))
    deepFreeze(clips)
    const sourceIndices = deepFreeze(fusionSourceIndices(clips))
    const fused = deepFreeze(fuseFormHeuristicsResults(clips))

    // Everything downstream that reads it: the derivation, the summary rows, the runner binding.
    const ratioClipBounce = ratioClipBounceFor(clips, sourceIndices)
    const tiers = Object.fromEntries(
      (Object.keys(sourceIndices) as MetricId[]).map((id) => [id, metricTier(fused[id] as MetricResult)]),
    ) as Record<MetricId, ReturnType<typeof metricTier>>
    const derivation = bounceDerivation(fused, tiers, sourceIndices, 'hipMid', ratioClipBounce)
    const rows = summaryRows(fused, { sourceIndices, ratioClipBounce })
    const bound = bindRunnerParams(fused, undefined, { sourceIndices, ratioClipBounce })

    expect(fusionSourceIndices(clips)).toEqual(indicesBefore)
    expect(fuseFormHeuristicsResults(clips)).toEqual(fusedBefore)
    expect(fused).toEqual(fusedBefore)
    // The fused relative bounce is still clip 1's; only the derivation cites clip 0's.
    expect(fused.verticalOscillation.value).toBe(0.172)
    expect(derivation?.figures).toEqual({ bounceTorsoLengths: 0.154, strideTorsoLengths: 0.154 / 0.0246 })
    expect(rows.areas.find((area) => area.view.area === 'rhythm')?.bounce).toEqual(derivation)
    expect(bound.strideLength).toMatchObject({ source: 'measured', value: 0.154 / 0.0246, metricValue: 0.0246 })
    expect(bound.pelvisBounce).toMatchObject({ metricId: 'verticalOscillation', value: 0.172 })
    // Without it, as before this change, the mixed clips leave the stride unsaid.
    expect(bounceDerivation(fused, tiers, sourceIndices)?.figures).toBeNull()
  })
})

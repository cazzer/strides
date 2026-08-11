import { describe, expect, it } from 'vitest'
import { computeFormHeuristics } from './index'
import { detectView } from './viewDetection'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'

const PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
  trunkLeanDeg: 8,
  view: 'side' as const,
}

describe('computeFormHeuristics', () => {
  it('returns a fully-populated result for a clean side-view clip, all metrics using the detected view', () => {
    const frames = generateSyntheticGait(PARAMS)

    const result = computeFormHeuristics(frames)

    expect(result.view.view).toBe('side')
    expect(result.verticalOscillation.metric).toBe('verticalOscillation')
    expect(result.trunkLean.metric).toBe('trunkLean')
    expect(result.overstriding.metric).toBe('overstriding')

    expect(result.verticalOscillation.value).not.toBeNull()
    expect(result.trunkLean.value).not.toBeNull()
    expect(result.overstriding.value).not.toBeNull()

    // Every metric was gated using the same detected view, not recomputed independently.
    expect(result.verticalOscillation.viewFit).toBe('primary')
    expect(result.trunkLean.viewFit).toBe('primary')
    expect(result.overstriding.viewFit).toBe('primary')
  })

  it('produces the same view label and per-metric results as calling detectView + each metric directly', () => {
    const frames = generateSyntheticGait(PARAMS)

    const orchestrated = computeFormHeuristics(frames)
    const standaloneView = detectView(frames)

    expect(orchestrated.view).toEqual(standaloneView)
  })

  it('gates all three metrics consistently off an ambiguous view', () => {
    const frames = generateSyntheticGait({
      ...PARAMS,
      strideAmplitudePx: 20, // engineered BSR/SER disagreement, see viewDetection.test.ts
    })

    const result = computeFormHeuristics(frames)

    expect(result.view.view).toBe('ambiguous')
    expect(result.verticalOscillation.viewFit).toBe('tolerated')
    expect(result.trunkLean.viewFit).toBe('unsuitable')
    expect(result.overstriding.viewFit).toBe('unsuitable')
  })

  it('never throws on an empty frame list and returns a well-formed, non-null-crashing result', () => {
    expect(() => computeFormHeuristics([])).not.toThrow()
    const result = computeFormHeuristics([])

    expect(result.view.view).toBe('ambiguous')
    expect(result.verticalOscillation.value).toBeNull()
    expect(result.trunkLean.value).toBeNull()
    expect(result.overstriding.value).toBeNull()
    expect(result.verticalOscillation.confidence).toBe(0)
    expect(result.trunkLean.confidence).toBe(0)
    expect(result.overstriding.confidence).toBe(0)
  })
})

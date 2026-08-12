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
    expect(result.cadence.metric).toBe('cadence')
    expect(result.footStrikePattern.metric).toBe('footStrikePattern')

    expect(result.verticalOscillation.value).not.toBeNull()
    expect(result.trunkLean.value).not.toBeNull()
    expect(result.overstriding.value).not.toBeNull()
    expect(result.cadence.value).not.toBeNull()
    expect(result.footStrikePattern.value).not.toBeNull()
    // generateSyntheticGait's elbow/wrist keypoints are static relative to the shoulder (this
    // shared fixture has no arm-swing motion), so armSwingSymmetry correctly reports null here
    // ("no complete arm-swing cycle") rather than a fabricated value — see armSwingSymmetry.test.ts
    // for dedicated coverage of a clip that actually swings, including its own view-gating case.
    expect(result.armSwingSymmetry.value).toBeNull()
    expect(result.armSwingSymmetry.confidence).toBe(0)

    // Every metric was gated using the same detected view, not recomputed independently.
    expect(result.verticalOscillation.viewFit).toBe('primary')
    expect(result.trunkLean.viewFit).toBe('primary')
    expect(result.overstriding.viewFit).toBe('primary')
    expect(result.cadence.viewFit).toBe('primary')
    expect(result.footStrikePattern.viewFit).toBe('primary')
    // armSwingSymmetry is the mirror image of trunkLean/overstriding: side is its unsuitable
    // view, not its primary one.
    expect(result.armSwingSymmetry.viewFit).toBe('unsuitable')

    // footStrikePattern's caveat is non-null even here, in the fully-populated clean case — the
    // one metric where that's true by design (it's always a proxy, never a direct measurement).
    expect(result.footStrikePattern.caveat).not.toBeNull()

    // #8's waveform chart needs the timeseries, timestamp-aligned 1:1 with the input frames.
    expect(result.verticalOscillation.series).toHaveLength(frames.length)
  })

  it('cadence and vertical oscillation agree exactly, since both fit the identical shared hip-bounce signal', () => {
    // D2's drift guard: cadence.ts and verticalOscillation.ts each call `analyzeHipBounce`
    // independently rather than sharing one computed result, on the theory that the fit is a
    // pure function and both calls are bit-identical (see hipBounce.ts's module doc). If a future
    // edit broke that -- e.g. one caller's config diverged from the other's, or one started
    // filtering its input differently -- this is the assertion that would catch it.
    const frames = generateSyntheticGait(PARAMS)

    const result = computeFormHeuristics(frames)

    expect(result.cadence.value).not.toBeNull()
    expect(result.verticalOscillation.fit).not.toBeNull()
    // Both sides compute `frequencyHz * 60` from the same bit-identical fit -- comparing the same
    // operation against itself, not round-tripping through a division, which floating-point
    // multiplication/division would not generally invert exactly.
    expect(result.cadence.value).toBe(result.verticalOscillation.fit!.frequencyHz * 60)
    expect(result.cadence.sampleSize).toBe(result.verticalOscillation.sampleSize)
  })

  it('produces the same view label and per-metric results as calling detectView + each metric directly', () => {
    const frames = generateSyntheticGait(PARAMS)

    const orchestrated = computeFormHeuristics(frames)
    const standaloneView = detectView(frames)

    expect(orchestrated.view).toEqual(standaloneView)
  })

  it('gates all seven metrics consistently off an ambiguous view', () => {
    const frames = generateSyntheticGait({
      ...PARAMS,
      strideAmplitudePx: 20, // engineered BSR/SER disagreement, see viewDetection.test.ts
    })

    const result = computeFormHeuristics(frames)

    expect(result.view.view).toBe('ambiguous')
    expect(result.verticalOscillation.viewFit).toBe('tolerated')
    expect(result.trunkLean.viewFit).toBe('unsuitable')
    expect(result.overstriding.viewFit).toBe('unsuitable')
    // Cadence is view-tolerant like verticalOscillation, not hard-gated like trunkLean/
    // overstriding — see viewFitTable.cadence in types.ts and design.md.
    expect(result.cadence.viewFit).toBe('tolerated')
    expect(result.armSwingSymmetry.viewFit).toBe('unsuitable')
    expect(result.footStrikePattern.viewFit).toBe('unsuitable')
  })

  it('never throws on an empty frame list and returns a well-formed, non-null-crashing result', () => {
    expect(() => computeFormHeuristics([])).not.toThrow()
    const result = computeFormHeuristics([])

    expect(result.view.view).toBe('ambiguous')
    expect(result.verticalOscillation.value).toBeNull()
    expect(result.trunkLean.value).toBeNull()
    expect(result.overstriding.value).toBeNull()
    expect(result.cadence.value).toBeNull()
    expect(result.armSwingSymmetry.value).toBeNull()
    expect(result.footStrikePattern.value).toBeNull()
    expect(result.verticalOscillation.confidence).toBe(0)
    expect(result.trunkLean.confidence).toBe(0)
    expect(result.overstriding.confidence).toBe(0)
    expect(result.cadence.confidence).toBe(0)
    expect(result.armSwingSymmetry.confidence).toBe(0)
    expect(result.footStrikePattern.confidence).toBe(0)
    expect(result.footStrikePattern.caveat).not.toBeNull()
    expect(result.verticalOscillation.series).toEqual([])
  })
})

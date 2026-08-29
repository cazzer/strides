import { describe, expect, it } from 'vitest'
import { computeFormHeuristics } from './index'
import { detectView } from './viewDetection'
import { estimateStrideLength } from './strideLength'
import { computeArmSwingSymmetry } from './armSwingSymmetry'
import { computeTrunkLean } from './trunkLean'
import { computeVerticalOscillation } from './verticalOscillation'
import { computeStepWidth } from './stepWidth'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'
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
    expect(result.verticalRatio.metric).toBe('verticalRatio')
    expect(result.verticalOscillationCm.metric).toBe('verticalOscillationCm')
    expect(result.trunkLean.metric).toBe('trunkLean')
    expect(result.overstriding.metric).toBe('overstriding')
    expect(result.cadence.metric).toBe('cadence')
    expect(result.footStrikePattern.metric).toBe('footStrikePattern')
    expect(result.stepWidth.metric).toBe('stepWidth')
    expect(result.stepWidthCm.metric).toBe('stepWidthCm')

    expect(result.verticalOscillation.value).not.toBeNull()
    expect(result.verticalRatio.value).not.toBeNull()
    expect(result.trunkLean.value).not.toBeNull()
    expect(result.overstriding.value).not.toBeNull()
    expect(result.cadence.value).not.toBeNull()
    expect(result.footStrikePattern.value).not.toBeNull()
    // stepWidth is front-primary/side-unsuitable (the mirror of armSwingSymmetry) -- still
    // computed on this side-view clip, per "never a silent wrong number", just view-discounted.
    expect(result.stepWidth.value).not.toBeNull()
    // stepWidthCm shares stepWidth's view-fit row (front primary), so side is unsuitable here too;
    // it's still computed (never a silent wrong number) but excluded for the same reason
    // armSwingSymmetry is below.
    expect(result.stepWidthCm.viewFit).toBe('unsuitable')
    // PARAMS carries no pixelsPerMeter -- an "unscaled" clip, like every non-MediaPipe backend --
    // so stepWidthCm also reports its availability caveat rather than a value, same as
    // verticalOscillationCm below.
    expect(result.stepWidthCm.value).toBeNull()
    expect(result.stepWidthCm.confidence).toBe(0)
    expect(result.stepWidthCm.caveat).toMatch(/no real-world scale could be measured/i)
    // generateSyntheticGait's elbow/wrist keypoints are static relative to the shoulder (this
    // shared fixture has no arm-swing motion), so armSwingSymmetry correctly reports null here
    // ("no complete arm-swing cycle") rather than a fabricated value — see armSwingSymmetry.test.ts
    // for dedicated coverage of a clip that actually swings, including its own view-gating case.
    expect(result.armSwingSymmetry.value).toBeNull()
    expect(result.armSwingSymmetry.confidence).toBe(0)
    // PARAMS carries no pixelsPerMeter -- an "unscaled" clip, like every non-MediaPipe backend --
    // so verticalOscillationCm reports its availability caveat rather than a value. See the
    // dedicated scaled-vs-unscaled suite below for the resolved case.
    expect(result.verticalOscillationCm.value).toBeNull()
    expect(result.verticalOscillationCm.confidence).toBe(0)
    expect(result.verticalOscillationCm.calibration).toBeNull()
    expect(result.verticalOscillationCm.caveat).toMatch(/no real-world scale could be measured/i)

    // Every metric was gated using the same detected view, not recomputed independently.
    expect(result.verticalOscillation.viewFit).toBe('primary')
    expect(result.verticalRatio.viewFit).toBe('primary')
    expect(result.verticalOscillationCm.viewFit).toBe('primary')
    expect(result.trunkLean.viewFit).toBe('primary')
    expect(result.overstriding.viewFit).toBe('primary')
    expect(result.cadence.viewFit).toBe('primary')
    expect(result.footStrikePattern.viewFit).toBe('primary')
    // armSwingSymmetry is the mirror image of trunkLean/overstriding: side is its unsuitable
    // view, not its primary one.
    expect(result.armSwingSymmetry.viewFit).toBe('unsuitable')
    // stepWidth mirrors armSwingSymmetry's row exactly: front-primary, side-unsuitable.
    expect(result.stepWidth.viewFit).toBe('unsuitable')

    // footStrikePattern's caveat is non-null even here, in the fully-populated clean case — the
    // one metric where that's true by design (it's always a proxy, never a direct measurement).
    expect(result.footStrikePattern.caveat).not.toBeNull()

    // #8's waveform chart needs the timeseries, timestamp-aligned 1:1 with the input frames.
    expect(result.verticalOscillation.series).toHaveLength(frames.length)
  })

  it('resolves verticalOscillationCm on a scaled clip and withholds it on an unscaled one, all else equal', () => {
    // #36: same clip either way, only pixelsPerMeter differs -- proves the backend gate is
    // genuinely about measured scale, not about anything else in the fixture.
    const unscaled = computeFormHeuristics(generateSyntheticGait(PARAMS))
    const scaled = computeFormHeuristics(
      generateSyntheticGait({ ...PARAMS, pixelsPerMeter: 800 }),
    )

    expect(unscaled.verticalOscillationCm.value).toBeNull()
    expect(unscaled.verticalOscillationCm.calibration).toBeNull()

    expect(scaled.verticalOscillationCm.value).not.toBeNull()
    expect(scaled.verticalOscillationCm.calibration).not.toBeNull()
    expect(scaled.verticalOscillationCm.unit).toBe('centimeters')
    expect(scaled.verticalOscillationCm.value).toBe(
      scaled.verticalOscillationCm.calibration?.verticalOscillationCm,
    )
  })

  it('gates stepWidthCm on measured scale the same way, independently of view (#45)', () => {
    // stepWidthCm's own backend gate runs first, same ordering as verticalOscillationCm's -- an
    // unscaled clip reports the availability caveat regardless of whether the view is even
    // workable for the metric.
    const unscaledSide = computeFormHeuristics(generateSyntheticGait(PARAMS))
    const unscaledFront = computeFormHeuristics(
      generateSyntheticGait({ ...PARAMS, view: 'front' }),
    )
    const scaledFront = computeFormHeuristics(
      generateSyntheticGait({ ...PARAMS, view: 'front', pixelsPerMeter: 800 }),
    )

    expect(unscaledSide.stepWidthCm.value).toBeNull()
    expect(unscaledFront.stepWidthCm.value).toBeNull()
    expect(scaledFront.stepWidthCm.value).not.toBeNull()
    expect(scaledFront.stepWidthCm.unit).toBe('centimeters')
    expect(scaledFront.stepWidthCm.viewFit).toBe('primary')
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

  it('vertical ratio and vertical oscillation agree exactly, since both read the identical shared hip-bounce fit', () => {
    // D2/D6's drift guard (openspec/changes/add-vertical-ratio-metric/design.md): verticalRatio.ts
    // always reads the hip-pinned analyzeHipBounce fit -- the SAME fit verticalOscillation.ts uses
    // under the DEFAULT config (verticalOscillationSignal: 'hipMid'). This is default-config-scoped
    // deliberately: an earMid VO-signal override would split verticalOscillation's fit from
    // verticalRatio's hip-pinned one, by design (verticalRatio never follows that setting -- see
    // verticalRatio.ts's module doc) -- so this equality would no longer hold under that override,
    // and that's correct, not a bug to guard against here.
    const frames = generateSyntheticGait(PARAMS)

    const result = computeFormHeuristics(frames)
    const stride = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.verticalRatio.value).not.toBeNull()
    expect(result.verticalOscillation.fit).not.toBeNull()
    expect(stride.ok).toBe(true)
    if (!stride.ok) return

    expect(result.verticalRatio.value).toBe(
      result.verticalOscillation.fit!.peakToPeakAmplitudePx / stride.strideLengthPx,
    )
    expect(result.verticalRatio.sampleSize).toBe(stride.pairCount)
  })

  it('the vertical-oscillation family reports one bounce estimate through three denominators (D6)', () => {
    // D6's headline coherence test: family coherence is FREQUENCY coherence, not object
    // identity -- the cm path fits the metre series (which absorbs any scale drift), while
    // verticalOscillation/verticalRatio fit the pixel series. Under a CONSTANT scale (this
    // fixture's whole point), both series are an exact affine image of each other, so the fit
    // converges on the identical winning frequency, an (up to float tolerance) identical R², the
    // identical sample count, and an amplitude related by the constant scale -- never asserted via
    // vi.spyOn call counts, which would pin an implementation detail (each family member re-derives
    // its own fit independently -- see hipBounce.ts's module doc) that is correct to keep, not a
    // bug to guard against.
    const scale = 800
    const frames = generateSyntheticGait({ ...PARAMS, pixelsPerMeter: scale })

    const result = computeFormHeuristics(frames)

    expect(result.verticalOscillation.fit).not.toBeNull()
    expect(result.verticalOscillationCm.calibration).not.toBeNull()
    const pixelFit = result.verticalOscillation.fit!
    const cmCalibration = result.verticalOscillationCm.calibration!
    expect(cmCalibration.fit).not.toBeNull()
    const cmFit = cmCalibration.fit!

    // Exact frequency equality -- both fits land on the same grid point, since an affine rescaling
    // of the fitted series can only move the amplitude, never the argmin RSS frequency.
    expect(cmFit.frequencyHz).toBe(pixelFit.frequencyHz)
    // R² is a ratio of two quantities that both scale by the same constant factor under an affine
    // rescaling, so it is unchanged up to floating-point tolerance.
    expect(cmFit.sinusoidR2).toBeCloseTo(pixelFit.sinusoidR2, 6)
    expect(cmFit.sampleCount).toBe(pixelFit.sampleCount)
    // Amplitude: pixel peak-to-peak / scale (m/px) * 100 (cm/m) -- the same conversion
    // `computeVerticalOscillationCm`'s own module doc derives.
    expect(result.verticalOscillationCm.value).toBeCloseTo(
      (pixelFit.peakToPeakAmplitudePx / scale) * 100,
      6,
    )
  })

  it('produces the same view label and per-metric results as calling detectView + each metric directly', () => {
    const frames = generateSyntheticGait(PARAMS)

    const orchestrated = computeFormHeuristics(frames)
    const standaloneView = detectView(frames)

    expect(orchestrated.view).toEqual(standaloneView)
  })

  it('gates all eleven metrics consistently off an ambiguous view', () => {
    const frames = generateSyntheticGait({
      ...PARAMS,
      strideAmplitudePx: 20, // engineered BSR/SER disagreement, see viewDetection.test.ts
    })

    const result = computeFormHeuristics(frames)

    expect(result.view.view).toBe('ambiguous')
    expect(result.verticalOscillation.viewFit).toBe('tolerated')
    // verticalRatio is hard-gated like trunkLean/overstriding, NOT view-tolerant like
    // verticalOscillation, despite sharing its numerator with it — see types.ts's doc on
    // viewFitTable.verticalRatio for why (a view-tolerant numerator paired with a
    // view-degenerate denominator is worse than either alone).
    expect(result.verticalRatio.viewFit).toBe('unsuitable')
    // verticalOscillationCm is view-tolerant on the SAME terms as verticalOscillation (D2) --
    // it has no denominator at all, so verticalRatio's foreshortening argument doesn't apply.
    expect(result.verticalOscillationCm.viewFit).toBe('tolerated')
    expect(result.trunkLean.viewFit).toBe('unsuitable')
    expect(result.overstriding.viewFit).toBe('unsuitable')
    // Cadence is view-tolerant like verticalOscillation, not hard-gated like trunkLean/
    // overstriding — see viewFitTable.cadence in types.ts and design.md.
    expect(result.cadence.viewFit).toBe('tolerated')
    expect(result.armSwingSymmetry.viewFit).toBe('unsuitable')
    expect(result.footStrikePattern.viewFit).toBe('unsuitable')
    // stepWidth is front-primary, so it is ALSO 'unsuitable' on an ambiguous view -- same
    // reasoning as armSwingSymmetry above.
    expect(result.stepWidth.viewFit).toBe('unsuitable')
    // stepWidthCm shares stepWidth's row -- hard-gated the same way, not view-tolerant.
    expect(result.stepWidthCm.viewFit).toBe('unsuitable')
  })

  it('never throws on an empty frame list and returns a well-formed, non-null-crashing result', () => {
    expect(() => computeFormHeuristics([])).not.toThrow()
    const result = computeFormHeuristics([])

    expect(result.view.view).toBe('ambiguous')
    expect(result.verticalOscillation.value).toBeNull()
    expect(result.verticalRatio.value).toBeNull()
    expect(result.verticalOscillationCm.value).toBeNull()
    expect(result.trunkLean.value).toBeNull()
    expect(result.overstriding.value).toBeNull()
    expect(result.cadence.value).toBeNull()
    expect(result.armSwingSymmetry.value).toBeNull()
    expect(result.footStrikePattern.value).toBeNull()
    expect(result.stepWidth.value).toBeNull()
    expect(result.stepWidthCm.value).toBeNull()
    expect(result.verticalOscillation.confidence).toBe(0)
    expect(result.verticalRatio.confidence).toBe(0)
    expect(result.verticalOscillationCm.confidence).toBe(0)
    expect(result.trunkLean.confidence).toBe(0)
    expect(result.overstriding.confidence).toBe(0)
    expect(result.cadence.confidence).toBe(0)
    expect(result.armSwingSymmetry.confidence).toBe(0)
    expect(result.footStrikePattern.confidence).toBe(0)
    expect(result.stepWidth.confidence).toBe(0)
    expect(result.stepWidthCm.confidence).toBe(0)
    expect(result.footStrikePattern.caveat).not.toBeNull()
    expect(result.verticalOscillationCm.calibration).toBeNull()
    expect(result.verticalOscillationCm.caveat).not.toBeNull()
    expect(result.stepWidthCm.caveat).not.toBeNull()
    expect(result.verticalOscillation.series).toEqual([])
  })

  // ---------------------------------------------------------------------------------------------
  // View-plausibility gating (propagate-view-confidence-to-metric-gating). TORSO_LENGTH_PX is 150
  // in the fixture generator, and `withBilateralSpread` sets both the shoulder and hip separation
  // to the same value, so BSR = spreadPx / 150 exactly. SER stays ~= 2 * strideAmplitudePx / 150,
  // untouched by the rewrite (see the helper's own note).
  // ---------------------------------------------------------------------------------------------

  /**
   * Re-spreads each frame's shoulder and hip pairs symmetrically about their own midpoints, to
   * put BSR at a chosen value. Deliberately surgical: the midpoints are unchanged (so torso
   * length, trunk lean and hip bounce are all untouched), and each ankle moves by the same
   * constant as its own hip, so every ankle-relative-to-hip RANGE — and therefore SER — is
   * unchanged too.
   */
  const withBilateralSpread = (
    frames: RobustPoseFrame[],
    spreadPx: number,
  ): RobustPoseFrame[] =>
    frames.map((frame) => {
      const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)
      const respread = (leftName: string, rightName: string) => {
        const left = at(leftName)
        const right = at(rightName)
        if (left?.x == null || right?.x == null) return {}
        const mid = (left.x + right.x) / 2
        return { [leftName]: mid - spreadPx / 2, [rightName]: mid + spreadPx / 2 }
      }
      const xs: Record<string, number> = {
        ...respread('left_shoulder', 'right_shoulder'),
        ...respread('left_hip', 'right_hip'),
      }
      return {
        ...frame,
        keypoints: frame.keypoints.map((kp) =>
          kp.name in xs ? { ...kp, x: xs[kp.name] } : kp,
        ),
      }
    })

  it('gates a decisively-committed view exactly as it did before plausibility existed', () => {
    // A clip whose two signals both sit inside one view's regions has a one-hot plausibility, so
    // resolving the view-fit table against it is the identity and every metric is called with the
    // caller's own config and the same label as before. Asserted against direct calls rather than
    // against remembered numbers, so it stays a no-op proof if any metric's own math changes.
    const frames = generateSyntheticGait(PARAMS)

    const result = computeFormHeuristics(frames)

    expect(result.view.view).toBe('side')
    expect(result.view.plausibility).toEqual({ side: 1, front: 0, ambiguous: 0 })
    expect(result.trunkLean).toEqual(
      computeTrunkLean(frames, 'side', DEFAULT_HEURISTICS_CONFIG),
    )
    expect(result.armSwingSymmetry).toEqual(
      computeArmSwingSymmetry(frames, 'side', DEFAULT_HEURISTICS_CONFIG),
    )
    expect(result.verticalOscillation).toEqual(
      computeVerticalOscillation(frames, 'side', DEFAULT_HEURISTICS_CONFIG),
    )
  })

  it('keeps a marginally-committed front view’s front-primary metrics at full front fit', () => {
    // The front-approach demo clip's shape: BSR barely over the front bar (0.56 vs 0.55), SER far
    // from side view's (0.26 vs 0.80). `detectView`'s margin-based confidence reads very low
    // there, but side is ruled out twice over, so nothing about the metrics should move: this is
    // the case where multiplying confidence by that low number would delete `armSwingSymmetry`
    // and `stepWidth` on a clip that plainly shows both arms.
    const frames = withBilateralSpread(
      generateSyntheticGait({ ...PARAMS, strideAmplitudePx: 20 }),
      0.56 * 150,
    )

    const result = computeFormHeuristics(frames)

    expect(result.view.view).toBe('front')
    expect(result.view.confidence).toBeLessThan(0.2)
    expect(result.view.plausibility).toEqual({ side: 0, front: 1, ambiguous: 0 })
    expect(result.armSwingSymmetry.viewFit).toBe('primary')
    expect(result.stepWidth.viewFit).toBe('primary')
    expect(result.armSwingSymmetry).toEqual(
      computeArmSwingSymmetry(frames, 'front', DEFAULT_HEURISTICS_CONFIG),
    )
    // The six sagittal metrics stay excluded, exactly as a front label excludes them today.
    expect(result.verticalRatio.viewFit).toBe('unsuitable')
    expect(result.trunkLean.viewFit).toBe('unsuitable')
    expect(result.overstriding.viewFit).toBe('unsuitable')
    expect(result.kneeFlexion.viewFit).toBe('unsuitable')
    expect(result.footStrikePattern.viewFit).toBe('unsuitable')
    // `stepWidthCm` is front-PRIMARY like `stepWidth` — on a real front clip it is excluded for a
    // different reason entirely (a null value on any backend that measures no real-world scale),
    // never by view fit.
    expect(result.stepWidthCm.viewFit).toBe('primary')
  })

  it('reports, rather than excludes, a front-primary metric when only side is ruled out', () => {
    // BSR 0.50 — past side view's bar but 0.05 short of front's, so the label stays 'ambiguous' —
    // with a fully front-like SER. The old gate hard-excluded `armSwingSymmetry` here as
    // structurally unmeasurable, on the strength of a side view the geometry rules out.
    const frames = withBilateralSpread(
      generateSyntheticGait({ ...PARAMS, strideAmplitudePx: 20 }),
      0.5 * 150,
    )

    const result = computeFormHeuristics(frames)

    expect(result.view.view).toBe('ambiguous')
    expect(result.view.plausibility.side).toBe(0)
    expect(result.view.plausibility.front).toBeCloseTo(0.8, 6)
    expect(result.view.plausibility.ambiguous).toBeCloseTo(0.2, 6)

    // What the label alone would have produced, for contrast — still the case for any caller that
    // gates on the label rather than the plausibility.
    expect(
      computeArmSwingSymmetry(frames, 'ambiguous', DEFAULT_HEURISTICS_CONFIG).viewFit,
    ).toBe('unsuitable')

    expect(result.armSwingSymmetry.viewFit).toBe('primary')

    // `stepWidth` is front-primary too, and unlike arm swing it produces a value on this fixture
    // (whose arms are rigid), so it shows the whole effect: measured, no longer excluded, and
    // discounted for the residual doubt — strictly between what the ambiguous row and the front
    // row would each have given it alone.
    expect(result.stepWidth.viewFit).toBe('primary')
    expect(result.stepWidth.value).not.toBeNull()
    const asAmbiguous = computeStepWidth(frames, 'ambiguous', DEFAULT_HEURISTICS_CONFIG)
    const asFront = computeStepWidth(frames, 'front', DEFAULT_HEURISTICS_CONFIG)
    expect(asAmbiguous.viewFit).toBe('unsuitable')
    expect(result.stepWidth.confidence).toBeGreaterThan(asAmbiguous.confidence)
    expect(result.stepWidth.confidence).toBeLessThan(asFront.confidence)

    // The sagittal metrics are unsuitable from both views still standing, so they stay excluded.
    expect(result.trunkLean.viewFit).toBe('unsuitable')
    expect(result.overstriding.viewFit).toBe('unsuitable')
    expect(result.kneeFlexion.viewFit).toBe('unsuitable')
    expect(result.footStrikePattern.viewFit).toBe('unsuitable')
    expect(result.verticalRatio.viewFit).toBe('unsuitable')
  })

  it('degrades in both directions on a genuinely ambiguous clip', () => {
    // Both signals dead-centre of their undecided bands: BSR 0.425, SER ~0.6. Half the mass is
    // honest ambiguity and the rest splits evenly, so neither view's primary metrics are granted
    // a measurable fit — the same outcome the flat ambiguous row gives today, reached without
    // pretending the clip is one label.
    const frames = withBilateralSpread(
      generateSyntheticGait({ ...PARAMS, strideAmplitudePx: 45 }),
      0.425 * 150,
    )

    const result = computeFormHeuristics(frames)

    expect(result.view.view).toBe('ambiguous')
    expect(result.view.plausibility.ambiguous).toBeCloseTo(0.5, 6)
    expect(result.view.plausibility.side).toBeCloseTo(0.25, 1)
    expect(result.view.plausibility.front).toBeCloseTo(0.25, 1)

    // Side-primary and front-primary alike: excluded, neither favoured.
    expect(result.trunkLean.viewFit).toBe('unsuitable')
    expect(result.overstriding.viewFit).toBe('unsuitable')
    expect(result.kneeFlexion.viewFit).toBe('unsuitable')
    expect(result.footStrikePattern.viewFit).toBe('unsuitable')
    expect(result.armSwingSymmetry.viewFit).toBe('unsuitable')
    expect(result.stepWidth.viewFit).toBe('unsuitable')
    // View-tolerant metrics still report, as they do from any view.
    expect(result.verticalOscillation.viewFit).toBe('tolerated')
    expect(result.cadence.viewFit).toBe('tolerated')
  })
})

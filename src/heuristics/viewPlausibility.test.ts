import { describe, expect, it } from 'vitest'
import {
  AMBIGUOUS_VIEW_PLAUSIBILITY,
  computeViewPlausibility,
  mostPlausibleView,
  resolveViewFitTable,
} from './viewPlausibility'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { ViewPlausibility } from './types'

const CONFIG = DEFAULT_HEURISTICS_CONFIG

// Thresholds this module ramps between, restated so the expected numbers below are readable:
//   BSR: side at/below 0.30, front at/above 0.55  -> undecided band 0.25 wide
//   SER: front at/below 0.40, side at/above 0.80  -> undecided band 0.40 wide

describe('computeViewPlausibility', () => {
  it('puts all the mass on side when both signals are inside side view’s regions', () => {
    // The synthetic side fixture's own numbers (viewDetection.test.ts): BSR 0.04, SER ~1.07.
    expect(computeViewPlausibility(0.04, 1.07, CONFIG)).toEqual({
      side: 1,
      front: 0,
      ambiguous: 0,
    })
  })

  it('puts all the mass on front when both signals are inside front view’s regions', () => {
    expect(computeViewPlausibility(0.867, 0.16, CONFIG)).toEqual({
      side: 0,
      front: 1,
      ambiguous: 0,
    })
  })

  it('rules side out entirely on the front-approach demo clip’s own measured signals', () => {
    // The clip that motivated this module (park-approach.mp4, measured live, 3 trials,
    // bit-identical): BSR 0.5507, SER 0.3389. `detectView` reports confidence 0.0771 there,
    // because BSR clears the front bar by only 0.13% and that scalar measures distance past a
    // threshold. It is NOT evidence that the clip might be a side view: side needs BSR <= 0.30
    // (measured 0.55) AND SER >= 0.80 (measured 0.34), and fails both by more than 2x. Every
    // metric gated on this must therefore see front, undiluted — degrading `armSwingSymmetry`
    // toward its `ambiguous` row here would delete a metric whose evidence images plainly show
    // both arms.
    const plausibility = computeViewPlausibility(0.5507, 0.3389, CONFIG)

    expect(plausibility).toEqual({ side: 0, front: 1, ambiguous: 0 })
  })

  it('is continuous across the front bar — the 0.13% that flips the label barely moves the gate', () => {
    // The defect this module exists to remove: at BSR 0.5499 the label is 'ambiguous' and every
    // front-primary metric is hard-excluded; at 0.5507 the label is 'front' and the same metrics
    // read full confidence. The plausibility moves by 0.3% across that same step.
    const justUnder = computeViewPlausibility(0.5499, 0.3389, CONFIG)
    const justOver = computeViewPlausibility(0.5507, 0.3389, CONFIG)

    expect(justUnder.side).toBe(0)
    expect(justUnder.front).toBeCloseTo(justOver.front, 2)
    expect(justOver.front - justUnder.front).toBeLessThan(0.01)
  })

  it('leaves the mass on ambiguous when the two signals point at different views', () => {
    // Side-like bilateral geometry, front-like sagittal excursion: neither view has both signals,
    // so the product that a committed view requires is zero for both.
    expect(computeViewPlausibility(0.04, 0.16, CONFIG)).toEqual({
      side: 0,
      front: 0,
      ambiguous: 1,
    })
  })

  it('splits mass between one view and ambiguous when one signal sits in the undecided band', () => {
    // BSR 0.50 is 0.05 short of the front bar, i.e. 80% of the way across the 0.25-wide band;
    // SER 0.30 is fully front. Side is still ruled out, so the doubt lands on 'ambiguous'.
    const plausibility = computeViewPlausibility(0.5, 0.3, CONFIG)

    expect(plausibility.side).toBe(0)
    expect(plausibility.front).toBeCloseTo(0.8, 10)
    expect(plausibility.ambiguous).toBeCloseTo(0.2, 10)
  })

  it('degrades in both directions when both signals sit mid-band', () => {
    // BSR 0.425 and SER 0.60 are each dead-centre of their undecided band. Neither view is
    // favoured and half the mass is honest ambiguity.
    const plausibility = computeViewPlausibility(0.425, 0.6, CONFIG)

    expect(plausibility.side).toBeCloseTo(0.25, 10)
    expect(plausibility.front).toBeCloseTo(0.25, 10)
    expect(plausibility.ambiguous).toBeCloseTo(0.5, 10)
  })

  it('treats a missing signal as supporting no view at all', () => {
    expect(computeViewPlausibility(null, 0.3, CONFIG)).toEqual(AMBIGUOUS_VIEW_PLAUSIBILITY)
    expect(computeViewPlausibility(0.5, null, CONFIG)).toEqual(AMBIGUOUS_VIEW_PLAUSIBILITY)
    expect(computeViewPlausibility(null, null, CONFIG)).toEqual(AMBIGUOUS_VIEW_PLAUSIBILITY)
  })

  it('always returns three non-negative components summing to 1', () => {
    for (let bsr = 0; bsr <= 1.2; bsr += 0.05) {
      for (let ser = 0; ser <= 2; ser += 0.05) {
        const p = computeViewPlausibility(bsr, ser, CONFIG)
        expect(p.side).toBeGreaterThanOrEqual(0)
        expect(p.front).toBeGreaterThanOrEqual(0)
        expect(p.ambiguous).toBeGreaterThanOrEqual(0)
        expect(p.side + p.front + p.ambiguous).toBeCloseTo(1, 10)
      }
    }
  })

  it('never lets one signal alone carry a view, at any strength of the other', () => {
    // The continuous form of "two independent signals must AGREE before committing": BSR says
    // front as loudly as it can, but SER says side, so front stays at zero.
    for (let ser = 0.8; ser <= 2; ser += 0.1) {
      expect(computeViewPlausibility(2, ser, CONFIG).front).toBe(0)
    }
  })

  it('collapses to a step, rather than dividing by zero, on a config whose thresholds cross', () => {
    const crossed = {
      ...CONFIG,
      sideViewMaxBilateralSpreadRatio: 0.6,
      frontViewMinBilateralSpreadRatio: 0.4,
    }

    expect(() => computeViewPlausibility(0.5, 0.3, crossed)).not.toThrow()
    const p = computeViewPlausibility(0.5, 0.3, crossed)
    expect(Number.isFinite(p.side + p.front + p.ambiguous)).toBe(true)
    expect(p.side + p.front + p.ambiguous).toBeCloseTo(1, 10)
  })
})

describe('mostPlausibleView', () => {
  it('names the view holding the most mass', () => {
    expect(mostPlausibleView({ side: 1, front: 0, ambiguous: 0 })).toBe('side')
    expect(mostPlausibleView({ side: 0, front: 1, ambiguous: 0 })).toBe('front')
    expect(mostPlausibleView(AMBIGUOUS_VIEW_PLAUSIBILITY)).toBe('ambiguous')
    expect(mostPlausibleView({ side: 0, front: 0.8, ambiguous: 0.2 })).toBe('front')
    expect(mostPlausibleView({ side: 0.25, front: 0.25, ambiguous: 0.5 })).toBe('ambiguous')
  })

  it('breaks a tie with ambiguous in ambiguous’s favour — a tie is not agreement', () => {
    expect(mostPlausibleView({ side: 0.5, front: 0, ambiguous: 0.5 })).toBe('ambiguous')
    expect(mostPlausibleView({ side: 0, front: 0.5, ambiguous: 0.5 })).toBe('ambiguous')
  })
})

describe('resolveViewFitTable', () => {
  const table = CONFIG.viewFitTable

  it('returns the input table by reference when one view holds all the mass', () => {
    // The no-op proof for every clip that commits to a label: blending against a one-hot
    // plausibility is the identity, so those clips reach every metric with the caller's own
    // config object.
    expect(resolveViewFitTable(table, { side: 1, front: 0, ambiguous: 0 })).toBe(table)
    expect(resolveViewFitTable(table, { side: 0, front: 1, ambiguous: 0 })).toBe(table)
    expect(resolveViewFitTable(table, AMBIGUOUS_VIEW_PLAUSIBILITY)).toBe(table)
  })

  it('keeps a front-primary metric measurable when only side is ruled out', () => {
    // BSR mid-band but past side's bar, SER fully front (the shape of a clip 0.13% short of the
    // front label). Today this is 'ambiguous' and `armSwingSymmetry` is hard-excluded as
    // structurally unmeasurable, on the strength of a side view the geometry rules out.
    const plausibility: ViewPlausibility = { side: 0, front: 0.8, ambiguous: 0.2 }

    const resolved = resolveViewFitTable(table, plausibility)

    expect(resolved.armSwingSymmetry.ambiguous.fit).toBe('primary')
    // 0.8 * 1.0 (front) + 0.2 * 0.2 (ambiguous) — reported, and discounted for the doubt.
    expect(resolved.armSwingSymmetry.ambiguous.multiplier).toBeCloseTo(0.84, 10)
  })

  it('keeps a sagittal metric excluded when it is unsuitable from every view still standing', () => {
    const plausibility: ViewPlausibility = { side: 0, front: 0.8, ambiguous: 0.2 }

    const resolved = resolveViewFitTable(table, plausibility)

    for (const metric of [
      'verticalRatio',
      'trunkLean',
      'overstriding',
      'kneeFlexion',
      'footStrikePattern',
    ] as const) {
      expect(resolved[metric].front.fit).toBe('unsuitable')
    }
    // 0.8 * 0.1 + 0.2 * 0.2 — a blend of two unsuitable rows is still unsuitable.
    expect(resolved.trunkLean.front.multiplier).toBeCloseTo(0.12, 10)
  })

  it('degrades both directions symmetrically on a genuinely ambiguous clip', () => {
    const plausibility: ViewPlausibility = { side: 0.25, front: 0.25, ambiguous: 0.5 }

    const resolved = resolveViewFitTable(table, plausibility)

    // Side-primary and front-primary metrics land on the same multiplier: neither view is
    // favoured, and both stay excluded exactly as a flat ambiguous label leaves them today.
    expect(resolved.trunkLean.ambiguous.fit).toBe('unsuitable')
    expect(resolved.armSwingSymmetry.ambiguous.fit).toBe('unsuitable')
    expect(resolved.trunkLean.ambiguous.multiplier).toBeCloseTo(0.375, 10)
    expect(resolved.armSwingSymmetry.ambiguous.multiplier).toBeCloseTo(0.375, 10)
    // A view-tolerant metric keeps more than the flat 0.6 ambiguous row, because half the mass
    // does sit on views it is measurable from.
    expect(resolved.verticalOscillation.ambiguous.multiplier).toBeCloseTo(0.7625, 10)
  })

  it('answers identically whichever view key a metric looks up', () => {
    const resolved = resolveViewFitTable(table, { side: 0, front: 0.8, ambiguous: 0.2 })

    for (const metric of Object.keys(table) as (keyof typeof table)[]) {
      expect(resolved[metric].side).toEqual(resolved[metric].front)
      expect(resolved[metric].side).toEqual(resolved[metric].ambiguous)
    }
  })

  it('never invents a fit that is not on one of the metric’s own rows', () => {
    const resolved = resolveViewFitTable(table, { side: 0.25, front: 0.25, ambiguous: 0.5 })

    for (const metric of Object.keys(table) as (keyof typeof table)[]) {
      const rows = table[metric]
      const allowed = [rows.side.fit, rows.front.fit, rows.ambiguous.fit]
      expect(allowed).toContain(resolved[metric].side.fit)
      const multipliers = [rows.side.multiplier, rows.front.multiplier, rows.ambiguous.multiplier]
      expect(resolved[metric].side.multiplier).toBeGreaterThanOrEqual(Math.min(...multipliers))
      expect(resolved[metric].side.multiplier).toBeLessThanOrEqual(Math.max(...multipliers))
    }
  })

  it('leaves the caller’s table untouched', () => {
    const before = JSON.stringify(table)

    resolveViewFitTable(table, { side: 0.25, front: 0.25, ambiguous: 0.5 })

    expect(JSON.stringify(table)).toBe(before)
  })
})

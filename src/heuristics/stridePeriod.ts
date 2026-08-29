/**
 * The clip's own stride rhythm, derived from the fitted hip-bounce frequency.
 *
 * This module exists so that `footstrikes.ts` and `strideLength.ts` can share one derivation
 * instead of each declaring its own copy. It deliberately has no imports: `strideLength.ts`
 * imports `footstrikes.ts`, so a constant living in `strideLength.ts` and read by `footstrikes.ts`
 * would be an import cycle, and a second declaration of the same number would be worse — the two
 * sites would be free to drift apart while describing the identical physical quantity.
 *
 * The identity everything here rests on: **a stride is exactly two steps**, and the fitted
 * hip-bounce frequency IS the step frequency (`cadence.ts`'s module doc establishes this — the
 * hip-mid y-trace bounces once per step, twice per gait cycle, which is why cadence reports
 * `frequencyHz × 60` with no harmonic correction). So the expected stride period is
 * `2 / stepFrequencyHz`, with no fitted, tuned or per-clip coefficient in it.
 */

/**
 * Half-width of the accept band for a same-side interval's elapsed TIME, as a fraction of the
 * expected stride period, applied **log-symmetrically**: an interval is consistent when
 * `interval / expectedPeriod` lies in `[1 / (1 + tol), 1 + tol]`. Log-symmetric rather than
 * additive because the errors it exists to reject are multiplicative — roughly ½× when a spurious
 * extra strike shortens the interval, roughly 2× when a real strike is missed — and an additive
 * band would sit at different multiplicative distances from those two.
 *
 * ## Derivation (openspec `gate-stride-pairs-on-fitted-period`, design D4)
 *
 * A GENUINE same-side pair's measured interval differs from `2 / fit.frequencyHz` for four
 * independent reasons. Each as a standard deviation, in fractions of the stride period:
 *
 * | source | σ | why |
 * |---|---|---|
 * | stride-to-stride biological variability | 2.5% | stride-time CV in healthy running is reported in the low single digits (~1–3%, tighter in trained runners); 2.5% is the pessimistic end |
 * | footstrike-instant quantization | 2.7% | each strike snaps to a sampled frame, so the interval carries σ = Δt/√6 ≈ 0.41·Δt; at this repo's pessimistic live sampling (Δt ≈ 0.08 s) against a 1.2 s stride |
 * | fit frequency-grid resolution | 0.5% | `spectralFitFrequencyStepHz` 0.02 Hz, uniform within ±½ step → σ = 0.02/√12, worst case at the band's 1.2 Hz floor |
 * | fit frequency estimation error beyond the grid | 2.0% | measured: Demo 1's fitted 1.52 Hz against a frame-counted 1.546 Hz is 1.7% |
 *
 * RSS → σ_total = 4.22%, and **3σ = 12.7%**, rounded up to a round 15%. A 3σ envelope (rather than
 * 2σ) because the two errors cost differently: wrongly rejecting a genuine stride costs one sample
 * and, at worst, an honest null; wrongly accepting a half-stride puts a 2×-wrong number on screen
 * at high confidence.
 *
 * **Insensitive to the one soft input.** Recomputing across the whole reported CV range gives 3σ =
 * 10.7% (CV 1.0%) … 13.4% (CV 3.0%) — the entire range rounds to the same 15%.
 *
 * **Sanity bounds.** The accept band is `[0.870, 1.150]`. Its edges sit 0.554 nats from BOTH wrong
 * multiplicities (0.5× and 2×) against a band half-width of 0.140 nats, so the band is ~4× narrower
 * than its distance to the nearest thing it must exclude — and any tolerance at all must stay under
 * √2 − 1 = 41.4%, or it would reach them. On the low side, a 5% deviation (larger than any single
 * term above) is at ratio 0.95, comfortably inside.
 *
 * **Not fitted to a clip.** Demo 1's offending pairs sit at 0.790× and 0.426×; rejecting the larger
 * needs only `tol < 26.5%`, which every value the derivation could have produced (10.7–15%)
 * satisfies. The outcome on that clip is determined by the physics, not by this number's exact
 * value. No existing tuned threshold was moved to make this work.
 *
 * **Two consumers, one number, deliberately.** `strideLength.ts` uses it to decide whether a
 * candidate PAIR lasted one stride. `footstrikes.ts` uses `shortestPlausibleStrideSeconds` (below)
 * to decide how close two same-side CANDIDATES may be. Those are the same statistic — the
 * fractional deviation of a real same-side interval from `2 / f` — read once as a band and once as
 * its lower edge, which is why they share this constant rather than each deriving one.
 */
export const STRIDE_PERIOD_TOLERANCE = 0.15

/** `2 / stepFrequencyHz` — a stride is exactly two steps — or `null` when no usable reference was
 * supplied, which makes every consumer of it inert. */
export function resolveExpectedStridePeriodSeconds(
  stepFrequencyHz: number | undefined,
): number | null {
  if (stepFrequencyHz === undefined) return null
  if (!Number.isFinite(stepFrequencyHz) || stepFrequencyHz <= 0) return null
  return 2 / stepFrequencyHz
}

/**
 * The shortest interval that two consecutive same-side footstrikes could plausibly span — the
 * LOWER EDGE of `isPeriodConsistent`'s band, `expected / (1 + tol)`, and nothing else.
 *
 * Stating it as that edge rather than as an independent number buys a structural invariant:
 * anything closer together than this would have been rejected as period-inconsistent downstream
 * anyway, so a selection rule that refuses to emit two same-side candidates closer than this can
 * never remove a pair `strideLength.ts` would have accepted. The two rules cannot disagree.
 */
export function shortestPlausibleStrideSeconds(expectedStridePeriodSeconds: number): number {
  return expectedStridePeriodSeconds / (1 + STRIDE_PERIOD_TOLERANCE)
}

/** Stated as the band rather than as a `Math.log` so the bounds are readable:
 * `[expected / (1 + tol), expected * (1 + tol)]` is exactly the log-symmetric band. */
export function isPeriodConsistent(
  intervalSeconds: number,
  expectedStridePeriodSeconds: number,
): boolean {
  const ratio = intervalSeconds / expectedStridePeriodSeconds
  return ratio >= 1 / (1 + STRIDE_PERIOD_TOLERANCE) && ratio <= 1 + STRIDE_PERIOD_TOLERANCE
}

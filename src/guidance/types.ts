import type { MetricId, MetricResult } from '../heuristics/types'

/**
 * The unit a reference band's numbers are stated in.
 *
 * Structurally `MetricResult['unit']`, and deliberately not a narrower union of its own: a band
 * whose unit disagreed with the unit the metric it describes actually reports in is the single
 * most likely defect in this module, so the two are the same type and `metricGuidance.test.ts`
 * pins them equal per metric against the literals in `src/heuristics/`.
 */
export type BandUnit = MetricResult['unit']

/**
 * A source a band or a claim rests on, in the shape the view has to render it.
 *
 * All four fields are required because the spec requires all four on screen, in the same view as
 * the band, without hovering or expanding. That is not a presentation preference: a band with its
 * provenance stripped off is indistinguishable from a number this app invented, and declining to
 * invent numbers is the whole reason this data layer exists (design.md D1).
 */
export interface BandSource {
  /** Author, year and where it was published — enough to find it without following the link. */
  title: string
  /**
   * The citation as a reader says it aloud — "Malisoux et al. 2023", "Garmin fenix 7 manual" — at
   * most about 30 characters, for places the full `title` would not fit (a scale's attribution
   * line, a link label). Never a replacement for `title` where the spec requires the full one.
   */
  shortTitle: string
  /** Verified https URL. Every URL in this module is pinned as a literal in the test file. */
  url: string
  /** Who was measured, and under what conditions. Renders verbatim. */
  population: string
  /**
   * How many were measured. A string rather than a number, deliberately: two of the five shipped
   * bands rest on a manufacturer's zone table over a population whose size is not published, and
   * design.md D9.3 requires that absence to be VISIBLE on screen rather than hidden behind a
   * `null` the renderer would have to invent wording for. "Not published" is a fact about the
   * source and belongs in the same slot as "860".
   */
  sampleSize: string
}

/**
 * One published zone of a band.
 *
 * `null` means the zone is open-ended on that side (Garmin's tables have an open zone at each
 * end). Zones are ordered ascending by value, and so are the percentiles their labels name: Garmin
 * ranks vertical ratio the other way round (a lower value is a higher Garmin percentile), so that
 * band's labels are restated in value order rather than quoted — see its entry and design.md D3.
 *
 * ## Which bounds are inclusive
 *
 * - **A CLOSED zone — both bounds finite — is inclusive on both bounds**, as published: `153–163`
 *   contains 153 and 163.
 * - **An OPEN-ENDED zone's single finite bound is EXCLUSIVE.** Garmin publishes those zones as
 *   `<153` and `>183`, and `<3.05%` and `>5.05%`, which are strict inequalities. They are stored
 *   as `{ min: null, max: 153 }` and `{ min: 183, max: null }`, and the stored number means what
 *   the publisher's `<`/`>` means: a cadence of exactly 153 belongs to `153–163`, never to `<153`.
 *
 * So a value on a shared bound belongs to exactly one zone — the closed one.
 *
 * **Adjacent zones may touch OR leave a gap, and both occur in the shipped data.** The gaps are
 * the publisher's — Garmin prints its tables to a fixed number of decimal places with
 * non-contiguous bounds (`6.1–7.4` then `7.5–8.6`; `153–163` then `164–173`) — and they are
 * transcribed as published and **not closed**. Inventing a boundary to make a table tile cleanly
 * would be inventing exactly the kind of number design.md D1 forbids, for a purely cosmetic gain.
 * See design.md D3.
 *
 * **A value inside a published gap belongs to NO zone**, and is described as lying between the
 * two zones either side of it — never rounded into one of them. The gaps are real positions, not
 * rounding artefacts: cadence is a fitted non-integer, so 163.5 steps/min happens.
 */
export interface BandZone {
  /**
   * What this zone is: the publisher's own name for it where that name already runs in value order
   * (`cadence`'s Garmin percentiles), a value-order restatement where it does not
   * (`verticalRatio`), or the range's own description where the source gives a single range rather
   * than a zone table (`trunkLean`'s and `kneeFlexion`'s observed ranges,
   * `verticalOscillationCm`'s pairing of two published percentiles). Never a grade, never a colour,
   * and never a claim that a derived range was published as such.
   */
  label: string
  /**
   * Lower bound in the metric's own value domain; `null` = open-ended below. Inclusive when `max`
   * is also finite, exclusive when `max` is `null` (see the zone-inclusivity rule above).
   */
  min: number | null
  /**
   * Upper bound in the metric's own value domain; `null` = open-ended above. Inclusive when `min`
   * is also finite, exclusive when `min` is `null` (see the zone-inclusivity rule above).
   */
  max: number | null
}

/**
 * How a band was reached, when it is arithmetic on published numbers rather than a range some
 * source published as such. Two bands ship with this non-null: `verticalRatio`, whose every bound
 * is a published bound halved, and `verticalOscillationCm`, whose two bounds are both published but
 * come from two different published rows. The spec requires a derived band to say on screen that
 * it is derived.
 */
export interface BandDerivation {
  /** The arithmetic, stated plainly enough for a reader to check it. */
  statement: string
  /**
   * What the derivation rests on — one entry per leg.
   *
   * For a unit conversion these are the **stated definitional identities** on each side:
   * pre-registered rule R1(ii) admits a conversion only where it rests on a stated definition,
   * never on a fitted constant. This field is where that is discharged, and it is why
   * `verticalRatio`'s halving ships while the arithmetically-similar `verticalOscillation`
   * derivation (design.md D5.2) does not: that one passes through a textbook anthropometric
   * constant and an unstated per-step/per-stride convention. For a band assembled from published
   * rows (`verticalOscillationCm`), they are the rows themselves, quoted.
   */
  restsOn: string[]
}

/**
 * A published range some population of runners was measured to fall in, with everything the view
 * needs to attribute it.
 *
 * ## THE NUMERIC CONVENTION — read this before adding or reading a bound
 *
 * **Every number in a band — every `BandZone` bound and `centralTendency.value` — is in the same
 * numeric domain as `MetricResult.value` for that metric.** Not the domain the panel *displays*;
 * the domain the pipeline *computes*. A consumer compares `metric.value` against these numbers
 * directly, with no conversion.
 *
 * The two domains differ for exactly one unit, and that is where the defect would be:
 *
 * - `'percent'` is a dimensionless 0..1 comparison, which `MetricsPanel`'s `formatValue` renders
 *   as `value * 100`. So Garmin's published vertical-ratio boundary of **3.05 %** is stored here
 *   as **`0.0305`**, not as `3.05`.
 * - `'stepsPerMinute'`, `'degrees'` and `'centimeters'` are stored exactly as published, because
 *   the pipeline computes them in those units too.
 *
 * Storing display numbers instead would push the ×100 onto every consumer, and the first one to
 * forget it would render a band a hundred times too wide with nothing failing. The test file pins
 * this convention twice: once by asserting every bound lies inside its metric's physically
 * possible value domain (a stored `3.05` would be outside `'percent'`'s 0..1), and once by
 * asserting the published display figures come back out when the bounds are formatted.
 *
 * ## What a band is NOT
 *
 * It is not a target, a goal, a recommendation or a healthy range, and no part of this type
 * carries a preferred end. For `trunkLean` four measured outcomes point in different directions
 * at once; for `cadence` the strongest available review reports insufficient evidence that
 * changing it affects injury or performance at all. See `MetricGuidance.evidenceDirection`.
 */
export interface ReferenceBand {
  /** MUST equal the `unit` the metric's own `MetricResult` carries. Pinned per metric by test. */
  unit: BandUnit
  /**
   * The published zones, ascending by value, at least one. A five-zone percentile table ships as
   * five zones and not as its outer envelope: the spec requires every published zone boundary to
   * render, because a table collapsed to its extremes discards the information the reader came
   * for.
   */
  zones: BandZone[]
  /**
   * A published central statistic — a mean — where the source states one. `null` where it does
   * not.
   *
   * **This is a description of where a population was measured, NOT a target.** A renderer must
   * not mark it as a goal, shade toward it, or describe a value's distance from it as a deficit.
   * It is here because the sources publish it and design.md D2 quotes it, and withholding a
   * published statistic would be its own kind of editorialising.
   */
  centralTendency: { value: number; label: string } | null
  /** The source the bounds themselves come from. */
  source: BandSource
  /**
   * Independent sources that land where the band says, shown BESIDE the band rather than merged
   * into it (design.md D9.3). Possibly empty — `trunkLean`'s only corroborating paper could not
   * be retrieved and is therefore neither linked nor quoted as a range.
   */
  corroboration: BandSource[]
  /** Non-null exactly when the band is arithmetic on published numbers — its bounds, or their pairing. */
  derivation: BandDerivation | null
  /**
   * A caveat about how this band itself was assembled — a zero reference that differs from this
   * app's, a confound an absolute-unit band cannot escape, an inference the paper does not make,
   * a methodology the publisher never published. Renders with the band.
   *
   * Distinct from `MetricGuidance.mandatoryNotes`, which are statements about the METRIC that
   * must render whether or not a band does.
   */
  note: string | null
}

/** Where a band's finite bounds start and end. See `referenceBandEnvelope`. */
export interface BandEnvelope {
  min: number
  max: number
}

/**
 * The extent a scale for this band has to cover: the lowest and the highest finite bound the band
 * publishes, in the metric's own value domain.
 *
 * **Every finite bound counts, from either field.** A finite `max` can be the lowest number a band
 * publishes (Garmin's `<153` is `{ min: null, max: 153 }`), and a finite `min` can be the highest
 * (`>183`), so taking the lower edge only from `min`s and the upper edge only from `max`es would
 * be wrong in general — `[{ null, 10 }, { 12, null }]` has no finite `min` below 12 at all, yet
 * publishes 10.
 *
 * Derived rather than stored, so it cannot drift out of step with the zones it summarises, and
 * provided here rather than left to each renderer so that two views cannot disagree about where a
 * scale ends. **It adds nothing to the band's numbers** — both edges are the band's own bounds, and
 * every bound lies within them. A measured value outside it is genuinely outside the reference
 * range and the spec requires the view to say so in words rather than clamp it
 * silently; this repo's own regression anchor for `verticalOscillationCm` is such a value, for a
 * reason design.md D6 records and declines to accommodate.
 *
 * `null` where there is no extent to draw: the band publishes no finite bound at all, or its
 * finite bounds are all one number, which would be a zero-width scale. No shipped band is either,
 * and the test pins that.
 */
export function referenceBandEnvelope(
  band: ReferenceBand,
): BandEnvelope | null {
  const bounds = band.zones
    .flatMap((zone) => [zone.min, zone.max])
    .filter((value) => value !== null)
  if (bounds.length === 0) return null
  const min = Math.min(...bounds)
  const max = Math.max(...bounds)
  return max > min ? { min, max } : null
}

/**
 * What the literature says about the DIRECTION of better for a metric — which is a different
 * question from whether a range exists, and is answered separately for every metric, banded or
 * not.
 *
 * Every member of this union is a way of saying "not a target". There is deliberately no member
 * meaning "higher is better" or "lower is better", and adding one would contradict the spec
 * requirement that a band carry no preferred end.
 *
 * - `'none-established'` — the research pass found no claim about direction at all. An absence of
 *   evidence, recorded as one; it is not a finding that none exists.
 * - `'contested'` — measured outcomes point in different directions at once, so any preferred end
 *   would be picking a side in a live disagreement. `trunkLean` (knee load falls with forward
 *   lean while hip and lumbar load rise about three times as fast, impact loading rises, and
 *   performance points the other way again) and `stepWidth`/`stepWidthCm` are the two.
 * - `'association-without-target'` — a within-runner change under an intervention, or an
 *   association with an outcome, is published, but no source names a value to aim at.
 * - `'redistribution-not-improvement'` — the alternatives move load between tissues rather than
 *   reducing it. `footStrikePattern` only: rearfoot raises patellofemoral load and vertical
 *   loading rate, forefoot raises Achilles and soleus load.
 */
export type EvidenceDirection =
  | 'none-established'
  | 'contested'
  | 'association-without-target'
  | 'redistribution-not-improvement'

/**
 * How much of a source's weight a link carries, so the view can say what kind of thing it is
 * sending the reader to. Not a quality score and not ordered — a reader deciding how much to
 * believe a claim needs to know a handout is a handout.
 */
export type GuidanceLinkKind =
  /** Published in a peer-reviewed journal, linked at a publisher or PubMed Central copy. */
  | 'peer-reviewed'
  /** Peer-reviewed work linked at an author's or institution's own copy, the publisher's being
   *  paywalled or having refused the research pass. */
  | 'peer-reviewed-author-copy'
  /** A device manufacturer's own documentation. A sourced external fact attributable to a named
   *  publisher — and, for Garmin specifically, over a population whose methodology, size and
   *  protocol are not published (design.md D9.3). */
  | 'manufacturer'
  /** A clinical trade publication — editorially reviewed, not peer-reviewed. */
  | 'trade-publication'
  /** A practitioner handout adapted from a consensus statement. The weakest kind of source that
   *  ships here, and the one place it is used says so. */
  | 'handout'
  /** A chapter in a book, not a journal article — so it is not labelled peer-reviewed, which
   *  would claim a review process nobody here verified. The one shipped (Hanley 2021) is linked
   *  at an institutional repository's copy of the accepted manuscript, which its link summary
   *  says rather than its title. */
  | 'book-chapter'

/**
 * An outbound reference.
 *
 * Every URL in this module was loaded during the research pass and returned HTTP 200, and the
 * whole set is pinned as a literal in `metricGuidance.test.ts` so an unverified URL cannot be
 * added silently. Sources that could not be retrieved are named in design.md where they would
 * otherwise have been cited, and are **not** linked — nor is their absence filled by a secondary
 * source restating them.
 */
export interface GuidanceLink {
  /** Author, year, title and venue. */
  title: string
  /** The citation as a reader says it aloud, at most about 30 characters. See `BandSource.shortTitle`. */
  shortTitle: string
  /** Verified https URL. */
  url: string
  kind: GuidanceLinkKind
  /** One sentence on what this source actually says, so the link is readable without following it. */
  summary: string
}

/**
 * What the sources say about how a metric moves with running speed — which this app cannot
 * measure at all.
 *
 * The two halves are kept apart because they are different claims and only one of them is usually
 * measured: `withinRunner` is an effect on one runner as their own pace changes, `betweenRunners`
 * is a correlation across runners each at their own self-selected pace. `cadence` is the worked
 * example — it climbs within a runner as they speed up, and is nonetheless uncorrelated with
 * speed between runners at preferred pace (step *length* is what varies).
 */
export interface SpeedSensitivity {
  /** One sentence, suitable as the caveat rendered beside a band. */
  summary: string
  /** The effect on one runner as their own pace changes; `null` where no source addressed it. */
  withinRunner: string | null
  /** The correlation across runners at self-selected pace; `null` where no source addressed it. */
  betweenRunners: string | null
}

/**
 * Everything this app is prepared to say about one metric beyond the number it measured.
 *
 * One entry exists per `MetricId` — the `Record` in `metricGuidance.ts` makes that a compile
 * error to get wrong, and a test iterates the union at runtime so a thirteenth metric fails
 * loudly rather than silently rendering without guidance.
 */
export interface MetricGuidance {
  /** Redundant with the record's key, and pinned equal to it by test, so that an entry read out
   *  of a sorted array still knows what it describes. */
  metric: MetricId
  /**
   * Fixed presentation order, 1..12, unique and dense.
   *
   * Ranks 1–5 are the banded metrics in design.md D2's order, which ranks by **strength of the
   * evidence behind the band** — not by how interesting the metric is and never by its value on
   * this clip. Ranking by the runner's own numbers would make the page's structure a judgement
   * about the runner, which is the thing this capability does not do.
   *
   * Ranks 6–12 are the unbanded metrics in design.md D5's own section order. Within that group
   * rank is a stable presentation order only, and asserts nothing about evidence.
   */
  displayRank: number
  /** `null` for the seven metrics with no citable range in the unit this app reports them in. */
  band: ReferenceBand | null
  /** Non-null exactly when `band` is `null`: why there is no band, in the reader's terms. */
  noBandReason: string | null
  evidenceDirection: EvidenceDirection
  /**
   * Statements that MUST render whenever this metric renders, band or no band.
   *
   * These are not decoration and not a caveat channel for low confidence — each one exists
   * because omitting it would let a reader draw a conclusion the evidence does not support.
   * design.md D5 makes four of them mandatory by name (`overstriding`, `stepWidth`,
   * `stepWidthCm`, `footStrikePattern`); `cadence` carries the one design.md D2 states in bold,
   * that 180 spm is not a target and must not appear as one.
   *
   * Empty array — never `null` — where there are none.
   */
  mandatoryNotes: string[]
  /**
   * `null` where the research pass established no speed dependence for this metric.
   *
   * **A `null` here is an absence of evidence and must not be rendered as evidence of absence.**
   * The spec requires a metric with no established speed dependence NOT to render the speed
   * caveat, precisely so the caveat keeps meaning something where it does render — not because
   * the metric is known to be speed-invariant.
   */
  speedSensitivity: SpeedSensitivity | null
  /** What the band and the claims above rest on. Possibly empty, for a metric where nothing at all
   *  surfaced. */
  research: GuidanceLink[]
  /**
   * What the literature says about changing this metric. Possibly empty, and empty is a finding
   * in two places rather than an oversight: `footStrikePattern` has nothing to remediate toward
   * because the best available systematic review rates the injury link as low evidence, and
   * `kneeFlexion` has no intervention literature in the research pass at all.
   *
   * **A metric's remediation may legitimately point at another metric's intervention.** `cadence`
   * carries `overstriding`'s links for the reason design.md D8 gives, and the comment on that
   * entry says so, because it reads exactly like a copy-paste error and is not one.
   */
  remediation: GuidanceLink[]
  /**
   * What to film differently to measure this metric, for the collapsed not-measured group — one
   * hint per CAUSE, because the fix for a camera angle that cannot see the measurement is a
   * different instruction from the fix for a clip that was too short.
   *
   * **About capture only** — camera angle, clip length, keeping the whole body in frame. Never a
   * suggestion that the runner change how they run: a metric this clip could not measure is a fact
   * about the clip, and turning it into advice about the runner would be asserting something the
   * app did not measure.
   */
  captureHints: {
    /** Shown when the metric was excluded because the camera angle can't support it (viewFit === 'unsuitable'). */
    wrongAngle: string
    /** Shown for every other not-measured cause: too few strides/cycles, detection gaps, no real-world scale. */
    notEnoughData: string
  }
  /** One plain sentence the guided view renders above this metric's remediation links. null for most. */
  remediationIntro: string | null
  /** Guided-view-only replacement for the shared METRIC_DESCRIPTIONS entry (src/results/metricDescriptions.ts),
   * used where the shared copy reads badly in a page about published ranges. null = use the shared one.
   * The shared descriptions are the classic view's copy and are NOT edited. */
  guidedDescription: string | null
}

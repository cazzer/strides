import type { ReactNode } from 'react'
import type { ScalePassStatus } from './types'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import { DEFAULT_HEURISTICS_CONFIG } from '../heuristics/types'
import { classifyFootStrike } from '../heuristics/footStrikePattern'
import type { FootStrikeClass } from '../heuristics/footStrikePattern'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import { VerticalOscillationChart } from './VerticalOscillationChart'
import { EvidenceCanvas } from './EvidenceCanvas'
import { altFor, captionFor, provenanceFor } from './evidenceCaptions'
import {
  HIGH_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_THRESHOLD,
  METRIC_LABELS,
  metricTier,
} from './metricConfidence'

/** Stable empty list, so a panel rendered without any evidence at all never hands its cards a
 * fresh identity on every render. */
const NO_EVIDENCE: readonly MetricCardEvidence[] = []

/**
 * One metric's extracted imagery, as a card needs it. Structurally the `EvidenceSection`
 * `useSessionEvidence` produces, restated here so the panel depends on the shape rather than on
 * the module that currently happens to own extraction.
 */
export interface MetricCardEvidence {
  metric: MetricId
  /** Index into the session's clips — the clip `fusionSourceIndices` says won this metric. */
  clipIndex: number
  items: readonly ExtractedEvidenceFrame[]
}

export interface MetricsPanelProps {
  heuristics: FormHeuristicsResult
  /** The background scale pass's status (add-background-scale-pass, D5). Two effects, both on
   * the null-valued `verticalOscillationCm` excluded entry only: 'pending'/'running' shows a
   * measuring-in-progress hint instead of the availability caveat, and 'failed' shows a
   * tried-but-couldn't line (the availability caveat alone would imply the capability is
   * absent when the app just ran it). Optional so every call site without a scale pass in
   * play is unchanged. */
  scalePassStatus?: ScalePassStatus
  /**
   * The imagery each metric was actually measured from, one entry per metric that produced any.
   * It arrives from `useSessionEvidence` (owned by `MultiClipVideoSession`) rather than being
   * derived here, because whether a metric HAS evidence is not knowable from `heuristics` alone:
   * an emitted exemplar can still fail to resolve to a sampled frame, or fail to extract.
   *
   * Defaults to empty, so a card with no evidence renders exactly the DOM it rendered before this
   * prop existed — no thumbnail, no placeholder, no reserved space, no layout shift.
   */
  evidence?: readonly MetricCardEvidence[]
  /** How many clips the session holds. Only ever read to say which clip a thumbnail came from,
   * which is a question that does not arise below two. */
  clipCount?: number
}

const METRIC_DESCRIPTIONS: Record<MetricId, string> = {
  verticalOscillation:
    'How much your hips bounce up and down with each step, as a percentage of your own torso length — the denominator is your body, so it compares across runners of different heights.',
  verticalRatio:
    "How much you bounce up and down for every unit of distance each stride carries you — the denominator is your stride length. Same concept a running watch calls 'vertical ratio', though this figure hasn't been validated against a watch reading.",
  verticalOscillationCm:
    "How much your hips bounce up and down with each step, in real centimetres — no denominator at all. This is the same raw quantity a running watch reports as 'vertical oscillation', though this figure hasn't been validated against a watch reading. It needs a real-world scale measurement from the clip, so it isn't always available.",
  trunkLean:
    'How far your torso leans forward or backward relative to your direction of travel.',
  overstriding:
    "How far your foot lands ahead of your hips at footstrike, relative to your torso length — a proxy for braking-force risk.",
  cadence: 'How many steps per minute you take, both feet combined.',
  kneeFlexion:
    'How much your knee bends during the swing phase of your stride, both legs combined.',
  armSwingSymmetry:
    'How evenly your left and right arms swing relative to each other — 100% is perfectly even, lower values mean one arm is swinging noticeably more than the other.',
  footStrikePattern:
    'Whether your foot tends to land heel-, midfoot-, or forefoot-first — approximated from ankle position relative to the knee at footstrike, not a direct foot-angle measurement.',
  stepWidth:
    "How far your foot lands from your body's midline at footstrike, as a percentage of your hip width. Positive means it lands on its own side; negative means it crosses toward or past the midline — sometimes called a crossover gait, a pattern some runners work on for stability, not a diagnosis.",
  stepWidthCm:
    "How far to the side of your hip midline your foot lands at each footstrike, in real centimetres. Positive means it lands on its own side; negative means it crosses toward or past the midline — sometimes called a crossover gait, a pattern some runners work on for stability, not a diagnosis. It needs a real-world scale measurement from the clip, so it isn't always available.",
}

const FOOT_STRIKE_CLASS_LABELS: Record<FootStrikeClass, string> = {
  heel: 'Heel strike',
  midfoot: 'Midfoot strike',
  forefoot: 'Forefoot strike',
}

function formatValue(metric: MetricResult): string {
  if (metric.value === null) return 'Not available'
  if (metric.metric === 'footStrikePattern') {
    const cls = classifyFootStrike(
      metric.value,
      DEFAULT_HEURISTICS_CONFIG.footStrikeMidfootBandRatio,
    )
    return `${FOOT_STRIKE_CLASS_LABELS[cls]} (proxy)`
  }
  if (metric.unit === 'degrees') return `${metric.value.toFixed(1)}°`
  if (metric.unit === 'stepsPerMinute') return `${Math.round(metric.value)} steps/min`
  // 'percent' is a dimensionless 0..1 comparison (e.g. armSwingSymmetry's min/max ratio) — unlike
  // 'ratio', it is NOT a fraction of torso length, so it gets no "of torso length" suffix.
  if (metric.unit === 'percent') return `${(metric.value * 100).toFixed(1)}%`
  // 'centimeters' (verticalOscillationCm only) is an absolute physical quantity with no
  // denominator at all — unlike every other branch here, `value` is not multiplied by 100 first.
  if (metric.unit === 'centimeters') return `${metric.value.toFixed(1)} cm`
  return `${(metric.value * 100).toFixed(1)}% of torso length`
}

// The 'Low confidence' branch is live on cards since exclude-only-unmeasurable-metrics: a
// measured, view-workable metric below LOW_CONFIDENCE_THRESHOLD renders as a caveated card with
// this label, where #37's tier rule used to exclude it from the grid entirely.
//
// There is deliberately no `value === null` branch. `metricTier` sends every null-valued metric
// to tier 3, and only a tier-1/tier-2 metric is ever rendered as a card, so this function is
// unreachable with a null value — a branch here could only ever be dead code that reads as a
// live case. It also used to return "Not measurable", which now says something quite different
// from `ExcludedEntry`'s "Not measurable for this clip." fallback.
function confidenceLabel(metric: MetricResult): string {
  if (metric.confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'High confidence'
  if (metric.confidence >= LOW_CONFIDENCE_THRESHOLD) return 'Medium confidence'
  return 'Low confidence'
}

/**
 * What rides in `MetricCard`'s existing `chart` slot: the vertical-oscillation waveform on the one
 * metric that has one, or `undefined` — literally no node — when it does not apply. That
 * `undefined` branch is the mechanism behind "a card with nothing extra renders exactly the DOM it
 * rendered before any of this existed"; it is deliberately a named helper rather than an inline
 * `??` so the guarantee has somewhere to be written down.
 */
function cardSlot(chart: ReactNode): ReactNode | undefined {
  return chart === null ? undefined : chart
}

/**
 * A metric's evidence, inside the metric's own card.
 *
 * The images are the extractor's own canvas elements, adopted by `EvidenceCanvas` — never a data
 * URL, blob or download. Display size is CSS and nothing else: the extractor caps its output at
 * `EVIDENCE_OUTPUT_MAX_SIDE_PX` and every crop is square by spec, so a card thumbnail is the SAME
 * image the gallery showed at `w-56`, drawn smaller. No second extraction at a second resolution.
 *
 * The caption is the metric's own words for that instant. It never restates the card's number:
 * what is pictured is a per-instant measurement, and the card's value is an aggregate over the
 * whole clip — captioning one with the other would be a false statement about the picture.
 */
function CardEvidence({
  evidence,
  clipCount,
}: {
  evidence: MetricCardEvidence
  clipCount: number
}) {
  const provenance = provenanceFor(evidence.clipIndex, clipCount)
  return (
    <div className="metrics-panel__evidence space-y-2 @lg/card:w-2/5 @lg/card:shrink-0">
      {/* A metric has one image or two (`MAX_EXEMPLARS_PER_METRIC`), listed one per row rather
          than side by side. One fixed IMAGE width for every item is the display-side half of
          reading as one set — the crop planner fixes the aspect ratio, this fixes the apparent
          scale — while the caption spans the whole block, because a sentence set to the width of a
          9rem thumbnail is a column of two-word lines at every card width. */}
      <ul className="space-y-3">
        {evidence.items.map((item, index) => (
          <li key={`${item.plan.base.timestamp}-${index}`}>
            <figure className="metrics-panel__evidence-figure space-y-1">
              <div className="w-36 max-w-full">
                <EvidenceCanvas canvas={item.canvas} alt={altFor(item.plan)} />
              </div>
              <figcaption className="metrics-panel__evidence-caption font-sans text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
                {captionFor(item.plan)}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      {provenance !== null && (
        <p className="metrics-panel__evidence-provenance font-sans text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
          {provenance}
        </p>
      )}
    </div>
  )
}

interface MetricCardProps {
  metric: MetricResult
  chart?: ReactNode
  evidence?: MetricCardEvidence
  clipCount: number
}

/**
 * Renders a `'normal'` or `'caveated'` tier metric as a card — never called for an `'excluded'`
 * metric, which the panel routes to the excluded section below instead (see `MetricsPanel`).
 * Tier 2 ('caveated') now spans ALL sub-0.7 confidence for a measured, view-workable metric
 * (exclude-only-unmeasurable-metrics dropped the tier's old 0.4 floor), and gets a structurally
 * distinct treatment, not a color-only one: the same left-accent-stripe border idiom this app's
 * alert/banner components already use (`border-l-4 border-l-brand-600`), plus its caveat note
 * (when present) rendered in its own bordered box rather than the muted footnote styling a
 * tier-1 card's caveat gets — on top of the `confidenceLabel` text itself already reading
 * "Medium confidence" or "Low confidence", which alone satisfies WCAG's "not color alone" bar
 * even on the (verified possible, see metricConfidence.ts) case where a tier-2 metric's
 * `caveat` is null.
 */
function MetricCard({ metric, chart, evidence, clipCount }: MetricCardProps) {
  const tier = metricTier(metric)
  const isCaveated = tier === 'caveated'

  const description = (
    <p className="metrics-panel__description font-sans text-sm text-neutral-700 dark:text-neutral-300">
      {METRIC_DESCRIPTIONS[metric.metric]}
    </p>
  )

  const confidence = (
    <p className="metrics-panel__confidence font-sans text-sm">
      <strong>{confidenceLabel(metric)}</strong>
    </p>
  )

  const caveat = metric.caveat ? (
    <p
      role="note"
      className={
        isCaveated
          ? 'metrics-panel__caveat font-sans text-sm border border-brand-600 dark:border-brand-400 p-2 text-neutral-800 dark:text-neutral-200'
          : 'metrics-panel__caveat font-sans text-xs text-neutral-500 dark:text-neutral-400'
      }
    >
      {metric.caveat}
    </p>
  ) : null

  return (
    <article
      className={`metrics-panel__card border-2 border-black dark:border-white p-5 space-y-2 ${
        isCaveated ? 'border-l-4 border-l-brand-600 dark:border-l-brand-400' : ''
      }`}
      data-tier={tier}
      aria-label={METRIC_LABELS[metric.metric]}
    >
      <h3 className="font-display text-lg font-bold tracking-tight">
        {METRIC_LABELS[metric.metric]}
      </h3>
      <p className="metrics-panel__value font-display text-2xl font-bold">
        {formatValue(metric)}
      </p>
      {/*
        A card with no evidence renders the bare paragraph, byte for byte what it rendered before
        this feature existed — no wrapper, no reserved space, no layout shift. The whole
        narrow/wide apparatus only exists on cards that actually have a picture to place.

        The breakpoint is the CARD's own width, never the viewport's — a `md:` rule would key the
        split to a number that says nothing about the space the thumbnail actually has. The panel's
        card grid is deliberately ONE column at every width (see the grid at the bottom of this
        file), so today the card is as wide as the panel; keying off the card anyway is what makes
        this rule survive a future density change instead of silently placing a thumbnail beside a
        description with no room for it.

        That single column is an intentional layout decision (`strides-49e`, decided 2026-08-29),
        not an oversight: full-width cards are precisely what gives the description enough room for
        the evidence to sit BESIDE it on a desktop, which is the behaviour the inline-evidence work
        was asked for. At two- or three-column density a desktop card is ~500 px / ~311 px wide, the
        query below correctly stacks the thumbnail, and "beside the description on a desktop" stops
        happening anywhere above a phone. The grid's dead `@lg:grid-cols-2`/`@3xl:grid-cols-3`
        utilities were deleted rather than made to fire. Do not reintroduce them.

        Two nested elements, not one: an element with `container-type` establishes a container for
        its DESCENDANTS and cannot query itself, so `@container/card` and `@lg/card:flex-row` must
        sit on different nodes. The container is named so it can never be confused with any
        panel-level container it might nest inside.
      */}
      {evidence === undefined ? (
        <>
          {description}
          {confidence}
          {caveat}
          {chart}
        </>
      ) : (
        <div className="@container/card">
          <div className="flex flex-col gap-3 @lg/card:flex-row @lg/card:items-start @lg/card:gap-4">
            {/* The confidence label rides in the SAME column as the description rather than
                below the whole two-column block. Left where it was, a one-line label sat under
                the tall evidence column and read as a footnote to the picture instead of to the
                number — and on a wide card it left an obvious hole beside the thumbnail. It is a
                statement about the value, so it belongs with the prose that explains the value.
                `space-y-2` matches the rhythm the article applies to its own children, so the
                gap under the description is the same in both branches. */}
            {/* `contents` while narrow, a real column once wide. The text column has to
                DISSOLVE at narrow widths: its children and the imagery are then siblings of one
                flex container, which is the only way `order` can interleave them. Without it the
                imagery can sit before the whole column or after it, never between the description
                and the chart — and after it means a phone shows the picture below a tall graph,
                which breaks "the picture and the number it explains SHALL be visible together". */}
            <div className="contents @lg/card:block @lg/card:space-y-2 @lg/card:min-w-0 @lg/card:flex-1">
              <div className="order-1 space-y-2 @lg/card:order-none @lg/card:contents">
                {description}
                {confidence}
              </div>
              <div className="order-3 space-y-2 @lg/card:order-none @lg/card:contents">
                {caveat}
                {chart}
              </div>
            </div>
            <div className="order-2 @lg/card:order-none @lg/card:contents">
              <CardEvidence evidence={evidence} clipCount={clipCount} />
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

interface ExcludedEntryProps {
  metric: MetricResult
  /** When set, renders in place of the metric's caveat as this entry's reason text — used for
   * the scale pass's measuring-in-progress hint, where the caveat ("no scale could be measured")
   * would misstate a measurement that is actively underway. */
  hint?: string
}

/**
 * A tier-3 ('excluded') metric's entire on-screen presence: its name and the reason it was
 * excluded, and nothing else — no formatted value, no confidence label, no "Not available"
 * placeholder (#37 design.md D4). `metric.caveat` is the reason text; every null-value path in
 * the heuristics layer is contractually required to set one (see each metric module's
 * `nullResult` helper), and every `'unsuitable'`-view path's caveat names the camera-angle
 * issue. The fallback below is a confidence-neutral defensive string for type-legal shapes with
 * no caveat — since exclude-only-unmeasurable-metrics, exclusion only ever means "structurally
 * unmeasurable" (null value or unsuitable view), never low confidence, so the fallback must not
 * assert a confidence-based reason.
 */
function ExcludedEntry({ metric, hint }: ExcludedEntryProps) {
  return (
    <li className="metrics-panel__excluded-entry">
      <p className="font-display font-bold">{METRIC_LABELS[metric.metric]}</p>
      <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
        {hint ?? metric.caveat ?? 'Not measurable for this clip.'}
      </p>
    </li>
  )
}

/**
 * Numeric readouts for all eleven form heuristics, partitioned into tiers (#37; exclusion rule
 * reversed by exclude-only-unmeasurable-metrics) rather than one uniform grid: tier 1
 * ('normal', measured, view-workable, confidence >= 0.7) and tier 2 ('caveated', measured,
 * view-workable, confidence < 0.7 with no lower bound) render as cards in the grid above,
 * distinguished from each other by `MetricCard`'s border/caveat treatment; tier 3 ('excluded',
 * `value === null` or `viewFit === 'unsuitable'` — structurally unmeasurable, never merely
 * low-confidence) is listed by name and reason only in the labeled section below the grid — no
 * value ever renders for an excluded metric. Both sections preserve `MetricId` declaration order
 * within themselves (no re-sorting by confidence — see #37 design.md D5 on why a metric crossing
 * a threshold between runs still only reorders its own section, not the whole panel).
 * `footStrikePattern`'s `caveat` is always non-null (even at its cleanest) since that metric is a
 * documented proxy end to end — it renders on its card whenever it lands in tier 1/2.
 */
export function MetricsPanel({
  heuristics,
  scalePassStatus = 'idle',
  evidence = NO_EVIDENCE,
  clipCount = 1,
}: MetricsPanelProps) {
  const scalePassInProgress = scalePassStatus === 'pending' || scalePassStatus === 'running'
  // Keyed by metric, never by array position: evidence arrives in its own order (the extraction
  // plan's), and a metric's imagery must reach the card for that metric or no card at all.
  const evidenceByMetric = new Map(evidence.map((entry) => [entry.metric, entry]))
  const metrics: MetricResult[] = [
    heuristics.verticalOscillation,
    heuristics.verticalRatio,
    heuristics.verticalOscillationCm,
    heuristics.trunkLean,
    heuristics.overstriding,
    heuristics.cadence,
    heuristics.kneeFlexion,
    heuristics.armSwingSymmetry,
    heuristics.footStrikePattern,
    heuristics.stepWidth,
    heuristics.stepWidthCm,
  ]
  const excluded = metrics.filter((metric) => metricTier(metric) === 'excluded')
  const caveatedCount = metrics.filter((metric) => metricTier(metric) === 'caveated').length
  // The counts NEST, they do not partition: a caveated metric was measured, and one of its own
  // cards is on screen showing a number. Counting it only under "with caveats" made the line
  // disagree with the screen — a 2/3/6 run rendered "2 metrics measured" beside five cards that
  // each showed a value. `measuredCount` is therefore every metric that got a card, tier 1 and
  // tier 2 alike, with the caveated share reported parenthetically INSIDE it.
  const measuredCount = metrics.length - excluded.length

  // One quiet line so a user who never scrolls the (height-capped) results pane still learns
  // that some metrics carry caveats or were excluded — the deleted LowConfidenceBanner's one
  // real job. Rendered only when there's something to say; an all-normal run stays clean.
  // "With caveats" now spans the whole sub-0.7 confidence range, since the caveated tier lost
  // its 0.4 floor (exclude-only-unmeasurable-metrics).
  //
  // "not measurable", not "not measured": the excluded section lists metrics whose value was
  // computed and then set aside because the camera angle cannot support the measurement
  // (`viewFit: 'unsuitable'`), so "not measured" is false for them. The heading below carries
  // the same word for the same reason.
  const summaryParts = [
    `${measuredCount} metric${measuredCount === 1 ? '' : 's'} measured${
      caveatedCount > 0 ? ` (${caveatedCount} with caveat${caveatedCount === 1 ? '' : 's'})` : ''
    }`,
    ...(excluded.length > 0
      ? [`${excluded.length} not measurable for this clip (listed below)`]
      : []),
  ]

  return (
    <section className="metrics-panel space-y-6" aria-label="Form metrics">
      {(caveatedCount > 0 || excluded.length > 0) && (
        <p className="metrics-panel__tier-summary font-sans text-sm text-neutral-600 dark:text-neutral-400">
          {summaryParts.join(' · ')}
        </p>
      )}
      {/* One column, at every viewport width — a decision, not an omission. See the note in
          `MetricCard` above on why full-width cards are the layout the evidence work needs. */}
      <div className="grid gap-4">
        {metrics.map((metric) =>
          metricTier(metric) !== 'excluded' ? (
            <MetricCard
              key={metric.metric}
              metric={metric}
              // Both the chart and the evidence ride on the metric they belong to, by identity —
              // not by array position, so reordering `metrics` for display reasons can never
              // strand either on the wrong card. An excluded metric never reaches this branch at
              // all, so a tier-3 metric gets no imagery however many exemplars it emitted.
              chart={cardSlot(
                metric.metric === 'verticalOscillation' ? (
                  <VerticalOscillationChart series={heuristics.verticalOscillation.series} />
                ) : null,
              )}
              evidence={evidenceByMetric.get(metric.metric)}
              clipCount={clipCount}
            />
          ) : null,
        )}
      </div>
      {excluded.length > 0 && (
        <section
          aria-labelledby="metrics-panel-excluded-heading"
          className="metrics-panel__excluded border-2 border-black dark:border-white p-5 space-y-3"
        >
          <h3
            id="metrics-panel-excluded-heading"
            className="font-display text-lg font-bold tracking-tight"
          >
            Not measurable for this clip
          </h3>
          <ul className="space-y-3">
            {excluded.map((metric) => (
              <ExcludedEntry
                key={metric.metric}
                metric={metric}
                // While the background scale pass is measuring, a scale-pass-backed metric's
                // availability caveat ("no scale could be measured") isn't the truth yet-to-come —
                // hint at the in-flight measurement instead; after a failed pass, say the
                // attempt happened (the availability caveat alone would imply the capability
                // is absent when the app just ran it). Null-value only: the only non-null
                // excluded shape is an unsuitable view, whose own caveat is the accurate one.
                // Both `verticalOscillationCm` and `stepWidthCm` are grafted from the same scale
                // pass (#45) and share this hint — see scalePassGraft.ts.
                hint={
                  (metric.metric === 'verticalOscillationCm' ||
                    metric.metric === 'stepWidthCm') &&
                  metric.value === null
                    ? scalePassInProgress
                      ? 'Measuring real-world scale with a second look at the clip…'
                      : scalePassStatus === 'failed'
                        ? "A second look at the clip couldn't measure real-world scale."
                        : undefined
                    : undefined
                }
              />
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

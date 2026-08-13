import type { ReactNode } from 'react'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import { DEFAULT_HEURISTICS_CONFIG } from '../heuristics/types'
import { classifyFootStrike } from '../heuristics/footStrikePattern'
import type { FootStrikeClass } from '../heuristics/footStrikePattern'
import { VerticalOscillationChart } from './VerticalOscillationChart'
import {
  HIGH_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_THRESHOLD,
  METRIC_LABELS,
  metricTier,
} from './metricConfidence'

export interface MetricsPanelProps {
  heuristics: FormHeuristicsResult
}

const METRIC_DESCRIPTIONS: Record<MetricId, string> = {
  verticalOscillation:
    'How much your hips bounce up and down with each step, as a percentage of your own torso length — the denominator is your body, so it compares across runners of different heights.',
  verticalRatio:
    "How much you bounce up and down for every unit of distance each stride carries you — the denominator is your stride length. Same concept a running watch calls 'vertical ratio', though this figure hasn't been validated against a watch reading.",
  verticalOscillationCm:
    "How much your hips bounce up and down with each step, in real centimetres — no denominator at all. This is the same raw quantity a running watch reports as 'vertical oscillation', though this figure hasn't been validated against a watch reading. It needs a pose-detection backend that measures real-world scale, so it isn't available on every backend.",
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
function confidenceLabel(metric: MetricResult): string {
  if (metric.value === null) return 'Not measurable'
  if (metric.confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'High confidence'
  if (metric.confidence >= LOW_CONFIDENCE_THRESHOLD) return 'Medium confidence'
  return 'Low confidence'
}

interface MetricCardProps {
  metric: MetricResult
  chart?: ReactNode
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
function MetricCard({ metric, chart }: MetricCardProps) {
  const tier = metricTier(metric)
  const isCaveated = tier === 'caveated'

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
      <p className="metrics-panel__description font-sans text-sm text-neutral-700 dark:text-neutral-300">
        {METRIC_DESCRIPTIONS[metric.metric]}
      </p>
      <p className="metrics-panel__confidence font-sans text-sm">
        <strong>{confidenceLabel(metric)}</strong>
      </p>
      {metric.caveat && (
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
      )}
      {chart}
    </article>
  )
}

interface ExcludedEntryProps {
  metric: MetricResult
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
function ExcludedEntry({ metric }: ExcludedEntryProps) {
  return (
    <li className="metrics-panel__excluded-entry">
      <p className="font-display font-bold">{METRIC_LABELS[metric.metric]}</p>
      <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
        {metric.caveat ?? 'Not measurable for this clip.'}
      </p>
    </li>
  )
}

/**
 * Numeric readouts for all nine form heuristics, partitioned into tiers (#37; exclusion rule
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
export function MetricsPanel({ heuristics }: MetricsPanelProps) {
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
  ]
  const excluded = metrics.filter((metric) => metricTier(metric) === 'excluded')
  const caveatedCount = metrics.filter((metric) => metricTier(metric) === 'caveated').length
  const normalCount = metrics.length - caveatedCount - excluded.length

  // One quiet line so a user who never scrolls the (height-capped) results pane still learns
  // that some metrics carry caveats or were excluded — the deleted LowConfidenceBanner's one
  // real job. Rendered only when there's something to say; an all-normal run stays clean.
  // "With caveats" now spans the whole sub-0.7 confidence range, since the caveated tier lost
  // its 0.4 floor (exclude-only-unmeasurable-metrics).
  const summaryParts = [
    `${normalCount} metric${normalCount === 1 ? '' : 's'} measured`,
    ...(caveatedCount > 0
      ? [`${caveatedCount} with caveat${caveatedCount === 1 ? '' : 's'}`]
      : []),
    ...(excluded.length > 0
      ? [`${excluded.length} not measured for this clip (listed below)`]
      : []),
  ]

  return (
    <section className="metrics-panel space-y-6" aria-label="Form metrics">
      {(caveatedCount > 0 || excluded.length > 0) && (
        <p className="metrics-panel__tier-summary font-sans text-sm text-neutral-600 dark:text-neutral-400">
          {summaryParts.join(' · ')}
        </p>
      )}
      <div className="@container grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">
        {metrics.map((metric) =>
          metricTier(metric) !== 'excluded' ? (
            <MetricCard
              key={metric.metric}
              metric={metric}
              // The chart rides on the metric it charts, by identity — not by array position, so
              // reordering `metrics` for display reasons can never strand it on the wrong card.
              chart={
                metric.metric === 'verticalOscillation' ? (
                  <VerticalOscillationChart series={heuristics.verticalOscillation.series} />
                ) : undefined
              }
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
            Not measured for this clip
          </h3>
          <ul className="space-y-3">
            {excluded.map((metric) => (
              <ExcludedEntry key={metric.metric} metric={metric} />
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

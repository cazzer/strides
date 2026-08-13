import type { ReactNode } from 'react'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import { DEFAULT_HEURISTICS_CONFIG } from '../heuristics/types'
import { classifyFootStrike } from '../heuristics/footStrikePattern'
import type { FootStrikeClass } from '../heuristics/footStrikePattern'
import { VerticalOscillationChart } from './VerticalOscillationChart'
import { LOW_CONFIDENCE_THRESHOLD, METRIC_LABELS, isMetricFlagged } from './metricConfidence'

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

function confidenceLabel(metric: MetricResult): string {
  if (metric.value === null) return 'Not measurable'
  if (metric.confidence >= 0.7) return 'High confidence'
  if (metric.confidence >= LOW_CONFIDENCE_THRESHOLD) return 'Medium confidence'
  return 'Low confidence'
}

interface MetricCardProps {
  metric: MetricResult
  chart?: ReactNode
}

function MetricCard({ metric, chart }: MetricCardProps) {
  const isFlagged = isMetricFlagged(metric)

  return (
    <article
      className={`metrics-panel__card border-2 p-5 space-y-2 ${
        isFlagged
          ? 'opacity-85 border-brand-600 dark:border-brand-400'
          : 'border-black dark:border-white'
      }`}
      data-flagged={isFlagged}
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
        {metric.viewFit === 'unsuitable' && ' — not reliable from this camera angle'}
      </p>
      {metric.caveat && (
        <p role="note" className="metrics-panel__caveat font-sans text-xs text-neutral-500 dark:text-neutral-400">
          {metric.caveat}
        </p>
      )}
      {chart}
    </article>
  )
}

/**
 * Numeric readouts for all nine form heuristics, each with a plain-language label and a
 * confidence/applicability indicator. A flagged metric (`value: null`, low confidence, or
 * `viewFit: 'unsuitable'`) gets a visibly different treatment — never color alone: the
 * confidence label text itself changes ("Low confidence" / "Not measurable"), the camera-angle
 * caveat is spelled out, and any `caveat` text from the heuristics engine is surfaced verbatim —
 * with a supplementary, non-load-bearing opacity/border cue for sighted users scanning quickly.
 * `footStrikePattern`'s `caveat` is always non-null (even at its cleanest) since that metric is a
 * documented proxy end to end — it always renders here, not just in a flagged/degraded state.
 */
export function MetricsPanel({ heuristics }: MetricsPanelProps) {
  return (
    <section
      className="metrics-panel @container grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3"
      aria-label="Form metrics"
    >
      <MetricCard
        metric={heuristics.verticalOscillation}
        chart={<VerticalOscillationChart series={heuristics.verticalOscillation.series} />}
      />
      <MetricCard metric={heuristics.verticalRatio} />
      <MetricCard metric={heuristics.verticalOscillationCm} />
      <MetricCard metric={heuristics.trunkLean} />
      <MetricCard metric={heuristics.overstriding} />
      <MetricCard metric={heuristics.cadence} />
      <MetricCard metric={heuristics.kneeFlexion} />
      <MetricCard metric={heuristics.armSwingSymmetry} />
      <MetricCard metric={heuristics.footStrikePattern} />
    </section>
  )
}

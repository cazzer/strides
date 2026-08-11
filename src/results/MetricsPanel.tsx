import type { ReactNode } from 'react'
import type { MetricId, MetricResult } from '../heuristics/types'
import type { FormHeuristicsResult } from '../heuristics/types'
import { VerticalOscillationChart } from './VerticalOscillationChart'

export interface MetricsPanelProps {
  heuristics: FormHeuristicsResult
}

const METRIC_LABELS: Record<MetricId, string> = {
  verticalOscillation: 'Vertical oscillation',
  trunkLean: 'Trunk lean',
  overstriding: 'Overstriding',
}

const METRIC_DESCRIPTIONS: Record<MetricId, string> = {
  verticalOscillation:
    'How much your hips bounce up and down with each stride, relative to your torso length.',
  trunkLean:
    'How far your torso leans forward or backward relative to your direction of travel.',
  overstriding:
    "How far your foot lands ahead of your hips at footstrike, relative to your torso length — a proxy for braking-force risk.",
}

/** Low-confidence threshold below which the panel calls extra attention to a metric's caveat —
 * a judgment-call cutoff, not derived from the heuristics engine itself (which only guarantees
 * confidence is 0..1, forced to 0 when value is null). */
const LOW_CONFIDENCE_THRESHOLD = 0.4

function formatValue(metric: MetricResult): string {
  if (metric.value === null) return 'Not available'
  if (metric.unit === 'degrees') return `${metric.value.toFixed(1)}°`
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
  const isFlagged =
    metric.value === null ||
    metric.confidence < LOW_CONFIDENCE_THRESHOLD ||
    metric.viewFit === 'unsuitable'

  return (
    <article
      className={`metrics-panel__card border-2 border-black dark:border-white p-5 space-y-2 ${isFlagged ? 'opacity-85 border-brand-600 dark:border-brand-400' : ''}`}
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
 * Numeric readouts for all three form heuristics, each with a plain-language label and a
 * confidence/applicability indicator. A flagged metric (`value: null`, low confidence, or
 * `viewFit: 'unsuitable'`) gets a visibly different treatment — never color alone: the
 * confidence label text itself changes ("Low confidence" / "Not measurable"), the camera-angle
 * caveat is spelled out, and any `caveat` text from the heuristics engine is surfaced verbatim —
 * with a supplementary, non-load-bearing opacity/border cue for sighted users scanning quickly.
 */
export function MetricsPanel({ heuristics }: MetricsPanelProps) {
  return (
    <section className="metrics-panel grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Form metrics">
      <MetricCard
        metric={heuristics.verticalOscillation}
        chart={<VerticalOscillationChart series={heuristics.verticalOscillation.series} />}
      />
      <MetricCard metric={heuristics.trunkLean} />
      <MetricCard metric={heuristics.overstriding} />
    </section>
  )
}

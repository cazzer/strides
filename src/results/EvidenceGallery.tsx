import { useEffect, useRef } from 'react'
import type { MetricId } from '../heuristics/types'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import { EvidenceCanvas } from './EvidenceCanvas'
import { altFor, captionFor, provenanceFor } from './evidenceCaptions'
import { METRIC_LABELS } from './metricConfidence'
import type { ClipSession } from './multiClipAnalysis'
import { useSessionEvidence } from './useSessionEvidence'
import type { EvidenceSection } from './useSessionEvidence'

/**
 * Prefix of every gallery section's DOM id, shared with `MetricsPanel`'s "See evidence" deep link
 * so the anchor and its target cannot drift apart. A metric's section is
 * `` `${EVIDENCE_SECTION_ID_PREFIX}${metricId}` ``.
 */
export const EVIDENCE_SECTION_ID_PREFIX = 'evidence-'

export type { EvidenceSection }

export interface EvidenceGalleryProps {
  clips: ClipSession[]
  /** `computeFusionSourceIndices(clips)`, which the caller has already confirmed is non-null —
   * the same gate the fused `heuristics` itself passes, so a section is never attributed to a
   * clip whose analysis has not been fused yet. */
  sourceIndices: Record<MetricId, number>
  /**
   * Which metrics ended up with imagery, reported up so the metric cards can grow their deep
   * links. Same report-up/fan-down idiom `ClipSlot` already uses: the cards live in a sibling
   * subtree (`ResultsView`), and there is no way to know a metric has evidence until extraction
   * has actually produced pixels for it. Called only when the set's CONTENTS change.
   */
  onEvidenceMetricsChange?: (metrics: ReadonlySet<MetricId>) => void
}

const NO_METRICS: ReadonlySet<MetricId> = new Set()

function sameMetricSet(a: ReadonlySet<MetricId>, b: ReadonlySet<MetricId>): boolean {
  return a.size === b.size && [...a].every((metric) => b.has(metric))
}

function EvidenceFigure({ frame }: { frame: ExtractedEvidenceFrame }) {
  return (
    <figure className="evidence-gallery__figure space-y-2">
      <EvidenceCanvas
        canvas={frame.canvas}
        alt={altFor(frame.plan)}
        className="evidence-gallery__image"
      />
      <figcaption className="evidence-gallery__caption font-sans text-xs text-neutral-600 dark:text-neutral-400">
        {captionFor(frame.plan)}
      </figcaption>
    </figure>
  )
}

function EvidenceSectionView({
  section,
  clipCount,
}: {
  section: EvidenceSection
  clipCount: number
}) {
  const id = `${EVIDENCE_SECTION_ID_PREFIX}${section.metric}`
  const provenance = provenanceFor(section.clipIndex, clipCount)
  return (
    <section
      id={id}
      // Focusable-by-script only, so following the card's deep link lands keyboard focus inside
      // the section it scrolled to rather than leaving it stranded back on the card.
      tabIndex={-1}
      aria-labelledby={`${id}-heading`}
      data-metric={section.metric}
      className="evidence-gallery__section scroll-mt-24 space-y-3 border-2 border-black p-5 dark:border-white"
    >
      <h3 id={`${id}-heading`} className="font-display text-lg font-bold tracking-tight">
        {METRIC_LABELS[section.metric]}
      </h3>
      {provenance !== null && (
        <p className="evidence-gallery__provenance font-sans text-sm text-neutral-600 dark:text-neutral-400">
          {provenance}
        </p>
      )}
      {/* Fixed-width, centred and wrapping rather than a two-column grid: a metric may have one
          image or two (`MAX_EXEMPLARS_PER_METRIC`), and a grid orphans the single case in the left
          half of the card. One width for every image in the gallery is also the display-side half
          of reading as one set — D13 fixes the aspect ratio, this fixes the apparent scale. */}
      <ul className="flex flex-wrap justify-center gap-4">
        {section.items.map((item, index) => (
          <li key={`${item.plan.base.timestamp}-${index}`} className="w-56 max-w-full">
            <EvidenceFigure frame={item} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The evidence gallery: the frames each metric was actually measured from, re-pulled out of the
 * clip after analysis and grouped by metric.
 *
 * **Not mounted by the application since `strides-ac9.2`** — the imagery moved into the metric
 * cards, and a canvas element has exactly one parent, so exactly one surface may adopt it. This
 * component and its suite stay only until `strides-ac9.3` retires them; the extraction it used to
 * own moved to `useSessionEvidence`, which is now the app's single caller.
 *
 * A metric with no evidence — never emitted, gated out, tier 3, or extraction-failed — gets no
 * section, no placeholder and no empty frame; that is the whole degradation story.
 */
export function EvidenceGallery({
  clips,
  sourceIndices,
  onEvidenceMetricsChange,
}: EvidenceGalleryProps) {
  const state = useSessionEvidence(clips, sourceIndices)
  const reportedRef = useRef<ReadonlySet<MetricId>>(NO_METRICS)

  useEffect(() => {
    const metrics: ReadonlySet<MetricId> =
      state.status === 'settled'
        ? new Set(state.sections.map((section) => section.metric))
        : NO_METRICS
    if (sameMetricSet(reportedRef.current, metrics)) return
    reportedRef.current = metrics
    onEvidenceMetricsChange?.(metrics)
  }, [state, onEvidenceMetricsChange])

  useEffect(() => {
    return () => {
      reportedRef.current = NO_METRICS
    }
  }, [])

  if (state.status === 'idle') return null
  if (state.status === 'settled' && state.sections.length === 0) return null

  return (
    <section
      aria-labelledby="evidence-gallery-heading"
      className="evidence-gallery space-y-6 border-t-2 border-black pt-8 lg:col-span-2 dark:border-white"
    >
      <div className="space-y-2">
        <h2
          id="evidence-gallery-heading"
          className="font-display text-xl font-bold tracking-tight"
        >
          What the analysis looked at
        </h2>
        {state.status === 'extracting' ? (
          <p
            role="status"
            className="evidence-gallery__status font-sans text-sm text-neutral-600 dark:text-neutral-400"
          >
            Pulling the frames behind these numbers back out of your clip…
          </p>
        ) : (
          <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
            One image per measurement, cropped from your own clip. Where two positions overlap,
            both of them are you — the same runner at two instants of the run, drawn over each
            other so the difference between them is visible.
          </p>
        )}
      </div>
      {state.status === 'settled' && (
        <div className="grid gap-6 md:grid-cols-2">
          {state.sections.map((section) => (
            <EvidenceSectionView
              key={section.metric}
              section={section}
              clipCount={clips.length}
            />
          ))}
        </div>
      )}
    </section>
  )
}

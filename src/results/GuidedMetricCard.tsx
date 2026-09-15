import { MetricScale } from '../guidance/MetricScale'
import { formatMeasuredBandValue } from '../guidance/bandPosition'
import { formatBandValue } from '../guidance/formatBandValue'
import type {
  BandSource,
  GuidanceLink,
  GuidanceLinkKind,
  ReferenceBand,
  SpeedSensitivity,
} from '../guidance/types'
import type { MetricResult } from '../heuristics/types'
import { EvidenceCanvas } from './EvidenceCanvas'
import { altFor, captionFor, provenanceFor } from './evidenceCaptions'
import { formatGuidedValue } from './formatGuidedValue'
import type { GuidedEntry } from './guidedGroups'
import {
  HIGH_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_THRESHOLD,
  METRIC_LABELS,
  metricTier,
} from './metricConfidence'
import { METRIC_DESCRIPTIONS } from './metricDescriptions'
import type { MetricCardEvidence } from './MetricsPanel'

/**
 * One metric on the guided results page, measured on this clip.
 *
 * Every factual sentence on this card comes from the metric's result (its value, its own caveat)
 * or from `METRIC_GUIDANCE` (band, provenance, notes, links). The only copy authored here is
 * structural — headings, field names, "opens in a new tab" — and none of it grades the runner:
 * a band is where a measured group of runners fell, never where this runner ought to be.
 */

const BODY = 'font-sans text-sm text-neutral-700 dark:text-neutral-300'
const MUTED = 'font-sans text-sm text-neutral-600 dark:text-neutral-400'
const SUBHEADING =
  'font-display text-sm font-bold uppercase tracking-wide text-black dark:text-white'
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

/** What kind of thing a link sends the reader to (`GuidanceLinkKind`'s own doc). Not a ranking. */
const LINK_KIND_LABELS: Record<GuidanceLinkKind, string> = {
  'peer-reviewed': 'Peer-reviewed',
  'peer-reviewed-author-copy': "Peer-reviewed, author's copy",
  manufacturer: 'Manufacturer documentation',
  'trade-publication': 'Trade publication',
  handout: 'Practitioner handout',
  'book-chapter': 'Book chapter',
}

/**
 * ⚠️ A copy of `MetricsPanel.tsx`'s private `confidenceLabel`, same thresholds (single-sourced in
 * `metricConfidence.ts`) and same words. Only ever called for a `'caveated'` card here.
 */
function confidenceLabel(metric: MetricResult): string {
  if (metric.confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'High confidence'
  if (metric.confidence >= LOW_CONFIDENCE_THRESHOLD) return 'Medium confidence'
  return 'Low confidence'
}

/** `860` reads as `n = 860`; anything that is not a bare count ("Not published") renders as stored. */
function formatSampleSize(sampleSize: string): string {
  return /^\d[\d,]*$/.test(sampleSize.trim()) ? `n = ${sampleSize.trim()}` : sampleSize
}

function ExternalLink({ url, title }: { url: string; title: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`font-semibold text-black underline decoration-1 underline-offset-2 hover:decoration-2 dark:text-white ${FOCUS}`}
    >
      {title}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function LinkList({
  heading,
  links,
  variant,
}: {
  heading: string
  links: readonly GuidanceLink[]
  variant: 'research' | 'remediation'
}) {
  if (links.length === 0) return null
  return (
    <div className={`guided-results__links guided-results__links--${variant} space-y-2`}>
      <h4 className={SUBHEADING}>{heading}</h4>
      <ul className="space-y-3">
        {links.map((link, index) => (
          <li key={`${link.url}-${index}`} className="space-y-0.5">
            <p className={BODY}>
              <ExternalLink url={link.url} title={link.title} />
            </p>
            <p className="font-sans text-xs text-neutral-600 dark:text-neutral-400">
              {LINK_KIND_LABELS[link.kind]}
            </p>
            <p className={BODY}>{link.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SourceFields({ source }: { source: BandSource }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
      <dt className="font-semibold">Source</dt>
      <dd>
        <ExternalLink url={source.url} title={source.title} />
      </dd>
      <dt className="font-semibold">Population</dt>
      <dd>{source.population}</dd>
      <dt className="font-semibold">Sample size</dt>
      <dd>{formatSampleSize(source.sampleSize)}</dd>
    </dl>
  )
}

/**
 * The band's provenance, on screen and never behind a disclosure: a band with its citation
 * stripped off is indistinguishable from a number the app invented (spec, "A reference band renders
 * only with its provenance on screen").
 */
function Provenance({ band }: { band: ReferenceBand }) {
  return (
    <div className={`guided-results__provenance space-y-3 ${BODY}`}>
      <h4 className={SUBHEADING}>Where this range comes from</h4>
      {band.derivation !== null && (
        <div className="guided-results__derivation space-y-1">
          <p>
            <strong className="guided-results__derived-label">Derived range</strong>
          </p>
          <p>
            These bounds are arithmetic on published numbers rather than a range the source
            publishes. {band.derivation.statement}
          </p>
          {band.derivation.restsOn.length > 0 && (
            <>
              <p>The arithmetic rests on these definitions:</p>
              <ul className="list-disc space-y-1 pl-5">
                {band.derivation.restsOn.map((definition) => (
                  <li key={definition}>{definition}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <SourceFields source={band.source} />
      {band.centralTendency !== null && (
        <p className="guided-results__central-tendency">
          Reported for this population — {band.centralTendency.label}:{' '}
          {formatBandValue(band.centralTendency.value, band.unit)}
        </p>
      )}
      {band.note !== null && <p className="guided-results__band-note">{band.note}</p>}
      {band.corroboration.length > 0 && (
        <div className="guided-results__corroboration space-y-2">
          <p className="font-semibold">
            Other published measurements, shown beside this range rather than merged into it
          </p>
          <ul className="space-y-3">
            {band.corroboration.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <SourceFields source={source} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * The speed caveat. Rendered only where the guidance records a speed dependence — a `null` there is
 * an absence of evidence, and rendering nothing is what keeps the caveat meaningful where it does
 * render. Within-runner and between-runner effects are kept apart because they are different claims.
 */
function SpeedNote({ speed }: { speed: SpeedSensitivity }) {
  return (
    <div
      role="note"
      className={`guided-results__speed space-y-2 border border-neutral-400 p-3 dark:border-neutral-600 ${BODY}`}
    >
      <p>
        <strong>Running speed: </strong>
        {speed.summary}
      </p>
      {(speed.withinRunner !== null || speed.betweenRunners !== null) && (
        <dl className="space-y-1">
          {speed.withinRunner !== null && (
            <div>
              <dt className="font-semibold">Within one runner, as their pace changes</dt>
              <dd>{speed.withinRunner}</dd>
            </div>
          )}
          {speed.betweenRunners !== null && (
            <div>
              <dt className="font-semibold">Between runners, each at their own pace</dt>
              <dd>{speed.betweenRunners}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

/**
 * The metric's evidence thumbnails.
 *
 * ⚠️ Mirrors `MetricsPanel.tsx`'s private `CardEvidence` — same `EvidenceCanvas`, same captions from
 * `evidenceCaptions.ts`, same pending placeholder and wording — without its container-query layout.
 * The canvases arrive as props from the session's one evidence acquisition; this component adopts
 * them and never starts one (a DOM node has one parent, design.md D7.3).
 */
function CardEvidence({
  evidence,
  clipCount,
}: {
  evidence: MetricCardEvidence
  clipCount: number
}) {
  const provenance = provenanceFor(evidence.clipIndex, clipCount)
  if (evidence.pending === true) {
    return (
      <div className="guided-results__evidence space-y-2" aria-busy="true">
        <div
          className="guided-results__evidence-placeholder aspect-square w-36 max-w-full animate-pulse border border-neutral-300 bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800"
          aria-hidden="true"
        />
        <p className="font-sans text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
          Preparing the frames this was measured from…
        </p>
      </div>
    )
  }
  if (evidence.items.length === 0) return null
  return (
    <div className="guided-results__evidence space-y-2">
      <ul className="space-y-3">
        {evidence.items.map((item, index) => (
          <li key={`${item.plan.base.timestamp}-${index}`}>
            <figure className="space-y-1">
              <div className="w-36 max-w-full">
                <EvidenceCanvas canvas={item.canvas} alt={altFor(item.plan)} />
              </div>
              <figcaption className="font-sans text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
                {captionFor(item.plan)}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      {provenance !== null && (
        <p className="font-sans text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
          {provenance}
        </p>
      )}
    </div>
  )
}

export interface GuidedMetricCardProps {
  /** A `banded` or `unbanded` entry from `guidedGroups` — never a not-measured one. */
  entry: GuidedEntry
  evidence?: MetricCardEvidence
  clipCount: number
}

/**
 * A measured metric's card. With a renderable band it shows the scale and the band's provenance;
 * without one it shows why there is no band. Everything else — value, the metric's own caveat, the
 * speed caveat, mandatory notes, evidence, research and remediation links — renders either way:
 * a band controls whether a SCALE renders, not whether the metric does (design.md D7.6).
 */
export function GuidedMetricCard({ entry, evidence, clipCount }: GuidedMetricCardProps) {
  const { metric, guidance, band } = entry
  const label = METRIC_LABELS[metric.metric]
  const tier = metricTier(metric)
  const value = metric.value
  const scaled = band !== null && value !== null
  // A banded headline is printed at the band's own precision, so it can never read as sitting on a
  // published bound the scale beneath it says it does not sit on.
  const valueText = scaled ? formatMeasuredBandValue(band, value) : formatGuidedValue(metric)

  return (
    <article
      className="guided-results__card space-y-4 border-2 border-black p-5 dark:border-white"
      aria-label={label}
      data-metric={metric.metric}
      data-tier={tier}
    >
      <div className="space-y-1">
        <h3 className="font-display text-lg font-bold tracking-tight">{label}</h3>
        <p className="guided-results__value font-display text-2xl font-bold">{valueText}</p>
        <p className={`guided-results__description ${BODY}`}>
          {METRIC_DESCRIPTIONS[metric.metric]}
        </p>
        {tier === 'caveated' && (
          <p className="guided-results__confidence font-sans text-sm">
            <strong>{confidenceLabel(metric)}</strong>
          </p>
        )}
      </div>

      {metric.caveat !== null && (
        <p role="note" className={`guided-results__caveat ${MUTED}`}>
          {metric.caveat}
        </p>
      )}

      {evidence !== undefined && <CardEvidence evidence={evidence} clipCount={clipCount} />}

      {scaled ? (
        <>
          <div className="guided-results__scale space-y-2">
            <h4 className={SUBHEADING}>Where this reading sits</h4>
            <MetricScale band={band} value={value} label={label} />
          </div>
          <Provenance band={band} />
        </>
      ) : (
        <div className={`guided-results__no-band space-y-1 ${BODY}`}>
          <h4 className={SUBHEADING}>Why no reference range is shown</h4>
          <p>
            {guidance.noBandReason ??
              'The range on record for this measurement is missing its source, population or sample size, so it is not shown.'}
          </p>
        </div>
      )}

      {guidance.speedSensitivity !== null && <SpeedNote speed={guidance.speedSensitivity} />}

      {guidance.mandatoryNotes.length > 0 && (
        <div className={`guided-results__notes space-y-2 ${BODY}`}>
          {guidance.mandatoryNotes.map((note) => (
            <p key={note} role="note">
              {note}
            </p>
          ))}
        </div>
      )}

      <LinkList heading="What the research says" links={guidance.research} variant="research" />
      <LinkList
        heading="Changes that have been studied"
        links={guidance.remediation}
        variant="remediation"
      />
    </article>
  )
}

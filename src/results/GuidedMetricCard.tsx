import { useId } from 'react'
import { MetricScale } from '../guidance/MetricScale'
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
import { guidedHeadline } from './formatGuidedValue'
import {
  cardReferences,
  guidedEntryId,
  noBandReasonFor,
  splitFirstSentence,
} from './guidedGroups'
import type { CorroborationReference, GuidedEntry } from './guidedGroups'
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
 *
 * ## What is on screen, and what waits behind the card's one disclosure
 *
 * Always visible, in reading order: the label, the value, a confidence label when caveated, the
 * description, the metric's own caveat; then the scale (or, unbanded, why there is none) with the
 * evidence thumbnail beside it; then the band's provenance — source, population, sample size, and
 * a derived band's label and statement — which the spec requires on screen without a click; then
 * the speed caveat, the FIRST sentence of each mandatory note, and up to three studies of changes.
 *
 * Behind one `<details>`: what a derivation rests on, the band's own note, the population's
 * reported central statistic, corroborating sources, the research links with their summaries, the
 * remaining studies of changes, and the rest of each mandatory note. Every URL renders at most once
 * per card (`cardReferences`).
 */

const BODY = 'font-sans text-sm text-neutral-700 dark:text-neutral-300'
const MUTED = 'font-sans text-sm text-neutral-600 dark:text-neutral-400'
const SECONDARY = 'font-sans text-xs text-neutral-600 dark:text-neutral-400'
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

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

function ExternalLink({ url, children }: { url: string; children: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`font-semibold text-black underline decoration-1 underline-offset-2 hover:decoration-2 dark:text-white ${FOCUS}`}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/** The full citation under a short link text — omitted when the two are the same words. */
function FullTitle({ reference }: { reference: { title: string; shortTitle: string } }) {
  if (reference.title.trim() === reference.shortTitle.trim()) return null
  return <span className={`guided-results__full-title block ${SECONDARY}`}>{reference.title}</span>
}

/** A list of links inside the disclosure, each with its full title, kind and summary. */
function LinkList({
  heading,
  links,
  variant,
}: {
  heading: string
  links: readonly GuidanceLink[]
  variant: 'research' | 'remediation-more'
}) {
  if (links.length === 0) return null
  return (
    <div className={`guided-results__links guided-results__links--${variant} space-y-2`}>
      <h4 className={SUBHEADING}>{heading}</h4>
      <ul className="space-y-3">
        {links.map((link, index) => (
          <li key={`${index}:${link.url}`} className="space-y-0.5">
            <p className={BODY}>
              <ExternalLink url={link.url}>{link.shortTitle}</ExternalLink>
              <FullTitle reference={link} />
            </p>
            <p className={SECONDARY}>{LINK_KIND_LABELS[link.kind]}</p>
            <p className={BODY}>{link.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Source, population and sample size. The source links only when its URL is not already on the card. */
function SourceFields({ source, linked = true }: { source: BandSource; linked?: boolean }) {
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
      <dt className="font-semibold">Source</dt>
      <dd className="mb-1 sm:mb-0">
        {linked ? (
          <ExternalLink url={source.url}>{source.shortTitle}</ExternalLink>
        ) : (
          <span className="font-semibold">{source.shortTitle}</span>
        )}
        <FullTitle reference={source} />
      </dd>
      <dt className="font-semibold">Population</dt>
      <dd className="mb-1 sm:mb-0">{source.population}</dd>
      <dt className="font-semibold">Sample size</dt>
      <dd>{formatSampleSize(source.sampleSize)}</dd>
    </dl>
  )
}

/**
 * The band's provenance, on screen and never behind a disclosure: a band with its citation
 * stripped off is indistinguishable from a number the app invented (spec, "A reference band renders
 * only with its provenance on screen"). A derived band says so here, visibly, with its statement.
 */
function Provenance({ band }: { band: ReferenceBand }) {
  return (
    <div className={`guided-results__provenance space-y-3 ${BODY}`}>
      <h4 className={SUBHEADING}>Where this range comes from</h4>
      <SourceFields source={band.source} />
      {band.derivation !== null && (
        <p className="guided-results__derivation">
          <strong className="guided-results__derived-label">Derived range</strong>
          {': '}
          {band.derivation.statement}
        </p>
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
        <ul className="space-y-1">
          {speed.withinRunner !== null && (
            <li className="guided-results__speed-within">
              <span className="font-semibold">As one runner speeds up: </span>
              {speed.withinRunner}
            </li>
          )}
          {speed.betweenRunners !== null && (
            <li className="guided-results__speed-between">
              <span className="font-semibold">Across different runners: </span>
              {speed.betweenRunners}
            </li>
          )}
        </ul>
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
          <li key={`${index}:${item.plan.base.timestamp}`}>
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

function CorroborationList({ references }: { references: CorroborationReference[] }) {
  if (references.length === 0) return null
  return (
    <div className="guided-results__corroboration space-y-2">
      <h4 className={SUBHEADING}>Other measurements beside this range</h4>
      <ul className="space-y-3">
        {references.map(({ source, linked }, index) => (
          <li key={`${index}:${source.url}`}>
            <SourceFields source={source} linked={linked} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface GuidedMetricCardProps {
  /** A `banded` or `unbanded` entry from `guidedGroups` — never a not-measured one. */
  entry: GuidedEntry
  evidence?: MetricCardEvidence
  clipCount: number
  /**
   * `'framed'` (default) draws the card's own 2 px frame. `'divided'` separates it from the card
   * above with a top rule only — for cards inside a group that is already framed, where a frame
   * per card would nest three borders deep on a phone.
   */
  variant?: 'framed' | 'divided'
}

/**
 * A measured metric's card. With a renderable band it shows the scale and the band's provenance;
 * without one it shows why there is no band. Everything else — value, the metric's own caveat, the
 * speed caveat, mandatory notes, evidence, research and remediation links — renders either way:
 * a band controls whether a SCALE renders, not whether the metric does (design.md D7.6).
 */
export function GuidedMetricCard({
  entry,
  evidence,
  clipCount,
  variant = 'framed',
}: GuidedMetricCardProps) {
  const headingId = useId()
  const { metric, guidance, band } = entry
  const label = METRIC_LABELS[metric.metric]
  const tier = metricTier(metric)
  const value = metric.value
  const scaled = band !== null && value !== null
  const valueText = guidedHeadline(entry, false)
  const references = cardReferences(entry)
  const notes = guidance.mandatoryNotes.map(splitFirstSentence)
  const notesRest = notes.filter((note) => note.rest.length > 0)

  const showsRemediation =
    guidance.remediationIntro !== null || references.visibleRemediation.length > 0
  const hasDisclosure =
    (scaled &&
      ((band.derivation?.restsOn.length ?? 0) > 0 ||
        band.note !== null ||
        band.centralTendency !== null)) ||
    references.corroboration.length > 0 ||
    references.research.length > 0 ||
    references.moreRemediation.length > 0 ||
    notesRest.length > 0
  const sourceCount = references.disclosureSourceCount
  const disclosureSummary = scaled
    ? sourceCount > 0
      ? `How this range was built, and the research (${plural(sourceCount, 'source')})`
      : 'How this range was built'
    : sourceCount > 0
      ? `The research (${plural(sourceCount, 'source')})`
      : 'More on this measurement'

  const frame =
    variant === 'framed'
      ? 'border-2 border-black p-5 dark:border-white'
      : 'border-t-2 border-black pt-5 dark:border-white'

  return (
    <article
      id={guidedEntryId(metric.metric)}
      tabIndex={-1}
      className={`guided-results__card scroll-mt-4 space-y-4 ${frame} ${FOCUS}`}
      aria-labelledby={headingId}
      data-metric={metric.metric}
      data-tier={tier}
    >
      <div className="space-y-1">
        <h3 id={headingId} className="font-display text-lg font-bold tracking-tight">
          {label}
        </h3>
        <p className="guided-results__value font-display text-2xl font-bold">{valueText}</p>
        {tier === 'caveated' && (
          <p className="guided-results__confidence font-sans text-sm">
            <strong>{confidenceLabel(metric)}</strong>
          </p>
        )}
        <p className={`guided-results__description ${BODY}`}>
          {guidance.guidedDescription ?? METRIC_DESCRIPTIONS[metric.metric]}
        </p>
      </div>

      {metric.caveat !== null && (
        <p role="note" className={`guided-results__caveat ${MUTED}`}>
          {metric.caveat}
        </p>
      )}

      <div
        className={`guided-results__reading grid gap-4 ${evidence !== undefined ? 'sm:grid-cols-[1fr_9rem] sm:items-start' : ''}`}
      >
        <div className="min-w-0">
          {scaled ? (
            <div className="guided-results__scale">
              <MetricScale band={band} value={value} label={label} />
            </div>
          ) : (
            <p className={`guided-results__no-band ${BODY}`}>{noBandReasonFor(entry)}</p>
          )}
        </div>
        {evidence !== undefined && <CardEvidence evidence={evidence} clipCount={clipCount} />}
      </div>

      {scaled && <Provenance band={band} />}

      {guidance.speedSensitivity !== null && <SpeedNote speed={guidance.speedSensitivity} />}

      {notes.length > 0 && (
        <div className={`guided-results__notes space-y-2 ${BODY}`}>
          {notes.map((note, index) => (
            <p key={`${index}:${note.first}`} role="note">
              {note.first}
            </p>
          ))}
        </div>
      )}

      {showsRemediation && (
        <div className={`guided-results__links guided-results__links--remediation space-y-2 ${BODY}`}>
          <h4 className={SUBHEADING}>What runners have tried in studies</h4>
          {guidance.remediationIntro !== null && (
            <p className="guided-results__remediation-intro">{guidance.remediationIntro}</p>
          )}
          {references.visibleRemediation.length > 0 && (
            <ul className="space-y-2">
              {references.visibleRemediation.map((link, index) => (
                <li key={`${index}:${link.url}`}>
                  <ExternalLink url={link.url}>{link.shortTitle}</ExternalLink>
                  <FullTitle reference={link} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {hasDisclosure && (
        <details className="guided-results__more border-t border-neutral-300 pt-3 dark:border-neutral-700">
          <summary
            className={`guided-results__more-summary cursor-pointer font-sans text-sm font-semibold text-black dark:text-white ${FOCUS}`}
          >
            {disclosureSummary}
          </summary>
          <div className={`mt-3 space-y-4 ${BODY}`}>
            {scaled && band.derivation !== null && band.derivation.restsOn.length > 0 && (
              <div className="guided-results__derivation-rests-on space-y-2">
                <h4 className={SUBHEADING}>What the derived range rests on</h4>
                <ul className="list-disc space-y-1 pl-5">
                  {band.derivation.restsOn.map((definition, index) => (
                    <li key={`${index}:${definition}`}>{definition}</li>
                  ))}
                </ul>
              </div>
            )}
            {scaled && band.note !== null && (
              <p className="guided-results__band-note">{band.note}</p>
            )}
            {scaled && band.centralTendency !== null && (
              <p className="guided-results__central-tendency">
                {band.centralTendency.label}:{' '}
                {formatBandValue(band.centralTendency.value, band.unit)}
              </p>
            )}
            <CorroborationList references={references.corroboration} />
            <LinkList heading="What the research says" links={references.research} variant="research" />
            <LinkList
              heading="More that runners have tried in studies"
              links={references.moreRemediation}
              variant="remediation-more"
            />
            {notesRest.length > 0 && (
              <div className="guided-results__notes-more space-y-2">
                <h4 className={SUBHEADING}>The notes above, continued</h4>
                {notesRest.map((note, index) => (
                  <p key={`${index}:${note.first}`}>{note.rest}</p>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </article>
  )
}

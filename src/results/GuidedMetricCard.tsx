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
import { EvidenceFrame } from './EvidenceFrame'
import { provenanceFor } from './evidenceCaptions'
import { guidedHeadlineParts } from './formatGuidedValue'
import {
  cardReferences,
  citationParts,
  guidedEntryId,
  joinList,
  noBandReasonFor,
  noteLead,
  splitFirstSentence,
  tryLineApplies,
} from './guidedGroups'
import type {
  CorroborationReference,
  GuidedEntry,
  LinkReference,
} from './guidedGroups'
import {
  METRIC_LABELS,
  confidenceLabel,
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
 * The card leads with one headline — the value, and beside it where that value sits, in the band's
 * own words. Then: a "Varies with pace" tag where speed moves the metric, a confidence label when
 * caveated, one sentence saying what the metric is, the metric's own caveat, the scale with the
 * evidence thumbnail beside it, one citation line naming the source, its population in short and its
 * sample size (and "derived" where the band is arithmetic), the first sentence of each mandatory
 * note, and at most one optional experiment line.
 *
 * Behind one `<details>`: the speed caveat in full, the source's own full population sentence, what
 * a derivation says and rests on, the band's own note, the population's central statistic, the rest
 * of an unbanded card's reason for having no range, the rest of each mandatory note, corroborating
 * sources, the research links, and every study of a change — the Try link among them, as text, which
 * is how its kind, summary and full citation reach the card. Every URL is an anchor at most once per
 * card, and every link's kind and summary reach the card somewhere (`cardReferences`).
 *
 * ## What moved there, and what did not
 *
 * Everything on the left of the reading grid sits in ONE column — scale, citation, notes, Try line —
 * because the right column is a fixed-width thumbnail and prose under it reads as a second column
 * that is mostly blank.
 *
 * What did NOT move is the attribution — who published the band, over roughly whom, at what sample
 * size, and whether this system did arithmetic on them — because that is what makes a band a sourced
 * fact rather than an assertion (declutter-guided-results-view design.md D1, which narrows the
 * original always-visible rule deliberately rather than dropping it). Nor, after review, did the
 * description: it left banded cards in the first pass of that change and came back, because a scale
 * says where a number sits and nothing on the card said what the number was.
 *
 * ## The one line that can be withheld
 *
 * A `Try:` line names a change in one direction, so it renders only where that direction is not
 * already past the band — `tryLineApplies`. A card can therefore carry a `tryLine` in its guidance
 * and show none, and that is the runner's reading rather than a missing record.
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

/** `860` reads as `n = 860`; anything that is not a bare count ("Not published") renders as stored. */
function formatSampleSize(sampleSize: string): string {
  return /^\d[\d,]*$/.test(sampleSize.trim())
    ? `n = ${sampleSize.trim()}`
    : sampleSize
}

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

export function ExternalLink({ url, children }: { url: string; children: string }) {
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
function FullTitle({
  reference,
}: {
  reference: { title: string; shortTitle: string }
}) {
  if (reference.title.trim() === reference.shortTitle.trim()) return null
  return (
    <span className={`guided-results__full-title block ${SECONDARY}`}>
      {reference.title}
    </span>
  )
}

/**
 * A list of links inside the disclosure, each with its full title, kind and summary. A link whose
 * URL is already an anchor higher on the card shows its short title as text instead of a second
 * anchor, and keeps its kind and summary.
 */
function LinkList({
  heading,
  intro,
  links,
  variant,
}: {
  heading: string
  intro?: string | null
  links: readonly LinkReference[]
  variant: 'research' | 'remediation-more'
}) {
  if (links.length === 0) return null
  return (
    <div
      className={`guided-results__links guided-results__links--${variant} space-y-2`}
    >
      <h4 className={SUBHEADING}>{heading}</h4>
      {intro !== undefined && intro !== null && (
        <p className="guided-results__remediation-intro">{intro}</p>
      )}
      <ul className="space-y-3">
        {links.map(({ link, linked }, index) => (
          <li key={`${index}:${link.url}`} className="space-y-0.5">
            <p className={BODY}>
              {linked ? (
                <ExternalLink url={link.url}>{link.shortTitle}</ExternalLink>
              ) : (
                <span className="guided-results__unlinked-title font-semibold text-black dark:text-white">
                  {link.shortTitle}
                </span>
              )}
              <FullTitle reference={link} />
            </p>
            <p className={`guided-results__link-kind ${SECONDARY}`}>
              {LINK_KIND_LABELS[link.kind]}
            </p>
            <p className="guided-results__link-summary">{link.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Source, population and sample size. The source links only when its URL is not already on the card. */
function SourceFields({
  source,
  linked = true,
}: {
  source: BandSource
  linked?: boolean
}) {
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
 * The band's attribution, as one visible line: `Malisoux et al. 2023 · recreational runners ·
 * n = 860`, or `Garmin fenix 7 manual · population not stated · sample size not published ·
 * derived`.
 *
 * This is what the spec requires on screen without expanding, and it is the only place the band's
 * source URL is an anchor. The fields come from `citationParts`, so the line a test reads through
 * `citationText` and the line rendered here cannot disagree.
 */
function CitationLine({ band }: { band: ReferenceBand }) {
  const [shortTitle, ...rest] = citationParts(
    band.source,
    band.derivation !== null,
  )
  return (
    <p className={`guided-results__citation ${SECONDARY}`}>
      <ExternalLink url={band.source.url}>{shortTitle}</ExternalLink>
      {rest.map((part) => (
        <span key={part}>
          {' · '}
          {part}
        </span>
      ))}
    </p>
  )
}

/**
 * The speed caveat in full. The card shows a "Varies with pace" tag beside the value, so the tag —
 * not this — is what the spec requires visible; the two halves below are two further paragraphs of
 * research prose and sit in the disclosure. They are kept apart because they are different claims:
 * an effect within one runner as their own pace changes is not a correlation between runners.
 *
 * Rendered only where the guidance records a speed dependence — a `null` there is an absence of
 * evidence, and rendering nothing is what keeps the tag meaningful where it does appear.
 */
function SpeedNote({ speed }: { speed: SpeedSensitivity }) {
  return (
    <div role="note" className={`guided-results__speed space-y-2 ${BODY}`}>
      <h4 className={SUBHEADING}>Running speed</h4>
      <p>{speed.summary}</p>
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
  onOpenEvidenceVideo,
}: {
  evidence: MetricCardEvidence
  clipCount: number
  onOpenEvidenceVideo?: (clipIndex: number, timestamp: number, returnFocus: HTMLButtonElement | null) => void
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
            <EvidenceFrame item={item} clipLabel={`clip ${evidence.clipIndex + 1} of ${clipCount}`} onOpenVideo={onOpenEvidenceVideo ? (returnFocus) => onOpenEvidenceVideo(evidence.clipIndex, item.plan.base.timestamp, returnFocus) : undefined} />
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

function CorroborationList({
  references,
}: {
  references: CorroborationReference[]
}) {
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

/**
 * The one studied change this card shows, conditional on a deliberate goal. A measured value by
 * itself is not a reason to change gait.
 *
 * The text states a change from the runner's own value and names no value to reach — the guidance
 * test enforces both, and that the link is one of this metric's own recorded studies of changes.
 * The study's kind, summary and full citation are in the disclosure, where it renders again as text.
 */
function TryLine({
  text,
  link,
  cadence,
}: {
  text: string
  link: GuidanceLink
  cadence: boolean
}) {
  return (
    <p className={`guided-results__try ${BODY}`}>
      <span className="font-semibold text-black dark:text-white">
        {cadence
          ? 'If you choose to raise step rate: '
          : 'If you choose to change your form: '}
      </span>
      {text}
      {/*
        ` · ` and the card's own attribution size, not an em dash at body size: the stored text can
        itself contain an em dash (`… own step rate — the most-studied …` did), and a second one
        appended here read as another clause of the instruction rather than as its citation. The
        middot is the separator this card already uses for attribution, on the citation line.
      */}
      <span className={`guided-results__try-source ${SECONDARY}`}>
        {' · '}
        <ExternalLink url={link.url}>{link.shortTitle}</ExternalLink>
      </span>
    </p>
  )
}

export interface GuidedMetricCardProps {
  /** A `banded` or `unbanded` entry from `guidedGroups` — never a not-measured one. */
  entry: GuidedEntry
  evidence?: MetricCardEvidence
  clipCount: number
  sourceLabel?: string
  onOpenEvidenceVideo?: (clipIndex: number, timestamp: number, returnFocus: HTMLButtonElement | null) => void
  /**
   * What the headline value was derived from, as one line under it (a composite reading's
   * `formatBounceDerivation`). Plain text, not `sr-only`: it is part of the reading.
   */
  derivation?: string
}

/**
 * A measured metric's card. With a renderable band it shows the scale and the band's citation line;
 * without one it shows its description and why there is no band. Everything else — value, the
 * metric's own caveat, the pace tag, mandatory notes, evidence, the Try line, research and
 * remediation links — renders either way: a band controls whether a SCALE renders, not whether the
 * metric does (design.md D7.6).
 */
export function GuidedMetricCard({
  entry,
  evidence,
  clipCount,
  sourceLabel,
  onOpenEvidenceVideo,
  derivation,
}: GuidedMetricCardProps) {
  const headingId = useId()
  const { metric, guidance, band } = entry
  const label = METRIC_LABELS[metric.metric]
  const tier = metricTier(metric)
  const value = metric.value
  const scaled = band !== null && value !== null
  const headline = guidedHeadlineParts(entry)
  const references = cardReferences(entry)
  const notes = guidance.mandatoryNotes.map(splitFirstSentence)
  const notesRest = notes.filter((note) => note.rest.length > 0)
  const speed = guidance.speedSensitivity
  // The same first-sentence rule the notes get, for the same reason: the lead answers "why is there
  // no bar here" and the rest is the literature review behind that answer. `overstriding`'s ran to
  // 101 words rendered whole, on the card that had the most to read already.
  const noBand = scaled ? null : splitFirstSentence(noBandReasonFor(entry))
  const showsTry = tryLineApplies(entry) && references.tryLink !== null

  const hasResearch =
    references.corroboration.length > 0 ||
    references.research.length > 0 ||
    references.moreRemediation.length > 0
  const hasNotes = notesRest.length > 0
  const sourceCount = references.disclosureSourceCount
  const count = sourceCount > 0 ? ` (${plural(sourceCount, 'source')})` : ''
  // The summary names what is inside, in the order the disclosure renders it, so a reader can tell
  // whether opening it will answer the question they have.
  const summaryParts = [
    ...(speed !== null ? ['pace'] : []),
    ...(scaled ? ['how this range was built'] : []),
    // Same slot, and mutually exclusive with it: a card either has a range to explain or has an
    // absence to explain. Named in the summary so the continuation cannot end up behind a
    // disclosure that does not exist — `kneeDrive` and `armSwingAmplitude` have no notes, no speed
    // sensitivity and, on a clip that measures them, nothing else to open.
    ...(noBand !== null && noBand.rest.length > 0
      ? ['why there is no range']
      : []),
    ...(hasNotes ? ['notes'] : []),
    ...(hasResearch ? ['research'] : []),
  ]
  const hasDisclosure = summaryParts.length > 0
  const joined = joinList(summaryParts)
  const disclosureSummary = hasDisclosure
    ? `${joined.charAt(0).toUpperCase()}${joined.slice(1)}${count}`
    : 'More on this measurement'

  return (
    <article
      id={guidedEntryId(metric.metric)}
      tabIndex={-1}
      className={`guided-results__card scroll-mt-4 space-y-4 border-t-2 border-black pt-5 dark:border-white ${FOCUS}`}
      aria-labelledby={headingId}
      data-metric={metric.metric}
      data-motion-metric={metric.metric}
      data-tier={tier}
    >
      <div className="space-y-1">
        <h3
          id={headingId}
          className="font-display text-lg font-bold tracking-tight"
        >
          {label}
        </h3>
        <p className="guided-results__headline flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="guided-results__value font-display text-2xl font-bold">
            {headline.value}
          </span>
          {headline.position !== null && (
            <span
              className={`guided-results__position font-sans text-base ${BODY}`}
            >
              {/*
                Hidden below `sm`: at 390 px the position wraps onto its own line and a leading `· `
                reads as a bullet point. Where they share a line it still separates them; where they
                do not, the value's own type size already does.
              */}
              <span aria-hidden="true" className="hidden sm:inline">
                {'· '}
              </span>
              {headline.position}
            </span>
          )}
          {speed !== null && (
            <span
              className={`guided-results__pace-tag shrink-0 border border-neutral-500 px-1.5 py-0.5 font-sans text-[11px] font-semibold uppercase tracking-wide dark:border-neutral-400 ${SECONDARY}`}
            >
              Varies with pace
            </span>
          )}
        </p>
        {derivation !== undefined && (
          <p className={`guided-results__derived-from tabular-nums ${MUTED}`}>{derivation}</p>
        )}
        {sourceLabel && <p className="font-sans text-xs font-semibold text-neutral-600 dark:text-neutral-400">Measured from {sourceLabel}</p>}
        {tier === 'caveated' && (
          <p className="guided-results__confidence font-sans text-sm">
            <strong>{confidenceLabel(metric)}</strong>
          </p>
        )}
        {/*
          On EVERY card, banded or not. This change originally dropped it from a banded one, on the
          reasoning that a scale, a headline naming the zone and a citation line have already said
          what the metric is. They have not: "110° · within the range shown" never says 110° of
          what, and `verticalRatio`'s headline is a percentile of a ratio the reader has not been
          told the terms of. The scale says where the number sits; only this says what the number is.
        */}
        <p className={`guided-results__description ${BODY}`}>
          {guidance.guidedDescription ?? METRIC_DESCRIPTIONS[metric.metric]}
        </p>
      </div>

      {metric.caveat !== null && (
        <p role="note" className={`guided-results__caveat ${MUTED}`}>
          {metric.caveat}
        </p>
      )}

      {/*
        The evidence thumbnail is a fixed 9 rem column, and the scale beside it is at most ~120 px of
        text and a track — so everything after the scale goes in the LEFT column rather than under
        the grid, where it used to leave 100–250 px of blank paper beside the thumbnail on a desktop
        and nothing at all to read there.
      */}
      <div
        className={`guided-results__reading grid gap-4 ${evidence !== undefined ? 'sm:grid-cols-[1fr_9rem] sm:items-start' : ''}`}
      >
        <div className="min-w-0 space-y-3">
          {scaled ? (
            <>
              <div className="guided-results__scale">
                <MetricScale band={band} value={value} label={label} />
              </div>
              <CitationLine band={band} />
            </>
          ) : (
            <p className={`guided-results__no-band ${BODY}`}>
              {noBand?.first}
              {noBand !== null && noBand.rest.length > 0 && (
                <span className="sr-only">
                  {' '}
                  (continued under “{disclosureSummary}”)
                </span>
              )}
            </p>
          )}

          {notes.length > 0 && (
            <div className={`guided-results__notes space-y-2 ${BODY}`}>
              {notes.map((note, index) => (
                <p key={`${index}:${note.first}`} role="note">
                  {note.first}
                  {note.rest.length > 0 && (
                    <span className="sr-only">
                      {' '}
                      (continued under “{disclosureSummary}”)
                    </span>
                  )}
                </p>
              ))}
            </div>
          )}

          {showsTry && (
            <TryLine
              text={guidance.tryLine!.text}
              link={references.tryLink!}
              cadence={metric.metric === 'cadence'}
            />
          )}
        </div>
        {evidence !== undefined && (
          <CardEvidence evidence={evidence} clipCount={clipCount} onOpenEvidenceVideo={onOpenEvidenceVideo} />
        )}
      </div>

      {hasDisclosure && (
        <details className="guided-results__more border-t border-neutral-300 pt-3 dark:border-neutral-700">
          <summary
            className={`guided-results__more-summary cursor-pointer py-1 font-sans text-sm font-semibold text-black dark:text-white ${FOCUS}`}
          >
            {disclosureSummary}
          </summary>
          <div className={`mt-3 space-y-4 ${BODY}`}>
            {speed !== null && <SpeedNote speed={speed} />}
            {scaled && (
              <div className="guided-results__provenance space-y-3">
                <h4 className={SUBHEADING}>Where this range comes from</h4>
                {/* The source's URL is already the citation line's anchor, so this is text. */}
                <SourceFields source={band.source} linked={false} />
                {band.derivation !== null && (
                  <>
                    <p className="guided-results__derivation">
                      <strong className="guided-results__derived-label">
                        Derived range
                      </strong>
                      {': '}
                      {band.derivation.statement}
                    </p>
                    {band.derivation.restsOn.length > 0 && (
                      <div className="guided-results__derivation-rests-on space-y-2">
                        <h4 className={SUBHEADING}>
                          What the derived range rests on
                        </h4>
                        <ul className="list-disc space-y-1 pl-5">
                          {band.derivation.restsOn.map((definition, index) => (
                            <li key={`${index}:${definition}`}>{definition}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
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
            {noBand !== null && noBand.rest.length > 0 && (
              <div className="guided-results__no-band-more space-y-2">
                <h4 className={SUBHEADING}>Why there is no range</h4>
                <p>{noBand.rest}</p>
              </div>
            )}
            {hasNotes && (
              <div className="guided-results__notes-more space-y-2">
                <h4 className={SUBHEADING}>The notes above, continued</h4>
                {notesRest.map((note, index) => (
                  <div
                    key={`${index}:${note.first}`}
                    className="guided-results__note-rest space-y-1"
                  >
                    <p className="guided-results__note-rest-label font-semibold text-black dark:text-white">
                      Continued — “{noteLead(note.first)}”
                    </p>
                    <p>{note.rest}</p>
                  </div>
                ))}
              </div>
            )}
            <CorroborationList references={references.corroboration} />
            <LinkList
              heading="What the research says"
              links={references.research}
              variant="research"
            />
            <LinkList
              heading="More research on changing this"
              intro={guidance.remediationIntro}
              links={references.moreRemediation}
              variant="remediation-more"
            />
          </div>
        </details>
      )}
    </article>
  )
}

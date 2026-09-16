import type {
  FormHeuristicsResult,
  MetricId,
  MetricResult,
} from '../heuristics/types'
import { locateInBand } from '../guidance/bandPosition'
import { METRIC_GUIDANCE } from '../guidance/metricGuidance'
import type {
  BandSource,
  GuidanceLink,
  MetricGuidance,
  ReferenceBand,
} from '../guidance/types'
import { metricTier } from './metricConfidence'
import type { ScalePassStatus } from './types'

/**
 * How the guided results view partitions and orders the twelve metrics.
 *
 * Pure, so the page's structure is decided somewhere a test can read it without rendering. Three
 * groups, by what can honestly be said about each metric on this clip (guided-results-view spec,
 * "The guided view ranks metrics into three groups"):
 *
 * 1. **`banded`** — measured, and its guidance carries a reference band that can be rendered WITH
 *    its provenance. Shown expanded, each against its scale.
 * 2. **`unbanded`** — measured, with no renderable band. Shown collapsed, with its value, its notes,
 *    its links and the reason there is no band. Only the SCALE is withheld (design.md D7.6).
 * 3. **`notMeasured`** — `metricTier(metric) === 'excluded'`: nothing measured, or the camera
 *    geometry cannot support the measurement. Shown collapsed, with why and a capture hint.
 *
 * **Order within every group is `displayRank` and nothing else** — a fixed property of the guidance
 * data, never of the runner's value or of the result's confidence. Ranking by the runner's own
 * numbers would make the page's layout a judgement about the runner (design.md D2, D7.8).
 */

export interface GuidedEntry {
  metric: MetricResult
  guidance: MetricGuidance
  /**
   * The band this entry renders against, or `null`. Non-null exactly for the `banded` group, and
   * never a band whose provenance is incomplete — see `renderableBand`.
   */
  band: ReferenceBand | null
}

export interface GuidedGroups {
  banded: GuidedEntry[]
  unbanded: GuidedEntry[]
  notMeasured: GuidedEntry[]
}

function isFilled(text: string): boolean {
  return text.trim().length > 0
}

/**
 * All five provenance fields present and non-blank.
 *
 * `populationShort` counts because it is the population statement that actually REACHES the screen
 * without expanding, which is what the spec's rule is about; `population` counts too, because a
 * short form with nothing behind it is an attribution the reader cannot check.
 */
export function sourceHasProvenance(
  source: BandSource | null | undefined,
): boolean {
  return (
    source !== null &&
    source !== undefined &&
    isFilled(source.title ?? '') &&
    isFilled(source.url ?? '') &&
    isFilled(source.population ?? '') &&
    isFilled(source.populationShort ?? '') &&
    isFilled(source.sampleSize ?? '')
  )
}

/**
 * The guidance's band if it can be shown with its source, population and sample size, else `null`.
 *
 * The type makes all four fields required, so no shipped band fails this. It is checked at runtime
 * anyway because the spec's rule is about what reaches the screen, not about what compiles: "a
 * band with its provenance stripped off is indistinguishable from a number the app invented", and
 * a blank string satisfies the type while stripping exactly that. A band that fails renders no
 * scale at all, and its metric falls to the unbanded group rather than disappearing.
 */
export function renderableBand(guidance: MetricGuidance): ReferenceBand | null {
  const { band } = guidance
  if (band === null) return null
  return sourceHasProvenance(band.source) ? band : null
}

/**
 * Partitions a heuristics result into the three guided groups.
 *
 * `guidance` defaults to the shipped record and is a parameter only so a test can prove the order
 * follows `displayRank` rather than the record's key order, and that an unattributable band is
 * withheld.
 */
export function guidedGroups(
  heuristics: FormHeuristicsResult,
  guidance: Record<MetricId, MetricGuidance> = METRIC_GUIDANCE,
): GuidedGroups {
  const entries: GuidedEntry[] = (Object.keys(guidance) as MetricId[])
    .map((id) => ({
      metric: heuristics[id] as MetricResult,
      guidance: guidance[id],
      band: renderableBand(guidance[id]),
    }))
    .sort((a, b) => a.guidance.displayRank - b.guidance.displayRank)

  const groups: GuidedGroups = { banded: [], unbanded: [], notMeasured: [] }
  for (const entry of entries) {
    if (metricTier(entry.metric) === 'excluded') {
      groups.notMeasured.push({ ...entry, band: null })
    } else if (entry.band !== null) {
      groups.banded.push(entry)
    } else {
      groups.unbanded.push(entry)
    }
  }
  return groups
}

/**
 * Why a not-measured metric was not measured, in the words the classic panel already uses.
 *
 * ⚠️ **A deliberate copy of the `hint` expression in `MetricsPanel.tsx`'s excluded list, and of
 * `ExcludedEntry`'s fallback chain**, strings included, because that file is not to be edited by
 * this change (design.md D7.2) and a reader switching views should read the same reason in both.
 * The two centimetre metrics are grafted from the background scale pass, so while it runs their
 * availability caveat ("no scale could be measured") is not yet the truth, and after it fails the
 * caveat alone would imply the capability is absent when the app just tried it. Null value only:
 * the one non-null excluded shape is an unsuitable view, whose own caveat is the accurate reason.
 */
export function notMeasuredReason(
  metric: MetricResult,
  scalePassStatus: ScalePassStatus,
): string {
  const scalePassInProgress =
    scalePassStatus === 'pending' || scalePassStatus === 'running'
  const hint =
    (metric.metric === 'verticalOscillationCm' ||
      metric.metric === 'stepWidthCm') &&
    metric.value === null
      ? scalePassInProgress
        ? 'Measuring real-world scale with a second look at the clip…'
        : scalePassStatus === 'failed'
          ? "A second look at the clip couldn't measure real-world scale."
          : undefined
      : undefined
  return hint ?? metric.caveat ?? 'Not measurable for this clip.'
}

/**
 * The reason shown for a measured metric whose guidance HAS a band that was withheld because its
 * provenance is incomplete (see `renderableBand`). Deliberately says nothing about the literature:
 * "no published range exists" would be false of a metric that has one.
 */
export const WITHHELD_BAND_REASON =
  "A range exists for this measurement but its source details are incomplete, so it isn't shown."

/** True for a measured entry that sits without a scale only because its band's provenance failed. */
export function bandWithheld(entry: GuidedEntry): boolean {
  return entry.band === null && entry.guidance.band !== null
}

/** Why a measured, unscaled entry has no scale: the guidance's own reason, or the neutral one. */
export function noBandReasonFor(entry: GuidedEntry): string {
  if (bandWithheld(entry)) return WITHHELD_BAND_REASON
  return entry.guidance.noBandReason ?? WITHHELD_BAND_REASON
}

/**
 * Whether this entry's Try line would point the runner further out of the band they are outside.
 *
 * A Try line names a change in one direction — `tryLine.direction`, which is which way it moves the
 * quantity THIS card reports. Rendered unconditionally, `verticalOscillationCm` reads 4.4 cm on this
 * repo's own side-view clip, below a 6.0–9.5 cm band, under a line saying to stay lower still.
 *
 * Withheld only where the value is genuinely PAST the band on the matching side. Inside the band, in
 * one of the source table's published gaps, or on a metric with no band at all, it renders: those
 * are not positions a direction can be wrong about. Note an open-ended outer zone (cadence's `<153`,
 * `>183`) is INSIDE the band by construction — `locateInBand` never reports `outside` for a value
 * such a zone contains — so cadence's line is never withheld, which is correct: a runner above
 * Garmin's 95th percentile is in the band's top zone, not past its end.
 */
export function tryLineApplies(entry: GuidedEntry): boolean {
  const { tryLine } = entry.guidance
  if (tryLine === null) return false
  const { band } = entry
  const value = entry.metric.value
  if (band === null || value === null) return true
  const position = locateInBand(band, value)
  if (position.kind !== 'outside') return true
  return position.side !== (tryLine.direction === 'lower' ? 'below' : 'above')
}

/**
 * The capture hint for a not-measured entry, chosen by CAUSE: an unsuitable camera angle gets the
 * angle advice, anything else (too little usable data, a failed scale pass) gets the other.
 */
export function captureHintFor(entry: GuidedEntry): string {
  return entry.metric.viewFit === 'unsuitable'
    ? entry.guidance.captureHints.wrongAngle
    : entry.guidance.captureHints.notEnoughData
}

/**
 * The element id a card or not-measured entry carries, and the fragment the contents list links
 * to. Plain and deterministic rather than `useId`, so a `#guided-results-cadence` link can be
 * shared. Only one results view is ever mounted, so the ids cannot collide with a sibling view.
 */
export function guidedEntryId(metric: MetricId): string {
  return `guided-results-${metric}`
}

/**
 * Abbreviations whose trailing full stop does not end a sentence: `et al.`, `e.g.`, `i.e.`, `vs.`,
 * `cf.`, `approx.`, `Fig.`, `No.`, and a single capital initial (`J. Daniels`).
 */
const NON_TERMINAL_ABBREVIATION =
  /(?:\bet al|\be\.g|\bi\.e|\bvs|\bcf|\bapprox|\bFig|\bNo|\b[A-Z])\.$/

/**
 * Splits a note into its first sentence and the rest, both trimmed. A sentence ends at `.`, `!` or
 * `?` (optionally followed by a closing quote or bracket) followed by whitespace and then a capital
 * letter, a digit or an opening quote — and not after one of the abbreviations above. A decimal
 * point (`9.2`) is never followed by whitespace, so it never splits. Text with no second sentence
 * returns it whole with an empty `rest`.
 */
export function splitFirstSentence(text: string): {
  first: string
  rest: string
} {
  const boundary = /[.!?]["”’)\]]?\s+(?=["“‘(]?[A-Z0-9])/g
  for (
    let match = boundary.exec(text);
    match !== null;
    match = boundary.exec(text)
  ) {
    const end = match.index + match[0].trimEnd().length
    const candidate = text.slice(0, end)
    if (NON_TERMINAL_ABBREVIATION.test(candidate)) continue
    return { first: candidate.trim(), rest: text.slice(end).trim() }
  }
  return { first: text.trim(), rest: '' }
}

/** A corroborating source, and whether its URL is still unrendered on the card at that point. */
export interface CorroborationReference {
  source: BandSource
  /** `false` when the same URL already rendered higher on the card: shown as text, not a link. */
  linked: boolean
}

/** A research or studies-of-changes link inside the disclosure, and whether it is still unlinked. */
export interface LinkReference {
  link: GuidanceLink
  /**
   * `false` when the same URL already rendered as a link higher on the card — typically a research
   * link that is also the band's source or a corroborating source. Its title then shows as text,
   * and its kind and summary still render: they say something the other mention of that URL does not.
   */
  linked: boolean
}

/**
 * Every outbound reference a card renders, already placed and de-duplicated.
 *
 * **Each URL is an anchor at most once per card**, in the order a reader meets them: the band's
 * source (visible, in the citation line), then the one studied change the guidance names as this
 * card's Try line (visible), then — inside the card's disclosure — corroborating sources, research
 * links and every study of a change, the Try link included.
 *
 * **No link is dropped for sharing a URL.** Every link's kind and summary reach the card (design.md
 * D7.11): a later mention of a URL that already rendered keeps its text and loses only the second
 * anchor. That is how the Try link's own kind, summary and full citation reach the card — it is in
 * `remediation`, so it comes back in `moreRemediation` with `linked: false`. The one thing skipped
 * is an exact repeat — same URL, kind and summary as a link already placed — because every word of
 * it is already on the card. (No shipped metric lists the same link under both `research` and
 * `remediation`; the entries say so, and it is that rule this check enforces.)
 */
export interface CardReferences {
  /**
   * The one studied change shown on screen: the `remediation` link the guidance's `tryLine` names.
   * `null` where the guidance names none, or names a URL this metric's own `remediation` does not
   * carry — which the guidance test rejects outright, so a `null` here is the metric having no Try
   * line rather than a lookup failing silently.
   */
  tryLink: GuidanceLink | null
  corroboration: CorroborationReference[]
  research: LinkReference[]
  /** Every study of a change, for the disclosure — the Try link among them, as text. */
  moreRemediation: LinkReference[]
  /** Distinct URLs linked inside the disclosure — the "(N sources)" count. */
  disclosureSourceCount: number
}

export function cardReferences(entry: GuidedEntry): CardReferences {
  const rendered = new Set<string>()
  const claim = (url: string): boolean => {
    if (rendered.has(url)) return false
    rendered.add(url)
    return true
  }
  if (entry.band !== null) claim(entry.band.source.url)

  const { tryLine, remediation, research: researchLinks } = entry.guidance
  let tryLink =
    tryLine === null
      ? null
      : (remediation.find((link) => link.url === tryLine.url) ?? null)
  // Claimed but deliberately NOT `placed`: the disclosure renders this same link again, as text,
  // which is where its kind, summary and full citation reach the card.
  //
  // The claim's RESULT decides whether the Try line renders at all. No shipped metric names a Try
  // study whose URL is also its band's source, so today this never fires — which is exactly why it
  // has to be structural rather than left to that staying true: the alternative is a card that
  // anchors one URL twice, silently, the first time a record pairs them.
  if (tryLink !== null && !claim(tryLink.url)) tryLink = null

  const before = rendered.size
  const placed: GuidanceLink[] = []
  const corroboration = (entry.band?.corroboration ?? []).map((source) => ({
    source,
    linked: claim(source.url),
  }))
  const place = (links: readonly GuidanceLink[]): LinkReference[] =>
    links.flatMap((link) => {
      const repeat = placed.some(
        (other) =>
          other.url === link.url &&
          other.kind === link.kind &&
          other.summary === link.summary,
      )
      if (repeat) return []
      placed.push(link)
      return [{ link, linked: claim(link.url) }]
    })
  const research = place(researchLinks)
  const moreRemediation = place(remediation)

  return {
    tryLink,
    corroboration,
    research,
    moreRemediation,
    disclosureSourceCount: rendered.size - before,
  }
}

/**
 * The visible citation line's fields, in order — `["Malisoux et al. 2023", "recreational runners",
 * "n = 860"]`, or `["Garmin fenix 7 manual", "population and sample size not published",
 * "derived"]`.
 *
 * Returned as parts rather than one string because the view anchors the first one and joins the
 * rest, and {@link citationText} joins the identical parts for a test — so the two cannot disagree
 * about what the line says.
 *
 * This is the whole of what the spec requires on screen without expanding: whose numbers, over
 * roughly whom, at what size, and whether this system did arithmetic on them. The source's own full
 * population sentence and the derivation's statement sit in the card's disclosure
 * (declutter-guided-results-view design.md D1).
 */
export function citationParts(source: BandSource, derived: boolean): string[] {
  const size = source.sampleSize.trim()
  const counted = /^\d[\d,]*$/.test(size)
  // A bare count reads as `n = 860`. Anything else is a sentence about the absence of one, and is
  // labelled so it cannot be read as a population: "Not published" alone would be ambiguous on a
  // line whose previous field is a population.
  const sampleSize = counted
    ? `n = ${size}`
    : `sample size ${size.charAt(0).toLowerCase()}${size.slice(1)}`
  // Where NEITHER field states a fact, they are one fact: that this source published neither.
  // `Garmin fenix 7 manual · population not stated · sample size not published · derived` spends
  // more than half a line, and the reader's whole attention, on two adjacent negations — and a
  // reader scanning fields reads the second one as a further finding rather than as the same
  // silence restated. The predicate is deliberately narrow: an absent population is written in this
  // record as `population not …`, and an absent sample size is anything that is not a count.
  const parts =
    !counted && /^population not\b/i.test(source.populationShort.trim())
      ? [source.shortTitle, 'population and sample size not published']
      : [source.shortTitle, source.populationShort, sampleSize]
  if (derived) parts.push('derived')
  return parts
}

/** {@link citationParts} as the one line it renders as. */
export function citationText(source: BandSource, derived: boolean): string {
  return citationParts(source, derived).join(' · ')
}

/** A first sentence this many words long or shorter is quoted whole by {@link noteLead}. */
const NOTE_LEAD_WHOLE_WORDS = 8
/** How many words {@link noteLead} keeps of a longer first sentence. */
const NOTE_LEAD_WORDS = 6

/**
 * The first few words of a note, to label where its continuation picks up: the whole first sentence
 * when it is short ("180 steps per minute is not a target."), otherwise its first words and an
 * ellipsis ("About 8 in 10 distance runners…").
 */
export function noteLead(first: string): string {
  const words = first.trim().split(/\s+/).filter(Boolean)
  if (words.length <= NOTE_LEAD_WHOLE_WORDS) return words.join(' ')
  return `${words
    .slice(0, NOTE_LEAD_WORDS)
    .join(' ')
    .replace(/[,;:—–-]+$/, '')}…`
}

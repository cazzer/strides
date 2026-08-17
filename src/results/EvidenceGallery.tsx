import { useEffect, useRef, useState } from 'react'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { extractSessionEvidence } from '../video/extractFrames'
import type {
  ClipEvidence,
  ClipEvidenceInput,
  ExtractedEvidenceFrame,
  MetricEvidence,
} from '../video/extractFrames'
import { planClipEvidence, summarizeEvidenceCoverage } from './evidenceFrames'
import type {
  ClipEvidencePlan,
  EvidenceCoverageClip,
  EvidenceFramePlan,
  EvidenceFrameSize,
  MetricEvidencePlan,
} from './evidenceFrames'
import { METRIC_LABELS } from './metricConfidence'
import type { ClipSession } from './multiClipAnalysis'

/**
 * Prefix of every gallery section's DOM id, shared with `MetricsPanel`'s "See evidence" deep link
 * so the anchor and its target cannot drift apart. A metric's section is
 * `` `${EVIDENCE_SECTION_ID_PREFIX}${metricId}` ``.
 */
export const EVIDENCE_SECTION_ID_PREFIX = 'evidence-'

/** One metric's worth of gallery: the images, and which clip they were pulled from. */
export interface EvidenceSection {
  metric: MetricId
  /** Index into the session's clips — the clip `fusionSourceIndices` says won this metric. */
  clipIndex: number
  items: ExtractedEvidenceFrame[]
}

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

/** What one clip's plan is derived from. Compared by reference, field by field, to decide whether
 * a clip already extracted is still the same clip. */
interface ClipEvidenceInputs {
  clipId: string
  heuristics: FormHeuristicsResult
  frames: RobustPoseFrame[]
  frameSize: EvidenceFrameSize
  sourceBlob: Blob | null
}

type GalleryState =
  | { status: 'idle' }
  | { status: 'extracting' }
  | { status: 'settled'; sections: EvidenceSection[] }

const IDLE_STATE: GalleryState = { status: 'idle' }
const EXTRACTING_STATE: GalleryState = { status: 'extracting' }
const NO_METRICS: ReadonlySet<MetricId> = new Set()

/** One clip's extraction cache entry: what it was extracted from, and what came out. */
interface CachedClipEvidence {
  inputs: ClipEvidenceInputs
  evidence: ClipEvidence
}

/**
 * Everything one clip's plan needs, or `null` when any clip is missing a piece. `sourceIndices`
 * being non-null already guarantees every clip is `'ready'` (and so has `heuristics` and
 * `robustFrames`); the pixel dimensions come from the video source and are checked here rather
 * than assumed.
 */
function collectClipInputs(clips: ClipSession[]): ClipEvidenceInputs[] | null {
  const inputs: ClipEvidenceInputs[] = []
  for (const clip of clips) {
    const { heuristics, robustFrames } = clip.analysis
    const metadata = clip.videoSource.metadata
    if (heuristics === null || robustFrames === null || metadata === null) return null
    inputs.push({
      clipId: clip.clipId,
      heuristics,
      frames: robustFrames,
      // Deliberately destructured rather than passed whole: `durationSec` is unguarded against
      // the `Infinity` a MediaRecorder WebM blob reports, and nothing downstream may read it.
      frameSize: { width: metadata.width, height: metadata.height },
      sourceBlob: clip.videoSource.sourceBlob,
    })
  }
  return inputs
}

function sameClipInputs(a: ClipEvidenceInputs, b: ClipEvidenceInputs): boolean {
  return (
    a.clipId === b.clipId &&
    a.heuristics === b.heuristics &&
    a.frames === b.frames &&
    a.frameSize.width === b.frameSize.width &&
    a.frameSize.height === b.frameSize.height &&
    a.sourceBlob === b.sourceBlob
  )
}

function sameInputList(
  a: ClipEvidenceInputs[] | null,
  b: ClipEvidenceInputs[] | null,
): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((entry, i) => sameClipInputs(entry, b[i]))
}

function planEntries(plan: ClipEvidencePlan): Array<[MetricId, MetricEvidencePlan]> {
  return Object.entries(plan) as Array<[MetricId, MetricEvidencePlan]>
}

function hasPlannedItems(plan: ClipEvidencePlan): boolean {
  return planEntries(plan).some(([, entry]) => entry.status === 'planned')
}

/** A clip nothing was planned for never opens a decoder: its plan is already its verdict. */
function unextractedEvidence(plan: ClipEvidencePlan): ClipEvidence {
  const evidence = {} as ClipEvidence
  for (const [metric, entry] of planEntries(plan)) {
    evidence[metric] =
      entry.status === 'planned'
        ? { status: 'no-evidence', reason: 'extraction-failed' }
        : entry
  }
  return evidence
}

/**
 * The plan as it stands AFTER extraction, which is what the coverage line reports: a metric that
 * planned images but produced none carries `'extraction-failed'`, so the reason is a verdict
 * rather than a pending state (design D9).
 */
function settledPlan(evidence: ClipEvidence): ClipEvidencePlan {
  const plan = {} as ClipEvidencePlan
  for (const [metric, entry] of Object.entries(evidence) as Array<
    [MetricId, MetricEvidence]
  >) {
    plan[metric] =
      entry.status === 'extracted'
        ? { status: 'planned', items: entry.items.map((item) => item.plan) }
        : entry
  }
  return plan
}

/**
 * One section per metric that actually has pixels, in the plan's own key order — which is
 * `FormHeuristicsResult`'s declaration order, the same order `MetricsPanel` lays its cards out in,
 * so scrolling the gallery reads in the same sequence as scrolling the cards.
 *
 * Each metric is read from ITS OWN winning clip (`sourceIndices`), never from whichever clip is on
 * screen — the fused winner legitimately comes from a different clip than its neighbours.
 */
function buildSections(
  evidenceByClip: ClipEvidence[],
  sourceIndices: Record<MetricId, number>,
): EvidenceSection[] {
  const first = evidenceByClip[0]
  if (first === undefined) return []
  const sections: EvidenceSection[] = []
  for (const metric of Object.keys(first) as MetricId[]) {
    const clipIndex = sourceIndices[metric] ?? 0
    const entry = evidenceByClip[clipIndex]?.[metric]
    if (entry !== undefined && entry.status === 'extracted') {
      sections.push({ metric, clipIndex, items: entry.items })
    }
  }
  return sections
}

/**
 * Everything one extraction run decides before any pixels move: which clips still need a decoder
 * opened (`batch`), and how to fold whatever comes back into the gallery's state (`finish`).
 *
 * Split out of the effect so the effect body is one guard and one `setState` — the shape
 * `react-hooks/set-state-in-effect` accepts, and the same one `useVideoAnalysis`'s scale-pass
 * effect already had to adopt. `finish` is called synchronously for a run with nothing to
 * extract and asynchronously otherwise; both paths cache and both paths emit coverage, so
 * `'extraction-failed'` is always a settled verdict.
 */
function startRun(
  inputs: ClipEvidenceInputs[],
  cache: Map<string, CachedClipEvidence>,
  sourceIndices: Record<MetricId, number>,
): { batch: ClipEvidenceInput[]; finish: (extracted: ClipEvidence[]) => GalleryState } {
  for (const key of [...cache.keys()]) {
    if (!inputs.some((input) => input.clipId === key)) cache.delete(key)
  }

  const plans = inputs.map((input) =>
    planClipEvidence(input.heuristics, input.frames, input.frameSize),
  )
  const reused = inputs.map((input) => {
    const cached = cache.get(input.clipId)
    return cached !== undefined && sameClipInputs(cached.inputs, input) ? cached.evidence : null
  })

  // Clip index → position in the extraction batch. A clip reused from cache, or with nothing
  // planned, never opens a decoder and never occupies a slot in the result array.
  const batchPosition = new Map<number, number>()
  const batch: ClipEvidenceInput[] = []
  inputs.forEach((input, index) => {
    if (reused[index] !== null || !hasPlannedItems(plans[index])) return
    batchPosition.set(index, batch.length)
    batch.push({ sourceBlob: input.sourceBlob, plan: plans[index] })
  })

  const finish = (extracted: ClipEvidence[]): GalleryState => {
    const evidenceByClip = inputs.map((input, index) => {
      const position = batchPosition.get(index)
      const evidence =
        reused[index] ??
        (position === undefined ? unextractedEvidence(plans[index]) : extracted[position])
      cache.set(input.clipId, { inputs: input, evidence })
      return evidence
    })
    emitCoverage(inputs, evidenceByClip, sourceIndices)
    return { status: 'settled', sections: buildSections(evidenceByClip, sourceIndices) }
  }

  return { batch, finish }
}

function sameMetricSet(a: ReadonlySet<MetricId>, b: ReadonlySet<MetricId>): boolean {
  return a.size === b.size && [...a].every((metric) => b.has(metric))
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)} s`
}

/**
 * The caption a reader actually needs: what the picture shows, and — for a ghost — the fact that
 * the two overlapping bodies are ONE runner at two instants. That sentence is not decoration: a
 * double exposure of a person against themself is trivially misread as two people, and this
 * feature's whole claim is "here is your own run", not "here is a crowd".
 *
 * `plan.label` is the metric's own words for the instant (it already names the side where the
 * measurement has one), so the caption never re-derives what a metric measured from its id.
 */
function captionFor(plan: EvidenceFramePlan): string {
  const parts = [`${plan.label}.`]
  if (plan.ghost !== null) {
    parts.push(
      'The two overlapping positions are the same runner at two instants of the same run, blended into one image — not two people.',
      `${formatSeconds(plan.base.timestamp)} and ${formatSeconds(plan.ghost.timestamp)} into the clip.`,
    )
  } else if (plan.demotedFromPair) {
    parts.push(
      'Shown as one frame: the paired instant was too similar to tell apart.',
      `${formatSeconds(plan.base.timestamp)} into the clip.`,
    )
  } else {
    parts.push(`A single frame, ${formatSeconds(plan.base.timestamp)} into the clip.`)
  }
  return parts.join(' ')
}

/** Standalone description for the canvas, which carries no text of its own. Names the metric
 * because alt text is read out of context, unlike the caption sitting under its section heading. */
function altFor(plan: EvidenceFramePlan): string {
  const side = plan.side === undefined ? '' : ` (${plan.side} side)`
  const shape =
    plan.ghost === null
      ? 'A single frame from the clip.'
      : 'Two frames of the same runner blended into one image.'
  return `${METRIC_LABELS[plan.metric]}${side}: ${plan.label}. ${shape}`
}

/**
 * Adopts an already-drawn `<canvas>` into the tree. The extractor hands back canvas ELEMENTS
 * rather than URLs on purpose — `toDataURL`/`toBlob` are the export path this epic deliberately
 * does not have — so the one way to render one is to parent the node itself.
 *
 * The host carries the accessible role and description, and sizes the adopted node through a
 * child selector, so the canvas itself is never mutated — it belongs to the extractor, and
 * writing to a prop is exactly what `react-hooks/immutability` is there to stop.
 *
 * The box is square, and so is the canvas by construction (`computeCropRect` produces squares and
 * the extractor draws into a square of the same side), so every image in the gallery presents at
 * one aspect ratio at every width (design D13).
 */
function EvidenceCanvas({ canvas, alt }: { canvas: HTMLCanvasElement; alt: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    host.replaceChildren(canvas)
    return () => {
      host.replaceChildren()
    }
  }, [canvas])

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={alt}
      className="evidence-gallery__image aspect-square w-full overflow-hidden border border-neutral-300 bg-neutral-100 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full [&>canvas]:object-contain dark:border-neutral-700 dark:bg-neutral-900"
    />
  )
}

function EvidenceFigure({ frame }: { frame: ExtractedEvidenceFrame }) {
  return (
    <figure className="evidence-gallery__figure space-y-2">
      <EvidenceCanvas canvas={frame.canvas} alt={altFor(frame.plan)} />
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
      {clipCount > 1 && (
        <p className="evidence-gallery__provenance font-sans text-sm text-neutral-600 dark:text-neutral-400">
          From clip {section.clipIndex + 1} of {clipCount}.
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
 * Mounted as a THIRD child of `MultiClipVideoSession`'s `<main>` and a sibling of `ResultsView`,
 * never a child of it — `<main>` is a two-column grid whose right column is a height-capped
 * scroll box, and imagery is the one thing on this page that needs the full width. `lg:col-span-2`
 * is what makes a third grid child span both columns instead of landing in column 1 of row 2; it
 * lives here rather than on a wrapper so this component genuinely is that third child.
 *
 * It owns the extraction: one pass per clip, at most once per clip per set of inputs, with the
 * detached decoder torn down inside `extractClipEvidence` before it returns. A metric with no
 * evidence — never emitted, gated out, tier 3, or extraction-failed — gets no section, no
 * placeholder and no empty frame; that is the whole degradation story.
 */
export function EvidenceGallery({
  clips,
  sourceIndices,
  onEvidenceMetricsChange,
}: EvidenceGalleryProps) {
  const [state, setState] = useState<GalleryState>(IDLE_STATE)
  // Bumped on every started run and on unmount; a resolved extraction whose id is stale belongs
  // to a superseded (or torn-down) run and is dropped along with its canvases. Same idiom as
  // `useVideoAnalysis`'s `runIdRef`.
  const runIdRef = useRef(0)
  // The other half of superseding a run. `runIdRef` invalidates a stale RESULT; this abandons the
  // stale WORK, which is a different thing and was the one missing: a superseded pass went on
  // holding a 4K decoder — and opening one per remaining clip — for results already destined to be
  // dropped on arrival.
  const abortRef = useRef<AbortController | null>(null)
  const inputsRef = useRef<ClipEvidenceInputs[] | null>(null)
  // Per-clip, so adding a second clip re-extracts only the new one rather than re-decoding a 4K
  // clip that has not changed.
  const cacheRef = useRef(new Map<string, CachedClipEvidence>())
  const reportedRef = useRef<ReadonlySet<MetricId>>(NO_METRICS)

  // `clips` is rebuilt on every render of the session component, so this effect fires on every
  // render and the reference-equality guard below — not the dependency list — is what makes
  // "extraction driven at most once per clip" true.
  useEffect(() => {
    const inputs = collectClipInputs(clips)
    if (sameInputList(inputsRef.current, inputs)) return
    inputsRef.current = inputs
    const runId = (runIdRef.current += 1)
    // Reached only past the signature guard above, so this fires when a run is genuinely
    // superseded — never on the every-render re-entry that guard exists to absorb. Putting it in
    // this effect's CLEANUP would abort on every render instead, killing the live pass.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const run = inputs === null ? null : startRun(inputs, cacheRef.current, sourceIndices)

    setState(
      run === null ? IDLE_STATE : run.batch.length === 0 ? run.finish([]) : EXTRACTING_STATE,
    )

    if (run !== null && run.batch.length > 0) {
      void extractSessionEvidence(run.batch, { signal: controller.signal }).then((extracted) => {
        // A superseded run's canvases are simply dropped here — never parented, never cached.
        if (runIdRef.current !== runId) return
        setState(run.finish(extracted))
      })
    }
  }, [clips, sourceIndices])

  // Teardown. Invalidates any in-flight run — its canvases are dropped rather than parented — AND
  // abandons it, so the detached decoder it is holding is released instead of outliving the
  // component that asked for it. Then forgets everything the gallery was holding, so nothing
  // survives an unmount or a clip reset.
  //
  // Resetting the input signature is what makes it correct under `StrictMode`, which the app
  // mounts under (`main.tsx`): React's dev-only mount → cleanup → mount cycle would otherwise
  // invalidate the first pass's extraction and then find the signature unchanged on the second,
  // skip the re-run, and leave the gallery reporting "pulling frames…" forever. The abandoned
  // first pass resolves promptly and the second queues behind it, so the two never overlap.
  useEffect(() => {
    const cache = cacheRef.current
    // The ref OBJECT, not its value: the controller to abort is whichever one is current at
    // cleanup time, not the one that existed at mount.
    const abort = abortRef
    return () => {
      runIdRef.current += 1
      abort.current?.abort()
      abort.current = null
      inputsRef.current = null
      reportedRef.current = NO_METRICS
      cache.clear()
    }
  }, [])

  useEffect(() => {
    const metrics: ReadonlySet<MetricId> =
      state.status === 'settled'
        ? new Set(state.sections.map((section) => section.metric))
        : NO_METRICS
    if (sameMetricSet(reportedRef.current, metrics)) return
    reportedRef.current = metrics
    onEvidenceMetricsChange?.(metrics)
  }, [state, onEvidenceMetricsChange])

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

/**
 * `[evidence-coverage]`, once per run, once extraction has settled for every clip (design D9).
 *
 * Deliberately its own line and its own prefix: `[analysis-diagnostics]` is a parsed harness
 * contract, and this epic's constraint 4 keeps anything image-shaped away from it. Matched
 * exclusively — `text.startsWith('[evidence-coverage]')` — with no sub-prefixed sibling, which is
 * the lesson `[analysis-diagnostics:scale-pass]` already taught. DEV-gated exactly as
 * `useVideoAnalysis`'s two lines are, so a production build emits nothing.
 */
function emitCoverage(
  inputs: ClipEvidenceInputs[],
  evidenceByClip: ClipEvidence[],
  sourceIndices: Record<MetricId, number>,
): void {
  if (!import.meta.env.DEV) return
  const coverage: EvidenceCoverageClip[] = inputs.map((input, index) => ({
    clipIndex: index,
    frameCount: input.frames.length,
    plan: settledPlan(evidenceByClip[index]),
  }))
  console.log(
    '[evidence-coverage]',
    JSON.stringify(summarizeEvidenceCoverage(coverage, sourceIndices)),
  )
}

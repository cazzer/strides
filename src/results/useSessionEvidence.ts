import { useEffect, useRef, useState } from 'react'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { extractSessionEvidence } from '../video/extractFrames'
import type {
  ClipEvidence,
  ClipEvidenceInput,
  ExtractedEvidenceFrame,
  MetricEvidence,
  ReusedMetricEvidence,
} from '../video/extractFrames'
import { planClipEvidence, summarizeEvidenceCoverage } from './evidenceFrames'
import type {
  ClipEvidencePlan,
  EvidenceCoverageClip,
  EvidenceFrameSize,
  MetricEvidencePlan,
} from './evidenceFrames'
import type { ClipSession } from './multiClipAnalysis'

/**
 * Evidence extraction, owned by a hook rather than by whichever component happens to display the
 * pictures.
 *
 * It was `EvidenceGallery`'s until `strides-ac9.2` moved the imagery into the metric cards and
 * `strides-ac9.3` deleted that component. The move forced the split for a reason that is pure DOM
 * and easy to miss: the extractor hands back
 * canvas ELEMENTS, and a node has exactly one parent, so two surfaces cannot adopt the same canvas
 * — the second `replaceChildren` steals it and leaves the first showing an empty box. Exactly one
 * component may render a given canvas, so the thing that PRODUCES canvases cannot be one of the
 * things that renders them.
 *
 * Every discipline that component enforced moved here unchanged, because none of it was ever about
 * display: extraction at most once per clip per input signature, a per-clip cache keyed by
 * `clipId`, a run-id guard that drops a superseded run's canvases rather than parenting them, the
 * sequential one-decoder-at-a-time batch inside `extractSessionEvidence`, and a teardown that
 * forgets everything on unmount or session reset. (The cache has since gone per metric within each
 * clip, so a superseded run's FINISHED metrics are kept and only a moved plan entry re-decodes —
 * `strides-zm8`. The run-id guard still drops everything a superseded run would have committed.)
 */

/** One metric's worth of evidence: the images, and which clip they were pulled from. */
export interface EvidenceSection {
  metric: MetricId
  /** Index into the session's clips — the clip `fusionSourceIndices` says won this metric. */
  clipIndex: number
  items: ExtractedEvidenceFrame[]
}

/**
 * `extracting` carries sections for the same reason `settled` does: a re-extraction is not a reason
 * to take imagery off the screen. An analysis result is not final when it first renders — the
 * background scale pass grafts its centimetre metrics one clip-replay later — so a run that has
 * already settled can legitimately be superseded, and a status with nowhere to put the previous
 * sections would make that supersession destructive by construction.
 *
 * `idle` is the only state with no sections, and it means what it says: nothing has been produced
 * for this session, or everything that was has been invalidated.
 *
 * `pending` names the metrics this run's plan says WILL have imagery and that have none on screen
 * yet — every planned metric on a first extraction, and on a re-extraction only the ones the graft
 * newly planned. Since `strides-zm8` a run that already HOLDS a metric's final image (finished by
 * the pass it superseded) shows it in `sections` straight away rather than listing it here. It is what lets a card distinguish "still decoding" from "this metric has no
 * picture", which are otherwise the same empty space for the several seconds a decode takes.
 */
export type SessionEvidenceState =
  | { status: 'idle' }
  | { status: 'extracting'; sections: EvidenceSection[]; pending: MetricId[] }
  | { status: 'settled'; sections: EvidenceSection[] }

const IDLE_STATE: SessionEvidenceState = { status: 'idle' }
const NO_SECTIONS: EvidenceSection[] = []

/**
 * What one clip's plan is derived from.
 *
 * Compared by reference, field by field, as the CHEAP outer layer of a two-layer comparison
 * (`sameClipInputs`). It answers "did anything upstream move at all", which is asked on every
 * render; whether the extraction may actually be REUSED is a separate, structural question about
 * the resulting plan, answered per metric by `reusableEvidence`.
 */
interface ClipEvidenceInputs {
  clipId: string
  heuristics: FormHeuristicsResult
  frames: RobustPoseFrame[]
  /**
   * The background scale pass's own frames, present exactly when that pass grafted its two
   * centimetre metrics into `heuristics` (`strides-3a1`). `planClipEvidence` plans those two
   * against these instead of against `frames`; `null` on every run with no completed graft.
   *
   * It belongs in the cheap comparison below for the same reason `heuristics` does: it arrives
   * with the graft, one render after the primary result, and a plan that already ran must be
   * recomputed when it lands. In practice it changes identity at the same instant `heuristics`
   * does — they are written in one literal — so this adds a guard, not a re-plan.
   *
   * Note it no longer decides whether the extraction RE-RUNS. It reaches that decision only
   * through the plan it produces, which is what `reusableEvidence` compares.
   */
  graftedFrames: RobustPoseFrame[] | null
  frameSize: EvidenceFrameSize
  sourceBlob: Blob | null
}

/**
 * One metric's finished evidence, and the plan entry it was extracted for.
 *
 * `planKey` is that entry serialised, stored rather than re-derived from `evidence` because it is
 * what the reuse decision compares against. Reconstructing it from the RESULT would round-trip
 * through `settledPlan`, which equals the plan only where every planned image actually produced
 * pixels.
 */
interface CachedMetricEvidence {
  planKey: string
  evidence: MetricEvidence
}

/**
 * One clip's extraction cache: the bytes its images were decoded from, and every metric's finished
 * evidence, PER METRIC (`strides-zm8`).
 *
 * It was per clip — one plan, one result — so a graft that moved one metric's plan re-decoded all of
 * them. Per metric, the same comparison that made the whole-clip reuse sound (`reusableEvidence`)
 * now admits every metric whose own entry is unchanged, and only the rest reach a decoder.
 *
 * Entries arrive two ways: a run that settles writes every planned metric it produced IN FULL, and a
 * run still in flight writes each metric the moment it finishes whole
 * (`ClipEvidenceInput.onMetricExtracted`). A failed or partial metric is never an entry
 * (`isCompleteEvidence`), so the next pass retries it.
 * The second is what keeps a SUPERSEDED pass's finished work — which on every single-clip run is
 * most of the primary-pass extraction, abandoned when the scale-pass graft lands.
 */
interface CachedClipEvidence {
  sourceBlob: Blob | null
  metrics: Map<MetricId, CachedMetricEvidence>
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
      // Read off the scale-pass state rather than inferred from the heuristics: only that state
      // knows whether these metrics were grafted, and it carries the frames in the same literal
      // as the graft. `undefined` on every non-'done' status, normalised to null here so the
      // comparison below and `planClipEvidence` see one absence rather than two.
      graftedFrames: clip.analysis.scalePass.robustFrames ?? null,
      // Deliberately destructured rather than passed whole: `durationSec` is unguarded against
      // the `Infinity` a MediaRecorder WebM blob reports, and nothing downstream may read it.
      frameSize: { width: metadata.width, height: metadata.height },
      sourceBlob: clip.videoSource.sourceBlob,
    })
  }
  return inputs
}

/**
 * The every-render early-out. `clips` is rebuilt on every render of the session component, so this
 * runs constantly and is kept to reference comparisons for that reason.
 *
 * A `false` here is NOT a decision to re-extract — it only means the effect must look properly.
 * `startRun` then compares the recomputed plan against the cached one and reuses the images
 * wherever they would come out the same.
 */
function sameClipInputs(a: ClipEvidenceInputs, b: ClipEvidenceInputs): boolean {
  return (
    a.clipId === b.clipId &&
    a.heuristics === b.heuristics &&
    a.frames === b.frames &&
    a.graftedFrames === b.graftedFrames &&
    a.frameSize.width === b.frameSize.width &&
    a.frameSize.height === b.frameSize.height &&
    a.sourceBlob === b.sourceBlob
  )
}

function sameInputList(a: ClipEvidenceInputs[] | null, b: ClipEvidenceInputs[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((entry, i) => sameClipInputs(entry, b[i]))
}

function sameSourceIndices(
  a: Record<MetricId, number> | null,
  b: Record<MetricId, number> | null,
): boolean {
  if (a === null || b === null) return a === b
  const metrics = Object.keys(a) as MetricId[]
  return metrics.length === Object.keys(b).length && metrics.every((metric) => a[metric] === b[metric])
}

/**
 * Whether the clip SET is the same one, ignoring everything about each clip's contents.
 *
 * Gates carrying previous sections forward, and nothing else. `EvidenceSection.clipIndex` is a
 * POSITION in the session's clip list and drives the card's "From clip N of M" attribution, so a
 * removed clip shifts every later index and would re-attribute imagery to a clip it did not come
 * from. Appending happens to leave existing indices intact, but that is not special-cased: "same
 * ids, same order" is one obviously-correct condition, where "appended only" is a second path to
 * get wrong for the sake of one render.
 */
function sameClipSet(a: ClipEvidenceInputs[] | null, b: ClipEvidenceInputs[]): boolean {
  return (
    a !== null && a.length === b.length && a.every((entry, i) => entry.clipId === b[i].clipId)
  )
}

/**
 * A metric's cached evidence, if it can be reused for that metric's freshly computed plan entry.
 *
 * This compares what DETERMINES THE PIXELS, and it is sufficient rather than heuristic: a metric's
 * images are a pure function of the clip's bytes and that metric's own plan entry — its instants,
 * crops, opacities and annotation inputs. Nothing about one metric's extraction reads another's
 * (each image is seeked, drawn and annotated from its own item alone, and the seek calibration is
 * derived from the blob), so per-metric equality is exactly as sufficient as the per-clip equality
 * this check used to make.
 *
 * It deliberately does NOT compare `heuristics`, `frames`, `graftedFrames` or `frameSize`. Those
 * are upstream of the plan, not inputs to the extractor: `frameSize` reaches it only through the
 * crop rectangles it produced, and the other three only through the instants they selected — all
 * of which are already in the plan being compared. Comparing them instead was this hook's bug
 * (`strides-3ui`): the scale-pass graft rebuilds the `heuristics` OBJECT while carrying eleven of
 * twelve metric results through by reference, so a reference check on the container reported
 * "everything changed" and threw away a whole clip's images to re-decode them identically.
 *
 * Structural comparison via `JSON.stringify` is sound here because a plan is pure data and both
 * sides come from the same `planClipEvidence` path, so key insertion order matches and the one
 * optional key (`EvidenceFramePlan.side`) is omitted identically on both. `NaN`/`-0` would
 * serialise lossily, which can only make the check more permissive; neither is producible in a
 * plan, and a plan carrying either would be reusing an identical image anyway.
 */
function reusableEvidence(
  cached: CachedClipEvidence | undefined,
  sourceBlob: Blob | null,
  metric: MetricId,
  planKey: string,
): MetricEvidence | undefined {
  if (cached === undefined || cached.sourceBlob !== sourceBlob) return undefined
  const entry = cached.metrics.get(metric)
  return entry !== undefined && entry.planKey === planKey ? entry.evidence : undefined
}

/**
 * Whether a metric's evidence is a COMPLETE answer to its plan entry, and so safe to keep for reuse:
 * extracted, with every planned image present.
 *
 * A failed metric, or one that lost an image to a seek timeout, is a correct verdict for the pass
 * that produced it and is rendered as such — but it is never cached. Reuse is keyed by the plan
 * entry, so a cached failure would be reused for as long as that entry stays the same, where the
 * whole-clip re-extraction this replaced retried it on the next pass. That matters because the pass
 * most likely to time out is the primary-pass extraction, which runs exactly while the scale pass
 * contends for the GPU.
 */
function isCompleteEvidence(evidence: MetricEvidence, entry: MetricEvidencePlan): boolean {
  return (
    evidence.status === 'extracted' &&
    entry.status === 'planned' &&
    evidence.items.length === entry.items.length
  )
}

/**
 * Records one metric's finished evidence. A clip whose bytes changed starts a fresh entry rather
 * than mixing images decoded from two different blobs under one.
 */
function rememberMetric(
  cache: Map<string, CachedClipEvidence>,
  clipId: string,
  sourceBlob: Blob | null,
  metric: MetricId,
  entry: CachedMetricEvidence,
): void {
  let cached = cache.get(clipId)
  if (cached === undefined || cached.sourceBlob !== sourceBlob) {
    cached = { sourceBlob, metrics: new Map() }
    cache.set(clipId, cached)
  }
  cached.metrics.set(metric, entry)
}

function planEntries(plan: ClipEvidencePlan): Array<[MetricId, MetricEvidencePlan]> {
  return Object.entries(plan) as Array<[MetricId, MetricEvidencePlan]>
}

/**
 * A clip that needs no decoder — nothing planned, or every planned metric reused — already knows its
 * whole result: the plan's own verdicts, with each reused metric's held evidence in its place.
 */
function unextractedEvidence(
  plan: ClipEvidencePlan,
  reuse: ReusedMetricEvidence,
): ClipEvidence {
  const evidence = {} as ClipEvidence
  for (const [metric, entry] of planEntries(plan)) {
    evidence[metric] =
      entry.status === 'planned'
        ? (reuse[metric] ?? { status: 'no-evidence', reason: 'extraction-failed' })
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
 * so a card's thumbnails and its neighbours' arrive in the same sequence the cards themselves do.
 *
 * Each metric is read from ITS OWN winning clip (`sourceIndices`), never from whichever clip is on
 * screen — the fused winner legitimately comes from a different clip than its neighbours.
 */
/**
 * The metrics this run's plans say will produce pixels, read from each metric's own winning clip —
 * the same selection `buildSections` makes, one step earlier, off the plan instead of the result.
 *
 * Off the PLAN rather than the eventual evidence on purpose: a placeholder has to go up before the
 * decoder opens, and the plan is the only statement of intent that exists at that moment.
 */
function plannedMetrics(
  plans: ClipEvidencePlan[],
  sourceIndices: Record<MetricId, number>,
): MetricId[] {
  const first = plans[0]
  if (first === undefined) return []
  const metrics: MetricId[] = []
  for (const metric of Object.keys(first) as MetricId[]) {
    const entry = plans[sourceIndices[metric] ?? 0]?.[metric]
    if (entry !== undefined && entry.status === 'planned') metrics.push(metric)
  }
  return metrics
}

/**
 * What an extracting run shows: everything carried forward, plus the images this run already HOLDS
 * (`strides-zm8`) for metrics with nothing on screen — typically the metrics a superseded pass
 * finished before the graft landed, which would otherwise sit behind placeholders until the run
 * settles although their pixels are final.
 *
 * A carried section always wins: replacing an on-screen image before the run settles is exactly what
 * "Evidence already on screen survives a re-extraction" forbids, even with an image that would
 * replace it at settle anyway. Held sections are complete answers to THIS run's plan read at each
 * metric's winning clip (`buildSections`). The caller still applies them only while the clip set is
 * unchanged, the same condition carrying is under.
 *
 * Ordered by the plan's own key order — `FormHeuristicsResult`'s declaration order, the order
 * `buildSections` and therefore every settled and carried list already use.
 */
function withHeldSections(
  carried: EvidenceSection[],
  held: EvidenceSection[],
  order: MetricId[],
): EvidenceSection[] {
  if (held.length === 0) return carried
  const additions = held.filter(
    (section) => !carried.some((existing) => existing.metric === section.metric),
  )
  if (additions.length === 0) return carried
  return [...carried, ...additions].sort(
    (a, b) => order.indexOf(a.metric) - order.indexOf(b.metric),
  )
}

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
 * opened (`batch`), and how to fold whatever comes back into state (`finish`).
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
  isCurrent: () => boolean,
): {
  batch: ClipEvidenceInput[]
  planned: MetricId[]
  held: EvidenceSection[]
  order: MetricId[]
  finish: (extracted: ClipEvidence[]) => SessionEvidenceState
} {
  for (const key of [...cache.keys()]) {
    if (!inputs.some((input) => input.clipId === key)) cache.delete(key)
  }

  const plans = inputs.map((input) =>
    planClipEvidence(
      input.heuristics,
      input.frames,
      input.frameSize,
      input.graftedFrames,
    ),
  )
  // Serialised once per planned metric per run: the key both the reuse check below and every cache
  // write this run makes are stated in.
  const planKeys = plans.map((plan) => {
    const keys = new Map<MetricId, string>()
    for (const [metric, entry] of planEntries(plan)) {
      if (entry.status === 'planned') keys.set(metric, JSON.stringify(entry))
    }
    return keys
  })
  const reuse = inputs.map((input, index) => {
    const cached = cache.get(input.clipId)
    const held: ReusedMetricEvidence = {}
    for (const [metric, planKey] of planKeys[index]) {
      const evidence = reusableEvidence(cached, input.sourceBlob, metric, planKey)
      if (evidence !== undefined) held[metric] = evidence
    }
    return held
  })

  // Clip index → position in the extraction batch. A clip with nothing left to decode — nothing
  // planned, or every planned metric held — never opens a decoder and never occupies a slot.
  const batchPosition = new Map<number, number>()
  const batch: ClipEvidenceInput[] = []
  inputs.forEach((input, index) => {
    const needsDecoder = [...planKeys[index].keys()].some((metric) => !(metric in reuse[index]))
    if (!needsDecoder) return
    batchPosition.set(index, batch.length)
    batch.push({
      sourceBlob: input.sourceBlob,
      plan: plans[index],
      reuse: reuse[index],
      // Keeps each metric this run finishes, even if the run itself is then superseded. Guarded on
      // the run still being current as well as by the extractor's own abort check, so the cache
      // cannot be written by a run this hook has already let go of — whatever the extractor does.
      onMetricExtracted: (metric, evidence) => {
        const planKey = planKeys[index].get(metric)
        if (!isCurrent() || planKey === undefined) return
        if (!isCompleteEvidence(evidence, plans[index][metric])) return
        rememberMetric(cache, input.clipId, input.sourceBlob, metric, { planKey, evidence })
      },
    })
  })

  const finish = (extracted: ClipEvidence[]): SessionEvidenceState => {
    const evidenceByClip = inputs.map((input, index) => {
      const position = batchPosition.get(index)
      const evidence =
        position === undefined
          ? unextractedEvidence(plans[index], reuse[index])
          : extracted[position]
      // Replaced wholesale rather than merged into: the cache holds exactly what the current plan
      // produced, so an image for a plan entry nothing asks for any more is released here rather
      // than retained for the rest of the session.
      const metrics = new Map<MetricId, CachedMetricEvidence>()
      for (const [metric, planKey] of planKeys[index]) {
        if (!isCompleteEvidence(evidence[metric], plans[index][metric])) continue
        metrics.set(metric, { planKey, evidence: evidence[metric] })
      }
      cache.set(input.clipId, { sourceBlob: input.sourceBlob, metrics })
      return evidence
    })
    emitCoverage(inputs, evidenceByClip, sourceIndices)
    return { status: 'settled', sections: buildSections(evidenceByClip, sourceIndices) }
  }

  return {
    batch,
    planned: plannedMetrics(plans, sourceIndices),
    held: buildSections(
      reuse.map((held, index) => unextractedEvidence(plans[index], held)),
      sourceIndices,
    ),
    order: plans[0] === undefined ? [] : (Object.keys(plans[0]) as MetricId[]),
    finish,
  }
}

/**
 * Drives evidence extraction for a whole session and hands back what settled.
 *
 * `sourceIndices` is `computeFusionSourceIndices(clips)`, or `null` while any clip's analysis has
 * not been fused — a `null` there keeps the hook idle rather than attributing a metric's evidence
 * to a clip that did not win it.
 *
 * Call this ONCE per session. Two callers means two caches, two batches and two decoders, which is
 * exactly the discipline this hook exists to hold.
 */
export function useSessionEvidence(
  clips: ClipSession[],
  sourceIndices: Record<MetricId, number> | null,
): SessionEvidenceState {
  const [state, setState] = useState<SessionEvidenceState>(IDLE_STATE)
  // Bumped on every started run and on unmount; a resolved extraction whose id is stale belongs
  // to a superseded (or torn-down) run and is dropped along with its canvases. Same idiom as
  // `useVideoAnalysis`'s `runIdRef`.
  const runIdRef = useRef(0)
  const inputsRef = useRef<ClipEvidenceInputs[] | null>(null)
  const sourceIndicesRef = useRef<Record<MetricId, number> | null>(null)
  // Per clip AND per metric, so adding a second clip re-extracts only the new one rather than
  // re-decoding a 4K clip that has not changed, and a graft that moves one metric's plan re-decodes
  // only that metric (`strides-zm8`).
  const cacheRef = useRef(new Map<string, CachedClipEvidence>())
  const abortRef = useRef<AbortController | null>(null)
  // The sections currently on screen, mirrored out of state so a run starting inside the effect
  // can carry them forward. A ref rather than the `state` closure or a functional updater: the
  // eager branch below calls `run.finish([])`, which caches and emits coverage, so it cannot move
  // inside an updater — React may invoke an updater twice, and both of those are side effects.
  const sectionsRef = useRef<EvidenceSection[]>(NO_SECTIONS)

  // `clips` is rebuilt on every render of the session component, so this effect fires on every
  // render and the reference-equality guard below — not the dependency list — is what makes
  // "extraction driven at most once per clip" true.
  useEffect(() => {
    // Every write to state goes through here, so the mirror cannot drift from what is rendered.
    const commit = (next: SessionEvidenceState): void => {
      sectionsRef.current = next.status === 'idle' ? NO_SECTIONS : next.sections
      setState(next)
    }
    const inputs = sourceIndices === null ? null : collectClipInputs(clips)
    if (sameInputList(inputsRef.current, inputs) && sameSourceIndices(sourceIndicesRef.current, sourceIndices)) return
    const previousInputs = inputsRef.current
    inputsRef.current = inputs
    sourceIndicesRef.current = sourceIndices
    const runId = (runIdRef.current += 1)
    // Reached only past the signature guard above, so this fires when a run is genuinely
    // superseded — never on the every-render re-entry that guard exists to absorb. Putting it in
    // this effect's CLEANUP would abort on every render instead, killing the live pass.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const run =
      inputs === null || sourceIndices === null
        ? null
        : startRun(inputs, cacheRef.current, sourceIndices, () => runIdRef.current === runId)

    // Whether the sections already on screen may stay there while this run works. They may
    // whenever the clip SET is unchanged — the common case, and the one this guard exists for: the
    // scale-pass graft supersedes a run that has already settled, and blanking every card for the
    // length of a decode is the thing that made a correct re-extraction look like a bug.
    const sameClips = sameClipSet(previousInputs, inputs ?? []) && sourceIndices !== null
    const carried = sameClips
      ? sectionsRef.current.filter((section) => sourceIndices[section.metric] === section.clipIndex)
      : NO_SECTIONS
    // Held images are shown early under the SAME condition carried ones are, even though their
    // attribution is the current run's: a changed clip set withholds evidence until the run
    // settles, and that rule is stated about the clip set, not about where an image came from.
    const shown =
      run === null || !sameClips ? carried : withHeldSections(carried, run.held, run.order)

    commit(
      run === null
        ? IDLE_STATE
        : run.batch.length === 0
          ? run.finish([])
          : {
              status: 'extracting',
              sections: shown,
              // Only what has nothing on screen. A metric whose previous image was carried
              // forward keeps showing it, and one whose image this run already holds shows that;
              // putting a placeholder over a picture that is already correct would be a downgrade,
              // not a progress report.
              pending: run.planned.filter(
                (metric) => !shown.some((section) => section.metric === metric),
              ),
            },
    )

    if (run !== null && run.batch.length > 0) {
      // No rejection handler, deliberately — the same decision, on the same terms, as
      // `useClipPoster.ts`'s derivation call, where the full reasoning is recorded (`strides-9yb`).
      // In short: `extractSessionEvidence` resolves every failure it knows about (a clip's metrics
      // come back `extraction-failed`, never a throw), so a rejection is a bug in the extractor;
      // this app has no error channel to catch it into; and a `.catch` would suppress the browser's
      // unhandled-rejection report, which is both louder and the only machine-detectable signal.
      // An abort is NOT a rejection on this path — `AbortController` teardown resolves normally.
      void extractSessionEvidence(run.batch, { signal: controller.signal }).then((extracted) => {
        // A superseded run's canvases are simply dropped here — never parented, never cached.
        if (runIdRef.current !== runId) return
        commit(run.finish(extracted))
      })
    }
  }, [clips, sourceIndices])

  // Teardown. Invalidates any in-flight run — its canvases are dropped rather than parented — AND
  // abandons it, so the detached decoder it is holding is released instead of outliving the
  // component that asked for it. Then forgets everything the hook was holding, so nothing
  // survives an unmount or a clip reset.
  //
  // Invalidation alone is NOT enough, and this is the subtle half (`strides-0ok`): `runIdRef`
  // invalidates a superseded run's RESULT, never its WORK. An async function suspended at an
  // `await` that is never resumed never leaves its `try`, so `extractClipEvidence`'s `finally`
  // never runs and its detached decoder is never released. Measured before the signal existed:
  // three 4K decoders still open at unmount, still open six seconds later.
  //
  // Resetting the input signature is what makes it correct under `StrictMode`, which the app
  // mounts under (`main.tsx`): React's dev-only mount → cleanup → mount cycle would otherwise
  // invalidate the first pass's extraction and then find the signature unchanged on the second,
  // skip the re-run, and leave the results reporting "pulling frames…" forever. The abandoned
  // first pass resolves promptly and the second queues behind it, so the two never overlap.
  useEffect(() => {
    const cache = cacheRef.current
    // The ref OBJECT, not its value: the controller to abort is whichever one is current at
    // cleanup time, not the one that existed at mount.
    const abort = abortRef
    const sections = sectionsRef
    return () => {
      runIdRef.current += 1
      abort.current?.abort()
      abort.current = null
      inputsRef.current = null
      sections.current = NO_SECTIONS
      cache.clear()
    }
  }, [])

  return state
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

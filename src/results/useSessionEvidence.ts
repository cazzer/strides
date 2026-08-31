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
 * forgets everything on unmount or session reset.
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
 */
export type SessionEvidenceState =
  | { status: 'idle' }
  | { status: 'extracting'; sections: EvidenceSection[] }
  | { status: 'settled'; sections: EvidenceSection[] }

const IDLE_STATE: SessionEvidenceState = { status: 'idle' }
const NO_SECTIONS: EvidenceSection[] = []

/**
 * What one clip's plan is derived from.
 *
 * Compared by reference, field by field, as the CHEAP outer layer of a two-layer comparison
 * (`sameClipInputs`). It answers "did anything upstream move at all", which is asked on every
 * render; whether the extraction may actually be REUSED is a separate, structural question about
 * the resulting plan, answered by `canReuseCachedEvidence`.
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
   * through the plan it produces, which is what `canReuseCachedEvidence` compares.
   */
  graftedFrames: RobustPoseFrame[] | null
  frameSize: EvidenceFrameSize
  sourceBlob: Blob | null
}

/**
 * One clip's extraction cache entry: what it was extracted from, and what came out.
 *
 * `plan` is stored rather than re-derived from `evidence` because it is what the reuse decision
 * compares against, and it is the exact object the batch was built from. Reconstructing it with
 * `settledPlan` would round-trip through the extraction RESULT, which equals the plan only where
 * every planned metric actually produced pixels.
 */
interface CachedClipEvidence {
  inputs: ClipEvidenceInputs
  plan: ClipEvidencePlan
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
 * Whether a clip's cached evidence can be reused for a freshly computed plan.
 *
 * This compares what DETERMINES THE PIXELS, and it is sufficient rather than heuristic:
 * `extractSessionEvidence` receives `ClipEvidenceInput`, which is exactly `{ sourceBlob, plan }`,
 * so its output is a pure function of those two and equality of both means the extraction would
 * reproduce the images already held.
 *
 * It deliberately does NOT compare `heuristics`, `frames`, `graftedFrames` or `frameSize`. Those
 * are upstream of the plan, not inputs to the extractor: `frameSize` reaches it only through the
 * crop rectangles it produced, and the other three only through the instants they selected — all
 * of which are already in the plan being compared. Comparing them instead was this hook's bug
 * (`strides-3ui`): the scale-pass graft rebuilds the `heuristics` OBJECT while carrying nine of
 * eleven metric results through by reference, so a reference check on the container reported
 * "everything changed" and threw away a whole clip's images to re-decode them identically.
 *
 * Structural comparison via `JSON.stringify` is sound here because a plan is pure data and both
 * sides come from the same `planClipEvidence` path, so key insertion order matches and the one
 * optional key (`EvidenceFramePlan.side`) is omitted identically on both. `NaN`/`-0` would
 * serialise lossily, which can only make the check more permissive; neither is producible in a
 * plan, and a plan carrying either would be reusing an identical image anyway.
 */
function canReuseCachedEvidence(
  cached: CachedClipEvidence,
  input: ClipEvidenceInputs,
  plan: ClipEvidencePlan,
): boolean {
  return (
    cached.inputs.sourceBlob === input.sourceBlob &&
    JSON.stringify(cached.plan) === JSON.stringify(plan)
  )
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
 * so a card's thumbnails and its neighbours' arrive in the same sequence the cards themselves do.
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
): {
  batch: ClipEvidenceInput[]
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
  const reused = inputs.map((input, index) => {
    const cached = cache.get(input.clipId)
    return cached !== undefined && canReuseCachedEvidence(cached, input, plans[index])
      ? cached.evidence
      : null
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

  const finish = (extracted: ClipEvidence[]): SessionEvidenceState => {
    const evidenceByClip = inputs.map((input, index) => {
      const position = batchPosition.get(index)
      const evidence =
        reused[index] ??
        (position === undefined ? unextractedEvidence(plans[index]) : extracted[position])
      cache.set(input.clipId, { inputs: input, plan: plans[index], evidence })
      return evidence
    })
    emitCoverage(inputs, evidenceByClip, sourceIndices)
    return { status: 'settled', sections: buildSections(evidenceByClip, sourceIndices) }
  }

  return { batch, finish }
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
  // Per-clip, so adding a second clip re-extracts only the new one rather than re-decoding a 4K
  // clip that has not changed — and, since `canReuseCachedEvidence`, so does any change that
  // leaves an existing clip's plan intact.
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
    if (sameInputList(inputsRef.current, inputs)) return
    const previousInputs = inputsRef.current
    inputsRef.current = inputs
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
        : startRun(inputs, cacheRef.current, sourceIndices)

    // Whether the sections already on screen may stay there while this run works. They may
    // whenever the clip SET is unchanged — the common case, and the one this guard exists for: the
    // scale-pass graft supersedes a run that has already settled, and blanking every card for the
    // length of a decode is the thing that made a correct re-extraction look like a bug.
    const carried = sameClipSet(previousInputs, inputs ?? []) ? sectionsRef.current : NO_SECTIONS

    commit(
      run === null
        ? IDLE_STATE
        : run.batch.length === 0
          ? run.finish([])
          : { status: 'extracting', sections: carried },
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

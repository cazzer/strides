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
 * It was `EvidenceGallery`'s until `strides-ac9.2` moved the imagery into the metric cards. The
 * move forced the split for a reason that is pure DOM and easy to miss: the extractor hands back
 * canvas ELEMENTS, and a node has exactly one parent, so two surfaces cannot adopt the same canvas
 * — the second `replaceChildren` steals it and leaves the first showing an empty box. Exactly one
 * component may render a given canvas, so the thing that PRODUCES canvases cannot be one of the
 * things that renders them.
 *
 * Every discipline the gallery enforced moved here unchanged, because none of it was ever about
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

export type SessionEvidenceState =
  | { status: 'idle' }
  | { status: 'extracting' }
  | { status: 'settled'; sections: EvidenceSection[] }

const IDLE_STATE: SessionEvidenceState = { status: 'idle' }
const EXTRACTING_STATE: SessionEvidenceState = { status: 'extracting' }

/** What one clip's plan is derived from. Compared by reference, field by field, to decide whether
 * a clip already extracted is still the same clip. */
interface ClipEvidenceInputs {
  clipId: string
  heuristics: FormHeuristicsResult
  frames: RobustPoseFrame[]
  frameSize: EvidenceFrameSize
  sourceBlob: Blob | null
}

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

function sameInputList(a: ClipEvidenceInputs[] | null, b: ClipEvidenceInputs[] | null): boolean {
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

  const finish = (extracted: ClipEvidence[]): SessionEvidenceState => {
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
  // clip that has not changed.
  const cacheRef = useRef(new Map<string, CachedClipEvidence>())

  // `clips` is rebuilt on every render of the session component, so this effect fires on every
  // render and the reference-equality guard below — not the dependency list — is what makes
  // "extraction driven at most once per clip" true.
  useEffect(() => {
    const inputs = sourceIndices === null ? null : collectClipInputs(clips)
    if (sameInputList(inputsRef.current, inputs)) return
    inputsRef.current = inputs
    const runId = (runIdRef.current += 1)
    const run =
      inputs === null || sourceIndices === null
        ? null
        : startRun(inputs, cacheRef.current, sourceIndices)

    setState(
      run === null ? IDLE_STATE : run.batch.length === 0 ? run.finish([]) : EXTRACTING_STATE,
    )

    if (run !== null && run.batch.length > 0) {
      void extractSessionEvidence(run.batch).then((extracted) => {
        // A superseded run's canvases are simply dropped here — never parented, never cached.
        if (runIdRef.current !== runId) return
        setState(run.finish(extracted))
      })
    }
  }, [clips, sourceIndices])

  // Teardown. Invalidates any in-flight run — its canvases are dropped rather than parented — and
  // forgets everything the hook was holding, so nothing survives an unmount or a clip reset.
  //
  // Resetting the input signature is what makes it correct under `StrictMode`, which the app
  // mounts under (`main.tsx`): React's dev-only mount → cleanup → mount cycle would otherwise
  // invalidate the first pass's extraction and then find the signature unchanged on the second,
  // skip the re-run, and leave the results reporting "pulling frames…" forever.
  useEffect(() => {
    const cache = cacheRef.current
    return () => {
      runIdRef.current += 1
      inputsRef.current = null
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

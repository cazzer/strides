import type { MetricId } from '../heuristics/types'
import type { VideoSource } from '../video/types'
import type {
  AnalysisPhase,
  ScalePassStatus,
  VideoAnalysisError,
  VideoAnalysisState,
} from './types'
import { fuseFormHeuristicsResults, fusionSourceIndices } from './fuseHeuristics'

/**
 * One uploaded clip's full session: its stable identity (assigned at upload time, never an array
 * index — clips can be removed, and an index would silently relabel the remaining ones), its own
 * unmodified `useVideoSource()` output, and its own unmodified `useVideoAnalysis()` output. Built
 * by `ClipSlot`, consumed here as pure data — nothing in this module calls a hook or touches the
 * DOM.
 */
export interface ClipSession {
  clipId: string
  videoSource: VideoSource
  analysis: VideoAnalysisState
}

const SCALE_PASS_STATUS_PRIORITY: ScalePassStatus[] = ['running', 'done', 'failed', 'skipped']

function aggregatePhase(clips: ClipSession[]): AnalysisPhase {
  if (clips.length === 0) return 'idle'
  if (clips.some((c) => c.analysis.phase === 'error')) return 'error'
  if (clips.some((c) => c.analysis.phase === 'sampling')) return 'sampling'
  if (clips.some((c) => c.analysis.phase === 'processing')) return 'processing'
  if (clips.every((c) => c.analysis.phase === 'ready')) return 'ready'
  // A clip has already finished ('ready') while another sits genuinely 'idle' -- queued behind
  // the shared detector (ClipSlot's "Queued -- waiting for another clip to finish analyzing…"
  // message), not the "nothing has ever run" case (that one only happens when EVERY clip is
  // idle, handled by the fallthrough below). Reporting 'sampling' here keeps ResultsView's
  // "Analyze" button disabled and its progress readout visible instead of falling through to
  // 'idle' and rendering a bare, re-enabled "Analyze" indistinguishable from a fresh session --
  // which, via `start()`'s fan-out below, would re-sample the already-finished clip from
  // scratch if clicked.
  if (clips.some((c) => c.analysis.phase === 'ready')) return 'sampling'
  return 'idle'
}

function aggregateScalePassStatus(clips: ClipSession[]): ScalePassStatus {
  for (const status of SCALE_PASS_STATUS_PRIORITY) {
    if (clips.some((c) => c.analysis.scalePass.status === status)) return status
  }
  return 'idle'
}

function aggregateError(clips: ClipSession[]): VideoAnalysisError | null {
  return clips.find((c) => c.analysis.phase === 'error')?.analysis.error ?? null
}

/** The one gate on a fused result existing at all: every clip finished, so every clip has a
 * `heuristics` to contribute. Shared by the aggregate below and the source-index map beside it so
 * the two can never disagree about whether there is anything to fuse. */
function allClipsReady(clips: ClipSession[]): boolean {
  return clips.length > 0 && clips.every((c) => c.analysis.phase === 'ready')
}

/**
 * Combines every clip's independently-driven `VideoAnalysisState` into one aggregate, for
 * `ResultsView` (unmodified) to render exactly as it does for a single clip today.
 *
 * `robustFrames`/`diagnostics`/`scalePass.diagnostics` are always `null` here — neither has a
 * sane N-clip merge, and nothing downstream reads an aggregate version of either: `ResultsView`/
 * `MetricsPanel` only read `heuristics`, and the skeleton overlay is rendered per-clip inside
 * `ClipSlot` off that clip's own `analysis.robustFrames`.
 */
export function computeAggregateAnalysisState(clips: ClipSession[]): VideoAnalysisState {
  const phase = aggregatePhase(clips)
  const allReady = allClipsReady(clips)

  return {
    phase,
    progress:
      clips.length === 0
        ? 0
        : clips.reduce((sum, c) => sum + c.analysis.progress, 0) / clips.length,
    isPausedMidAnalysis: clips.some((c) => c.analysis.isPausedMidAnalysis),
    robustFrames: null,
    heuristics: allReady
      ? fuseFormHeuristicsResults(clips.map((c) => c.analysis.heuristics!))
      : null,
    diagnostics: null,
    scalePass: { status: aggregateScalePassStatus(clips), diagnostics: null },
    error: aggregateError(clips),
    // Defense in depth alongside the `aggregatePhase` fix above: a 'ready' clip is finished and
    // deterministic (re-running it has nothing new to say -- see ResultsView's own comment on
    // why the button doesn't even render once a clip is ready). Skipping it here means that even
    // if this combinator is ever invoked from a phase this module didn't anticipate, calling the
    // aggregate `start()` can never discard an already-finished clip's results out from under it.
    start: () => {
      for (const clip of clips) {
        if (clip.analysis.phase === 'ready') continue
        clip.analysis.start()
      }
    },
    reset: () => {
      for (const clip of clips) clip.analysis.reset()
    },
  }
}

/**
 * Which clip each metric of the aggregate's fused `heuristics` was selected from, as indices into
 * the SAME array passed here. The companion to `computeAggregateAnalysisState`: that one produces
 * the fused numbers, this one says where each came from, and both read the same `clips` in the
 * same order, so `clips[indices[metricId]]` is the clip that produced `heuristics[metricId]`.
 *
 * The evidence gallery is the consumer: a fused metric's exemplar timestamps are on its *own*
 * clip's media clock and must be resolved against that clip's `analysis.robustFrames` (crop
 * geometry) and `videoSource.sourceBlob` (extraction), never against whichever clip is on screen.
 * Both of those are on `ClipSession` already — `multiClipAnalysis`'s aggregate nulls
 * `robustFrames` because there is no sane N-clip merge of them, but per-clip frames are intact and
 * are already consumed that way by `ClipSlot`'s skeleton overlay.
 *
 * `null` until every clip is ready, mirroring the aggregate's own gate on `heuristics` exactly
 * (both call `allClipsReady`): before then there is no fused result to attribute, and a map built
 * from a partially-analyzed session would name winners that have not been decided yet.
 */
export function computeFusionSourceIndices(
  clips: ClipSession[],
): Record<MetricId, number> | null {
  if (!allClipsReady(clips)) return null
  return fusionSourceIndices(clips.map((c) => c.analysis.heuristics!))
}

function isDoneWithSharedDetector(clip: ClipSession): boolean {
  // An errored clip's primary pass never reached 'ready', so `useVideoAnalysis.ts`'s scale-pass
  // effect (gated on `state.phase === 'ready'`) never fires for it -- its `scalePass.status`
  // stays 'idle' forever (see `idleState()`/`start()`'s error branches, both of which spread
  // `idleState()` verbatim). Waiting for that scale pass to reach a terminal status is waiting
  // for something structurally incapable of happening: an errored clip's scale pass isn't "not
  // yet terminal", it never had the chance to start. Treat 'error' as immediately, fully
  // terminal -- releasing both the primary and scale-pass detector claims -- without requiring
  // `scalePass.status` to move at all.
  if (clip.analysis.phase === 'error') return true
  if (clip.analysis.phase !== 'ready') return false
  // The 'ready' path is unchanged: the primary pass succeeded, and its background scale pass --
  // which uses its OWN separately-shared, module-cached MediaPipe detector -- genuinely needs to
  // finish before that scale-pass detector is safe to reuse for the next clip.
  return (
    clip.analysis.scalePass.status === 'done' ||
    clip.analysis.scalePass.status === 'failed' ||
    clip.analysis.scalePass.status === 'skipped'
  )
}

/**
 * The shared-detector serialization rule (see the change's design.md, D5): a clip is skipped
 * past once EITHER (a) it errored -- its primary pass never reached 'ready', so it never started
 * a scale pass and never will, making it terminal on the spot -- or (b) its ENTIRE pipeline --
 * primary analysis run AND background scale pass -- has reached a terminal state. Only one clip
 * ever holds a live detector at a time; every other clip must receive `null` (see
 * `MultiClipVideoSession`). For a single clip this is a permanent no-op — the loop's bound
 * (`clips.length - 1`) never lets it advance past the only clip there is, done or not.
 *
 * `currentActiveIndex` is clamped into range first so a clip removal (shrinking the array) can't
 * leave the index pointing past the end.
 */
export function nextActiveClipIndex(
  clips: ClipSession[],
  currentActiveIndex: number,
): number {
  if (clips.length === 0) return 0
  let index = Math.min(Math.max(currentActiveIndex, 0), clips.length - 1)
  while (index < clips.length - 1 && isDoneWithSharedDetector(clips[index])) {
    index += 1
  }
  return index
}

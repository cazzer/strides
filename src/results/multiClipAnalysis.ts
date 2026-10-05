import type { MetricId } from '../heuristics/types'
import type { ClipPoster } from '../video/posterFrame'
import type { VideoSource } from '../video/types'
import type {
  AggregateAnalysisState,
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
  /**
   * One still frame from this clip, for anything that has to show a clip as an image rather than a
   * position ("clip 2 of 3"). `null` until the source is ready and the frame has been decoded, and
   * `null` again once the source is replaced or cleared.
   *
   * A live `<canvas>` held in memory for the session, never a data URL, blob or stored asset — the
   * same no-export rule the evidence pipeline follows. Its owner is the `ClipSlot` that derived it
   * (`useClipPoster`); a consumer renders it and must never mutate or release it.
   */
  poster: ClipPoster | null
}

// `pending` outranks every terminal status: with scale passes queued behind every primary
// (`nextScalePassClipIndex`), one clip can be 'done' while another still waits its turn, and the
// session has not finished measuring until the last one has run.
const SCALE_PASS_STATUS_PRIORITY: ScalePassStatus[] = [
  'running',
  'pending',
  'done',
  'failed',
  'skipped',
]

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
export function computeAggregateAnalysisState(clips: ClipSession[]): AggregateAnalysisState {
  const phase = aggregatePhase(clips)
  const allReady = allClipsReady(clips)

  return {
    phase,
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
 * Session evidence is the consumer: a fused metric's exemplar timestamps are on its *own*
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

function isScalePassTerminal(status: ScalePassStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'skipped'
}

/** Whether this clip's primary run sampled by playing its `<video>` (a WebM, a webcam recording,
 * or an MP4 the sequential-decode probe turned down). Its scale pass replays that same element, so
 * it keeps the old rule: the pass runs straight after its own primary, before any other clip moves.
 * `diagnostics` is written in the same literal that commits `'ready'`, so it is never null on a
 * clip this is asked about. */
function sampledOnPlaybackPath(clip: ClipSession): boolean {
  return clip.analysis.diagnostics?.sampling.path === 'playback'
}

function isWaitingForScalePass(clip: ClipSession): boolean {
  return clip.analysis.phase === 'ready' && clip.analysis.scalePass.status === 'pending'
}

function isDoneWithSharedDetector(clip: ClipSession): boolean {
  // An errored clip's primary pass never reached 'ready', so `useVideoAnalysis.ts`'s scale-pass
  // effect (gated on `state.phase === 'ready'`) never fires for it -- its `scalePass.status`
  // stays 'idle' forever (see `idleState()`/`start()`'s error branches, both of which spread
  // `idleState()` verbatim). Waiting for it would be waiting for something structurally incapable
  // of happening, so 'error' is immediately terminal.
  if (clip.analysis.phase === 'error') return true
  if (clip.analysis.phase !== 'ready') return false
  // The shared detector is the PRIMARY one, and a 'ready' clip is finished with it. Its scale pass
  // uses a separate, module-cached MediaPipe detector and is scheduled on its own lane
  // (`nextScalePassClipIndex`), after every primary -- except on the playback path, where the
  // pass replays the clip's own element and keeps the old rule of finishing before the next clip
  // starts.
  if (!sampledOnPlaybackPath(clip)) return true
  return isScalePassTerminal(clip.analysis.scalePass.status)
}

/**
 * The shared-detector serialization rule (see the change's design.md, D5): a clip is skipped
 * past once its primary pass is terminal ('ready' or 'error') -- and, for a clip sampled on the
 * playback path, once its background scale pass is terminal too. Only one clip ever holds a live
 * detector at a time; every other clip must receive `null` (see `MultiClipVideoSession`). For a
 * single clip this is a permanent no-op — the loop's bound (`clips.length - 1`) never lets it
 * advance past the only clip there is, done or not.
 *
 * Never advances while any scale pass is 'running' (schedule-scale-passes-after-primaries): a clip
 * added after every primary finished would otherwise start its primary on top of that pass. The
 * running pass keeps its lease, the new clip's primary starts once it is terminal, and the passes
 * still queued wait behind that primary (`nextScalePassClipIndex`).
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
  if (clips.some((c) => c.analysis.scalePass.status === 'running')) return index
  while (index < clips.length - 1 && isDoneWithSharedDetector(clips[index])) {
    index += 1
  }
  return index
}

/**
 * Which clip may run its background scale pass now, or `null` for none — the scale-pass lane
 * (schedule-scale-passes-after-primaries). At most one pass runs at a time, because the scale-pass
 * detector is one stateful, module-cached MediaPipe instance; and none starts while a primary pass
 * could still sample, so the two never contend for the GPU and every primary — the work the fused
 * result waits on — runs first.
 *
 * In order:
 *   1. a clip whose pass is already 'running' keeps the lane (a started pass is never cancelled);
 *   2. nothing, while any primary is sampling or processing;
 *   3. the lowest-index waiting clip sampled on the PLAYBACK path: it still holds the shared
 *      detector until its pass is terminal (`isDoneWithSharedDetector`), so every later primary
 *      waits for it, and withholding its lane would deadlock the session;
 *   4. nothing, while a primary is still outstanding — an idle clip at or after the active index
 *      whose source has not failed. An idle clip BEFORE the active index (reset after an error)
 *      can never be handed the detector again, so it must not hold the lane either;
 *   5. otherwise the lowest-index clip that is 'ready' with its pass 'pending'.
 */
export function nextScalePassClipIndex(
  clips: ClipSession[],
  activeClipIndex: number,
): number | null {
  const running = clips.findIndex((c) => c.analysis.scalePass.status === 'running')
  if (running !== -1) return running
  if (clips.some((c) => c.analysis.phase === 'sampling' || c.analysis.phase === 'processing')) {
    return null
  }
  const playback = clips.findIndex((c) => isWaitingForScalePass(c) && sampledOnPlaybackPath(c))
  if (playback !== -1) return playback
  const primaryOutstanding = clips.some(
    (c, index) =>
      index >= activeClipIndex && c.analysis.phase === 'idle' && c.videoSource.status !== 'error',
  )
  if (primaryOutstanding) return null
  const next = clips.findIndex(isWaitingForScalePass)
  return next === -1 ? null : next
}

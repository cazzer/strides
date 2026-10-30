import type { MetricId } from '../heuristics/types'
import type { ClipPoster } from '../video/posterFrame'
import type { VideoSource } from '../video/types'
import { outlinePassStatus } from './types'
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
// (`nextBackgroundPassClipIndex`), one clip can be 'done' while another still waits its turn, and the
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

function aggregateOutlinePassStatus(clips: ClipSession[]): ScalePassStatus {
  for (const status of SCALE_PASS_STATUS_PRIORITY) {
    if (clips.some((c) => outlinePassStatus(c.analysis) === status)) return status
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
    outlinePass: { status: aggregateOutlinePassStatus(clips) },
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
  // A clip whose video never loaded will never run anything. Without this the active index would
  // stop on it for good, and every later clip's primary — and so every queued scale pass, which
  // waits for those primaries — would wait behind it forever.
  if (clip.videoSource.status === 'error') return true
  // An errored clip's primary pass never reached 'ready', so `useVideoAnalysis.ts`'s scale-pass
  // effect (gated on `state.phase === 'ready'`) never fires for it -- its `scalePass.status`
  // stays 'idle' forever (see `idleState()`/`start()`'s error branches, both of which spread
  // `idleState()` verbatim). Waiting for it would be waiting for something structurally incapable
  // of happening, so 'error' is immediately terminal.
  if (clip.analysis.phase === 'error') return true
  if (clip.analysis.phase !== 'ready') return false
  // The shared detector is the PRIMARY one, and a 'ready' clip is finished with it. Its scale pass
  // uses a separate, module-cached MediaPipe detector and is scheduled on its own lane
  // (`nextBackgroundPassClipIndex`), after every primary -- except on the playback path, where the
  // pass replays the clip's own element and keeps the old rule of finishing before the next clip
  // starts.
  if (!sampledOnPlaybackPath(clip)) return true
  return isScalePassTerminal(clip.analysis.scalePass.status)
}

/** Whether this clip's primary run is still to come: idle, with a source that has not failed. */
function isPrimaryToCome(clip: ClipSession): boolean {
  return clip.analysis.phase === 'idle' && clip.videoSource.status !== 'error'
}

/** Whether this clip's primary may sample on the playback path: its probe said no, or has not
 * answered yet. Unknown counts as playback, the conservative reading. */
function primaryMaySampleOnPlaybackPath(clip: ClipSession): boolean {
  return clip.analysis.primarySamplingPath !== 'sequential'
}

/** Whether this clip's sampling path is still to be decided, with an answer on its way: its video
 * is loading, or loaded and its probe has not answered. The probe starts when the video's metadata
 * arrives and is bounded by its own timeout (`useVideoAnalysis`), so this cannot stay true for long
 * unless the video never finishes loading. An 'empty' source has no load in progress, so no answer
 * is coming. */
function samplingPathPending(clip: ClipSession): boolean {
  if (clip.analysis.primarySamplingPath != null) return false
  return clip.videoSource.status === 'loading' || clip.videoSource.status === 'ready'
}

function isInFlight(status: ScalePassStatus): boolean {
  return status === 'pending' || status === 'running'
}

/** Whether this clip still has a background pass — scale or outline — to run or running. */
function hasBackgroundPassAhead(clip: ClipSession): boolean {
  return (
    clip.analysis.phase === 'ready' &&
    (isInFlight(clip.analysis.scalePass.status) || isInFlight(outlinePassStatus(clip.analysis)))
  )
}

function isBackgroundPassRunning(clip: ClipSession): boolean {
  return (
    clip.analysis.scalePass.status === 'running' || outlinePassStatus(clip.analysis) === 'running'
  )
}

/** Ready, scale pass terminal, outline pass due (`strides-uz48`). */
function isWaitingForOutlinePass(clip: ClipSession): boolean {
  return (
    clip.analysis.phase === 'ready' &&
    isScalePassTerminal(clip.analysis.scalePass.status) &&
    outlinePassStatus(clip.analysis) === 'pending'
  )
}

/**
 * The shared-detector serialization rule (see the change's design.md, D5): a clip is skipped
 * past once its video failed to load, or its primary pass is terminal ('ready' or 'error') -- and,
 * for a clip sampled on the playback path, once its background scale pass is terminal too. Only
 * one clip ever holds a live detector at a time; every other clip must receive `null` (see
 * `MultiClipVideoSession`). For a single clip this is a permanent no-op — the loop's bound
 * (`clips.length - 1`) never lets it advance past the only clip there is, done or not.
 *
 * A clip whose primary may sample on the PLAYBACK path is advanced into only once every earlier
 * clip's scale pass is terminal (schedule-scale-passes-after-primaries, design.md D9). The
 * real-time playback sampler is sensitive to what ran on the GPU just before it — measured, a
 * WebM primary started right after MediaPipe detector creation detected 93/97 frames where the
 * reference order (after a whole scale pass) detected 99/99 — so it must see exactly the order it
 * always did. While it waits, `nextBackgroundPassClipIndex` drains those earlier passes.
 *
 * Never advances while the scale-pass lane is held — a pass 'running', or `scalePassLeaseIndex`,
 * the clip the lane was last granted to while its pass is still due. A clip added after every
 * primary finished would otherwise start its primary on top of that pass. The lease covers the
 * moment between the grant and the clip reporting 'running': a session that saw only 'pending'
 * there would advance.
 *
 * `currentActiveIndex` is clamped into range first so a clip removal (shrinking the array) can't
 * leave the index pointing past the end.
 */
export function nextActiveClipIndex(
  clips: ClipSession[],
  currentActiveIndex: number,
  scalePassLeaseIndex: number | null = null,
): number {
  if (clips.length === 0) return 0
  let index = Math.min(Math.max(currentActiveIndex, 0), clips.length - 1)
  if (scalePassLeaseIndex !== null) return index
  if (clips.some(isBackgroundPassRunning)) return index
  while (index < clips.length - 1 && isDoneWithSharedDetector(clips[index])) {
    const next = clips[index + 1]
    const playbackPrimaryMustWait =
      isPrimaryToCome(next) &&
      primaryMaySampleOnPlaybackPath(next) &&
      clips.slice(0, index + 1).some(hasBackgroundPassAhead)
    if (playbackPrimaryMustWait) break
    index += 1
  }
  return index
}

/**
 * The clip the scale-pass lane was last granted to, as an index into `clips`, while that grant is
 * still live: the clip is still there and its pass is 'pending' or 'running'. `null` otherwise.
 * `MultiClipVideoSession` remembers the granted clip's id across renders and resolves it here.
 */
export function scalePassLeaseIndex(
  clips: ClipSession[],
  grantedClipId: string | null,
): number | null {
  if (grantedClipId === null) return null
  const index = clips.findIndex((c) => c.clipId === grantedClipId)
  if (index === -1) return null
  return hasBackgroundPassAhead(clips[index]) ? index : null
}

/**
 * Which clip may run its background scale pass now, or `null` for none — the scale-pass lane
 * (schedule-scale-passes-after-primaries). At most one pass runs at a time, because the scale-pass
 * detector is one stateful, module-cached MediaPipe instance; and none starts while a primary pass
 * could still sample, so the two never contend for the GPU.
 *
 * In order:
 *   1. a clip whose pass is already 'running' keeps the lane (a started pass is never cancelled),
 *      and so does the clip holding the lease (`scalePassLeaseIndex`) while its pass is still due;
 *   2. nothing, while any primary is sampling or processing;
 *   3. the lowest-index waiting clip sampled on the PLAYBACK path: it still holds the shared
 *      detector until its pass is terminal (`isDoneWithSharedDetector`), so every later primary
 *      waits for it, and withholding its lane would deadlock the session;
 *   4. nothing, while the NEXT primary to run — the first idle clip at or after the active index
 *      whose source has not failed — samples on the sequential path, or has not been probed yet
 *      while its video loads or its probe runs: sequential primaries all run before any scale
 *      pass, and an unprobed clip is most likely an MP4 that will turn out sequential. Only a next
 *      primary KNOWN to sample on the playback path does not block: it is itself waiting for the
 *      earlier passes to drain (`nextActiveClipIndex`), so blocking here would deadlock. The wait
 *      for an unprobed clip cannot deadlock, because its answer needs nothing from either lane —
 *      only its own video to load and its probe, which has a timeout, to settle (strides-6i6.5:
 *      on a slow phone, the lane used to go to clip 1's pass while clip 2 was still loading or
 *      probing, delaying the fused result by the whole pass). An idle clip BEFORE the active index
 *      (reset after an error) can never be handed the detector again, so it is never the next
 *      primary;
 *   5. otherwise the lowest-index clip that is 'ready' with its pass 'pending'.
 *
 * The OUTLINE pass (`strides-uz48`) shares this lane, after every scale pass: step 1 also keeps a
 * running outline pass, a leased outline pass keeps the lane only while no scale pass is due, and
 * a sixth step grants the lowest-index clip whose scale pass is terminal and outline pass pending.
 */
export function nextBackgroundPassClipIndex(
  clips: ClipSession[],
  activeClipIndex: number,
  leaseIndex: number | null = null,
): number | null {
  const running = clips.findIndex(isBackgroundPassRunning)
  if (running !== -1) return running
  if (leaseIndex !== null) {
    const leased = clips[leaseIndex]
    if (isWaitingForScalePass(leased)) return leaseIndex
    // An outline pass keeps its lease only while no scale pass is due anywhere: every scale pass
    // runs before any outline pass.
    if (isWaitingForOutlinePass(leased) && !clips.some(isWaitingForScalePass)) return leaseIndex
  }
  if (clips.some((c) => c.analysis.phase === 'sampling' || c.analysis.phase === 'processing')) {
    return null
  }
  const playback = clips.findIndex((c) => isWaitingForScalePass(c) && sampledOnPlaybackPath(c))
  if (playback !== -1) return playback
  const nextPrimary = clips.find((c, index) => index >= activeClipIndex && isPrimaryToCome(c))
  if (
    nextPrimary !== undefined &&
    (!primaryMaySampleOnPlaybackPath(nextPrimary) || samplingPathPending(nextPrimary))
  ) {
    return null
  }
  const next = clips.findIndex(isWaitingForScalePass)
  if (next !== -1) return next
  // 6. Every scale pass is done: the lowest-index clip whose outline pass is due (`strides-uz48`).
  const outline = clips.findIndex(isWaitingForOutlinePass)
  return outline === -1 ? null : outline
}

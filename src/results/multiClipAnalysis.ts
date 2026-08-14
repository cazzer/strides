import type { VideoSource } from '../video/types'
import type {
  AnalysisPhase,
  ScalePassStatus,
  VideoAnalysisError,
  VideoAnalysisState,
} from './types'
import { fuseFormHeuristicsResults } from './fuseHeuristics'

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
  const allReady = clips.length > 0 && clips.every((c) => c.analysis.phase === 'ready')

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
    start: () => {
      for (const clip of clips) clip.analysis.start()
    },
    reset: () => {
      for (const clip of clips) clip.analysis.reset()
    },
  }
}

function isDoneWithSharedDetector(clip: ClipSession): boolean {
  const primaryDone = clip.analysis.phase === 'ready' || clip.analysis.phase === 'error'
  const scalePassDone =
    clip.analysis.scalePass.status === 'done' ||
    clip.analysis.scalePass.status === 'failed' ||
    clip.analysis.scalePass.status === 'skipped'
  return primaryDone && scalePassDone
}

/**
 * The shared-detector serialization rule (see the change's design.md, D5): a clip is only
 * skipped past once its ENTIRE pipeline — primary analysis run AND background scale pass — has
 * reached a terminal state. Only one clip ever holds a live detector at a time; every other clip
 * must receive `null` (see `MultiClipVideoSession`). For a single clip this is a permanent
 * no-op — the loop's bound (`clips.length - 1`) never lets it advance past the only clip there
 * is, done or not.
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

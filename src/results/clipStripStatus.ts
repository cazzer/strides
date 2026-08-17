import type { VideoSourceStatus } from '../video/types'
import type { AnalysisPhase, ScalePassStatus } from './types'

/**
 * What one clip strip entry is currently reporting.
 *
 * These are NOT a new state machine, and deliberately not a superset of one: every value below is
 * read straight off that clip's own `VideoAnalysisState`/`VideoSource` (design.md D3). `'queued'` is
 * the one derived value — `AnalysisPhase` has no such member, because `'idle'` covers both "nothing
 * has happened yet" and "waiting for the shared detector", and only the session knows which clip
 * currently holds it.
 */
export type ClipStripCondition =
  | 'loading'
  | 'load-error'
  | 'idle'
  | 'queued'
  | 'sampling'
  | 'processing'
  | 'ready'
  | 'error'

export interface ClipStripStatusInput {
  videoStatus: VideoSourceStatus
  phase: AnalysisPhase
  /** 0..1, meaningful during `'sampling'`. */
  progress: number
  isPausedMidAnalysis: boolean
  scalePassStatus: ScalePassStatus
  /** Whether this clip is the one currently holding the shared detector (`nextActiveClipIndex`). */
  isActiveClip: boolean
}

export interface ClipStripStatus {
  condition: ClipStripCondition
  /** Whole percent, `null` unless the condition is `'sampling'`. */
  percent: number | null
  /**
   * Short visible caption. Every condition has a DIFFERENT word (or a percentage), so the five
   * conditions the spec requires be distinguishable are distinguishable by text alone — colour and
   * the bar treatment are redundant encodings on top, never the only ones.
   */
  caption: string
  /**
   * A single non-colour glyph, a third redundant encoding beside the caption and the bar.
   * `aria-hidden` at the call site: the announcement below is what assistive technology reads.
   */
  glyph: string
  /**
   * The full sentence exposed to assistive technology. `'sampling'`/`'processing'` deliberately
   * reuse `ResultsView`'s exact former wording (`Analyzing… 42%`, `Processing results…`, and the
   * paused suffix) — per-clip progress MOVED here rather than being reinvented, so anything that
   * waited on those strings still finds them, now on the clip they belong to.
   */
  announcement: string
}

/** The paused suffix, verbatim from the session progress line this replaces. */
const PAUSED_SUFFIX = ' — paused, resume playback to continue analyzing'

/**
 * Whether this clip's `<video>` must be genuinely on screen right now.
 *
 * **This is a correctness predicate, not a styling one** (`strides-kyu.13`). Concealing a clip's
 * element costs ~20-24% of sampled frames on the playback path — measured, with no threshold: a
 * visible element keeps full throughput down to 60 CSS px, a concealed one loses a fifth at any
 * size and by any mechanism. So the element is on screen exactly while something is reading frames
 * off it, and concealed the rest of the time.
 *
 * Both readers count:
 *   - the primary run, `'sampling'` (and `'processing'`, which is the same run still settling);
 *   - the background scale pass, which on the PLAYBACK path replays and re-samples the very same
 *     canonical element (`useVideoAnalysis.ts`'s scale-pass block) — after `phase` has already
 *     reached `'ready'`. Concealing at `'ready'` would hand that pass the same 20% loss the primary
 *     run was just spared.
 *
 * On the default WebCodecs path neither reader touches the element, so this is simply harmless
 * there; nothing in the UI can tell the two paths apart, and being visible is never the wrong
 * answer.
 */
export function clipHostsLiveElement(
  phase: AnalysisPhase,
  scalePassStatus: ScalePassStatus,
): boolean {
  if (phase === 'sampling' || phase === 'processing') return true
  return scalePassStatus === 'pending' || scalePassStatus === 'running'
}

/**
 * PURE. One clip's strip entry, from that clip's OWN state — never from
 * `computeAggregateAnalysisState`, whose mean progress is exactly the summary this replaces.
 *
 * Order matters: a real `phase` always wins over the video-source conditions behind it, so a clip
 * that is mid-analysis reads as mid-analysis even while its source is technically still `'ready'`.
 * `'queued'` is reachable only from `'idle'`, which is the only phase that is ambiguous.
 */
export function describeClipStripStatus(input: ClipStripStatusInput): ClipStripStatus {
  const { videoStatus, phase, progress, isPausedMidAnalysis, isActiveClip } = input

  if (phase === 'error') {
    return {
      condition: 'error',
      percent: null,
      caption: 'Failed',
      glyph: '!',
      announcement: 'Analysis failed for this clip.',
    }
  }

  if (phase === 'sampling') {
    const percent = Math.round(clamp01(progress) * 100)
    return {
      condition: 'sampling',
      percent,
      caption: `${percent}%`,
      glyph: '◐',
      announcement: `Analyzing… ${percent}%${isPausedMidAnalysis ? PAUSED_SUFFIX : ''}`,
    }
  }

  if (phase === 'processing') {
    return {
      condition: 'processing',
      percent: null,
      caption: 'Working',
      glyph: '◑',
      // Same string the session line used to carry, paused suffix included: `processing` can also
      // be reached with a paused element, and dropping the suffix here would lose the only hint
      // that the reader has to do something.
      announcement: `Processing results…${isPausedMidAnalysis ? PAUSED_SUFFIX : ''}`,
    }
  }

  if (phase === 'ready') {
    // Never the words "analysis complete" — that phrase belongs to the ONE session-level line in
    // `ResultsView`, which the e2e suite and `scripts/ab-person-selection.mjs` both wait on by
    // text. A per-clip entry repeating it would make that wait ambiguous (Playwright's strict
    // mode) rather than merely redundant.
    return {
      condition: 'ready',
      percent: null,
      caption: 'Done',
      glyph: '✓',
      announcement: 'Analyzed.',
    }
  }

  // phase === 'idle' from here down: the video source decides what the entry is waiting for.
  if (videoStatus === 'error') {
    return {
      condition: 'load-error',
      percent: null,
      caption: 'Failed',
      glyph: '!',
      announcement: 'This video could not be loaded.',
    }
  }

  if (videoStatus === 'ready') {
    if (isActiveClip) {
      return {
        condition: 'idle',
        percent: null,
        caption: 'Ready',
        glyph: '▶',
        announcement: 'Ready to analyze.',
      }
    }
    return {
      condition: 'queued',
      percent: null,
      caption: 'Queued',
      glyph: '⋯',
      // Verbatim the hint this replaces, so "waiting for the shared detector" keeps reading as one
      // specific, explained condition rather than a bare label.
      announcement: 'Queued — waiting for another clip to finish analyzing…',
    }
  }

  return {
    condition: 'loading',
    percent: null,
    caption: 'Loading',
    glyph: '⋯',
    announcement: 'Loading video…',
  }
}

/** Progress arrives from a sampler, so a stray NaN or an out-of-range value must not reach a label. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

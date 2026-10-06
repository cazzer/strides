import { describe, expect, it, vi } from 'vitest'
import type { VideoSource } from '../video/types'
import type { ScalePassState, VideoAnalysisError, VideoAnalysisState } from './types'
import type { AnalysisDiagnostics } from './analysisDiagnostics'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import {
  computeAggregateAnalysisState,
  computeFusionSourceIndices,
  nextActiveClipIndex,
  nextScalePassClipIndex,
  scalePassLeaseIndex,
} from './multiClipAnalysis'
import type { ClipSession } from './multiClipAnalysis'

function makeMetric<M extends MetricId>(metric: M, confidence = 1): MetricResult & { metric: M } {
  return {
    metric,
    value: 1,
    unit: 'ratio',
    confidence,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  } as MetricResult & { metric: M }
}

function makeHeuristics(confidence = 1): FormHeuristicsResult {
  return {
    view: {
      view: 'side',
      confidence,
      plausibility: { side: 1, front: 0, ambiguous: 0 },
      diagnostics: {
        bilateralSpreadRatio: null,
        sagittalExcursionRatio: null,
        sagittalExcursionSampleCount: { left: 0, right: 0 },
        sagittalExcursionInterpolatedFraction: { left: 0, right: 0 },
        frameCoverage: 1,
      },
    },
    verticalOscillation: { ...makeMetric('verticalOscillation', confidence), series: [], fit: null },
    verticalRatio: makeMetric('verticalRatio', confidence),
    verticalOscillationCm: { ...makeMetric('verticalOscillationCm', confidence), calibration: null },
    trunkLean: makeMetric('trunkLean', confidence),
    overstriding: makeMetric('overstriding', confidence),
    cadence: makeMetric('cadence', confidence),
    kneeFlexion: makeMetric('kneeFlexion', confidence),
    footStrikePattern: makeMetric('footStrikePattern', confidence),
    stepWidth: makeMetric('stepWidth', confidence),
    stepWidthCm: makeMetric('stepWidthCm', confidence),
    kneeDrive: makeMetric('kneeDrive', confidence),
    armSwingAmplitude: makeMetric('armSwingAmplitude', confidence),
    swingFootLateralExcursion: makeMetric('swingFootLateralExcursion', confidence),
  }
}

function makeVideoSource(): VideoSource {
  return {
    videoRef: { current: null },
    status: 'ready',
    metadata: { durationSec: 10, width: 640, height: 480, frameRate: 30 },
    error: null,
    sourceBlob: null,
    load: vi.fn(),
    reset: vi.fn(),
  }
}

function makeAnalysis(overrides: Partial<VideoAnalysisState> = {}): VideoAnalysisState {
  return {
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics: null,
    diagnostics: null,
    scalePass: { status: 'idle', diagnostics: null },
    error: null,
    // The default MP4 case. A playback-path (or not-yet-probed) clip says so explicitly.
    primarySamplingPath: 'sequential',
    start: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

function makeClip(clipId: string, analysisOverrides: Partial<VideoAnalysisState> = {}): ClipSession {
  return {
    clipId,
    videoSource: makeVideoSource(),
    analysis: makeAnalysis(analysisOverrides),
    poster: null,
  }
}

function makeScalePass(status: ScalePassState['status']): ScalePassState {
  return { status, diagnostics: null }
}

/** Only `sampling.path` is read by the scheduler, so that is all this carries. */
function sampledOn(path: 'sequential' | 'playback'): VideoAnalysisState['diagnostics'] {
  return { sampling: { path } } as unknown as AnalysisDiagnostics
}

/** A clip whose primary pass is done, sampled on `path`, with its scale pass at `status`. */
function makePrimaryDoneClip(
  clipId: string,
  status: ScalePassState['status'],
  path: 'sequential' | 'playback' = 'sequential',
): ClipSession {
  return makeClip(clipId, {
    phase: 'ready',
    heuristics: makeHeuristics(),
    diagnostics: sampledOn(path),
    scalePass: makeScalePass(status),
  })
}

describe('computeAggregateAnalysisState', () => {
  it('is idle with no clips', () => {
    const agg = computeAggregateAnalysisState([])
    expect(agg.phase).toBe('idle')
    expect(agg.heuristics).toBeNull()
    expect(agg.error).toBeNull()
  })

  it('is idle when every clip is idle', () => {
    const clips = [makeClip('a'), makeClip('b')]
    expect(computeAggregateAnalysisState(clips).phase).toBe('idle')
  })

  it('is error if any clip errored, surfacing the first errored clip error', () => {
    const err: VideoAnalysisError = { kind: 'unknown', message: 'boom' }
    const clips = [
      makeClip('a', { phase: 'ready', heuristics: makeHeuristics() }),
      makeClip('b', { phase: 'error', error: err }),
    ]
    const agg = computeAggregateAnalysisState(clips)
    expect(agg.phase).toBe('error')
    expect(agg.error).toBe(err)
  })

  it('reports the FIRST (lowest-index) errored clip when multiple clips error', () => {
    const err0: VideoAnalysisError = { kind: 'unknown', message: 'first' }
    const err1: VideoAnalysisError = { kind: 'unknown', message: 'second' }
    const clips = [makeClip('a', { phase: 'error', error: err0 }), makeClip('b', { phase: 'error', error: err1 })]
    expect(computeAggregateAnalysisState(clips).error).toBe(err0)
  })

  it('is sampling/processing when mixed with ready clips (not ready until every clip is)', () => {
    const clips = [
      makeClip('a', { phase: 'ready', heuristics: makeHeuristics() }),
      makeClip('b', { phase: 'sampling' }),
    ]
    expect(computeAggregateAnalysisState(clips).phase).toBe('sampling')
  })

  it('is NOT idle when one clip is ready and another is idle, genuinely queued behind the shared detector', () => {
    // This is the normal, expected state whenever N>=2 clips are uploaded and the earlier ones
    // haven't all finished yet -- not an edge case. Falling through to 'idle' here would render
    // ResultsView's bare, re-enabled "Analyze" button, indistinguishable from a fresh session,
    // and clicking it would discard clip 'a's finished results via the aggregate start() fan-out.
    const clips = [
      makeClip('a', { phase: 'ready', heuristics: makeHeuristics() }),
      makeClip('b', { phase: 'idle' }),
    ]
    const phase = computeAggregateAnalysisState(clips).phase
    expect(phase).not.toBe('idle')
  })

  it('is ready only when every clip is ready, and fuses heuristics at that point', () => {
    const h0 = makeHeuristics(0.9)
    const h1 = makeHeuristics(0.1)
    const clips = [
      makeClip('a', { phase: 'ready', heuristics: h0 }),
      makeClip('b', { phase: 'ready', heuristics: h1 }),
    ]
    const agg = computeAggregateAnalysisState(clips)
    expect(agg.phase).toBe('ready')
    expect(agg.heuristics).not.toBeNull()
    // clip a has higher confidence on every metric -- fused view should reflect that.
    expect(agg.heuristics!.trunkLean.confidence).toBe(0.9)
  })

  it('carries no session-level progress — progress is per clip (strides-e4c.3)', () => {
    // The session ignores progress changes, so an average here would be a stale snapshot.
    const clips = [makeClip('a', { progress: 0.2 }), makeClip('b', { progress: 0.6 })]
    expect('progress' in computeAggregateAnalysisState(clips)).toBe(false)
  })

  it('isPausedMidAnalysis is true if any clip is paused', () => {
    const clips = [makeClip('a'), makeClip('b', { isPausedMidAnalysis: true })]
    expect(computeAggregateAnalysisState(clips).isPausedMidAnalysis).toBe(true)
  })

  it('robustFrames/diagnostics/scalePass.diagnostics are always null at the aggregate level', () => {
    const clips = [
      makeClip('a', {
        phase: 'ready',
        heuristics: makeHeuristics(),
        robustFrames: [],
        diagnostics: {} as VideoAnalysisState['diagnostics'],
        scalePass: { status: 'done', diagnostics: {} as ScalePassState['diagnostics'] },
      }),
    ]
    const agg = computeAggregateAnalysisState(clips)
    expect(agg.robustFrames).toBeNull()
    expect(agg.diagnostics).toBeNull()
    expect(agg.scalePass.diagnostics).toBeNull()
  })

  it('scalePass.status priority is running > pending > done > failed > skipped', () => {
    const doneFailedSkipped = [
      makeClip('a', { scalePass: makeScalePass('done') }),
      makeClip('b', { scalePass: makeScalePass('failed') }),
      makeClip('c', { scalePass: makeScalePass('skipped') }),
      makeClip('d', { scalePass: makeScalePass('running') }),
    ]
    expect(computeAggregateAnalysisState(doneFailedSkipped).scalePass.status).toBe('running')

    const failedAndSkipped = [
      makeClip('a', { scalePass: makeScalePass('skipped') }),
      makeClip('b', { scalePass: makeScalePass('failed') }),
    ]
    expect(computeAggregateAnalysisState(failedAndSkipped).scalePass.status).toBe('failed')
  })

  it('reports pending, not done, while one clip is finished and another is still queued for its pass', () => {
    // With passes queued behind every primary, clip 1 can be 'done' while clip 2 waits its turn.
    // Reporting 'done' here would tell the status line the second look is over ("added N more
    // metrics") while a pass is still to come.
    const clips = [makePrimaryDoneClip('a', 'done'), makePrimaryDoneClip('b', 'pending')]
    expect(computeAggregateAnalysisState(clips).scalePass.status).toBe('pending')
    const running = [makePrimaryDoneClip('a', 'pending'), makePrimaryDoneClip('b', 'running')]
    expect(computeAggregateAnalysisState(running).scalePass.status).toBe('running')
  })

  it('start()/reset() fan out to every clip', () => {
    const clips = [makeClip('a'), makeClip('b')]
    const agg = computeAggregateAnalysisState(clips)

    agg.start()
    expect(clips[0].analysis.start).toHaveBeenCalledTimes(1)
    expect(clips[1].analysis.start).toHaveBeenCalledTimes(1)

    agg.reset()
    expect(clips[0].analysis.reset).toHaveBeenCalledTimes(1)
    expect(clips[1].analysis.reset).toHaveBeenCalledTimes(1)
  })

  it('start() skips a clip that is already ready, even if called unexpectedly', () => {
    // Belt-and-suspenders alongside the phase-combinator fix above: whatever state this
    // aggregate is computed from, an already-finished clip's results must never be discardable
    // by a fanned-out start() call.
    const clips = [
      makeClip('a', { phase: 'ready', heuristics: makeHeuristics() }),
      makeClip('b', { phase: 'idle' }),
    ]
    const agg = computeAggregateAnalysisState(clips)

    agg.start()
    expect(clips[0].analysis.start).not.toHaveBeenCalled()
    expect(clips[1].analysis.start).toHaveBeenCalledTimes(1)
  })
})

describe('computeFusionSourceIndices', () => {
  function makeReadyClip(
    clipId: string,
    heuristics: FormHeuristicsResult,
  ): ClipSession {
    return makeClip(clipId, { phase: 'ready', heuristics })
  }

  it('indexes into the same array, per metric, agreeing with the aggregate it accompanies', () => {
    const clips = [
      makeReadyClip('a', { ...makeHeuristics(0.4), trunkLean: makeMetric('trunkLean', 0.95) }),
      makeReadyClip('b', makeHeuristics(0.6)),
    ]

    const indices = computeFusionSourceIndices(clips)!
    const fused = computeAggregateAnalysisState(clips).heuristics!

    expect(indices.trunkLean).toBe(0)
    expect(indices.cadence).toBe(1)
    // The point of the map: `clips[indices[metric]]` is the clip whose own result was selected,
    // which is what makes that clip's frames and blob the right ones to resolve against.
    expect(fused.trunkLean.confidence).toBe(
      clips[indices.trunkLean].analysis.heuristics!.trunkLean.confidence,
    )
    expect(fused.cadence.confidence).toBe(
      clips[indices.cadence].analysis.heuristics!.cadence.confidence,
    )
  })

  it('maps every metric to clip 0 for a single ready clip', () => {
    const indices = computeFusionSourceIndices([makeReadyClip('a', makeHeuristics())])!

    expect(Object.values(indices).every((index) => index === 0)).toBe(true)
  })

  it('is null until every clip is ready — the same gate the fused aggregate uses', () => {
    const stillAnalyzing = [
      makeReadyClip('a', makeHeuristics()),
      makeClip('b', { phase: 'sampling' }),
    ]

    expect(computeFusionSourceIndices(stillAnalyzing)).toBeNull()
    expect(computeAggregateAnalysisState(stillAnalyzing).heuristics).toBeNull()
  })

  it('is null for a session with no clips', () => {
    expect(computeFusionSourceIndices([])).toBeNull()
  })
})

describe('nextActiveClipIndex', () => {
  it('stays 0 with no clips', () => {
    expect(nextActiveClipIndex([], 0)).toBe(0)
  })

  it('never advances for a single clip, terminal or not', () => {
    const notDone = [makeClip('a')]
    expect(nextActiveClipIndex(notDone, 0)).toBe(0)

    const done = [
      makeClip('a', { phase: 'ready', scalePass: makeScalePass('done') }),
    ]
    expect(nextActiveClipIndex(done, 0)).toBe(0)
  })

  it('does not advance while the active clip has not reached a terminal phase', () => {
    const clips = [makeClip('a', { phase: 'sampling' }), makeClip('b')]
    expect(nextActiveClipIndex(clips, 0)).toBe(0)
  })

  it('advances as soon as a sequential-path clip is ready, its scale pass still pending', () => {
    // schedule-scale-passes-after-primaries: the shared detector is the PRIMARY one, and the
    // scale pass is scheduled on its own lane after every primary.
    const clips = [makePrimaryDoneClip('a', 'pending'), makeClip('b')]
    expect(nextActiveClipIndex(clips, 0)).toBe(1)
  })

  it('a playback-path clip keeps the detector until its scale pass is terminal', () => {
    for (const status of ['pending', 'running'] satisfies ScalePassState['status'][]) {
      expect(nextActiveClipIndex([makePrimaryDoneClip('a', status, 'playback'), makeClip('b')], 0)).toBe(0)
    }
    for (const status of ['done', 'failed', 'skipped'] satisfies ScalePassState['status'][]) {
      expect(nextActiveClipIndex([makePrimaryDoneClip('a', status, 'playback'), makeClip('b')], 0)).toBe(1)
    }
  })

  it('advances once the active clip is fully terminal (primary AND scale pass)', () => {
    const clips = [
      makeClip('a', { phase: 'ready', scalePass: makeScalePass('done') }),
      makeClip('b'),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(1)
  })

  it('does not advance into a newly added clip while any scale pass is running', () => {
    // Every primary finished and clip a's pass is running when clip c is added: its primary must
    // wait for that pass rather than share the GPU with it.
    const clips = [makePrimaryDoneClip('a', 'running'), makePrimaryDoneClip('b', 'pending'), makeClip('c')]
    expect(nextActiveClipIndex(clips, 1)).toBe(1)
    const passDone = [makePrimaryDoneClip('a', 'done'), makePrimaryDoneClip('b', 'pending'), makeClip('c')]
    expect(nextActiveClipIndex(passDone, 1)).toBe(2)
  })

  it('advances past an errored clip too, even though its scale pass never left idle', () => {
    // A real errored clip's scalePass never reaches a terminal status -- useVideoAnalysis.ts's
    // scale-pass effect only ever fires out of phase === 'ready', and every 'error' transition
    // spreads idleState() (scalePass: { status: 'idle', diagnostics: null }) verbatim. A fixture
    // asserting 'skipped' here would test a state the real state machine can never produce and
    // would pass even against the pre-fix gate (which required BOTH phase-terminal AND
    // scalePass-terminal) -- this is the exact reachable state instead, so this test actually
    // exercises the fix: it fails against `(phase === 'ready' || phase === 'error') &&
    // scalePassTerminal` and passes against `phase === 'error' || (phase === 'ready' &&
    // scalePassTerminal)`.
    const clips = [
      makeClip('a', {
        phase: 'error',
        error: { kind: 'unknown', message: 'x' },
        scalePass: { status: 'idle', diagnostics: null },
      }),
      makeClip('b'),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(1)
  })

  it('does not deadlock: an errored clip releases the detector to the very next clip in the queue', () => {
    // The concrete deadlock this bug produced: a clip queued directly behind an errored clip
    // stuck "Queued" forever (analysis.phase 'idle', detector null), with no automatic recovery,
    // because the errored clip's scalePass.status could never become terminal. `nextActiveIndex`
    // only ever walks past clips that are THEMSELVES terminal -- a genuinely queued ('idle')
    // clip is exactly where the walk should stop, since it hasn't had a chance to run yet (it's
    // that clip's own eventual 'ready'/'error' transition that lets the walk continue past it).
    // What must not happen is getting stuck at index 0, on the errored clip itself.
    const clips = [
      makeClip('a', {
        phase: 'error',
        error: { kind: 'unknown', message: 'x' },
        scalePass: { status: 'idle', diagnostics: null },
      }),
      makeClip('b'),
      makeClip('c'),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(1)
  })

  it('advances through a run of an errored clip followed by an already-finished clip in one call', () => {
    // Mirrors the existing "advances through multiple already-finished clips" case above, but
    // with the run starting on an errored clip rather than a ready one -- both terminal kinds
    // should chain through a single nextActiveClipIndex call identically.
    const clips = [
      makeClip('a', {
        phase: 'error',
        error: { kind: 'unknown', message: 'x' },
        scalePass: { status: 'idle', diagnostics: null },
      }),
      makeClip('b', { phase: 'ready', scalePass: makeScalePass('done') }),
      makeClip('c'),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(2)
  })

  it('advances through multiple already-finished clips in one call', () => {
    const clips = [
      makeClip('a', { phase: 'ready', scalePass: makeScalePass('done') }),
      makeClip('b', { phase: 'ready', scalePass: makeScalePass('failed') }),
      makeClip('c'),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(2)
  })

  it('stops at the last clip even if it is also terminal', () => {
    const clips = [
      makeClip('a', { phase: 'ready', scalePass: makeScalePass('done') }),
      makeClip('b', { phase: 'ready', scalePass: makeScalePass('done') }),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(1)
  })

  it('clamps a stale index after a clip is removed', () => {
    // Active index pointed at clip 2, but the array has since shrunk to 2 clips.
    const clips = [makeClip('a', { phase: 'ready', scalePass: makeScalePass('done') }), makeClip('b')]
    expect(nextActiveClipIndex(clips, 2)).toBe(1)
  })
})

describe('nextScalePassClipIndex', () => {
  const done = (id: string) => makePrimaryDoneClip(id, 'done')
  const pending = (id: string) => makePrimaryDoneClip(id, 'pending')
  const running = (id: string) => makePrimaryDoneClip(id, 'running')

  it('is null with no clips', () => {
    expect(nextScalePassClipIndex([], 0)).toBeNull()
  })

  it('grants a lone clip its pass as soon as its primary is ready', () => {
    expect(nextScalePassClipIndex([pending('a')], 0)).toBe(0)
    expect(nextScalePassClipIndex([makeClip('a', { phase: 'sampling' })], 0)).toBeNull()
  })

  it('is null while any primary is sampling or processing', () => {
    for (const phase of ['sampling', 'processing'] as const) {
      expect(nextScalePassClipIndex([pending('a'), makeClip('b', { phase })], 1)).toBeNull()
    }
  })

  it('is null while a later clip is idle with a usable source — its primary is still to come', () => {
    expect(nextScalePassClipIndex([pending('a'), makeClip('b')], 1)).toBeNull()
    // Still loading counts as coming, too.
    const loading = makeClip('b')
    loading.videoSource = { ...loading.videoSource, status: 'loading' }
    expect(nextScalePassClipIndex([pending('a'), loading], 1)).toBeNull()
  })

  it('does not wait on a clip whose source failed to load, or one that errored', () => {
    const failedLoad = makeClip('b')
    failedLoad.videoSource = { ...failedLoad.videoSource, status: 'error' }
    expect(nextScalePassClipIndex([pending('a'), failedLoad], 1)).toBe(0)

    const errored = makeClip('b', { phase: 'error', error: { kind: 'unknown', message: 'x' } })
    expect(nextScalePassClipIndex([pending('a'), errored], 1)).toBe(0)
  })

  it('does not wait on an idle clip BEFORE the active index, which can never get the detector again', () => {
    // An errored clip reset by "Try again" goes back to idle behind the active index.
    expect(nextScalePassClipIndex([makeClip('a'), pending('b')], 1)).toBe(1)
  })

  it('grants the lowest-index pending clip once every primary is done', () => {
    expect(nextScalePassClipIndex([done('a'), pending('b'), pending('c')], 2)).toBe(1)
    expect(nextScalePassClipIndex([pending('a'), pending('b'), pending('c')], 2)).toBe(0)
  })

  it('keeps the lane for a running pass, over a lower-index pending one and over an outstanding primary', () => {
    expect(nextScalePassClipIndex([pending('a'), running('b')], 1)).toBe(1)
    // A clip added while the pass runs does not take the lane from it.
    expect(nextScalePassClipIndex([pending('a'), running('b'), makeClip('c')], 1)).toBe(1)
  })

  it('is null once every pass is terminal', () => {
    expect(nextScalePassClipIndex([done('a'), makePrimaryDoneClip('b', 'skipped')], 1)).toBeNull()
  })

  it('a playback-path clip gets the lane straight after its own primary, even with primaries still to come', () => {
    // It still holds the shared detector until its pass is terminal, so the next clip's primary
    // waits for it — withholding the lane here would deadlock the session.
    const clips = [pending('a'), makePrimaryDoneClip('b', 'pending', 'playback'), makeClip('c')]
    expect(nextScalePassClipIndex(clips, 1)).toBe(1)
  })
})

describe('the two lanes together (schedule-scale-passes-after-primaries)', () => {
  /**
   * Plays a session forward one transition at a time, the way `MultiClipVideoSession` recomputes
   * both lanes every render: whatever holds a lane finishes its step, then both are recomputed.
   * Records each step as `P<n>` / `S<n>`, and asserts at every step that a primary and a scale pass
   * never run at once and that at most one scale pass runs.
   */
  function simulate(paths: ('sequential' | 'playback')[]): string[] {
    let clips: ClipSession[] = paths.map((path, i) =>
      makeClip(String(i + 1), { primarySamplingPath: path }),
    )
    let active = 0
    const order: string[] = []
    const set = (index: number, overrides: Partial<VideoAnalysisState>) => {
      clips = clips.map((c, i) =>
        i === index ? { ...c, analysis: { ...c.analysis, ...overrides } } : c,
      )
    }
    for (let step = 0; step < 4 * paths.length; step += 1) {
      active = nextActiveClipIndex(clips, active)
      const lane = nextScalePassClipIndex(clips, active)
      const primary = clips[active].analysis.phase === 'idle' ? active : null
      expect(primary !== null && lane !== null).toBe(false)
      if (primary !== null) {
        set(primary, { phase: 'sampling' })
        expect(nextScalePassClipIndex(clips, active)).toBeNull()
        set(primary, {
          phase: 'ready',
          diagnostics: sampledOn(paths[primary]),
          scalePass: makeScalePass('pending'),
        })
        order.push(`P${primary + 1}`)
      } else if (lane !== null) {
        set(lane, { scalePass: makeScalePass('running') })
        expect(nextActiveClipIndex(clips, active)).toBe(active)
        expect(nextScalePassClipIndex(clips, active)).toBe(lane)
        expect(clips.filter((c) => c.analysis.scalePass.status === 'running')).toHaveLength(1)
        set(lane, { scalePass: makeScalePass('done') })
        order.push(`S${lane + 1}`)
      }
    }
    return order
  }

  it('runs every primary before any scale pass on the sequential path: P1 P2 P3 S1 S2 S3', () => {
    expect(simulate(['sequential', 'sequential', 'sequential'])).toEqual([
      'P1', 'P2', 'P3', 'S1', 'S2', 'S3',
    ])
  })

  it('keeps the old interleaving on the playback path: P1 S1 P2 S2 P3 S3', () => {
    expect(simulate(['playback', 'playback', 'playback'])).toEqual([
      'P1', 'S1', 'P2', 'S2', 'P3', 'S3',
    ])
  })

  // A playback-path primary sees exactly the reference order: it starts only once every earlier
  // clip's pass is terminal (design.md D9 — measured, a WebM primary started right after MediaPipe
  // detector creation detected 93/97 where the reference order detected 99/99).
  it('[seq, webm] keeps the reference order: P1 S1 P2 S2', () => {
    expect(simulate(['sequential', 'playback'])).toEqual(['P1', 'S1', 'P2', 'S2'])
  })

  it('[seq, seq, webm] runs the sequential primaries first, then drains before the webm: P1 P2 S1 S2 P3 S3', () => {
    expect(simulate(['sequential', 'sequential', 'playback'])).toEqual([
      'P1', 'P2', 'S1', 'S2', 'P3', 'S3',
    ])
  })

  it('[seq, webm, seq] mixes the two rules without deadlocking', () => {
    expect(simulate(['sequential', 'playback', 'sequential'])).toEqual([
      'P1', 'S1', 'P2', 'S2', 'P3', 'S3',
    ])
  })

  it('[webm, seq, seq] runs the webm pair first, then the sequential schedule', () => {
    expect(simulate(['playback', 'sequential', 'sequential'])).toEqual([
      'P1', 'S1', 'P2', 'P3', 'S2', 'S3',
    ])
  })

  it('runs a lone clip as P1 S1', () => {
    expect(simulate(['sequential'])).toEqual(['P1', 'S1'])
  })
})

describe('the scale-pass lease and clips that cannot run (review round 1)', () => {
  const pending = (id: string) => makePrimaryDoneClip(id, 'pending')

  function failedLoad(id: string): ClipSession {
    const clip = makeClip(id)
    clip.videoSource = { ...clip.videoSource, status: 'error' }
    return clip
  }

  it('does not advance into a clip added after the lane was granted, while the granted pass still reads pending', () => {
    // The lane went to clip a; clip c was added before a's 'running' reached the session.
    const clips = [pending('a'), makePrimaryDoneClip('b', 'done'), makeClip('c')]
    const lease = scalePassLeaseIndex(clips, 'a')
    expect(lease).toBe(0)
    expect(nextActiveClipIndex(clips, 1, lease)).toBe(1)
    // ...and the lease keeps the lane, although c's primary now counts as outstanding.
    expect(nextScalePassClipIndex(clips, 1, lease)).toBe(0)
    // Without the lease, both would have moved on.
    expect(nextActiveClipIndex(clips, 1)).toBe(2)
    expect(nextScalePassClipIndex(clips, 1)).toBeNull()
  })

  it('resolves a lease only while the granted clip is there and its pass is due or running', () => {
    const clips = [pending('a'), makePrimaryDoneClip('b', 'running'), makePrimaryDoneClip('c', 'done')]
    expect(scalePassLeaseIndex(clips, null)).toBeNull()
    expect(scalePassLeaseIndex(clips, 'gone')).toBeNull()
    expect(scalePassLeaseIndex(clips, 'a')).toBe(0)
    expect(scalePassLeaseIndex(clips, 'b')).toBe(1)
    expect(scalePassLeaseIndex(clips, 'c')).toBeNull()
    expect(scalePassLeaseIndex([makeClip('a')], 'a')).toBeNull()
  })

  it('A clip that cannot run does not hold up the passes: the active index walks past a failed load', () => {
    // Before this, the active index stopped on a clip whose video never loaded, so clip c's
    // primary never ran, it stayed an outstanding primary, and clip a's pass waited forever.
    const clips = [pending('a'), failedLoad('b'), makeClip('c')]
    const active = nextActiveClipIndex(clips, 1)
    expect(active).toBe(2)
    expect(nextScalePassClipIndex(clips, active)).toBeNull()

    const afterC = [pending('a'), failedLoad('b'), pending('c')]
    expect(nextActiveClipIndex(afterC, active)).toBe(2)
    expect(nextScalePassClipIndex(afterC, 2)).toBe(0)
  })

  it('a failed load as the last clip does not count as an outstanding primary', () => {
    const clips = [pending('a'), failedLoad('b')]
    const active = nextActiveClipIndex(clips, 0)
    expect(active).toBe(1)
    expect(nextScalePassClipIndex(clips, active)).toBe(0)
  })
})

describe('a playback-path primary waits for earlier passes (design.md D9)', () => {
  const pending = (id: string) => makePrimaryDoneClip(id, 'pending')
  const idle = (id: string, primarySamplingPath: 'sequential' | 'playback' | null) =>
    makeClip(id, { primarySamplingPath })

  it('is not advanced into while an earlier pass is pending, and the lane drains that pass meanwhile', () => {
    const clips = [pending('a'), idle('b', 'playback')]
    const active = nextActiveClipIndex(clips, 0)
    expect(active).toBe(0)
    expect(nextScalePassClipIndex(clips, active)).toBe(0)
  })

  it('is advanced into once every earlier pass is terminal', () => {
    const clips = [makePrimaryDoneClip('a', 'failed'), idle('b', 'playback')]
    expect(nextActiveClipIndex(clips, 0)).toBe(1)
  })

  it('treats a clip whose probe has not answered as playback', () => {
    const clips = [pending('a'), idle('b', null)]
    expect(nextActiveClipIndex(clips, 0)).toBe(0)
    expect(nextScalePassClipIndex(clips, 0)).toBe(0)
  })

  it('does not hold back a sequential primary, which still runs before any pass', () => {
    const clips = [pending('a'), idle('b', 'sequential')]
    const active = nextActiveClipIndex(clips, 0)
    expect(active).toBe(1)
    expect(nextScalePassClipIndex(clips, active)).toBeNull()
  })

  it('drains the earlier passes in index order before the playback primary', () => {
    const clips = [pending('a'), pending('b'), idle('c', 'playback')]
    const active = nextActiveClipIndex(clips, 1)
    expect(active).toBe(1)
    expect(nextScalePassClipIndex(clips, active)).toBe(0)
    const afterA = [makePrimaryDoneClip('a', 'done'), pending('b'), idle('c', 'playback')]
    expect(nextActiveClipIndex(afterA, 1)).toBe(1)
    expect(nextScalePassClipIndex(afterA, 1)).toBe(1)
  })

  it('ignores a failed load or an errored clip ahead of it', () => {
    const failedLoad = idle('b', 'playback')
    failedLoad.videoSource = { ...failedLoad.videoSource, status: 'error' }
    const clips = [makePrimaryDoneClip('a', 'done'), failedLoad, idle('c', 'playback')]
    expect(nextActiveClipIndex(clips, 0)).toBe(2)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { VideoSource } from '../video/types'
import type { ScalePassState, VideoAnalysisError, VideoAnalysisState } from './types'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import {
  computeAggregateAnalysisState,
  computeFusionSourceIndices,
  nextActiveClipIndex,
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
    armSwingSymmetry: makeMetric('armSwingSymmetry', confidence),
    footStrikePattern: makeMetric('footStrikePattern', confidence),
    stepWidth: makeMetric('stepWidth', confidence),
    stepWidthCm: makeMetric('stepWidthCm', confidence),
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

describe('computeAggregateAnalysisState', () => {
  it('is idle with no clips', () => {
    const agg = computeAggregateAnalysisState([])
    expect(agg.phase).toBe('idle')
    expect(agg.progress).toBe(0)
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

  it('averages progress across clips', () => {
    const clips = [makeClip('a', { progress: 0.2 }), makeClip('b', { progress: 0.6 })]
    expect(computeAggregateAnalysisState(clips).progress).toBeCloseTo(0.4)
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

  it('scalePass.status priority is running > done > failed > skipped', () => {
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

  it('does not advance while the active clip is ready but its scale pass is still pending/running', () => {
    const clips = [
      makeClip('a', { phase: 'ready', scalePass: makeScalePass('running') }),
      makeClip('b'),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(0)
  })

  it('advances once the active clip is fully terminal (primary AND scale pass)', () => {
    const clips = [
      makeClip('a', { phase: 'ready', scalePass: makeScalePass('done') }),
      makeClip('b'),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(1)
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

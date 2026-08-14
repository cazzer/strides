import { describe, expect, it, vi } from 'vitest'
import type { VideoSource } from '../video/types'
import type { ScalePassState, VideoAnalysisError, VideoAnalysisState } from './types'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import {
  computeAggregateAnalysisState,
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
      diagnostics: { bilateralSpreadRatio: null, sagittalExcursionRatio: null, frameCoverage: 1 },
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
  }
}

function makeVideoSource(): VideoSource {
  return {
    videoRef: { current: null },
    status: 'ready',
    metadata: { durationSec: 10, width: 640, height: 480, frameRate: 30 },
    error: null,
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

  it('advances past an errored clip too (error counts as primary-terminal)', () => {
    const clips = [
      makeClip('a', {
        phase: 'error',
        error: { kind: 'unknown', message: 'x' },
        scalePass: makeScalePass('skipped'),
      }),
      makeClip('b'),
    ]
    expect(nextActiveClipIndex(clips, 0)).toBe(1)
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

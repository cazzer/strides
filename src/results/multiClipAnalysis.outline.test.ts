import { describe, expect, it, vi } from 'vitest'
import type { VideoSource } from '../video/types'
import type { AnalysisDiagnostics } from './analysisDiagnostics'
import type { OutlinePassState, ScalePassState, VideoAnalysisState } from './types'
import {
  computeAggregateAnalysisState,
  nextActiveClipIndex,
  nextBackgroundPassClipIndex,
  scalePassLeaseIndex,
  backgroundPassKindAt,
} from './multiClipAnalysis'
import type { BackgroundPassLease, ClipSession } from './multiClipAnalysis'
import { makeHeuristics } from './__fixtures__/metricResult'

// The outline pass (`strides-uz48`) shares the background lane, after every scale pass.

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

function makeClip(clipId: string, overrides: Partial<VideoAnalysisState> = {}): ClipSession {
  return {
    clipId,
    videoSource: makeVideoSource(),
    analysis: {
      phase: 'idle',
      progress: 0,
      isPausedMidAnalysis: false,
      robustFrames: null,
      heuristics: null,
      diagnostics: null,
      scalePass: { status: 'idle', diagnostics: null },
      error: null,
      primarySamplingPath: 'sequential',
      start: vi.fn(),
      reset: vi.fn(),
      ...overrides,
    },
    poster: null,
  }
}

const sequential = { sampling: { path: 'sequential' } } as unknown as AnalysisDiagnostics
const scale = (status: ScalePassState['status']): ScalePassState => ({ status, diagnostics: null })

function readyClip(clipId: string, scaleStatus: ScalePassState['status'], outline: OutlinePassState['status']) {
  return makeClip(clipId, {
    phase: 'ready',
    heuristics: makeHeuristics(),
    diagnostics: sequential,
    scalePass: scale(scaleStatus),
    outlinePass: { status: outline },
  })
}

/**
 * Plays a session forward as `MultiClipVideoSession` does — the lease remembered as {clip, pass}
 * across steps — recording `P<n>`/`S<n>`/`O<n>`. `addAfterScaleOf` adds an idle clip while that
 * clip's scale pass runs.
 */
function simulate(count: number, outlineOn: number[], addAfterScaleOf?: number): string[] {
  let clips: ClipSession[] = Array.from({ length: count }, (_, i) => makeClip(String(i + 1)))
  let active = 0
  let lease: BackgroundPassLease | null = null
  const order: string[] = []
  const set = (index: number, overrides: Partial<VideoAnalysisState>) => {
    clips = clips.map((c, i) => (i === index ? { ...c, analysis: { ...c.analysis, ...overrides } } : c))
  }
  const schedule = () => {
    const leaseIndex = scalePassLeaseIndex(clips, lease?.clipId ?? null, lease?.pass)
    active = nextActiveClipIndex(clips, active, leaseIndex)
    const lane = nextBackgroundPassClipIndex(clips, active, leaseIndex, lease?.pass)
    lease = lane === null ? null : { clipId: clips[lane].clipId, pass: backgroundPassKindAt(clips, lane) }
    return lane
  }
  for (let step = 0; step < 8 * (count + 1); step += 1) {
    const lane = schedule()
    const primary = clips[active].analysis.phase === 'idle' ? active : null
    expect(primary !== null && lane !== null).toBe(false)
    if (primary !== null) {
      set(primary, {
        phase: 'ready',
        diagnostics: sequential,
        scalePass: scale('pending'),
        outlinePass: outlineOn.includes(primary + 1)
          ? { status: 'pending' }
          : { status: 'skipped', reason: 'not-front' },
      })
      order.push(`P${primary + 1}`)
    } else if (lane !== null) {
      if (clips[lane].analysis.scalePass.status === 'pending') {
        set(lane, { scalePass: scale('running') })
        expect(schedule()).toBe(lane)
        if (addAfterScaleOf === lane + 1) {
          clips = [...clips, makeClip(String(clips.length + 1))]
          expect(schedule()).toBe(lane)
        }
        set(lane, { scalePass: scale('done') })
        order.push(`S${lane + 1}`)
      } else {
        set(lane, { outlinePass: { status: 'running' } })
        // No primary advances, and the lane stays put, while an outline pass runs.
        const before = active
        expect(schedule()).toBe(lane)
        expect(active).toBe(before)
        set(lane, { outlinePass: { status: 'done' } })
        order.push(`O${lane + 1}`)
      }
    }
  }
  return order
}

describe('the outline pass in the background lane', () => {
  it('runs primary 1,2,3, scale 1,2,3, then the outline pass: P1 P2 P3 S1 S2 S3 O3', () => {
    expect(simulate(3, [3])).toEqual(['P1', 'P2', 'P3', 'S1', 'S2', 'S3', 'O3'])
  })

  it('runs several outline passes in index order, after every scale pass', () => {
    expect(simulate(3, [1, 3])).toEqual(['P1', 'P2', 'P3', 'S1', 'S2', 'S3', 'O1', 'O3'])
  })

  it('runs a lone front clip as P1 S1 O1', () => {
    expect(simulate(1, [1])).toEqual(['P1', 'S1', 'O1'])
  })

  it("clip added while scale pass N runs → that clip's primary runs before N's outline", () => {
    // A scale lease must not carry over into the same clip's outline pass (review, strides-uz48).
    expect(simulate(1, [1], 1)).toEqual(['P1', 'S1', 'P2', 'S2', 'O1'])
  })

  it("ends a scale lease with the scale pass: it never leases the same clip's outline pass", () => {
    const clips = [readyClip('1', 'done', 'pending'), makeClip('2')]
    expect(scalePassLeaseIndex(clips, '1', 'scale')).toBeNull()
    expect(scalePassLeaseIndex(clips, '1', 'outline')).toBe(0)
  })

  it('does not let a leased outline pass jump a scale pass due on another clip', () => {
    const clips = [readyClip('1', 'done', 'pending'), readyClip('2', 'pending', 'skipped')]
    expect(scalePassLeaseIndex(clips, '1', 'outline')).toBe(0)
    expect(nextBackgroundPassClipIndex(clips, 1, 0, 'outline')).toBe(1)
  })

  it('keeps the lane on a leased outline pass once no scale pass is due', () => {
    const clips = [readyClip('1', 'done', 'pending'), readyClip('2', 'done', 'skipped'), makeClip('3')]
    expect(nextBackgroundPassClipIndex(clips, 2, 0, 'outline')).toBe(0)
    // ...and the clip added meanwhile waits for it.
    expect(nextActiveClipIndex(clips, 1, 0)).toBe(1)
  })

  it('does not advance into a clip added while an outline pass runs', () => {
    const clips = [readyClip('1', 'done', 'running'), makeClip('2')]
    expect(nextActiveClipIndex(clips, 0)).toBe(0)
    expect(nextBackgroundPassClipIndex(clips, 0)).toBe(0)
  })

  it('aggregates the outline status across clips', () => {
    const clips = [readyClip('1', 'done', 'skipped'), readyClip('2', 'done', 'running')]
    expect(computeAggregateAnalysisState(clips).outlinePass?.status).toBe('running')
  })
})

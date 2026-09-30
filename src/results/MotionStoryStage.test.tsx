import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { METRIC_LABELS } from './metricConfidence'
import { MotionStoryStage } from './MotionStoryStage'
import type { MetricCardEvidence } from './MetricsPanel'
import type { ClipSession } from './multiClipAnalysis'
import type { VideoAnalysisState } from './types'

const sourceIndices = Object.fromEntries(
  (Object.keys(METRIC_LABELS) as MetricId[]).map((metric) => [metric, 0]),
) as Record<MetricId, number>

function frames(detected: boolean): RobustPoseFrame[] {
  return [{
    timestamp: 0,
    source: detected ? 'detected' : 'missing',
    pixelsPerMeter: null,
    keypoints: COMMON_KEYPOINT_NAMES.map((name, index) => ({
      name, x: detected ? index * 10 : null, y: detected ? index * 5 : null,
      score: detected ? 0.9 : 0,
      status: detected ? 'detected' : 'unrecoverable',
    })),
  }]
}

function setup(detected: boolean, evidence: MetricCardEvidence[] = [], samples = frames(detected)) {
  const robustFrames = samples
  const heuristics = Object.fromEntries(
    (Object.keys(METRIC_LABELS) as MetricId[]).map((metric) => [metric, {
      metric, value: metric === 'cadence' ? 180 : null,
      viewFit: 'primary', confidence: 1,
    }]),
  ) as unknown as FormHeuristicsResult
  const analysis = {
    phase: 'ready', heuristics, scalePass: { status: 'skipped', diagnostics: null },
  } as VideoAnalysisState
  const clips = [0, 1].map((index) => ({
    clipId: String(index), analysis: { robustFrames, scalePass: {} },
  })) as ClipSession[]
  const resultsRef = { current: document.createElement('div') }
  const headerRef = { current: document.createElement('header') }
  return render(
    <MotionStoryStage
      analysis={analysis}
      clips={clips}
      sourceIndices={sourceIndices}
      evidence={evidence}
      resultsRef={resultsRef}
      headerRef={headerRef}
      viewMode="classic"
    />,
  )
}

describe('MotionStoryStage', () => {
  it('keeps the reference illustration and withholds clip attribution when an evidence pose is unusable', () => {
    setup(false, [{
      metric: 'cadence', clipIndex: 0, pending: false,
      items: [{
        canvas: document.createElement('canvas'),
        plan: { base: { timestamp: 0, keypoints: [] }, crop: { x: 0, y: 0, side: 100 } },
      }],
    } as unknown as MetricCardEvidence])
    expect(screen.getByText(/Reference illustration shown; a reliable full-body pose/)).toBeInTheDocument()
    expect(document.querySelector('.motion-story__ghost')).toBeNull()
    expect(screen.queryByText('Clip 1 of 2')).not.toBeInTheDocument()
  })

  it('marks footage as pending and returns focus after expanded view closes', () => {
    setup(true, [{ metric: 'cadence', clipIndex: 0, items: [], pending: true }])
    expect(screen.getByText('Still pose · motion unavailable')).toBeInTheDocument()
    const expand = screen.getByRole('button', { name: 'Expand form' })
    fireEvent.click(expand)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(expand).toHaveFocus()
  })

  it('labels sparse detected form as a still pose', () => {
    setup(true)
    expect(screen.getByText('Still pose · motion unavailable')).toBeInTheDocument()
  })

  it('plays recorded joints, fades at the seam, and returns to exact evidence on command', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id) })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never)
    const samples = [0, 0.15, 0.3, 0.45, 0.6, 0.75].map((timestamp, index) => ({
      ...frames(true)[0], timestamp,
      keypoints: frames(true)[0].keypoints.map((point) => ({ ...point,
        x: (point.x ?? 0) + index * 20 +
          ((point.name === 'nose' || point.name === 'left_knee') && index % 2 ? 12 : 0),
      })),
    }))
    const canvas = document.createElement('canvas')
    const evidence = [{ metric: 'cadence', clipIndex: 0, pending: false, items: [{
      canvas, plan: { base: { timestamp: 0.3, keypoints: [] }, crop: { x: 0, y: 0, side: 320 } },
    }] }] as unknown as MetricCardEvidence[]
    const { container, unmount } = setup(true, evidence, samples)
    const flush = (now: number) => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      act(() => { pending.forEach((callback) => callback(now)) })
    }
    flush(performance.now() + 700)
    const playbackStart = performance.now() + 800
    flush(playbackStart)
    const before = container.querySelector('svg [data-joint="left_knee"]')?.getAttribute('cx')
    flush(playbackStart + 250)
    const after = container.querySelector('svg [data-joint="left_knee"]')?.getAttribute('cx')
    expect(after).not.toBe(before)
    flush(playbackStart + 760)
    const lastPose = container.querySelector('svg [data-joint="left_knee"]')?.getAttribute('cx')
    flush(playbackStart + 900)
    expect(container.querySelector('.motion-story__trace--hidden')).toBeInTheDocument()
    expect(container.querySelector('svg [data-joint="left_knee"]')?.getAttribute('cx')).toBe(lastPose)
    flush(playbackStart + 1200)
    expect(container.querySelector('.motion-story__trace--hidden')).toBeNull()
    expect(container.querySelector('svg [data-joint="left_knee"]')?.getAttribute('cx')).toBe(before)
    expect(container.querySelector('.motion-story__ghost')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show evidence still' }))
    expect(container.querySelector('.motion-story__ghost')).toBeInTheDocument()
    expect(container.querySelector('svg circle')?.getAttribute('cx')).toBe('40')
    expect(screen.getByRole('button', { name: 'Play detected motion' })).toBeInTheDocument()
    unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts paused for reduced motion and permits an explicit play request', () => {
    let matches = true
    let onPreferenceChange: (() => void) | null = null
    vi.stubGlobal('matchMedia', () => ({
      get matches() { return matches },
      addEventListener: vi.fn((_event, callback) => { onPreferenceChange = callback }),
      removeEventListener: vi.fn(),
    }))
    const samples = [0, 0.15, 0.3, 0.45, 0.6].map((timestamp) => ({
      ...frames(true)[0], timestamp,
    }))
    const { unmount } = setup(true, [], samples)
    expect(screen.getByRole('button', { name: 'Play detected motion' })).toBeInTheDocument()
    expect(screen.queryByText('Still pose · motion unavailable')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play detected motion' }))
    expect(screen.getByRole('button', { name: 'Pause detected motion' })).toBeInTheDocument()
    matches = false
    act(() => { onPreferenceChange?.() })
    expect(screen.getByRole('button', { name: 'Pause detected motion' })).toBeInTheDocument()
    matches = true
    act(() => { onPreferenceChange?.() })
    expect(screen.getByRole('button', { name: 'Play detected motion' })).toBeInTheDocument()
    unmount()
    vi.unstubAllGlobals()
  })
})

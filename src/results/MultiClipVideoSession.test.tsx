import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import type { FormHeuristicsResult } from '../heuristics/types'

const {
  sampleClipMock,
  applyRobustnessMock,
  computeFormHeuristicsMock,
  getScalePassDetectorMock,
  deriveClipPosterMock,
} = vi.hoisted(() => ({
  sampleClipMock: vi.fn(),
  applyRobustnessMock: vi.fn(),
  computeFormHeuristicsMock: vi.fn(),
  getScalePassDetectorMock: vi.fn(),
  deriveClipPosterMock: vi.fn(),
}))

vi.mock('./sampleClip', () => ({
  sampleClip: sampleClipMock,
  DEFAULT_MAX_CONSECUTIVE_ERRORS: 30,
  DEFAULT_DETECTION_TIMEOUT_MS: 5000,
}))
vi.mock('../pose/robustness/interpolate', () => ({ applyRobustness: applyRobustnessMock }))
vi.mock('../heuristics/index', () => ({ computeFormHeuristics: computeFormHeuristicsMock }))
vi.mock('../pose/scalePassDetector', () => ({ getScalePassDetector: getScalePassDetectorMock }))
// Only the decode is mocked — jsdom decodes nothing, and `releaseClipPoster` must stay REAL, since
// what the two release tests below check is that this component calls it on the right canvas at the
// right moment. Mocking it would let them pass against a component that never released anything.
vi.mock('../video/posterFrame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../video/posterFrame')>()),
  deriveClipPoster: deriveClipPosterMock,
}))

import type { ClipPoster } from '../video/posterFrame'
import { MultiClipVideoSession } from './MultiClipVideoSession'

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

function makeFakeKeypoints(): RobustKeypoint[] {
  return COMMON_KEYPOINT_NAMES.map((name) => ({
    name,
    status: 'detected',
    x: 1,
    y: 1,
    score: 0.9,
  }))
}

const FAKE_ROBUST_FRAMES: RobustPoseFrame[] = [
  { timestamp: 0, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.1, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.2, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
]

function makeMetric(metric: string, overrides: Record<string, unknown> = {}) {
  return {
    metric,
    value: 1,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
    ...overrides,
  }
}

const FAKE_HEURISTICS = {
  view: {
    view: 'side',
    confidence: 1,
    diagnostics: { bilateralSpreadRatio: null, sagittalExcursionRatio: null, frameCoverage: 1 },
  },
  verticalOscillation: { ...makeMetric('verticalOscillation'), series: [], fit: null },
  verticalRatio: makeMetric('verticalRatio', { unit: 'percent' }),
  verticalOscillationCm: {
    ...makeMetric('verticalOscillationCm', { unit: 'centimeters', value: null, confidence: 0 }),
    calibration: null,
  },
  trunkLean: makeMetric('trunkLean', { unit: 'degrees' }),
  overstriding: makeMetric('overstriding'),
  cadence: makeMetric('cadence', { unit: 'stepsPerMinute' }),
  kneeFlexion: makeMetric('kneeFlexion', { unit: 'degrees' }),
  armSwingSymmetry: makeMetric('armSwingSymmetry', { unit: 'percent' }),
  footStrikePattern: makeMetric('footStrikePattern'),
  stepWidth: makeMetric('stepWidth', { unit: 'percent' }),
  stepWidthCm: makeMetric('stepWidthCm', { unit: 'centimeters', value: null, confidence: 0 }),
} as unknown as FormHeuristicsResult

function markVideoReady(video: HTMLVideoElement) {
  Object.defineProperty(video, 'duration', { value: 10, configurable: true })
  Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true })
  act(() => {
    video.dispatchEvent(new Event('loadedmetadata'))
  })
}

function canonicalVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll('video[controls]'))
}

function makePoster(): ClipPoster {
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 135
  return { canvas, width: 240, height: 135, timestamp: 0.8 }
}

/** Released == the backing store is gone. The recorded `width`/`height` deliberately survive. */
function isReleased(poster: ClipPoster): boolean {
  return poster.canvas.width === 0 && poster.canvas.height === 0
}

/**
 * Hands each clip its own poster, keyed by the file it was loaded from rather than by call order,
 * so an assertion naming "clip 1's poster" cannot be satisfied by whichever derivation happened to
 * resolve first.
 */
function posterPerFile(): Map<string, ClipPoster> {
  const byName = new Map<string, ClipPoster>()
  deriveClipPosterMock.mockImplementation((blob: Blob) => {
    const name = blob instanceof File ? blob.name : 'anonymous'
    const poster = byName.get(name) ?? makePoster()
    byName.set(name, poster)
    return Promise.resolve(poster)
  })
  return byName
}

/**
 * Waits until every loaded clip's poster has travelled the whole path this component owns:
 * `useClipPoster` state -> `ClipSlot`'s report-up -> `sameClipSession` -> `clipStates`. Asserted on
 * the count so a test cannot proceed against a session whose posters have not landed yet — a
 * release assertion would then pass for having nothing to release.
 */
async function waitForPosters(count: number) {
  await waitFor(() => expect(deriveClipPosterMock).toHaveBeenCalledTimes(count))
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  sampleClipMock.mockReset()
  applyRobustnessMock.mockReset()
  computeFormHeuristicsMock.mockReset()
  getScalePassDetectorMock.mockReset()
  applyRobustnessMock.mockReturnValue(FAKE_ROBUST_FRAMES)
  computeFormHeuristicsMock.mockReturnValue(FAKE_HEURISTICS)
  getScalePassDetectorMock.mockResolvedValue(makeFakeDetector())
  deriveClipPosterMock.mockReset()
  deriveClipPosterMock.mockResolvedValue(null)
  // Resolves every sampling call (primary or scale pass, either clip) immediately with one
  // null-frame sample -- with FAKE_HEURISTICS' calibration: null, every scale pass concludes
  // 'failed' ("measured no real-world scale"), a terminal status, same as
  // useVideoAnalysis.test.ts's own default fixtures.
  sampleClipMock.mockImplementation(() => ({
    promise: Promise.resolve([{ timestamp: 0, frame: null }]),
    handle: { stop: vi.fn() },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MultiClipVideoSession', () => {
  it('renders exactly one clip slot initially', () => {
    const headingRef = createRef<HTMLHeadingElement>()
    render(<MultiClipVideoSession detector={null} headingRef={headingRef} />)
    expect(canonicalVideos()).toHaveLength(1)
  })

  it('single clip (N=1): auto-starts and reaches Analysis complete once ready', async () => {
    const headingRef = createRef<HTMLHeadingElement>()
    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} headingRef={headingRef} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file = new File(['x'], 'run.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), { target: { files: [file] } })

    markVideoReady(canonicalVideos()[0])

    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
    expect(sampleClipMock).toHaveBeenCalled()
  })

  it('serializes the shared detector: the second clip stays queued until the first clip fully finishes', async () => {
    // Clip 1's primary sampling pass hangs until resolved manually -- every OTHER sampleClip
    // call (clip 1's scale pass, clip 2's primary and scale pass) resolves immediately, so the
    // only thing gating progress is this one controlled promise.
    let resolveClip1Primary!: (samples: unknown[]) => void
    sampleClipMock
      .mockImplementationOnce(() => ({
        promise: new Promise((resolve) => {
          resolveClip1Primary = resolve
        }),
        handle: { stop: vi.fn() },
      }))
      .mockImplementation(() => ({
        promise: Promise.resolve([{ timestamp: 0, frame: null }]),
        handle: { stop: vi.fn() },
      }))

    const headingRef = createRef<HTMLHeadingElement>()
    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} headingRef={headingRef} />)

    // Load clip 1 through its own picker -- its primary pass starts sampling and hangs.
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file1 = new File(['x'], 'run1.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file1] },
    })
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))

    // Add clip 2 via the session-level "Add another clip" picker while clip 1 is still sampling.
    await waitFor(() => expect(screen.getByText(/add another clip/i)).toBeInTheDocument())
    const file2 = new File(['y'], 'run2.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file2] },
    })
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    markVideoReady(canonicalVideos()[1])

    // Clip 2 is loaded and would be eligible to auto-start, but the shared detector is still
    // held by clip 1 (still mid-sampling) -- it must show the queued hint, not start sampling.
    await waitFor(() =>
      expect(screen.getByText(/queued.*waiting for another clip/i)).toBeInTheDocument(),
    )
    expect(sampleClipMock).toHaveBeenCalledTimes(1)

    // Let clip 1's primary pass resolve -- its scale pass (also mocked) runs to a terminal
    // ('failed': no scale measured) status right after.
    await act(async () => {
      resolveClip1Primary([{ timestamp: 0, frame: null }])
    })
    await waitFor(() => expect(sampleClipMock.mock.calls.length).toBeGreaterThanOrEqual(2))

    // Once clip 1's ENTIRE pipeline (primary AND scale pass) is terminal, clip 2 is handed the
    // detector and auto-starts -- the queued hint disappears and clip 2's own primary sampling
    // call happens.
    await waitFor(() => {
      expect(screen.queryByText(/queued.*waiting for another clip/i)).not.toBeInTheDocument()
    })
    await waitFor(() => expect(sampleClipMock.mock.calls.length).toBeGreaterThanOrEqual(3))

    // Both clips eventually finish; the aggregate reaches ready.
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
  })

  it('removes a clip via its Remove button, keeping at least one slot', async () => {
    const headingRef = createRef<HTMLHeadingElement>()
    render(<MultiClipVideoSession detector={null} headingRef={headingRef} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file1 = new File(['x'], 'run1.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file1] },
    })
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/add another clip/i)).toBeInTheDocument())

    const file2 = new File(['y'], 'run2.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file2] },
    })
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))

    const removeButtons = screen.getAllByRole('button', { name: /remove clip/i })
    expect(removeButtons).toHaveLength(2)
    fireEvent.click(removeButtons[0])

    await waitFor(() => expect(canonicalVideos()).toHaveLength(1))
    // A lone remaining clip has nothing left to remove itself from.
    expect(screen.queryByRole('button', { name: /remove clip/i })).not.toBeInTheDocument()
  })

  it('releases the removed clip’s poster in `removeClip` itself, and leaves the survivor’s alone', async () => {
    const posters = posterPerFile()
    const headingRef = createRef<HTMLHeadingElement>()
    render(<MultiClipVideoSession detector={null} headingRef={headingRef} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [new File(['x'], 'run1.mp4', { type: 'video/mp4' })] },
    })
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/add another clip/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [new File(['y'], 'run2.mp4', { type: 'video/mp4' })] },
    })
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    markVideoReady(canonicalVideos()[1])
    await waitForPosters(2)

    const removed = posters.get('run1.mp4')!
    const survivor = posters.get('run2.mp4')!
    expect(isReleased(removed)).toBe(false)

    // Raw DOM `.click()`, deliberately NOT `fireEvent` — for the same reason as the mid-analysis
    // teardown test below. `fireEvent` wraps the state update, the commit AND the passive-effect
    // flush in `act()`, which would run the unmounting `ClipSlot`'s `useClipPoster` cleanup and
    // release this poster for entirely different reasons. React processes the click's state update
    // and commit synchronously either way, but passive effects are only *scheduled*. Asserting
    // inside that gap is what makes this a test of `removeClip`'s own call and not of React's
    // cleanup ordering — which both code comments at the release sites say they deliberately do
    // NOT lean on.
    screen.getAllByRole('button', { name: /remove clip/i })[0].click()

    expect(isReleased(removed)).toBe(true)
    // The clip that stayed keeps its pixels: this frees one poster, not the session's.
    expect(isReleased(survivor)).toBe(false)

    await act(async () => {})
    await waitFor(() => expect(canonicalVideos()).toHaveLength(1))
    expect(isReleased(survivor)).toBe(false)
  })

  it('releases every clip’s poster in `handleChooseDifferentVideo` itself when the session resets', async () => {
    const posters = posterPerFile()
    const headingRef = createRef<HTMLHeadingElement>()
    render(<MultiClipVideoSession detector={null} headingRef={headingRef} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [new File(['x'], 'run1.mp4', { type: 'video/mp4' })] },
    })
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/add another clip/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [new File(['y'], 'run2.mp4', { type: 'video/mp4' })] },
    })
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    markVideoReady(canonicalVideos()[1])
    await waitForPosters(2)

    const all = [posters.get('run1.mp4')!, posters.get('run2.mp4')!]
    expect(all.map(isReleased)).toEqual([false, false])

    // Same raw-click reasoning as above: every slot is about to unmount, so a flushed passive pass
    // would release all of these regardless of what this component did.
    screen.getByRole('button', { name: /choose a different video/i }).click()

    // EVERY clip, not just the active one — the session is going away whole.
    expect(all.map(isReleased)).toEqual([true, true])

    await act(async () => {})
    await waitFor(() => expect(canonicalVideos()).toHaveLength(1))
  })

  it('removing the currently-ACTIVE, mid-analysis clip deterministically tears down its detector-holding pipeline before the next clip becomes active', async () => {
    // Clip 1's primary sampling pass hangs forever -- it never reaches a terminal state on its
    // own (no 'ready'/'error', so its scale pass never even starts). This is what makes it
    // genuinely mid-analysis, not already-terminal, when it gets removed below. Every other
    // sampleClip call (clip 2's primary and scale pass) resolves immediately.
    const callOrder: string[] = []
    const clip1PrimaryStop = vi.fn(() => callOrder.push('clip1-primary-stop'))
    sampleClipMock
      .mockImplementationOnce(() => ({
        promise: new Promise(() => {}), // never resolves
        handle: { stop: clip1PrimaryStop },
      }))
      .mockImplementation(() => {
        callOrder.push('other-sample-start')
        return {
          promise: Promise.resolve([{ timestamp: 0, frame: null }]),
          handle: { stop: vi.fn() },
        }
      })

    const headingRef = createRef<HTMLHeadingElement>()
    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} headingRef={headingRef} />)

    // Load clip 1 -- its primary pass starts sampling and hangs, holding the shared detector.
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file1 = new File(['x'], 'run1.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file1] },
    })
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))

    // Add clip 2 while clip 1 is still mid-analysis -- it queues, waiting for the shared detector.
    await waitFor(() => expect(screen.getByText(/add another clip/i)).toBeInTheDocument())
    const file2 = new File(['y'], 'run2.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file2] },
    })
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    markVideoReady(canonicalVideos()[1])
    await waitFor(() =>
      expect(screen.getByText(/queued.*waiting for another clip/i)).toBeInTheDocument(),
    )
    expect(clip1PrimaryStop).not.toHaveBeenCalled()

    // Remove clip 1 -- the currently-ACTIVE clip, still genuinely mid-analysis (its primary
    // sampleClip promise never resolves on its own, and its scale pass never even started).
    // Before the fix, `removeClip` only deleted `clipIds`/`clipStates` and relied entirely on
    // `ClipSlot`'s unmount cleanup (a *passive* effect) to eventually stop clip 1's sample loop.
    //
    // Dispatched via the raw DOM `.click()`, deliberately NOT through RTL's `fireEvent` (which
    // wraps the whole thing -- state update, commit, AND passive-effect flush -- in `act()`,
    // collapsing exactly the window this test needs to see). React still processes a native click
    // event's state update and commit (including layout effects) synchronously either way, but
    // passive effects are merely *scheduled*, not run, until something flushes them. That gap is
    // precisely what distinguishes an explicit, synchronous `reset()` call inside `removeClip`
    // itself (this fix) from an implicit dependence on `ClipSlot`'s unmount cleanup effect (the
    // pre-fix behavior, which would NOT have stopped clip 1 yet at this point).
    const removeButtons = screen.getAllByRole('button', { name: /remove clip/i })
    expect(removeButtons).toHaveLength(2)
    removeButtons[0].click()

    // The detector-holding pipeline was torn down as a direct, synchronous consequence of
    // `removeClip`'s own code -- provably not contingent on passive effects having flushed yet.
    expect(clip1PrimaryStop).toHaveBeenCalledTimes(1)

    // Let React finish flushing (passive effects, the resulting re-renders, etc.) before the
    // remaining assertions.
    await act(async () => {})

    // Clip 2 becomes the sole remaining clip and is handed the shared detector -- but its own
    // sampling only ever starts AFTER clip 1's stop() already ran, never overlapping with it.
    await waitFor(() => expect(canonicalVideos()).toHaveLength(1))
    await waitFor(() => expect(callOrder).toContain('other-sample-start'))
    expect(callOrder[0]).toBe('clip1-primary-stop')
    expect(callOrder.indexOf('clip1-primary-stop')).toBeLessThan(
      callOrder.indexOf('other-sample-start'),
    )
  })
})

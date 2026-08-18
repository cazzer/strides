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

/**
 * Chooses a file through whichever file input is currently on the page — the full-page
 * `ClipPicker` while no clip is loaded, the header action's picker once one is (see
 * `addAnotherClip`, which opens it).
 *
 * The `await act(async () => {})` afterwards is load-bearing and its absence reads as a hang, not
 * a failed assertion: every clip (the first one now included) is created by `addClip` and loaded
 * through `pendingLoad`, whose `load()` is deferred one microtask (`ClipSlot.tsx`'s
 * `queueMicrotask`), and `useVideoSource` attaches its `loadedmetadata` listener lazily *inside*
 * `load()`. Marking a video ready before that microtask runs dispatches the event at nothing, and
 * the clip never reaches `'ready'`.
 */
async function chooseFile(file: File) {
  fireEvent.change(screen.getByLabelText(/choose a video file/i), { target: { files: [file] } })
  await act(async () => {})
}

/**
 * Adds a clip through the HEADER's add-a-clip action, which is the only way in once a clip is
 * loaded. Both extra steps are the point rather than ceremony: the action presents the entire
 * `ClipPicker` (record, upload and both demo clips), and Record is its default tab, so a test that
 * wants a file has to ask for the Upload one. What this replaces was a bare `<FileUpload>` in the
 * page body, which offered no record path and no demo clips at all.
 */
async function addAnotherClip(file: File) {
  fireEvent.click(await screen.findByRole('button', { name: /add a clip/i }))
  fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
  await chooseFile(file)
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
  it('starts with zero clips and a full-page picker', () => {
    render(<MultiClipVideoSession detector={null} />)

    // A genuinely empty session, not "one slot whose videoSource.status is 'empty'": there is no
    // clip, so there is no video element to be empty.
    expect(canonicalVideos()).toHaveLength(0)
    // All four ways in are reachable: record (default tab), upload, and the two demo clips.
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^upload$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /demo 1 \(side view\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /demo 2 \(front view\)/i })).toBeInTheDocument()
  })

  it('single clip (N=1): auto-starts and reaches Analysis complete once ready', async () => {
    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))

    markVideoReady(canonicalVideos()[0])

    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
    expect(sampleClipMock).toHaveBeenCalled()
  })

  it('one source, one clip: selecting several files at once creates one clip per file', async () => {
    render(<MultiClipVideoSession detector={null} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: {
        files: [
          new File(['a'], 'run1.mp4', { type: 'video/mp4' }),
          new File(['b'], 'run2.mp4', { type: 'video/mp4' }),
          new File(['c'], 'run3.mp4', { type: 'video/mp4' }),
        ],
      },
    })
    await act(async () => {})

    // The bug this deletes: the old first slot owned its own picker, so all three files went to
    // ONE `useVideoSource` and produced a single clip, last file wins.
    await waitFor(() => expect(canonicalVideos()).toHaveLength(3))
  })

  it('the picker stays on the page while a clip is still loading, and is replaced once one is ready', async () => {
    render(<MultiClipVideoSession detector={null} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))

    // 'loading' is not 'loaded': the gate is `anyClipVideoReady`, not `clipIds.length`, so a clip
    // that never gets there leaves the reader a way forward rather than an empty page.
    expect(canonicalVideos()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /demo 1 \(side view\)/i })).toBeInTheDocument()
    // The two presentations are complements, so the header action is absent for exactly as long as
    // the full-page picker is present. Otherwise the page would carry two Upload tabs, two file
    // inputs and two pairs of demo buttons at once.
    expect(screen.queryByRole('button', { name: /add a clip/i })).not.toBeInTheDocument()

    markVideoReady(canonicalVideos()[0])

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /demo 1 \(side view\)/i })).not.toBeInTheDocument(),
    )

    // The picker collapsed INTO the header, and `video-input` requires it leave nothing behind:
    // "No add-a-clip affordance SHALL remain in the page body."
    const collapsed = screen.getByRole('button', { name: /add a clip/i })
    expect(screen.getByRole('banner')).toContainElement(collapsed)
    const main = screen.getByRole('main')
    expect(main.querySelector('input[type=file]')).toBeNull()
    expect(main.textContent).not.toMatch(/add (another|a) clip/i)
  })

  it('adds clip 2 from a demo button — a path that had no way in at all while the body block was upload-only', async () => {
    // Not a relocation test. Every `addClip` records a `pendingLoad` that the new `ClipSlot`
    // consumes on mount, so the new slot's own picker (gated on `status === 'empty'`) never
    // rendered — the demo buttons and the record path were unreachable for clips 2..N, and upload
    // was the only way in. This is the fix, exercised through the session.
    const demoBlob = new Blob(['demo'], { type: 'video/mp4' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(demoBlob) }),
    )

    render(<MultiClipVideoSession detector={null} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])

    fireEvent.click(await screen.findByRole('button', { name: /add a clip/i }))
    fireEvent.click(screen.getByRole('button', { name: /demo 2 \(front view\)/i }))

    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    // Same `pendingLoad` path as an uploaded clip, so it is indistinguishable downstream: it gets
    // its own strip entry, numbered in clip-session order.
    expect(
      screen.getByRole('button', { name: /clip 2 of 2:/i }),
    ).toBeInTheDocument()
    // The picker collapsed again once it had handed the source over, rather than sitting open in
    // the header on top of a webcam preview nobody asked for.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add a clip/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    )

    vi.unstubAllGlobals()
  })

  it('shows each clip its own progress in the header strip, and hosts the working clip’s element on screen', async () => {
    // Clip 1's primary pass hangs, so the session sits in the one state this whole ticket is
    // about: one clip sampling, one clip queued behind the shared detector.
    sampleClipMock
      .mockImplementationOnce(() => ({
        promise: new Promise(() => {}),
        handle: { stop: vi.fn() },
      }))
      .mockImplementation(() => ({
        promise: Promise.resolve([{ timestamp: 0, frame: null }]),
        handle: { stop: vi.fn() },
      }))

    render(<MultiClipVideoSession detector={makeFakeDetector()} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))

    await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    markVideoReady(canonicalVideos()[1])

    // One entry per clip, in clip-session order -- the same order fusion's source index and the
    // "Combined from clip N of TOTAL" copy number clips by.
    const strip = screen.getByRole('list', { name: /clips/i })
    const entries = await waitFor(() => {
      const found = strip.querySelectorAll('[data-clip-condition]')
      expect(found).toHaveLength(2)
      return found
    })

    // Each entry reports its OWN state. `computeAggregateAnalysisState` would have averaged these
    // into one number that describes neither clip.
    await waitFor(() =>
      expect(entries[0].getAttribute('data-clip-condition')).toBe('sampling'),
    )
    expect(entries[1].getAttribute('data-clip-condition')).toBe('queued')
    expect(entries[0].textContent).toMatch(/clip 1 of 2: analyzing/i)
    expect(entries[1].textContent).toMatch(/clip 2 of 2: queued/i)

    // Exactly one live region for the whole session's clip progress, on the clip that is working
    // (design.md D3). The other entry is readable but silent.
    expect(strip.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(entries[0].querySelector('[role="status"]')).not.toBeNull()

    // THE CORRECTNESS REQUIREMENT (`strides-kyu.13`). The clip being sampled hosts its real
    // element on screen inside its own entry; the queued one's is concealed off screen. jsdom
    // cannot see that a concealed element stops presenting frames — this asserts the placement
    // that a live browser then has to confirm in pixels.
    const hostOf = (entry: Element) => entry.querySelector('video')!.parentElement!
    expect(hostOf(entries[0]).className).toContain('absolute')
    expect(hostOf(entries[0]).className).not.toContain('fixed')
    expect(hostOf(entries[1]).className).toContain('fixed')

    // Both elements are inside their own entry in either placement: the strip never withholds an
    // element, so moving between the two is a class change and never a remount.
    expect(entries[0]).toContainElement(entries[0].querySelector('video'))
    expect(entries[1]).toContainElement(entries[1].querySelector('video'))
  })

  it('previews one clip at a time: nothing loops until presented, and dismissing stops it again', async () => {
    // design.md D1 / `results-view` "Clip playback loops only while that clip is presented". Two
    // ready clips with no preview open must BOTH be stopped: an always-on loop would decode and
    // composite N videos nobody can see for the life of the session.
    render(<MultiClipVideoSession detector={makeFakeDetector()} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    markVideoReady(canonicalVideos()[1])

    const videos = canonicalVideos()
    for (const video of videos) vi.spyOn(video, 'play').mockResolvedValue(undefined)
    const pauses = videos.map((video) => vi.spyOn(video, 'pause').mockImplementation(() => {}))
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())

    // Both ready, neither presented, neither looping.
    expect(videos.map((v) => v.loop)).toEqual([false, false])

    const entryButton = (n: number) =>
      screen.getByRole('button', { name: new RegExp(`clip ${n} of 2:`, 'i') })

    fireEvent.click(entryButton(2))
    // Exactly one clip loops, and it is the one that was activated.
    expect(videos.map((v) => v.loop)).toEqual([false, true])
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/clip 2 of 2/i)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(videos.map((v) => v.loop)).toEqual([false, false])
    expect(pauses[1]).toHaveBeenCalled()
    expect(pauses[0]).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    // Focus is back on the entry that opened it.
    expect(document.activeElement).toBe(entryButton(2))
  })

  it('the preview presents the clip’s already-mounted element, overlay and all', async () => {
    render(<MultiClipVideoSession detector={makeFakeDetector()} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())

    const video = canonicalVideos()[0]
    vi.spyOn(video, 'play').mockResolvedValue(undefined)
    vi.spyOn(video, 'pause').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: /clip 1 of 1:/i }))

    // No second element for the clip, and the existing one has not been remounted — the modal
    // formed around it (`results-view`, "Revealing a clip does not change which element analysis
    // holds"). Asserted on the node, not on a selector match.
    expect(canonicalVideos()).toHaveLength(1)
    expect(canonicalVideos()[0]).toBe(video)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(video)
    // The overlay came along, still hidden from assistive technology.
    const overlay = dialog.querySelector('canvas')
    expect(overlay).not.toBeNull()
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
    // On screen, in the dialog's stage — the concealed placement would defeat the whole preview.
    expect(video.parentElement!.className).toContain('absolute')
    expect(video.parentElement!.className).not.toContain('fixed')

    fireEvent.click(screen.getByRole('button', { name: /close preview/i }))
    expect(canonicalVideos()).toHaveLength(1)
    expect(canonicalVideos()[0]).toBe(video)
  })

  it('a preview opened mid-analysis shows the video without an overlay, and writes nothing', async () => {
    // The observational guard: a reader inspecting a clip mid-analysis is reasonable, and is made
    // safe by presentation writing nothing while the pipeline owns the element.
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise(() => {}),
      handle: { stop: vi.fn() },
    }))

    render(<MultiClipVideoSession detector={makeFakeDetector()} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))

    const video = canonicalVideos()[0]
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {})
    const before = { loop: video.loop, muted: video.muted, currentTime: video.currentTime }

    fireEvent.click(screen.getByRole('button', { name: /clip 1 of 1:/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(video)
    expect(dialog.querySelector('canvas')).toBeNull() // no frames yet, so no overlay
    // The element stays `inert` while the pipeline owns it: the native controls write into the
    // very playback state a run in flight depends on.
    expect(video.parentElement).toHaveAttribute('inert')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(video.loop).toBe(before.loop)
    expect(video.muted).toBe(before.muted)
    expect(video.currentTime).toBe(before.currentTime)
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

    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} />)

    // Load clip 1 through the full-page picker -- its primary pass starts sampling and hangs.
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))

    // Add clip 2 via the header's add-a-clip action while clip 1 is still sampling.
    await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
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

  it('removes clips one by one, and removing the last one returns to the picker', async () => {
    render(<MultiClipVideoSession detector={null} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))

    const removeButtons = screen.getAllByRole('button', { name: /remove clip/i })
    expect(removeButtons).toHaveLength(2)
    fireEvent.click(removeButtons[0])

    await waitFor(() => expect(canonicalVideos()).toHaveLength(1))
    // The lone remaining clip is removable too -- the always-one-slot invariant is gone.
    const lastRemove = screen.getByRole('button', { name: /remove clip/i })
    fireEvent.click(lastRemove)

    await waitFor(() => expect(canonicalVideos()).toHaveLength(0))
    expect(screen.getByRole('button', { name: /demo 1 \(side view\)/i })).toBeInTheDocument()
  })

  it('releases the removed clip’s poster in `removeClip` itself, and leaves the survivor’s alone', async () => {
    const posters = posterPerFile()
    render(<MultiClipVideoSession detector={null} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
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
    render(<MultiClipVideoSession detector={null} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
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
    // Back to a genuinely empty session, not one seeded slot.
    await waitFor(() => expect(canonicalVideos()).toHaveLength(0))
    expect(screen.getByRole('button', { name: /demo 1 \(side view\)/i })).toBeInTheDocument()
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

    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} />)

    // Load clip 1 -- its primary pass starts sampling and hangs, holding the shared detector.
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))

    // Add clip 2 while clip 1 is still mid-analysis -- it queues, waiting for the shared detector.
    await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
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

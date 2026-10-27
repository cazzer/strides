import { Profiler } from 'react'
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
  canUseSequentialDecodeMock,
  sampleClipSequentialMock,
} = vi.hoisted(() => ({
  sampleClipMock: vi.fn(),
  applyRobustnessMock: vi.fn(),
  computeFormHeuristicsMock: vi.fn(),
  getScalePassDetectorMock: vi.fn(),
  deriveClipPosterMock: vi.fn(),
  canUseSequentialDecodeMock: vi.fn(),
  sampleClipSequentialMock: vi.fn(),
}))

vi.mock('./sampleClip', () => ({
  sampleClip: sampleClipMock,
  DEFAULT_MAX_CONSECUTIVE_ERRORS: 30,
  DEFAULT_DETECTION_TIMEOUT_MS: 5000,
}))
vi.mock('../pose/robustness/interpolate', () => ({ applyRobustness: applyRobustnessMock }))
vi.mock('../heuristics/index', () => ({ computeFormHeuristics: computeFormHeuristicsMock }))
vi.mock('../pose/scalePassDetector', () => ({ getScalePassDetector: getScalePassDetectorMock }))
// jsdom has no VideoDecoder, so the real probe always answers no and every clip samples on the
// playback path; `beforeEach` keeps that answer. The scale-pass schedule case below answers yes
// to drive the sequential path, whose sampler is mocked for the same reason.
vi.mock('../video/webCodecsSupport', () => ({ canUseSequentialDecode: canUseSequentialDecodeMock }))
vi.mock('./sampleClipSequential', () => ({ sampleClipSequential: sampleClipSequentialMock }))
// A PASSTHROUGH spy, so the schedule case can read which clip was handed the scale-pass lane.
vi.mock('./useVideoAnalysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useVideoAnalysis')>()
  return { ...actual, useVideoAnalysis: vi.fn(actual.useVideoAnalysis) }
})
// Only the decode is mocked — jsdom decodes nothing, and `releaseClipPoster` must stay REAL, since
// what the two release tests below check is that this component calls it on the right canvas at the
// right moment. Mocking it would let them pass against a component that never released anything.
vi.mock('../video/posterFrame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../video/posterFrame')>()),
  deriveClipPoster: deriveClipPosterMock,
}))

import type { ClipPoster } from '../video/posterFrame'
import { IDLE_MODEL_LOAD_STATE } from '../pose/modelLoadState'
import type { ModelLoadStates } from '../pose/modelLoadState'
import type { EvidenceFramePlan } from './evidenceFrames'
import type { SessionEvidenceState } from './useSessionEvidence'
import { MultiClipVideoSession } from './MultiClipVideoSession'
import { useVideoAnalysis } from './useVideoAnalysis'

/** This component receives model-load state but renders none of it yet (`strides-utn.1` is the
 * wire; `strides-utn.5` is the UI), so every case here can share one settled value. */
const IDLE_MODEL_LOADS: ModelLoadStates = {
  primary: IDLE_MODEL_LOAD_STATE,
  scalePass: IDLE_MODEL_LOAD_STATE,
}

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
    plausibility: { side: 1, front: 0, ambiguous: 0 },
    confidence: 1,
    diagnostics: {
      bilateralSpreadRatio: null,
      sagittalExcursionRatio: null,
      sagittalExcursionSampleCount: { left: 0, right: 0 },
      sagittalExcursionInterpolatedFraction: { left: 0, right: 0 },
      frameCoverage: 1,
    },
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
  footStrikePattern: makeMetric('footStrikePattern'),
  stepWidth: makeMetric('stepWidth', { unit: 'percent' }),
  stepWidthCm: makeMetric('stepWidthCm', { unit: 'centimeters', value: null, confidence: 0 }),
  kneeDrive: makeMetric('kneeDrive', { unit: 'degrees' }),
  armSwingAmplitude: makeMetric('armSwingAmplitude', { unit: 'ratio' }),
  swingFootLateralExcursion: makeMetric('swingFootLateralExcursion', { unit: 'percent' }),
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
 * `ClipPicker` (record, upload and the bundled demo), and Record is its default tab, so a test that
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
  canUseSequentialDecodeMock.mockReset()
  canUseSequentialDecodeMock.mockResolvedValue(false)
  sampleClipSequentialMock.mockReset()
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
    render(<MultiClipVideoSession detector={null} modelLoad={IDLE_MODEL_LOADS} />)

    // A genuinely empty session, not "one slot whose videoSource.status is 'empty'": there is no
    // clip, so there is no video element to be empty.
    expect(canonicalVideos()).toHaveLength(0)
    // All three ways in are reachable: record (default tab), upload, and the bundled demo.
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^upload$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /demo \(3 clips\)/i })).toBeInTheDocument()
  })

  it('single clip (N=1): auto-starts and reaches Analysis complete once ready', async () => {
    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} modelLoad={IDLE_MODEL_LOADS} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))

    markVideoReady(canonicalVideos()[0])

    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
    expect(sampleClipMock).toHaveBeenCalled()
  })

  it('commits about once per displayed percent while a clip samples, and never re-renders the session for it (strides-e4c.3)', async () => {
    // Clip 1 finishes (results view, evidence and all mounted); clip 2's primary pass then hangs
    // so the test can drive its progress by hand — the shape where per-frame progress was most
    // expensive, since every update re-rendered clip 1's finished results too.
    sampleClipMock
      .mockImplementationOnce(() => ({
        promise: Promise.resolve([{ timestamp: 0, frame: null }]),
        handle: { stop: vi.fn() },
      }))
    const commits = { count: 0 }
    render(
      <Profiler id="session" onRender={() => (commits.count += 1)}>
        <MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />
      </Profiler>,
    )

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())

    sampleClipMock.mockImplementation(() => ({
      promise: new Promise(() => {}),
      handle: { stop: vi.fn() },
    }))
    await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    markVideoReady(canonicalVideos()[1])

    // The primary pass is the one call carrying onProgress; a scale pass passes none.
    const progressCalls = () =>
      sampleClipMock.mock.calls.filter(
        (call) => typeof (call[3] as { onProgress?: unknown })?.onProgress === 'function',
      )
    await waitFor(() => expect(progressCalls()).toHaveLength(2))
    const { onProgress } = progressCalls()[1][3] as { onProgress: (fraction: number) => void }
    await act(async () => {})

    // `useSessionEvidence` is called exactly once per render of the session component, so its
    // passthrough spy (bottom of this file) counts SESSION renders, as distinct from commits that
    // only re-render the sampling clip's own `ClipSlot`.
    const sessionHook = vi.mocked((await import('./useSessionEvidence')).useSessionEvidence)
    const strip = screen.getByRole('list', { name: /clips/i })
    const clip2Entry = () => strip.querySelectorAll('[data-clip-condition]')[1]

    // Far more sampled frames than displayed percents, so a per-frame regression cannot hide
    // inside the bound.
    const FRAMES = 2000
    const commitsBefore = commits.count
    const sessionRendersBefore = sessionHook.mock.calls.length
    for (let k = 1; k <= FRAMES; k += 1) {
      act(() => onProgress(k / FRAMES))
      // The strip still advances while the session above it stays put.
      if (k === FRAMES / 2) expect(clip2Entry().textContent).toMatch(/50%/)
    }
    const sampledCommits = commits.count - commitsBefore
    const sessionRenders = sessionHook.mock.calls.length - sessionRendersBefore

    // Measured in this test, 2000 frames (commits / session renders): 6000 / 4000 with neither
    // change (every frame published, every publish re-rendering the session); 300 / 200 with the
    // whole-percent throttle alone; 100 / 0 with `sameClipSession` also ignoring progress — the
    // 100 being the sampling clip's own `ClipSlot`, which is the strip entry that shows it.
    expect(sampledCommits).toBeLessThanOrEqual(400)
    expect(sessionRenders).toBe(0)
    expect(clip2Entry().textContent).toMatch(/100%/)
  })

  it('one source, one clip: selecting several files at once creates one clip per file', async () => {
    render(<MultiClipVideoSession detector={null} modelLoad={IDLE_MODEL_LOADS} />)

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
    render(<MultiClipVideoSession detector={null} modelLoad={IDLE_MODEL_LOADS} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))

    // 'loading' is not 'loaded': the gate is `anyClipVideoReady`, not `clipIds.length`, so a clip
    // that never gets there leaves the reader a way forward rather than an empty page.
    expect(canonicalVideos()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /demo \(3 clips\)/i })).toBeInTheDocument()
    // The two presentations are complements, so the header action is absent for exactly as long as
    // the full-page picker is present. Otherwise the page would carry two Upload tabs, two file
    // inputs and two demo buttons at once.
    expect(screen.queryByRole('button', { name: /add a clip/i })).not.toBeInTheDocument()

    markVideoReady(canonicalVideos()[0])

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /demo \(3 clips\)/i })).not.toBeInTheDocument(),
    )

    // The picker collapsed INTO the header, and `video-input` requires it leave nothing behind:
    // "No add-a-clip affordance SHALL remain in the page body."
    const collapsed = screen.getByRole('button', { name: /add a clip/i })
    expect(screen.getByRole('banner')).toContainElement(collapsed)
    const main = screen.getByRole('main')
    expect(main.querySelector('input[type=file]')).toBeNull()
    expect(main.textContent).not.toMatch(/add (another|a) clip/i)
  })

  it('adds the demo clips after clip 1 — a path that had no way in at all while the body block was upload-only', async () => {
    // Not a relocation test. Every `addClip` records a `pendingLoad` that the new `ClipSlot`
    // consumes on mount, so the new slot's own picker (gated on `status === 'empty'`) never
    // rendered — the demo button and the record path were unreachable for clips 2..N, and upload
    // was the only way in. This is the fix, exercised through the session.
    //
    // The demo is one action loading THREE clips, so this also pins that a multi-clip source lands
    // as several clips rather than as one: 1 uploaded + 3 demo = 4.
    const demoBlob = new Blob(['demo'], { type: 'video/mp4' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(demoBlob) }),
    )

    render(<MultiClipVideoSession detector={null} modelLoad={IDLE_MODEL_LOADS} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])

    fireEvent.click(await screen.findByRole('button', { name: /add a clip/i }))
    fireEvent.click(screen.getByRole('button', { name: /demo \(3 clips\)/i }))

    await waitFor(() => expect(canonicalVideos()).toHaveLength(4))
    // Same `pendingLoad` path as an uploaded clip, so each is indistinguishable downstream: they
    // get their own strip entries, numbered in clip-session order.
    expect(
      screen.getByRole('button', { name: /clip 2 of 4:/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /clip 4 of 4:/i }),
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

    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)

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
    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)

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
    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)

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

    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)
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

  it('serializes the shared detector: on the playback path the second clip stays queued until the first clip fully finishes', async () => {
    // jsdom's probe answers no, so both clips sample on the PLAYBACK path, which keeps the old
    // rule: a clip's scale pass replays its own element and finishes before the next clip starts.
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
    render(<MultiClipVideoSession detector={detector} modelLoad={IDLE_MODEL_LOADS} />)

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

  it('on the sequential path runs every primary before any scale pass — P1 P2 P3 S1 S2 S3 — one pass at a time', async () => {
    canUseSequentialDecodeMock.mockResolvedValue(true)
    const scaleDetector = makeFakeDetector()
    getScalePassDetectorMock.mockResolvedValue(scaleDetector)
    const detector = makeFakeDetector()
    // Every sampling pass hangs until the test resolves it, so what is in flight at each step is
    // exactly what the session started.
    const inFlight: { label: string; resolve: () => void }[] = []
    sampleClipSequentialMock.mockImplementation((blob: Blob, passDetector: PoseDetector) => {
      const clipNumber = /\d/.exec((blob as File).name)![0]
      const label = `${passDetector === scaleDetector ? 'S' : 'P'}${clipNumber}`
      let resolve!: () => void
      const promise = new Promise((settle) => {
        resolve = () => settle([{ timestamp: 0, frame: null }])
      })
      inFlight.push({ label, resolve })
      return { promise, handle: { stop: vi.fn() } }
    })
    const analysisHook = vi.mocked(useVideoAnalysis)
    analysisHook.mockClear()
    /** How many clips' latest render was handed the scale-pass lane (`scalePassAllowed`). */
    const clipsHoldingTheScaleLane = () => {
      const latest = new Map<string, boolean>()
      for (const [videoSource, , options] of analysisHook.mock.calls) {
        const name = (videoSource.sourceBlob as File | null)?.name
        if (name) latest.set(name, options?.scalePassAllowed ?? true)
      }
      return [...latest.values()].filter(Boolean).length
    }

    render(<MultiClipVideoSession detector={detector} modelLoad={IDLE_MODEL_LOADS} />)
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
    await waitFor(() => expect(canonicalVideos()).toHaveLength(3))
    for (const video of canonicalVideos()) markVideoReady(video)

    const order: string[] = []
    for (let step = 0; step < 6; step += 1) {
      await waitFor(() => expect(inFlight).toHaveLength(1))
      await act(async () => {})
      // Never a primary and a scale pass at once, never two scale passes, and never more than one
      // clip allowed to start one.
      expect(inFlight).toHaveLength(1)
      expect(clipsHoldingTheScaleLane()).toBeLessThanOrEqual(1)
      const { label, resolve } = inFlight.shift()!
      order.push(label)
      await act(async () => {
        resolve()
      })
    }

    expect(order).toEqual(['P1', 'P2', 'P3', 'S1', 'S2', 'S3'])
    expect(inFlight).toHaveLength(0)
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
  })

  it('a webm after a sequential clip keeps the reference order — P1 S1 P2 S2 — one pass at a time', async () => {
    // design.md D9: the playback primary starts only once the earlier clip's pass is terminal.
    canUseSequentialDecodeMock.mockImplementation(
      async (blob: Blob) => (blob as File).name === 'run1.mp4',
    )
    const scaleDetector = makeFakeDetector()
    getScalePassDetectorMock.mockResolvedValue(scaleDetector)
    const detector = makeFakeDetector()
    const inFlight: { label: string; resolve: () => void }[] = []
    const track = (clipNumber: string, passDetector: PoseDetector) => {
      const label = `${passDetector === scaleDetector ? 'S' : 'P'}${clipNumber}`
      let resolve!: () => void
      const promise = new Promise((settle) => {
        resolve = () => settle([{ timestamp: 0, frame: null }])
      })
      inFlight.push({ label, resolve })
      return { promise, handle: { stop: vi.fn() } }
    }
    sampleClipSequentialMock.mockImplementation((_blob: Blob, passDetector: PoseDetector) =>
      track('1', passDetector),
    )
    // Only clip 2 samples on the playback path.
    sampleClipMock.mockImplementation((_video: HTMLVideoElement, passDetector: PoseDetector) =>
      track('2', passDetector),
    )

    render(<MultiClipVideoSession detector={detector} modelLoad={IDLE_MODEL_LOADS} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: {
        files: [
          new File(['a'], 'run1.mp4', { type: 'video/mp4' }),
          new File(['b'], 'run2.webm', { type: 'video/webm' }),
        ],
      },
    })
    await act(async () => {})
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    for (const video of canonicalVideos()) markVideoReady(video)

    const order: string[] = []
    for (let step = 0; step < 4; step += 1) {
      await waitFor(() => expect(inFlight).toHaveLength(1))
      await act(async () => {})
      expect(inFlight).toHaveLength(1)
      const { label, resolve } = inFlight.shift()!
      order.push(label)
      await act(async () => {
        resolve()
      })
    }

    expect(order).toEqual(['P1', 'S1', 'P2', 'S2'])
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
  })

  it('removes clips one by one, and removing the last one returns to the picker', async () => {
    render(<MultiClipVideoSession detector={null} modelLoad={IDLE_MODEL_LOADS} />)

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
    expect(screen.getByRole('button', { name: /demo \(3 clips\)/i })).toBeInTheDocument()
  })

  it('releases the removed clip’s poster in `removeClip` itself, and leaves the survivor’s alone', async () => {
    const posters = posterPerFile()
    render(<MultiClipVideoSession detector={null} modelLoad={IDLE_MODEL_LOADS} />)

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

  it('releases every clip’s poster in `handleStartOver` itself when the session resets', async () => {
    const posters = posterPerFile()
    render(<MultiClipVideoSession detector={null} modelLoad={IDLE_MODEL_LOADS} />)

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
    // The first click only asks (strides-qi5q); nothing is released until the reader confirms.
    fireEvent.click(screen.getByRole('button', { name: /^start over$/i }))
    expect(screen.getByText(/remove all 2 clips and start over\?/i)).toBeInTheDocument()
    expect(all.map(isReleased)).toEqual([false, false])
    screen.getByRole('button', { name: /remove and start over/i }).click()

    // EVERY clip, not just the active one — the session is going away whole.
    expect(all.map(isReleased)).toEqual([true, true])

    await act(async () => {})
    // Back to a genuinely empty session, not one seeded slot.
    await waitFor(() => expect(canonicalVideos()).toHaveLength(0))
    expect(screen.getByRole('button', { name: /demo \(3 clips\)/i })).toBeInTheDocument()
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
    render(<MultiClipVideoSession detector={detector} modelLoad={IDLE_MODEL_LOADS} />)

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

  describe('the model-download entry (strides-utn.5)', () => {
    const PRIMARY_LOADING: ModelLoadStates = {
      primary: { phase: 'loading', progress: { loadedBytes: 4_200_000, totalBytes: 14_522_593 } },
      scalePass: IDLE_MODEL_LOAD_STATE,
    }

    /**
     * The state a first-time visitor is in for the whole of MoveNet's 14.5 MB download — and the
     * exact state in which the clip strip did not render at all, because it was gated on
     * `clipIds.length > 0`.
     */
    it('renders at zero clips, where the clip strip does not render at all', () => {
      render(<MultiClipVideoSession detector={null} modelLoad={PRIMARY_LOADING} />)

      expect(canonicalVideos()).toHaveLength(0)
      expect(screen.queryByRole('list', { name: /clips/i })).not.toBeInTheDocument()

      const entry = screen.getByText('4.2 MB')
      expect(screen.getByRole('banner')).toContainElement(entry)
      expect(screen.getByText(/downloading the pose model… 4\.2 mb so far\./i)).toBeInTheDocument()
    })

    it('is absent while both owners are settled', () => {
      render(<MultiClipVideoSession detector={null} modelLoad={IDLE_MODEL_LOADS} />)

      expect(document.querySelector('.model-load-entry')).toBeNull()
    })

    it('leaves as soon as the download it reports completes', () => {
      const { rerender } = render(
        <MultiClipVideoSession detector={null} modelLoad={PRIMARY_LOADING} />,
      )
      expect(document.querySelector('.model-load-entry')).not.toBeNull()

      rerender(
        <MultiClipVideoSession
          detector={null}
          modelLoad={{ primary: { phase: 'ready', progress: null }, scalePass: IDLE_MODEL_LOAD_STATE }}
        />,
      )
      expect(document.querySelector('.model-load-entry')).toBeNull()
    })

    it('reappears mid-session when the scale pass starts its own, much later download', async () => {
      const { rerender } = render(
        <MultiClipVideoSession
          detector={null}
          modelLoad={{ primary: { phase: 'ready', progress: null }, scalePass: IDLE_MODEL_LOAD_STATE }}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
      await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))
      markVideoReady(canonicalVideos()[0])
      expect(document.querySelector('.model-load-entry')).toBeNull()

      rerender(
        <MultiClipVideoSession
          detector={null}
          modelLoad={{
            primary: { phase: 'ready', progress: null },
            scalePass: { phase: 'loading', progress: { loadedBytes: 9_398_198, totalBytes: 9_398_198 } },
          }}
        />,
      )

      expect(screen.getByText('9.4 MB')).toBeInTheDocument()
      expect(screen.getByText(/downloading the scale model…/i)).toBeInTheDocument()
    })

    /**
     * `multi-clip-analysis` requires exactly one strip entry per clip, in clip-session order, so a
     * reader can match `"Combined from clip N of TOTAL"` by counting. A non-clip entry inside
     * `<ul aria-label="Clips">` would break that count — hence a preceding SIBLING.
     */
    it('is not a member of the clip list and does not renumber clips', async () => {
      render(<MultiClipVideoSession detector={null} modelLoad={PRIMARY_LOADING} />)

      fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
      await chooseFile(new File(['x'], 'run1.mp4', { type: 'video/mp4' }))
      markVideoReady(canonicalVideos()[0])
      await addAnotherClip(new File(['y'], 'run2.mp4', { type: 'video/mp4' }))
      await waitFor(() => expect(canonicalVideos()).toHaveLength(2))

      const list = screen.getByRole('list', { name: /clips/i })
      expect(list.querySelectorAll('li')).toHaveLength(2)
      expect(list.querySelector('.model-load-entry')).toBeNull()

      const entry = document.querySelector('.model-load-entry')!
      // Preceding sibling of the list, in the same scrolling strip.
      expect(entry.nextElementSibling).toBe(list)
      expect(entry.parentElement).toBe(list.parentElement)

      // Counting still works: entry 2 of the list is still "Clip 2 of 2".
      expect(screen.getByText(/clip 2 of 2:/i)).toBeInTheDocument()
    })

    /**
     * `results-view`: at most one live region announces progress for the session. The entry has to
     * be readable without becoming a second announcer against the active clip's `role="status"`.
     */
    it('adds no live region while a clip is being analysed', async () => {
      render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={PRIMARY_LOADING} />)

      fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
      await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))
      markVideoReady(canonicalVideos()[0])
      await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())

      const entry = document.querySelector('.model-load-entry')!
      expect(entry.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull()

      // The session's own budget is unchanged by this entry: the announcers are the session status
      // line and the one active clip's caption, exactly as before.
      const banner = screen.getByRole('banner')
      expect(banner.querySelectorAll('[role="status"], [role="alert"], [aria-live]')).toHaveLength(1)
    })

    it('reports a failed download as a failure rather than as work still in progress', () => {
      render(
        <MultiClipVideoSession
          detector={null}
          modelLoad={{
            primary: { phase: 'error', progress: null },
            scalePass: IDLE_MODEL_LOAD_STATE,
          }}
        />,
      )

      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(
        screen.getByText(/the pose model could not be downloaded\. reload the page to try again\./i),
      ).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------------------------
// Results view mode: the tour default, the remembered summary landing and `?view=classic` (strides-trn2.2)
// ---------------------------------------------------------------------------------------------

// A PASSTHROUGH spy — hoisted like every `vi.mock`, so it is in place for the whole file, and it
// calls the real hook unless a test below overrides it. Every case above therefore still runs the
// real `useSessionEvidence`. It exists because jsdom decodes no video, so the real extraction never
// produces a canvas; the canvas-identity case below needs one, and `afterEach` puts the real
// implementation back.
vi.mock('./useSessionEvidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useSessionEvidence')>()
  return { ...actual, useSessionEvidence: vi.fn(actual.useSessionEvidence) }
})
// Also a PASSTHROUGH, so one case can put a button ahead of the summary's entry control. `afterEach`
// puts the real component back.
vi.mock('./summary/ResultsSummary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./summary/ResultsSummary')>()
  return { ...actual, ResultsSummary: vi.fn(actual.ResultsSummary) }
})

describe('MultiClipVideoSession — results view mode', () => {
  let originalHref: string

  beforeEach(() => {
    originalHref = window.location.href
    window.localStorage.clear()
  })

  afterEach(async () => {
    window.history.replaceState(null, '', originalHref)
    vi.restoreAllMocks()
    window.localStorage.clear()
    const actual = await vi.importActual<typeof import('./useSessionEvidence')>(
      './useSessionEvidence',
    )
    const hook = vi.mocked((await import('./useSessionEvidence')).useSessionEvidence)
    hook.mockImplementation(actual.useSessionEvidence)
    const actualSummary = await vi.importActual<typeof import('./summary/ResultsSummary')>(
      './summary/ResultsSummary',
    )
    vi.mocked((await import('./summary/ResultsSummary')).ResultsSummary).mockImplementation(
      actualSummary.ResultsSummary,
    )
  })

  /** Makes the session's evidence one settled canvas, and returns it. jsdom decodes no video, so the
   * real extraction never produces one. */
  async function settleOneEvidenceCanvas(): Promise<HTMLCanvasElement> {
    const plan: EvidenceFramePlan = {
      metric: 'trunkLean',
      kind: 'footStrike',
      quality: 0.8,
      label: 'Torso at the widest lean',
      side: 'left',
      base: { timestamp: 0.4, opacity: 1, keypoints: [], outwardSign: null, side: null },
      ghost: null,
      crop: { x: 0, y: 0, side: 200 },
      travelDirection: 1,
      demotion: null,
      cropGrowth: null,
      focusOffset: null,
    }
    const canvas = document.createElement('canvas')
    // One stable object, as the real hook returns between changes — a fresh one per render would
    // hand every view a new evidence identity on every render.
    const settled: SessionEvidenceState = {
      status: 'settled',
      sections: [{ metric: 'trunkLean', clipIndex: 0, items: [{ plan, canvas }] }],
    }
    vi.mocked((await import('./useSessionEvidence')).useSessionEvidence).mockImplementation(
      () => settled,
    )
    return canvas
  }

  /** Every results view's root — classic, or the one guided view inside the tour or summary. */
  function resultsRoots(): Element[] {
    return Array.from(document.querySelectorAll('section[aria-label="Analysis results"]'))
  }

  /**
   * Which view is mounted, asserting on the way that it is EXACTLY one: one results root, exactly
   * one of the classic panel / the guided root, exactly one of tour / summary / classic, and exactly
   * one "Analysis complete." line (a second would break Playwright's strict locator in the e2e suite
   * and the A/B harness). Called after every step rather than once, because "never two" is the
   * invariant (design.md D7.3), not "eventually one".
   */
  function mountedView(): 'tour' | 'summary' | 'classic' {
    expect(resultsRoots()).toHaveLength(1)
    const classic = document.querySelectorAll('.metrics-panel').length
    const guided = document.querySelectorAll('.guided-results').length
    expect(classic + guided).toBe(1)
    expect(screen.getAllByText(/analysis complete/i)).toHaveLength(1)
    expect(
      screen.getAllByRole('status').filter((el) => /^Analysis complete\./.test(el.textContent ?? '')),
    ).toHaveLength(1)
    const tour = document.querySelectorAll('.runner-tour').length
    const summary = document.querySelectorAll('.results-summary').length
    expect(tour + summary + classic).toBe(1)
    if (classic === 1) {
      expect(document.querySelector('.motion-story')).not.toBeNull()
      return 'classic'
    }
    // The motion stage renders beside the classic table only.
    expect(document.querySelector('.motion-story')).toBeNull()
    return tour === 1 ? 'tour' : 'summary'
  }

  async function loadOneReadyClip() {
    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
  }

  it('renders no results view before a clip is ready', async () => {
    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)
    expect(screen.queryByRole('button', { name: 'Skip to summary' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))
    // Loading, not loaded: still the picker, still no results view.
    expect(canonicalVideos()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Skip to summary' })).toBeNull()
    expect(resultsRoots()).toHaveLength(0)

    markVideoReady(canonicalVideos()[0])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Skip to summary' })).toBeInTheDocument(),
    )
  })

  it('defaults to the tour with no view param and no landing, and leaves the address untouched', async () => {
    window.history.replaceState(null, '', '/strides/?clip=demo#top')
    await loadOneReadyClip()

    expect(mountedView()).toBe('tour')
    expect(document.querySelector('.guided-results__group')).not.toBeNull()
    expect(document.querySelector('.runner-tour .results-runner-slot')).toHaveAttribute('aria-hidden', 'true')
    expect(window.location.search).toBe('?clip=demo')
    expect(window.location.hash).toBe('#top')
  })

  it('lands on the summary when the summary is remembered', async () => {
    window.localStorage.setItem('strides.resultsLanding', 'summary')
    await loadOneReadyClip()
    expect(mountedView()).toBe('summary')
    expect(screen.getByRole('button', { name: 'Replay tour' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Classic table' })).toBeInTheDocument()
  })

  it.each(['?view=guide', '?view=CLASSIC', '?view=nonsense', '?view=classic&view=guide'])(
    'renders the tour for %s',
    async (search) => {
      window.history.replaceState(null, '', `/strides/${search}`)
      await loadOneReadyClip()
      expect(mountedView()).toBe('tour')
    },
  )

  it('renders the tour for an old ?view=guide link even when the summary is remembered', async () => {
    window.localStorage.setItem('strides.resultsLanding', 'summary')
    window.history.replaceState(null, '', '/strides/?view=guide')
    await loadOneReadyClip()
    expect(mountedView()).toBe('tour')
  })

  it('is seeded with the classic view, beside the motion stage, from ?view=classic', async () => {
    window.history.replaceState(null, '', '/strides/?view=classic')
    await loadOneReadyClip()

    expect(mountedView()).toBe('classic')
    expect(document.querySelector('.guided-results__group')).toBeNull()
    const back = screen.getByRole('button', { name: 'Show summary' })
    expect(screen.getByRole('main')).toContainElement(back)
    expect(screen.getByRole('banner')).not.toContainElement(back)
    // Above the classic layout, which holds both the stage and the results.
    const layout = back.nextElementSibling
    expect(layout?.querySelector('.motion-story')).not.toBeNull()
    expect(layout?.contains(resultsRoots()[0])).toBe(true)
  })

  it('renders the tour when storage throws, and Skip still works', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    await loadOneReadyClip()
    expect(mountedView()).toBe('tour')

    fireEvent.click(screen.getByRole('button', { name: 'Skip to summary' }))
    expect(mountedView()).toBe('summary')
  })

  it('Skip remembers the summary, removes view from the address and moves focus into the summary', async () => {
    window.history.replaceState(null, '', '/strides/?clip=demo&view=tour#top')
    await loadOneReadyClip()
    expect(mountedView()).toBe('tour')

    const skip = screen.getByRole('button', { name: 'Skip to summary' })
    skip.focus()
    fireEvent.click(skip)

    expect(mountedView()).toBe('summary')
    expect(window.localStorage.getItem('strides.resultsLanding')).toBe('summary')
    expect(window.location.search).toBe('?clip=demo')
    expect(window.location.hash).toBe('#top')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Replay tour' }))
  })

  it('Replay tour returns to the tour and leaves the remembered landing alone', async () => {
    window.localStorage.setItem('strides.resultsLanding', 'summary')
    await loadOneReadyClip()
    expect(mountedView()).toBe('summary')

    fireEvent.click(screen.getByRole('button', { name: 'Replay tour' }))
    expect(mountedView()).toBe('tour')
    expect(window.localStorage.getItem('strides.resultsLanding')).toBe('summary')
    expect(window.location.search).toBe('')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skip to summary' }))
  })

  it('Classic table writes view=classic, and Show summary removes it again', async () => {
    window.localStorage.setItem('strides.resultsLanding', 'summary')
    window.history.replaceState(null, '', '/strides/?clip=demo#top')
    await loadOneReadyClip()
    expect(mountedView()).toBe('summary')

    fireEvent.click(screen.getByRole('button', { name: 'Classic table' }))
    expect(mountedView()).toBe('classic')
    expect(window.location.search).toBe('?clip=demo&view=classic')
    expect(window.location.hash).toBe('#top')
    expect(window.location.pathname).toBe('/strides/')
    const show = screen.getByRole('button', { name: 'Show summary' })
    expect(document.activeElement).toBe(show)

    fireEvent.click(show)
    expect(mountedView()).toBe('summary')
    expect(window.location.search).toBe('?clip=demo')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Replay tour' }))
  })

  it('focuses the marked entry control, not a button that happens to come first', async () => {
    const { ResultsSummary: ActualSummary } = await vi.importActual<
      typeof import('./summary/ResultsSummary')
    >('./summary/ResultsSummary')
    vi.mocked((await import('./summary/ResultsSummary')).ResultsSummary).mockImplementation(
      (props) => (
        <>
          {/* A control a later ticket might put in the runner slot, ahead of the entry control. */}
          <div className="results-runner-slot">
            <button type="button">Runner control</button>
          </div>
          <ActualSummary {...props} />
        </>
      ),
    )
    await loadOneReadyClip()
    expect(mountedView()).toBe('tour')

    fireEvent.click(screen.getByRole('button', { name: 'Skip to summary' }))
    expect(mountedView()).toBe('summary')
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Runner control' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Replay tour' }))
  })

  it('does not move focus when the first view mounts', async () => {
    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))
    // Focus is somewhere that survives the picker unmounting; mounting the tour must not move it.
    const heading = screen.getByRole('heading', { name: 'Strides' })
    heading.focus()
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())

    expect(mountedView()).toBe('tour')
    expect(document.activeElement).toBe(heading)
  })

  it('browser Back steps back through the views without leaving the page, and Forward replays them', async () => {
    const canvas = await settleOneEvidenceCanvas()
    window.history.replaceState(null, '', '/strides/?clip=demo')
    await loadOneReadyClip()
    expect(mountedView()).toBe('tour')
    // The entry the page loaded on is stamped with the view it opened with.
    expect(window.history.state).toEqual({ stridesView: 'tour' })

    fireEvent.click(screen.getByRole('button', { name: 'Skip to summary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Classic table' }))
    expect(mountedView()).toBe('classic')
    expect(window.location.search).toBe('?clip=demo&view=classic')

    window.history.back()
    await waitFor(() => expect(mountedView()).toBe('summary'))
    expect(window.location.search).toBe('?clip=demo')
    expect(document.querySelector('.results-summary .evidence-image > canvas')).toBe(canvas)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Replay tour' }))

    // The load entry restores the tour, although the summary is remembered by now.
    window.history.back()
    await waitFor(() => expect(mountedView()).toBe('tour'))
    expect(window.localStorage.getItem('strides.resultsLanding')).toBe('summary')
    expect(document.querySelector('.runner-tour .evidence-image > canvas')).toBe(canvas)

    window.history.forward()
    await waitFor(() => expect(mountedView()).toBe('summary'))
    window.history.forward()
    await waitFor(() => expect(mountedView()).toBe('classic'))
    expect(window.location.search).toBe('?clip=demo&view=classic')
    expect(document.querySelector('.metrics-panel .evidence-image > canvas')).toBe(canvas)
  })

  it('Back from a replayed tour returns to the summary, though both share one address', async () => {
    window.localStorage.setItem('strides.resultsLanding', 'summary')
    await loadOneReadyClip()
    expect(mountedView()).toBe('summary')

    fireEvent.click(screen.getByRole('button', { name: 'Replay tour' }))
    expect(mountedView()).toBe('tour')
    const pushes = vi.spyOn(window.history, 'pushState')

    window.history.back()
    await waitFor(() => expect(mountedView()).toBe('summary'))
    // Restoring a view from history adds no entry of its own.
    expect(pushes).not.toHaveBeenCalled()
  })

  it('keeps the view on screen for an entry no switch created, such as an in-page # link', async () => {
    window.localStorage.setItem('strides.resultsLanding', 'summary')
    await loadOneReadyClip()
    fireEvent.click(screen.getByRole('button', { name: 'Replay tour' }))
    expect(mountedView()).toBe('tour')

    // What a fragment navigation leaves behind: an entry with no state. Its address (no `view`,
    // summary remembered) would re-resolve to the summary, which is exactly what must not happen.
    window.history.pushState(null, '', '#cadence')
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    })
    expect(mountedView()).toBe('tour')
    expect(window.history.state).toEqual({ stridesView: 'tour' })
  })

  it('reads the address once, at mount — a later change to it does not switch the view', async () => {
    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)
    window.history.replaceState(null, '', '/strides/?view=classic')

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())

    expect(mountedView()).toBe('tour')
  })

  it('publishes the header height on <main>, for every view’s scroll targets', async () => {
    await loadOneReadyClip()
    expect(mountedView()).toBe('tour')
    expect(
      screen.getByRole('main').style.getPropertyValue('--motion-story-header-height'),
    ).toMatch(/^\d+px$/)
  })

  it('moves the SAME evidence canvas through tour → summary → classic → summary, never losing it', async () => {
    const canvas = await settleOneEvidenceCanvas()
    await loadOneReadyClip()

    expect(mountedView()).toBe('tour')
    // Identity, not a lookalike: the one node the extractor produced is what each view shows.
    expect(document.querySelector('.runner-tour .guided-results .evidence-image > canvas')).toBe(canvas)

    fireEvent.click(screen.getByRole('button', { name: 'Skip to summary' }))
    expect(mountedView()).toBe('summary')
    expect(document.querySelector('.results-summary .guided-results .evidence-image > canvas')).toBe(canvas)

    fireEvent.click(screen.getByRole('button', { name: 'Classic table' }))
    expect(mountedView()).toBe('classic')
    expect(document.querySelector('.metrics-panel .evidence-image > canvas')).toBe(canvas)

    fireEvent.click(screen.getByRole('button', { name: 'Show summary' }))
    expect(mountedView()).toBe('summary')
    expect(document.querySelector('.results-summary .guided-results .evidence-image > canvas')).toBe(canvas)
  })
})

// ---------------------------------------------------------------------------------------------
// Waiting on a phone: screen wake lock and the wait notice (strides-6os1)
// ---------------------------------------------------------------------------------------------

describe('MultiClipVideoSession — waiting on a phone', () => {
  afterEach(() => {
    // @ts-expect-error -- removing the test double
    delete navigator.wakeLock
    vi.unstubAllGlobals()
  })

  function stubPointer(coarse: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(pointer: coarse)' ? coarse : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
  }

  async function startHangingAnalysis() {
    const stop = vi.fn()
    sampleClipMock.mockImplementationOnce(() => ({
      promise: new Promise(() => {}), // mid-analysis for the whole test
      handle: { stop },
    }))
    render(<MultiClipVideoSession detector={makeFakeDetector()} modelLoad={IDLE_MODEL_LOADS} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    await chooseFile(new File(['x'], 'run.mp4', { type: 'video/mp4' }))
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))
  }

  it('holds a screen wake lock while a clip is analysing, and releases it on start over', async () => {
    stubPointer(false)
    const sentinel = { released: false, release: vi.fn(async () => { sentinel.released = true }) }
    const request = vi.fn(async () => sentinel)
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })

    await startHangingAnalysis()
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))

    fireEvent.click(screen.getByRole('button', { name: /^start over$/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove and start over/i }))
    await waitFor(() => expect(sentinel.release).toHaveBeenCalled())
  })

  it('tells a coarse-pointer reader to expect a wait, without a live region', async () => {
    stubPointer(true)
    await startHangingAnalysis()
    const notice = await screen.findByText(/analysis on a phone can take a minute or more/i)
    expect(notice.closest('[aria-live],[role="status"],[role="alert"]')).toBeNull()
  })

  it('says nothing about phones on a fine-pointer device', async () => {
    stubPointer(false)
    await startHangingAnalysis()
    expect(screen.queryByText(/analysis on a phone/i)).toBeNull()
  })
})

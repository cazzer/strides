import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  estimatePoses,
  dispose,
  reset,
  multiPoseEstimatePoses,
  multiPoseDispose,
  multiPoseReset,
  createDetectorMock,
} = vi.hoisted(() => ({
  estimatePoses: vi.fn(),
  dispose: vi.fn(),
  reset: vi.fn(),
  multiPoseEstimatePoses: vi.fn(),
  multiPoseDispose: vi.fn(),
  multiPoseReset: vi.fn(),
  createDetectorMock: vi.fn(),
}))

vi.mock('@tensorflow/tfjs-backend-webgl', () => ({}))

vi.mock('@tensorflow/tfjs-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tensorflow/tfjs-core')>()
  return {
    ...actual,
    setBackend: vi.fn().mockResolvedValue(true),
    ready: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@tensorflow-models/pose-detection', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tensorflow-models/pose-detection')>()
  return {
    ...actual,
    createDetector: createDetectorMock,
  }
})

import * as poseDetection from '@tensorflow-models/pose-detection'
import { createMoveNetDetector } from './movenet'
import { MOVENET_RAW_KEYPOINTS } from './__fixtures__/movenet-keypoints.fixture'
import { COMMON_KEYPOINT_NAMES } from '../types'
import { DEFAULT_TRACKING_CROP_CONFIG } from './trackingCropConfig'
import type { TrackingCropConfig } from './trackingCropConfig'
import {
  DEFAULT_PERSON_OF_INTEREST_CONFIG,
  POST_ACQUISITION_SETTLE_FRAMES,
  REVERIFICATION_INTERVAL_FRAMES,
} from './personOfInterestConfig'
import type { PersonOfInterestConfig } from './personOfInterestConfig'
import { stubCanvas2DContext } from '../../test/canvasTestUtils'
import type { FakeCanvasRenderingContext2D } from '../../test/canvasTestUtils'
import { videoFrameSource } from '../detector'

/**
 * Crop-mode tests opt in explicitly: the shipped default is `enabled: false` (see
 * DEFAULT_TRACKING_CROP_CONFIG's doc comment for the A/B evidence behind that).
 */
const CROP_ON: TrackingCropConfig = {
  ...DEFAULT_TRACKING_CROP_CONFIG,
  enabled: true,
}

/**
 * Person-of-interest tests opt in explicitly too; every test *not* about acquisition/
 * reacquisition passes this so the multi-pose path never intercepts a call it isn't testing (see
 * the `person-of-interest acquisition/reacquisition` describe block below for the tests that
 * exercise it directly).
 */
const POI_OFF: PersonOfInterestConfig = {
  ...DEFAULT_PERSON_OF_INTEREST_CONFIG,
  enabled: false,
}

/** A confident, canvas-space (0..192) 12-point detection -- keeps crop-mode tracking engaged. */
const CROP_SPACE_CONFIDENT_KEYPOINTS = [
  { name: 'left_shoulder', x: 80, y: 40, score: 0.9 },
  { name: 'right_shoulder', x: 110, y: 40, score: 0.9 },
  { name: 'left_elbow', x: 70, y: 70, score: 0.9 },
  { name: 'right_elbow', x: 120, y: 70, score: 0.9 },
  { name: 'left_wrist', x: 60, y: 100, score: 0.9 },
  { name: 'right_wrist', x: 130, y: 100, score: 0.9 },
  { name: 'left_hip', x: 85, y: 110, score: 0.9 },
  { name: 'right_hip', x: 105, y: 110, score: 0.9 },
  { name: 'left_knee', x: 85, y: 150, score: 0.9 },
  { name: 'right_knee', x: 105, y: 150, score: 0.9 },
  { name: 'left_ankle', x: 85, y: 185, score: 0.9 },
  { name: 'right_ankle', x: 105, y: 185, score: 0.9 },
]

/** Same shape as above, but every score below the default 0.3 confidence gate -- "not usable". */
const CROP_SPACE_LOW_CONFIDENCE_KEYPOINTS = CROP_SPACE_CONFIDENT_KEYPOINTS.map(
  (k) => ({
    ...k,
    score: 0.1,
  }),
)

/**
 * Multi-pose candidate fixtures, in full-frame video-pixel space (acquisition/reacquisition calls
 * never crop, see design.md's "Person-of-interest scoring") -- unlike CROP_SPACE_*, these model
 * distinct *people* at distinct positions/sizes for the acquisition/reacquisition heuristics to
 * choose between, not one person's steady-state detection.
 *
 * A small, fully-resolved 12-point bbox (~50x120, area 6000) -- mimics the reported bug's
 * background bystander: a real, usable detection, just a much smaller bbox-area-weighted-by-
 * confidence score than a nearer/larger subject.
 */
const SMALL_DISTANT_CANDIDATE_KEYPOINTS = [
  { name: 'left_shoulder', x: 100, y: 200, score: 0.9 },
  { name: 'right_shoulder', x: 130, y: 200, score: 0.9 },
  { name: 'left_elbow', x: 95, y: 220, score: 0.9 },
  { name: 'right_elbow', x: 135, y: 220, score: 0.9 },
  { name: 'left_wrist', x: 90, y: 240, score: 0.9 },
  { name: 'right_wrist', x: 140, y: 240, score: 0.9 },
  { name: 'left_hip', x: 105, y: 260, score: 0.9 },
  { name: 'right_hip', x: 125, y: 260, score: 0.9 },
  { name: 'left_knee', x: 105, y: 290, score: 0.9 },
  { name: 'right_knee', x: 125, y: 290, score: 0.9 },
  { name: 'left_ankle', x: 105, y: 320, score: 0.9 },
  { name: 'right_ankle', x: 125, y: 320, score: 0.9 },
]

/**
 * The canvas-space (0..192) detection a crop built around SMALL_DISTANT_CANDIDATE_KEYPOINTS would
 * actually produce for that same person, derived as the exact inverse of `toVideoSpaceKeypoints`
 * so it round-trips back to that fixture's own video-space box.
 *
 * `CROP_SPACE_CONFIDENT_KEYPOINTS` cannot serve here: it fills most of the 192px canvas, which is
 * right after a crop built around the large `MOVENET_RAW_KEYPOINTS` box but wrong after this tiny
 * one -- a 50x120 box floors the crop side at `minCropSidePx` (256), so the subject occupies only
 * ~37x90 of the canvas, and a full-canvas detection there would remap to roughly 3x the anchor's
 * area. The steady-state continuity gate (`anchor-continuity-gate`) correctly rejects that as a
 * scale discontinuity, so tests pairing a small acquisition candidate with steady-state crop-mode
 * calls need a scale-consistent fixture, not a gate exemption.
 *
 * Crop geometry, from `computeCropRect` on `{minX:90, minY:200, maxX:140, maxY:320}` in a 1280x720
 * frame: `max(50,120) * 1.75 = 210`, floored to 256, positioned at `(0, 132)` after clamping.
 */
const SMALL_ANCHOR_CROP_RECT = { x: 0, y: 132, side: 256 }
const CROP_SPACE_SMALL_ANCHOR_KEYPOINTS = SMALL_DISTANT_CANDIDATE_KEYPOINTS.map(
  (k) => ({
    ...k,
    x: ((k.x - SMALL_ANCHOR_CROP_RECT.x) / SMALL_ANCHOR_CROP_RECT.side) * 192,
    y: ((k.y - SMALL_ANCHOR_CROP_RECT.y) / SMALL_ANCHOR_CROP_RECT.side) * 192,
  }),
)

/** A small shift (+15, +10) from SMALL_DISTANT_CANDIDATE_KEYPOINTS's bbox -- overlaps it
 * (nonzero IoU), modeling the same person a couple of frames later. */
const SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS =
  SMALL_DISTANT_CANDIDATE_KEYPOINTS.map((k) => ({
    ...k,
    x: k.x + 15,
    y: k.y + 10,
  }))

/** Disjoint from SMALL_DISTANT_CANDIDATE_KEYPOINTS's bbox (zero IoU) but within
 * REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE x its side -- the proximity-fallback case. */
const NEARBY_NO_OVERLAP_CANDIDATE_KEYPOINTS =
  SMALL_DISTANT_CANDIDATE_KEYPOINTS.map((k) => ({
    ...k,
    x: k.x + 200,
  }))

/** Far from SMALL_DISTANT_CANDIDATE_KEYPOINTS's bbox -- zero IoU and outside the proximity
 * threshold -- a second, smaller-scored "no match" candidate for the acquisition-heuristic
 * fallback tests, so that fallback provably isn't just "pick whichever candidate came first". */
const FAR_SMALL_CANDIDATE_KEYPOINTS = SMALL_DISTANT_CANDIDATE_KEYPOINTS.map(
  (k) => ({
    ...k,
    x: k.x + 600,
  }),
)

/** A large, fully-resolved 12-point bbox (~380x600, area 228000) at a distinct position -- a much
 * higher acquisition score than SMALL_DISTANT_CANDIDATE_KEYPOINTS despite identical confidence,
 * purely from bbox size. */
const LARGE_CANDIDATE_KEYPOINTS = [
  { name: 'left_shoulder', x: 600, y: 100, score: 0.9 },
  { name: 'right_shoulder', x: 900, y: 100, score: 0.9 },
  { name: 'left_elbow', x: 580, y: 250, score: 0.9 },
  { name: 'right_elbow', x: 920, y: 250, score: 0.9 },
  { name: 'left_wrist', x: 560, y: 400, score: 0.9 },
  { name: 'right_wrist', x: 940, y: 400, score: 0.9 },
  { name: 'left_hip', x: 650, y: 450, score: 0.9 },
  { name: 'right_hip', x: 850, y: 450, score: 0.9 },
  { name: 'left_knee', x: 660, y: 600, score: 0.9 },
  { name: 'right_knee', x: 840, y: 600, score: 0.9 },
  { name: 'left_ankle', x: 670, y: 700, score: 0.9 },
  { name: 'right_ankle', x: 830, y: 700, score: 0.9 },
]

/**
 * As CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, but for a crop built around LARGE_CANDIDATE_KEYPOINTS.
 *
 * Crop geometry, from `computeCropRect` on `{minX:560, minY:100, maxX:940, maxY:700}` in a
 * 1280x720 frame: `max(380,600) * 1.75 = 1050`, capped at `min(1280,720) = 720`, positioned at
 * `(390, 0)` -- the y clamp is exact here, since a 720-side crop in a 720-tall frame can only sit
 * at y = 0.
 */
const LARGE_ANCHOR_CROP_RECT = { x: 390, y: 0, side: 720 }
const CROP_SPACE_LARGE_ANCHOR_KEYPOINTS = LARGE_CANDIDATE_KEYPOINTS.map((k) => ({
  ...k,
  x: ((k.x - LARGE_ANCHOR_CROP_RECT.x) / LARGE_ANCHOR_CROP_RECT.side) * 192,
  y: ((k.y - LARGE_ANCHOR_CROP_RECT.y) / LARGE_ANCHOR_CROP_RECT.side) * 192,
}))

function makeVideo(
  currentTime: number,
  videoWidth = 1280,
  videoHeight = 720,
): HTMLVideoElement {
  return { currentTime, videoWidth, videoHeight } as HTMLVideoElement
}

/**
 * Argument COUNT no longer discriminates a full-frame call from a crop-mode one: since
 * `anchor-continuity-gate` both shapes pass the frame timestamp as a third argument (see
 * `movenet.ts`'s `timestampMs` -- omitting it silently disabled MoveNet's built-in one-euro
 * keypoint filter for any image source without a `currentTime`, which is every source the
 * sequential-decode sampler produces). The IMAGE argument is the discriminator now, so these
 * helpers assert that, plus the timestamp contract when a specific video is supplied.
 *
 * The combined kill-switch path is the one exception and keeps its own helper below.
 */
function expectFullFrameCall(call: unknown[], video?: HTMLVideoElement): void {
  expect(call).toHaveLength(3)
  expect(call[0]).toHaveProperty('currentTime')
  if (video !== undefined) {
    expect(call[0]).toEqual(video)
    expect(call[2]).toBe(video.currentTime * 1000)
  }
}

function expectCropCall(call: unknown[], video?: HTMLVideoElement): void {
  expect(call).toHaveLength(3)
  expect(call[0]).not.toHaveProperty('currentTime')
  if (video !== undefined) expect(call[2]).toBe(video.currentTime * 1000)
}

/**
 * The combined kill-switch path (tracking-crop AND person-of-interest both disabled) must stay
 * byte-identical to this backend's pre-capability behavior, which includes passing the image
 * source as `estimatePoses`' ONLY argument -- that path runs no new-run check, so it never resets
 * the underlying detector between analysis runs, and handing MoveNet's one-euro filter a
 * backwards-jumping timestamp series would be worse than leaving it implicit.
 */
function expectKillSwitchCall(call: unknown[]): void {
  expect(call).toHaveLength(1)
  expect(call[0]).toHaveProperty('currentTime')
}

let fakeCtx: FakeCanvasRenderingContext2D

beforeEach(() => {
  estimatePoses.mockReset()
  dispose.mockReset()
  reset.mockReset()
  multiPoseEstimatePoses.mockReset()
  multiPoseDispose.mockReset()
  multiPoseReset.mockReset()
  createDetectorMock.mockReset()
  // Model-type-aware: MULTIPOSE_LIGHTNING calls get their own fake detector/mocks, independent of
  // the single-pose fake -- needed so acquisition/reacquisition tests can return multiple
  // distinct candidates without also controlling the single-pose steady-state fixture.
  createDetectorMock.mockImplementation(
    async (_model: unknown, config?: { modelType?: string }) => {
      if (
        config?.modelType ===
        poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING
      ) {
        return {
          estimatePoses: multiPoseEstimatePoses,
          dispose: multiPoseDispose,
          reset: multiPoseReset,
        }
      }
      return { estimatePoses, dispose, reset }
    },
  )
  fakeCtx = stubCanvas2DContext()
})

describe('createMoveNetDetector', () => {
  it('defaults to SinglePose Lightning on the WebGL backend', async () => {
    await createMoveNetDetector()

    expect(createDetectorMock).toHaveBeenCalledWith(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING },
    )
  })

  it('creates the multi-pose detector at an explicit input resolution, not the library default', async () => {
    await createMoveNetDetector()

    // The library defaults `multiPoseMaxDimension` to 256, at which this model returned zero
    // detections on 25 of 40 frames of the real multi-person fixture and never saw two people at
    // all -- the measured root cause of the person-of-interest validation gap. Asserted explicitly
    // so the value cannot silently revert to a default that makes the whole capability inert.
    expect(createDetectorMock).toHaveBeenCalledWith(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        multiPoseMaxDimension: 448,
      },
    )
  })

  it('selects SinglePose Thunder when given modelType: "thunder"', async () => {
    await createMoveNetDetector('thunder')

    expect(createDetectorMock).toHaveBeenCalledWith(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER },
    )
  })

  it('maps a single-frame estimate to a PoseFrame using the shared fixture', async () => {
    estimatePoses.mockResolvedValue([
      { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
    ])
    const video = { currentTime: 12.5 } as HTMLVideoElement

    const detector = await createMoveNetDetector(undefined, undefined, POI_OFF)
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(estimatePoses).toHaveBeenCalledWith(video)
    expect(frame?.timestamp).toBe(12.5)
    expect(frame?.keypoints.map((k) => k.name)).toEqual([
      ...COMMON_KEYPOINT_NAMES,
    ])
    expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')).toEqual({
      name: 'left_shoulder',
      x: 360,
      y: 160,
      score: 0.95,
    })
  })

  it('reaches nose/left_ear/right_ear through to the frame from the raw MoveNet output', async () => {
    estimatePoses.mockResolvedValue([
      { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
    ])
    const video = { currentTime: 12.5 } as HTMLVideoElement

    const detector = await createMoveNetDetector(undefined, undefined, POI_OFF)
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(frame?.keypoints.find((k) => k.name === 'nose')).toEqual({
      name: 'nose',
      x: 320,
      y: 100,
      score: 0.98,
    })
    expect(frame?.keypoints.find((k) => k.name === 'left_ear')).toEqual({
      name: 'left_ear',
      x: 340,
      y: 95,
      score: 0.9,
    })
    expect(frame?.keypoints.find((k) => k.name === 'right_ear')).toEqual({
      name: 'right_ear',
      x: 300,
      y: 95,
      score: 0.89,
    })
  })

  it('resolves heel/foot_index to a zero-score default: MoveNet is COCO-17 and never produces them', async () => {
    estimatePoses.mockResolvedValue([
      { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
    ])
    const video = { currentTime: 12.5 } as HTMLVideoElement

    const detector = await createMoveNetDetector(undefined, undefined, POI_OFF)
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(frame?.keypoints.find((k) => k.name === 'left_heel')).toEqual({
      name: 'left_heel',
      x: 0,
      y: 0,
      score: 0,
    })
    expect(frame?.keypoints.find((k) => k.name === 'right_heel')).toEqual({
      name: 'right_heel',
      x: 0,
      y: 0,
      score: 0,
    })
    expect(frame?.keypoints.find((k) => k.name === 'left_foot_index')).toEqual({
      name: 'left_foot_index',
      x: 0,
      y: 0,
      score: 0,
    })
    expect(frame?.keypoints.find((k) => k.name === 'right_foot_index')).toEqual(
      {
        name: 'right_foot_index',
        x: 0,
        y: 0,
        score: 0,
      },
    )
  })

  it('returns null when estimatePoses finds no one in frame', async () => {
    estimatePoses.mockResolvedValue([])
    const video = { currentTime: 3 } as HTMLVideoElement

    const detector = await createMoveNetDetector(undefined, undefined, POI_OFF)
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(frame).toBeNull()
  })

  it('dispose delegates to the underlying TF.js detector', async () => {
    const detector = await createMoveNetDetector()
    detector.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  describe('tracking-crop preprocessing', () => {
    it('is disabled by default: repeated usable detections never leave the full-frame path', async () => {
      const detector = await createMoveNetDetector(
        undefined,
        undefined,
        POI_OFF,
      )

      estimatePoses.mockResolvedValue([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))
      await detector.estimatePose(videoFrameSource(makeVideo(1)))

      expectKillSwitchCall(estimatePoses.mock.calls[0])
      expectKillSwitchCall(estimatePoses.mock.calls[1])
      expect(fakeCtx.drawImage).not.toHaveBeenCalled()
    })

    it('cold start: calls estimatePoses with the video directly, not a canvas', async () => {
      estimatePoses.mockResolvedValue([])
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      await detector.estimatePose(videoFrameSource(makeVideo(0)))

      expectFullFrameCall(estimatePoses.mock.calls[0], makeVideo(0))
    })

    it('engages crop mode on the call after a usable detection, cropping/upscaling the tracked bbox', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      // Call 1: cold start, full-frame, engages tracking off a high-confidence detection.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const video1 = makeVideo(0, 1280, 720)
      await detector.estimatePose(videoFrameSource(video1))

      expectFullFrameCall(estimatePoses.mock.calls[0], video1)

      // Call 2: crop mode. The fixture carries 15 common keypoints, but nose/ears are excluded
      // from bbox derivation (BBOX_EXCLUDED_KEYPOINT_NAMES), so the box comes from the 12
      // limb/torso points: {minX:250, minY:160, maxX:390, maxY:480}; padded (x1.75), floored
      // (256), clamped to the 1280x720 frame: side 560, position (40, 40).
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      const video2 = makeVideo(1, 1280, 720)
      await detector.estimatePose(videoFrameSource(video2))

      expect(fakeCtx.drawImage).toHaveBeenCalledWith(
        video2,
        40,
        40,
        560,
        560,
        0,
        0,
        192,
        192,
      )
      const secondCall = estimatePoses.mock.calls[1]
      expect(secondCall[0]).not.toBe(video2)
      expect(secondCall[0].tagName).toBe('CANVAS')
      expect(secondCall[1]).toBeUndefined()
      expect(secondCall[2]).toBe(video2.currentTime * 1000)
    })

    it('sizes the crop canvas to 256 (not 192) when modelType: "thunder"', async () => {
      const detector = await createMoveNetDetector('thunder', CROP_ON, POI_OFF)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      // Same bbox/crop-rect math as the Lightning case above (crop-rect geometry doesn't depend
      // on model resolution) -- only the destination size differs.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      const video2 = makeVideo(1, 1280, 720)
      await detector.estimatePose(videoFrameSource(video2))

      expect(fakeCtx.drawImage).toHaveBeenCalledWith(
        video2,
        40,
        40,
        560,
        560,
        0,
        0,
        256,
        256,
      )
      expect(estimatePoses.mock.calls[1][2]).toBe(video2.currentTime * 1000)
    })

    it('coordinate round-trip: remaps a canvas-space keypoint back to video-pixel space', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      // Call 1: engages off a simple, hand-computable bbox {100,100,300,300} on an 800x600 frame.
      estimatePoses.mockResolvedValueOnce([
        {
          keypoints: [
            { name: 'left_shoulder', x: 100, y: 100, score: 0.9 },
            { name: 'right_shoulder', x: 300, y: 100, score: 0.9 },
            { name: 'left_hip', x: 100, y: 300, score: 0.9 },
            { name: 'right_hip', x: 300, y: 300, score: 0.9 },
          ],
          score: 0.9,
        },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 800, 600)))

      // computeCropRect({100,100,300,300}, 800, 600, 1.75, 256) -> side 350, position (25, 25).
      // A canvas-space keypoint at (48, 144) should remap to:
      //   videoX = 25 + (48/192)*350 = 112.5
      //   videoY = 25 + (144/192)*350 = 287.5
      estimatePoses.mockResolvedValueOnce([
        {
          keypoints: [
            { name: 'left_shoulder', x: 48, y: 144, score: 0.9 },
            { name: 'right_shoulder', x: 150, y: 144, score: 0.9 },
            { name: 'left_hip', x: 48, y: 300, score: 0.9 },
            { name: 'right_hip', x: 150, y: 300, score: 0.9 },
          ],
          score: 0.9,
        },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(1, 800, 600)),
      )

      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')).toEqual({
        name: 'left_shoulder',
        x: 112.5,
        y: 287.5,
        score: 0.9,
      })
    })

    it('reacquisition: keeps crop mode through reacquisitionLossThreshold - 1 not-usable frames, drops it on the next', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))

      // reacquisitionLossThreshold defaults to 5 -- feed 4 (threshold - 1) not-usable frames.
      for (
        let i = 0;
        i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold - 1;
        i += 1
      ) {
        estimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(videoFrameSource(makeVideo(i + 1)))
      }

      // Still crop mode: this call is itself the 5th not-usable frame, and since the drop only
      // takes effect starting the *next* call, it still runs in crop mode.
      estimatePoses.mockResolvedValueOnce([])
      const stillCropCallIndex = estimatePoses.mock.calls.length
      await detector.estimatePose(videoFrameSource(makeVideo(100)))
      expectCropCall(estimatePoses.mock.calls[stillCropCallIndex])

      // The 5th not-usable frame (above) tripped reacquisition loss, so this next call falls
      // back to full-frame.
      estimatePoses.mockResolvedValueOnce([])
      const fallbackCallIndex = estimatePoses.mock.calls.length
      await detector.estimatePose(videoFrameSource(makeVideo(101)))
      expectFullFrameCall(estimatePoses.mock.calls[fallbackCallIndex])
    })

    it('enabled: false is a total kill-switch -- always calls estimatePoses with the video directly', async () => {
      const config: TrackingCropConfig = {
        ...DEFAULT_TRACKING_CROP_CONFIG,
        enabled: false,
      }
      const detector = await createMoveNetDetector(undefined, config, POI_OFF)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(1)))

      expectKillSwitchCall(estimatePoses.mock.calls[0])
      expectKillSwitchCall(estimatePoses.mock.calls[1])
      expect(reset).not.toHaveBeenCalled()
    })

    it('trackingCrop AND personOfInterest both disabled: byte-identical to pre-change behavior across a new-run boundary too', async () => {
      const config: TrackingCropConfig = {
        ...DEFAULT_TRACKING_CROP_CONFIG,
        enabled: false,
      }
      const detector = await createMoveNetDetector(undefined, config, POI_OFF)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(10)))

      // A new-run-shaped drop in currentTime -- the pre-existing kill switch had no "new run"
      // concept at all (no generation/lastSeenTime bookkeeping ever ran), so this must not call
      // reset() either, unlike every other config combination in this file.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))

      expect(reset).not.toHaveBeenCalled()
      expectKillSwitchCall(estimatePoses.mock.calls[0])
      expectKillSwitchCall(estimatePoses.mock.calls[1])
    })

    it('reset() call-timing: only on mode-transition calls, never mid-steady-tracking or during a full-frame-only run', async () => {
      const config: TrackingCropConfig = {
        ...CROP_ON,
        reacquisitionLossThreshold: 1,
      }
      const detector = await createMoveNetDetector(undefined, config, POI_OFF)

      // Cold start: no reset.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))
      expect(reset).toHaveBeenCalledTimes(0)

      // Engage (still a full-frame call itself -- no reset).
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(1)))
      expect(reset).toHaveBeenCalledTimes(0)

      // Crop mode, transition in: reset fires once.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(2)))
      expect(reset).toHaveBeenCalledTimes(1)

      // Crop mode, steady tracking: NOT a mode transition, so no reset -- a same-size square
      // crop canvas needs no reset to stay a geometric no-op call-to-call (see design.md), and
      // resetting here would only cost MoveNet's own one-euro smoothing continuity for nothing.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(3)))
      expect(reset).toHaveBeenCalledTimes(1)

      // Crop mode, this frame is not usable -- with reacquisitionLossThreshold: 1, tracking
      // drops after this call, but this call itself still ran in (non-transition) crop mode, so
      // still no reset.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(4)))
      expect(reset).toHaveBeenCalledTimes(1)

      // Transition out: reset fires exactly once.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(5)))
      expect(reset).toHaveBeenCalledTimes(2)
      expectFullFrameCall(estimatePoses.mock.calls[5])

      // Steady full-frame run: no more resets.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(6)))
      expect(reset).toHaveBeenCalledTimes(2)
      expectFullFrameCall(estimatePoses.mock.calls[6])
    })

    it('resets tracking state when a new analysis run starts (video.currentTime drops back near 0)', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      // Run 1: engage tracking near the end of a clip.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(8, 1280, 720)))

      // Confirm tracking actually engaged: the next call, still within run 1, uses the crop
      // canvas.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(8.5, 1280, 720)))
      expectCropCall(estimatePoses.mock.calls[1])

      // Run 2: a different clip loaded into this same cached detector instance (this app never
      // recreates the detector between clips, see design.md) -- playback starts again near 0,
      // well past run 1's tracked currentTime (8.5).
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      expectFullFrameCall(estimatePoses.mock.calls[2])
    })

    it('does not treat ordinary small backward jitter within a run as a new run', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(5, 1280, 720)))

      // A 0.2s backward step -- well within the new-run drop threshold -- must not be treated as
      // a new run; tracking should still be active.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(4.8, 1280, 720)))

      expectCropCall(estimatePoses.mock.calls[1])
    })

    it("reentrancy guard: a stale, late-resolving call does not clobber a newer call's tracking state", async () => {
      const config: TrackingCropConfig = {
        ...CROP_ON,
        reacquisitionLossThreshold: 1,
      }
      const detector = await createMoveNetDetector(undefined, config, POI_OFF)

      // Call 1: engage tracking.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      // Call 2 (crop mode) stalls -- its detection promise doesn't resolve yet, simulating
      // `sampleClip`'s timeout moving on without cancelling the underlying detector call.
      let resolveStale!: (value: unknown) => void
      const stalePromise = new Promise((resolve) => {
        resolveStale = resolve
      })
      estimatePoses.mockReturnValueOnce(stalePromise)
      const stalePoseCall = detector.estimatePose(
        videoFrameSource(makeVideo(1, 1280, 720)),
      )

      // Call 3 starts on the same detector instance before call 2 resolves, and succeeds.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      const freshFrame = await detector.estimatePose(
        videoFrameSource(makeVideo(2, 1280, 720)),
      )
      expect(freshFrame).not.toBeNull()

      // Call 2 finally resolves -- with a *low-confidence* ("not usable") result. Were this
      // allowed to mutate shared state, `reacquisitionLossThreshold: 1` would immediately drop
      // tracking.
      resolveStale([
        { keypoints: CROP_SPACE_LOW_CONFIDENCE_KEYPOINTS, score: 0.2 },
      ])
      const staleFrame = await stalePoseCall
      expect(staleFrame).not.toBeNull() // still returns whatever it detected

      // Tracking must still be active, reflecting call 3's progress -- not dropped by call 2's
      // stale, late-arriving "not usable" result.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(3, 1280, 720)))
      const lastCall =
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1]
      expectCropCall(lastCall) // still crop mode, not fallen back to full-frame
    })

    it('off-screen start/end sequence: cold start -> engage -> steady track -> reacquisition loss -> stays full-frame, no oscillation', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      // 1. Absent at start: two calls with nobody detected.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(1)))
      expectFullFrameCall(estimatePoses.mock.calls[0])
      expectFullFrameCall(estimatePoses.mock.calls[1])

      // 2. Enters frame: a full-confidence detection engages tracking for the next call.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const enterFrame = await detector.estimatePose(
        videoFrameSource(makeVideo(2)),
      )
      expectFullFrameCall(estimatePoses.mock.calls[2])
      expect(enterFrame).not.toBeNull()

      // 3. Steady crop-mode tracking for a couple of calls.
      for (let i = 0; i < 2; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        const frame = await detector.estimatePose(
          videoFrameSource(makeVideo(3 + i)),
        )
        expectCropCall(estimatePoses.mock.calls[3 + i])
        expect(frame).not.toBeNull()
      }

      // 4. Degrading confidence over reacquisitionLossThreshold (5) calls -- still returns a
      // frame each time (usability only controls tracking state, never what's returned), and
      // all 5 still run in crop mode (the loss only takes effect starting the call after).
      const lossStart = estimatePoses.mock.calls.length
      for (
        let i = 0;
        i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold;
        i += 1
      ) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_LOW_CONFIDENCE_KEYPOINTS, score: 0.2 },
        ])
        const frame = await detector.estimatePose(
          videoFrameSource(makeVideo(5 + i)),
        )
        expectCropCall(estimatePoses.mock.calls[lossStart + i])
        expect(frame).not.toBeNull()
      }

      // 5. Falls back to full-frame and stays there -- doesn't oscillate back into crop mode.
      const fallbackStart = estimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(20)))
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(21)))
      expectFullFrameCall(estimatePoses.mock.calls[fallbackStart])
      expectFullFrameCall(estimatePoses.mock.calls[fallbackStart + 1])
    })
  })
})

describe('person-of-interest acquisition/reacquisition', () => {
  /**
   * Seeds an anchor via a single-candidate acquisition call, then trips the shared reacquisition
   * loss threshold via that many not-usable steady-state calls -- the next call after this helper
   * returns is a reacquisition-shaped moment.
   *
   * The successful acquisition engages a settle-in window (`POST_ACQUISITION_SETTLE_FRAMES`),
   * which forces the first few of these not-usable calls into crop mode even though this helper
   * uses the default (crop-disabled) `trackingCropConfig` -- that's real, correct
   * `rawDetector.reset()` traffic (one transition into forced crop mode, one back out once the
   * window expires), not something tests exercising this helper should have to account for. Clear
   * it here so callers that check `reset` counts are checking "since seeding", not "since the
   * detector was constructed".
   */
  async function detectorWithSeededAnchor() {
    const detector = await createMoveNetDetector()
    multiPoseEstimatePoses.mockResolvedValueOnce([
      { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
    ])
    await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

    for (
      let i = 0;
      i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold;
      i += 1
    ) {
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(i + 1, 1280, 720)))
    }

    reset.mockClear()
    return detector
  }

  it('personOfInterest.enabled: false never invokes the multi-pose detector, across an acquisition + reacquisition-shaped sequence', async () => {
    const detector = await createMoveNetDetector(undefined, undefined, {
      ...DEFAULT_PERSON_OF_INTEREST_CONFIG,
      enabled: false,
    })

    // Acquisition-shaped moment: no prior anchor.
    estimatePoses.mockResolvedValueOnce([
      { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
    ])
    await detector.estimatePose(videoFrameSource(makeVideo(0)))

    // Reacquisition-shaped moment: enough consecutive not-usable calls to cross the threshold.
    for (
      let i = 0;
      i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold;
      i += 1
    ) {
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(i + 1)))
    }
    estimatePoses.mockResolvedValueOnce([
      { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
    ])
    await detector.estimatePose(videoFrameSource(makeVideo(100)))

    expect(multiPoseEstimatePoses).not.toHaveBeenCalled()
    // The multi-pose detector was never even created -- only the single-pose (raw) detector was.
    expect(createDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('is enabled by default', async () => {
    const detector = await createMoveNetDetector()
    multiPoseEstimatePoses.mockResolvedValueOnce([
      { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
    ])

    await detector.estimatePose(videoFrameSource(makeVideo(0)))

    expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(1)
    expect(estimatePoses).not.toHaveBeenCalled()
  })

  describe('acquisition', () => {
    it('exactly one candidate produces a PoseFrame equivalent to the single-pose path for the same person', async () => {
      const detector = await createMoveNetDetector()
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const video = { currentTime: 12.5 } as HTMLVideoElement

      const frame = await detector.estimatePose(videoFrameSource(video))

      expect(multiPoseEstimatePoses).toHaveBeenCalledWith(
        video,
        undefined,
        12500,
      )
      expect(frame?.timestamp).toBe(12.5)
      expect(frame?.keypoints.map((k) => k.name)).toEqual([
        ...COMMON_KEYPOINT_NAMES,
      ])
      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')).toEqual({
        name: 'left_shoulder',
        x: 360,
        y: 160,
        score: 0.95,
      })
    })

    it('multiple candidates -- highest bbox-area x confidence wins', async () => {
      const detector = await createMoveNetDetector()
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])

      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(0, 1280, 720)),
      )

      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')?.x).toBe(
        600,
      )
    })

    it('zero candidates resolves null, and the next call is still an acquisition attempt', async () => {
      const detector = await createMoveNetDetector()
      multiPoseEstimatePoses.mockResolvedValueOnce([])

      const frame = await detector.estimatePose(videoFrameSource(makeVideo(0)))
      expect(frame).toBeNull()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const secondFrame = await detector.estimatePose(
        videoFrameSource(makeVideo(1)),
      )

      expect(secondFrame).not.toBeNull()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(2)
    })

    it('nonzero raw candidates but none clearing the usability gate still returns a frame, not null', async () => {
      const detector = await createMoveNetDetector()
      // Both candidates present, but each with too few confident keypoints to pass the bbox
      // usability gate (default minConfidentKeypoints: 4) -- must not be treated the same as
      // "zero candidates" (spec.md's "No candidates returned" scenario is about zero *raw poses*,
      // not zero *usable* ones).
      multiPoseEstimatePoses.mockResolvedValueOnce([
        {
          keypoints: [{ name: 'left_shoulder', x: 10, y: 10, score: 0.9 }],
          score: 0.4,
        },
        {
          keypoints: [{ name: 'left_hip', x: 20, y: 20, score: 0.9 }],
          score: 0.8,
        },
      ])

      const frame = await detector.estimatePose(videoFrameSource(makeVideo(0)))

      expect(frame).not.toBeNull()
      // Picked by MoveNet's own per-pose score (0.8 > 0.4) since neither candidate has a
      // derivable bbox to rank by.
      expect(frame?.keypoints.find((k) => k.name === 'left_hip')).toEqual({
        name: 'left_hip',
        x: 20,
        y: 20,
        score: 0.9,
      })
    })

    it('does not seed the anchor from a not-usable candidate', async () => {
      const detector = await createMoveNetDetector()
      multiPoseEstimatePoses.mockResolvedValueOnce([
        {
          keypoints: [{ name: 'left_shoulder', x: 10, y: 10, score: 0.9 }],
          score: 0.5,
        },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))

      // Anchor was never seeded above -- the next call is still treated as a fresh acquisition
      // attempt, scored by the acquisition heuristic (highest area x confidence), not
      // reacquisition continuity against a stale not-usable "anchor".
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(1, 1280, 720)),
      )

      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')?.x).toBe(
        600,
      )
    })

    it('multi-pose detector creation failure falls back to the single-pose full-frame call, seeding the anchor from a usable result', async () => {
      createDetectorMock.mockImplementation(
        async (_model: unknown, config?: { modelType?: string }) => {
          if (
            config?.modelType ===
            poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING
          ) {
            throw new Error('model load failed')
          }
          return { estimatePoses, dispose, reset }
        },
      )
      const detector = await createMoveNetDetector()

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(videoFrameSource(makeVideo(0)))

      expectFullFrameCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        makeVideo(0),
      )
      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')).toEqual({
        name: 'left_shoulder',
        x: 360,
        y: 160,
        score: 0.95,
      })
    })

    it('attempts multi-pose detector creation exactly once, at construction, never retrying on later calls', async () => {
      createDetectorMock.mockImplementation(
        async (_model: unknown, config?: { modelType?: string }) => {
          if (
            config?.modelType ===
            poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING
          ) {
            throw new Error('model load failed')
          }
          return { estimatePoses, dispose, reset }
        },
      )
      const detector = await createMoveNetDetector()

      // Eager, parallel creation (see `createMoveNetDetector`'s doc comment) means
      // `createDetectorMock` was already called exactly twice (raw + multi-pose attempt) by the
      // time `createMoveNetDetector()` above resolved -- there is no lazy retry mechanism left to
      // exercise, unlike the pre-eager-creation version of this test.
      expect(createDetectorMock).toHaveBeenCalledTimes(2)

      // Three consecutive frames, each failing to seed an anchor via the single-pose fallback too
      // (so every one of them would, under the OLD lazy design, have re-evaluated "should I
      // attempt multi-pose acquisition again") -- confirms no new creation attempts happen no
      // matter how many calls follow.
      for (let i = 0; i < 3; i += 1) {
        estimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(videoFrameSource(makeVideo(i)))
      }

      expect(createDetectorMock).toHaveBeenCalledTimes(2)
    })

    it('the whole detector still constructs successfully, and single-pose tracking keeps working across many calls, when multi-pose creation fails', async () => {
      createDetectorMock.mockImplementation(
        async (_model: unknown, config?: { modelType?: string }) => {
          if (
            config?.modelType ===
            poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING
          ) {
            throw new Error('model load failed')
          }
          return { estimatePoses, dispose, reset }
        },
      )

      // The multi-pose creation failure must not propagate to `createMoveNetDetector`'s own
      // returned promise -- it's caught locally (see `createMoveNetDetector`'s doc comment) so
      // the app still gets a usable detector, just without person-of-interest disambiguation,
      // rather than the whole pose-detection pipeline failing to start.
      const detector = await createMoveNetDetector()
      expect(detector).toBeTruthy()

      // Ordinary single-pose tracking (via the acquisition-context fallback, then steady state)
      // keeps working across many subsequent calls -- not just the first one.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const first = await detector.estimatePose(videoFrameSource(makeVideo(0)))
      expect(first).not.toBeNull()

      for (let i = 1; i < 6; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
        ])
        const frame = await detector.estimatePose(
          videoFrameSource(makeVideo(i)),
        )
        expect(frame).not.toBeNull()
      }

      // No multi-pose calls were ever issued -- the failure was permanent for this instance, not
      // retried into eventually working.
      expect(multiPoseEstimatePoses).not.toHaveBeenCalled()
    })

    it('disposes an already-created multi-pose detector if single-pose creation subsequently fails, instead of leaking it', async () => {
      let rejectRawDetector!: (err: Error) => void
      createDetectorMock.mockImplementation(
        async (_model: unknown, config?: { modelType?: string }) => {
          if (
            config?.modelType ===
            poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING
          ) {
            return {
              estimatePoses: multiPoseEstimatePoses,
              dispose: multiPoseDispose,
              reset: multiPoseReset,
            }
          }
          return new Promise<never>((_resolve, reject) => {
            rejectRawDetector = reject
          })
        },
      )

      const creation = createMoveNetDetector()

      // Both detector creations are kicked off in parallel, so there's no `await` point to hook
      // in the test -- drain enough microtask ticks for the multi-pose branch's own promise chain
      // (the mock's async function, then its `.catch`) to fully settle before failing the
      // single-pose one. This reproduces the exact ordering the fix targets: the multi-pose
      // detector already exists by the time single-pose creation rejects.
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
      }
      rejectRawDetector(new Error('single-pose model load failed'))

      await expect(creation).rejects.toThrow('single-pose model load failed')
      expect(multiPoseDispose).toHaveBeenCalledTimes(1)
    })
  })

  describe('reacquisition', () => {
    it('a successful reacquisition resumes ordinary single-pose tracking on the next call', async () => {
      const detector = await detectorWithSeededAnchor()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const reacquired = await detector.estimatePose(
        videoFrameSource(makeVideo(100, 1280, 720)),
      )
      expect(reacquired).not.toBeNull()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(2) // seed + this reacquisition

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const next = await detector.estimatePose(
        videoFrameSource(makeVideo(101, 1280, 720)),
      )

      expect(next).not.toBeNull()
      // Resumed the ordinary single-pose path -- no further multi-pose calls.
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(2)
      expect(estimatePoses).toHaveBeenCalledTimes(
        DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold + 1,
      )
    })

    it('continuity-scored candidate wins over a higher-scoring-by-area-alone candidate, and does not reset rawDetector', async () => {
      const detector = await detectorWithSeededAnchor()
      expect(reset).toHaveBeenCalledTimes(0)

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(100, 1280, 720)),
      )

      // SMALL_DISTANT_MOVED overlaps the seeded anchor (nonzero IoU); LARGE scores far higher on
      // bbox-area-weighted-by-confidence alone but has zero IoU with it.
      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')?.x).toBe(
        115,
      )
      // A continuous match -- the same person as the seeded anchor -- so rawDetector's own
      // internal state is left alone (review NEW-1).
      expect(reset).toHaveBeenCalledTimes(0)
    })

    it('zero-IoU candidates fall back to the closest one within the proximity threshold, and does not reset rawDetector', async () => {
      const detector = await detectorWithSeededAnchor()
      expect(reset).toHaveBeenCalledTimes(0)

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
        { keypoints: NEARBY_NO_OVERLAP_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(100, 1280, 720)),
      )

      // Neither candidate overlaps the seeded anchor (zero IoU for both), but NEARBY_NO_OVERLAP
      // sits within the proximity threshold and LARGE does not -- still a continuous match.
      expect(reset).toHaveBeenCalledTimes(0)
      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')?.x).toBe(
        300,
      )
    })

    it('no candidate within the proximity threshold falls back to the acquisition heuristic, and resets rawDetector for the non-continuous switch', async () => {
      const detector = await detectorWithSeededAnchor()
      expect(reset).toHaveBeenCalledTimes(0) // crop disabled by default, nothing to reset yet

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: FAR_SMALL_CANDIDATE_KEYPOINTS, score: 0.9 },
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(100, 1280, 720)),
      )

      // Both candidates are outside the proximity threshold (and zero IoU) -- this call falls
      // back to a fresh acquisition among them, where LARGE wins on bbox-area x confidence.
      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')?.x).toBe(
        600,
      )
      // The selected person is NOT continuous with the seeded anchor -- rawDetector's own
      // internal state (if any) was tracking the OLD, rejected person and must be reset so the
      // next full-frame call doesn't silently resume locked onto them (review NEW-1).
      expect(reset).toHaveBeenCalledTimes(1)
    })

    it('raw candidates during reacquisition but none clearing the usability gate still returns a frame and preserves the anchor for a retry', async () => {
      const detector = await detectorWithSeededAnchor()

      // Both candidates present during reacquisition, but each with too few confident keypoints
      // to pass the usability gate -- must not be treated as "zero candidates" (review item #2)
      // even though this happens during REACQUISITION specifically, not just acquisition.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        {
          keypoints: [{ name: 'left_shoulder', x: 10, y: 10, score: 0.9 }],
          score: 0.4,
        },
        {
          keypoints: [{ name: 'left_hip', x: 20, y: 20, score: 0.9 }],
          score: 0.8,
        },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(100, 1280, 720)),
      )

      expect(frame).not.toBeNull()
      expect(frame?.keypoints.find((k) => k.name === 'left_hip')).toEqual({
        name: 'left_hip',
        x: 20,
        y: 20,
        score: 0.9,
      })

      // Anchor preserved (review item #5): the retry is still scored by continuity against the
      // ORIGINAL seeded position, not treated as a fresh acquisition.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const retried = await detector.estimatePose(
        videoFrameSource(makeVideo(101, 1280, 720)),
      )
      expect(
        retried?.keypoints.find((k) => k.name === 'left_shoulder')?.x,
      ).toBe(115)
    })

    it('reset-timing: a mid-run reacquisition "none" hole between two crop-mode calls (continuous match) does not trigger an extra reset', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      // Engage crop mode via acquisition (cold start) -- the acquisition itself is a 'none' call,
      // no reset.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(0)

      // Steady-state crop mode: the first REAL rawDetector invocation -- exactly one reset (the
      // genuine fullFrame(never-invoked)->crop transition).
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(1, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(1)

      // Trip the loss streak while steady-state crop mode continues -- no transition, no reset.
      for (let i = 0; i < CROP_ON.reacquisitionLossThreshold; i += 1) {
        estimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(
          videoFrameSource(makeVideo(2 + i, 1280, 720)),
        )
      }
      expect(reset).toHaveBeenCalledTimes(1)

      // The reacquisition ('none' hole) itself finds a CONTINUOUS match against the seeded
      // anchor (the same person) -- no reset-timing transition (the hole is transparent) and no
      // identity-switch reset (continuity matched) either.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(100, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(1)

      // Back to steady-state crop mode -- the actual usage before (crop) and after (crop) the
      // hole is identical, so this doesn't trigger a reset either.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(101, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(1)
    })

    it('an empty reacquisition attempt preserves the anchor for a retry, scored by continuity against the original position', async () => {
      const detector = await detectorWithSeededAnchor()

      multiPoseEstimatePoses.mockResolvedValueOnce([])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(100, 1280, 720)),
      )
      expect(frame).toBeNull()

      // If the anchor had been cleared by the empty attempt above, this retry would be scored as
      // a fresh acquisition (area x confidence) and LARGE would win. Since the anchor survived,
      // continuity against the ORIGINAL seeded position wins instead.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const retried = await detector.estimatePose(
        videoFrameSource(makeVideo(101, 1280, 720)),
      )

      expect(
        retried?.keypoints.find((k) => k.name === 'left_shoulder')?.x,
      ).toBe(115)
    })

    it('gives up after exhausting the empty-reacquisition retry budget, falling back to the plain single-pose path', async () => {
      const detector = await detectorWithSeededAnchor()

      for (
        let i = 0;
        i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold;
        i += 1
      ) {
        multiPoseEstimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(
          videoFrameSource(makeVideo(100 + i, 1280, 720)),
        )
      }
      // seed (1) + every empty retry (reacquisitionLossThreshold), all dispatched to multi-pose.
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(
        1 + DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold,
      )

      // Budget exhausted: the next call no longer dispatches to multi-pose at all -- ordinary
      // single-pose full-frame tracking, same shape as the pre-existing crop-mode fallback.
      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(200, 1280, 720)),
      )

      expect(frame).toBeNull()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)
      expectFullFrameCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        makeVideo(200, 1280, 720),
      )
    })

    it("reentrancy: a stale, late-resolving multi-pose call does not clobber a newer call's reacquired anchor", async () => {
      const detector = await detectorWithSeededAnchor()

      // Call X: reacquisition-shaped; the multi-pose detector is already created and memoized
      // (from seeding above), but X's OWN detection call stalls.
      let resolveStale!: (value: unknown) => void
      const staleDetectionPromise = new Promise((resolve) => {
        resolveStale = resolve
      })
      multiPoseEstimatePoses.mockReturnValueOnce(staleDetectionPromise)
      const stalePoseCall = detector.estimatePose(
        videoFrameSource(makeVideo(100, 1280, 720)),
      )

      // Call Y: starts before X resolves, against the same (still-stale) shared anchor state --
      // since the multi-pose detector is already memoized, Y's own detection call resolves
      // immediately, ahead of X, and successfully reacquires.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const freshFrame = await detector.estimatePose(
        videoFrameSource(makeVideo(101, 1280, 720)),
      )
      expect(freshFrame).not.toBeNull()

      // X finally resolves -- with a DIFFERENT candidate that would, if allowed to mutate shared
      // state, overwrite Y's already-committed reacquisition.
      resolveStale([{ keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 }])
      const staleFrame = await stalePoseCall
      expect(staleFrame).not.toBeNull() // still returns whatever it detected

      // Y's reacquisition must still be what steady-state tracking uses next: the follow-up call
      // must not re-dispatch to multi-pose (which would mean the anchor got cleared/corrupted by
      // X's late arrival).
      const multiPoseCallsBeforeFollowUp =
        multiPoseEstimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const followUp = await detector.estimatePose(
        videoFrameSource(makeVideo(102, 1280, 720)),
      )
      expect(followUp).not.toBeNull()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(
        multiPoseCallsBeforeFollowUp,
      )
    })

    it('gives up after a second stale streak following a successful reacquisition, dropping to the plain full-frame path (POI-enabled + crop-enabled)', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      // Seed the anchor.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      // Trip the first loss streak (crop-mode not-usable calls).
      for (let i = 0; i < CROP_ON.reacquisitionLossThreshold; i += 1) {
        estimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(
          videoFrameSource(makeVideo(i + 1, 1280, 720)),
        )
      }

      // First reacquisition: succeeds, continuity-scored against the seeded anchor.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const reacquired = await detector.estimatePose(
        videoFrameSource(makeVideo(100, 1280, 720)),
      )
      expect(reacquired).not.toBeNull()

      // Trip a SECOND loss streak against the reacquired anchor.
      for (let i = 0; i < CROP_ON.reacquisitionLossThreshold; i += 1) {
        estimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(
          videoFrameSource(makeVideo(101 + i, 1280, 720)),
        )
      }

      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length
      // A third stale trigger: without giving up, this would re-dispatch to reacquisition
      // (possibly forever). It should instead drop straight to the plain single-pose full-frame
      // path -- same shape as the original crop-mode fallback.
      estimatePoses.mockResolvedValueOnce([])
      const gaveUp = await detector.estimatePose(
        videoFrameSource(makeVideo(200, 1280, 720)),
      )

      expect(gaveUp).toBeNull()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)
      expectFullFrameCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        makeVideo(200, 1280, 720),
      )
    })

    it('reset-timing: a "none" acquisition/reacquisition hole does not itself trigger a rawDetector reset', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      // Call 1: cold start, dispatches to acquisition ('none' usage) -- must not reset
      // rawDetector, since rawDetector was never invoked by any previous call either.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(0)

      // Call 2: steady-state crop mode, now that an anchor exists -- the first REAL rawDetector
      // invocation. Exactly one reset fires here (the genuine fullFrame(never-invoked)->crop
      // transition) -- not two, which the old tri-state design (resetting on entry AND exit of
      // 'none') would have fired.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(1, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(1)

      // Call 3: steady-state crop mode again -- no further reset.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(2, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(1)
    })
  })

  describe('settle-in window', () => {
    it('forces the next POST_ACQUISITION_SETTLE_FRAMES calls into crop mode after a successful acquisition, even with tracking-crop disabled', async () => {
      const detector = await createMoveNetDetector()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      for (let i = 0; i < POST_ACQUISITION_SETTLE_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(i + 1, 1280, 720)),
        )
        expectCropCall(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
          )
      }

      // The window has expired -- the next call runs full-frame again (tracking-crop is
      // disabled, so nothing else keeps forcing crop mode).
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo(POST_ACQUISITION_SETTLE_FRAMES + 1, 1280, 720),
        ),
      )
      expectFullFrameCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        )
    })

    it('also engages after a successful reacquisition that switches to a non-continuous person', async () => {
      // Review F4: the settle-in window only triggers on NEW identity information -- a fresh
      // acquisition, or a reacquisition/re-verification that switches to a genuinely different
      // (non-continuous) person. LARGE_CANDIDATE_KEYPOINTS is far from the seeded SMALL_DISTANT
      // anchor (zero IoU, outside the proximity threshold), so this reacquisition falls through
      // to the acquisition heuristic -- a non-continuous switch, exactly the case the window
      // exists for.
      const detector = await detectorWithSeededAnchor()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(100, 1280, 720)))

      for (let i = 0; i < POST_ACQUISITION_SETTLE_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(101 + i, 1280, 720)),
        )
        expectCropCall(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
          )
      }

      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(200, 1280, 720)))
      expectFullFrameCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        )
    })

    it('does NOT engage after a successful reacquisition that confirms the same (continuous) person (review F4)', async () => {
      const detector = await detectorWithSeededAnchor()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(100, 1280, 720)))

      // No settle-in window forced -- tracking-crop is disabled, and continuity was confirmed, so
      // this runs full-frame like any other ordinary steady-state call.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(101, 1280, 720)))
      expectFullFrameCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        )
    })

    it('is a no-op when tracking-crop is already continuously enabled', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(0) // acquisition itself: no rawDetector call at all

      // The first steady-state call already engages crop mode via `trackingCropConfig.enabled`
      // -- this is the one genuine full-frame(never-invoked)->crop transition.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(1, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(1)
      expectCropCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        )

      // Run well past the settle-in window's own budget while steady-state crop-mode tracking
      // continues -- no extra resets, still crop mode throughout, entirely explained by
      // `trackingCropConfig.enabled` alone; the settle window has nothing extra to force.
      for (let i = 0; i < POST_ACQUISITION_SETTLE_FRAMES + 2; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(2 + i, 1280, 720)),
        )
        expectCropCall(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
          )
      }
      expect(reset).toHaveBeenCalledTimes(1)
    })

    it('still expires on schedule under mid-window loss of confidence, cropping around an increasingly stale box the whole time', async () => {
      const detector = await createMoveNetDetector() // crop-disabled default

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      // Every settle-in call fails to detect anyone -- the window must still run its full
      // course, cropping around the SAME (unrefreshed, increasingly stale) acquisition-time box
      // each time, not bail early just because detection keeps failing. This is exactly the case
      // where "self-correcting" (each call re-derives a fresh box on success) does not hold --
      // there is no success to re-derive from here (review F3).
      for (let i = 0; i < POST_ACQUISITION_SETTLE_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(
          videoFrameSource(makeVideo(i + 1, 1280, 720)),
        )
        expectCropCall(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
          )
      }

      // Window expired exactly on schedule (tracking-crop stays disabled, so nothing else keeps
      // forcing crop mode). POST_ACQUISITION_SETTLE_FRAMES (3) < the default
      // reacquisitionLossThreshold (5), so the anchor hasn't gone stale yet either -- this is an
      // ordinary full-frame call, not a reacquisition dispatch.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo(POST_ACQUISITION_SETTLE_FRAMES + 1, 1280, 720),
        ),
      )
      expectFullFrameCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        )
    })

    it('reset-timing on the shipped default (crop-disabled): a continuous reacquisition costs zero resets, unlike the pre-F4 behavior', async () => {
      const detector = await detectorWithSeededAnchor() // crop-disabled default

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(100, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(0) // the reacquisition dispatch itself: 'none' usage

      // Several ordinary full-frame calls afterward -- no settle window (F4: continuity means no
      // new identity information), no identity-switch reset -- reset stays at zero for the whole
      // cycle. Before F4, a continuous match still cost 2 resets here (a spurious forced-crop
      // entry, then exit, for a person who was never actually lost).
      for (let i = 0; i < 5; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(101 + i, 1280, 720)),
        )
        expectFullFrameCall(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
          )
      }
      expect(reset).toHaveBeenCalledTimes(0)
    })

    it('a reacquisition landing inside an already-active settle window restarts it at the full duration', async () => {
      const config: TrackingCropConfig = {
        ...DEFAULT_TRACKING_CROP_CONFIG,
        reacquisitionLossThreshold: 1,
      }
      const detector = await createMoveNetDetector(undefined, config)

      // Acquisition starts a settle window (POST_ACQUISITION_SETTLE_FRAMES calls).
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      // Consume ONE settle-in frame (crop mode), but it fails to detect anyone -- with
      // reacquisitionLossThreshold: 1, this single failure immediately makes the anchor stale.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(1, 1280, 720)))

      // A non-continuous reacquisition lands NOW, while the settle window from acquisition is
      // still partway through (2 of 3 frames left) -- must restart the window at the full
      // duration, not continue counting down from 2. LARGE_CANDIDATE_KEYPOINTS is far from the
      // seeded anchor (non-continuous).
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(2, 1280, 720)))

      // The window is back at full duration: exactly POST_ACQUISITION_SETTLE_FRAMES more
      // forced-crop calls before it expires -- not just the 2 that would remain if it had merely
      // continued counting down.
      for (let i = 0; i < POST_ACQUISITION_SETTLE_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(3 + i, 1280, 720)),
        )
        expectCropCall(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
          )
      }

      // Now expired.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo(3 + POST_ACQUISITION_SETTLE_FRAMES, 1280, 720),
        ),
      )
      expectFullFrameCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        )
    })
  })

  describe('periodic re-verification', () => {
    /** Seeds an anchor via acquisition, then runs exactly REVERIFICATION_INTERVAL_FRAMES
     * successful steady-state crop-mode calls -- the next call after this helper returns is due
     * for periodic re-verification. Uses `CROP_ON` so every steady-state call (including the
     * ones the settle-in window would otherwise force) is uniformly crop-mode, avoiding the need
     * to track which of these setup calls fall inside vs. outside that window. */
    async function detectorDueForReverification() {
      const detector = await createMoveNetDetector(undefined, CROP_ON)
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      for (let i = 0; i < REVERIFICATION_INTERVAL_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(i + 1, 1280, 720)),
        )
      }

      reset.mockClear()
      return detector
    }

    it('triggers a multi-pose call after REVERIFICATION_INTERVAL_FRAMES steady-state calls, instead of an ordinary one', async () => {
      const detector = await detectorDueForReverification()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(1) // just the seed so far

      const estimatePosesCallsBefore = estimatePoses.mock.calls.length
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )

      expect(frame).not.toBeNull()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(2)
      expect(estimatePoses).toHaveBeenCalledTimes(estimatePosesCallsBefore) // no ordinary call issued instead
    })

    it('a continuous match resets the interval and does not retrigger on the very next call', async () => {
      const detector = await detectorDueForReverification()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const verified = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )
      expect(
        verified?.keypoints.find((k) => k.name === 'left_shoulder')?.x,
      ).toBe(115)

      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 2, 1280, 720),
        ),
      )
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)
    })

    it('behaves identically across two consecutive re-verification cycles', async () => {
      const detector = await detectorDueForReverification()

      // Cycle 1: a continuous match.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const cycle1 = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )
      expect(cycle1?.keypoints.find((k) => k.name === 'left_shoulder')?.x).toBe(
        115,
      )

      // Run another full interval of ordinary steady-state calls before cycle 2 is due.
      for (let i = 0; i < REVERIFICATION_INTERVAL_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(
            makeVideo(REVERIFICATION_INTERVAL_FRAMES + 2 + i, 1280, 720),
          ),
        )
      }

      // Cycle 2: triggers again, and behaves identically to cycle 1 -- same continuity match,
      // same selection, no ordinary call substituted for it, no extra state carried over from
      // cycle 1 that would change the outcome.
      const estimatePosesCallsBefore = estimatePoses.mock.calls.length
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const cycle2 = await detector.estimatePose(
        videoFrameSource(
          makeVideo(2 * REVERIFICATION_INTERVAL_FRAMES + 2, 1280, 720),
        ),
      )
      expect(cycle2?.keypoints.find((k) => k.name === 'left_shoulder')?.x).toBe(
        115,
      )
      expect(estimatePoses).toHaveBeenCalledTimes(estimatePosesCallsBefore) // still no ordinary call substituted
    })

    it('a non-continuous match resets rawDetector, re-seeds the anchor, and starts a settle-in window even with tracking-crop disabled', async () => {
      const detector = await createMoveNetDetector()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      // Keep the steady-state anchor small (matching SMALL_DISTANT_CANDIDATE_KEYPOINTS's scale,
      // not MOVENET_RAW_KEYPOINTS's much larger one) so FAR_SMALL/LARGE below stay outside its
      // proximity threshold, exactly as already calibrated for the acquisition/reacquisition
      // "falls back to the acquisition heuristic" tests above.
      //
      // Tracking-crop is disabled here, but the settle-in window still forces the first
      // POST_ACQUISITION_SETTLE_FRAMES calls into crop mode -- so those calls' returned keypoints
      // are read as CANVAS space and remapped, while every later call's are already video space.
      // Feeding the video-space fixture to a crop-mode call makes the anchor walk downward a
      // little further every settle frame (each crop is built from the previous walked box), which
      // the continuity gate then correctly rejects once the window expires and real video-space
      // detections resume. That walk was always a fixture artifact -- nothing checked continuity
      // before -- so the fix is to feed each call the fixture matching the space it is actually
      // in, not to exempt this test from the gate.
      for (let i = 0; i < REVERIFICATION_INTERVAL_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          {
            keypoints:
              i < POST_ACQUISITION_SETTLE_FRAMES
                ? CROP_SPACE_SMALL_ANCHOR_KEYPOINTS
                : SMALL_DISTANT_CANDIDATE_KEYPOINTS,
            score: 0.9,
          },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(i + 1, 1280, 720)),
        )
      }
      const resetCountBefore = reset.mock.calls.length

      // Both candidates are far from the current anchor -- falls through to the acquisition
      // heuristic, a genuine identity switch caught by periodic re-verification rather than a
      // confidence drop.
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: FAR_SMALL_CANDIDATE_KEYPOINTS, score: 0.9 },
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const corrected = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )
      expect(
        corrected?.keypoints.find((k) => k.name === 'left_shoulder')?.x,
      ).toBe(600)
      expect(reset.mock.calls.length).toBe(resetCountBefore + 1)

      // Settle-in window engaged despite tracking-crop being disabled -- the next call is forced
      // into crop mode around the newly-selected anchor.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 2, 1280, 720),
        ),
      )
      expectCropCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        )
    })

    it('an empty periodic check falls through to the ordinary single-pose call for the same frame (review F2), and does not retrigger the next call', async () => {
      const detector = await detectorDueForReverification()

      // The empty check itself must not drop the sampled frame: it falls through to the
      // ordinary (crop-mode, since detectorDueForReverification uses CROP_ON) single-pose call
      // for this SAME frame, which succeeds.
      multiPoseEstimatePoses.mockResolvedValueOnce([])
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      const checkFrame = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )
      expect(checkFrame).not.toBeNull()
      expectCropCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        ) // fell through to the ordinary crop-mode path, not dropped

      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      const next = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 2, 1280, 720),
        ),
      )
      expect(next).not.toBeNull()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore) // no new multi-pose call
      expectCropCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        ) // ordinary crop-mode tracking, unaffected by the failed check
    })

    it('raw candidates but none usable during a periodic check also falls through to the ordinary single-pose call for the same frame', async () => {
      const detector = await detectorDueForReverification()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        {
          keypoints: [{ name: 'left_shoulder', x: 10, y: 10, score: 0.9 }],
          score: 0.4,
        },
      ])
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )
      expect(frame).not.toBeNull()
      // Came from the fallen-through ordinary call, not the unreliable multi-pose candidate: the
      // ordinary fixture's left_shoulder (192-space, CROP_SPACE_CONFIDENT_KEYPOINTS) remaps to a
      // real crop-relative video-pixel coordinate, not (10, 10) verbatim.
      expect(
        frame?.keypoints.find((k) => k.name === 'left_shoulder')?.x,
      ).not.toBe(10)
      expectCropCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        )

      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_SMALL_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 2, 1280, 720),
        ),
      )
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)
    })

    it('multi-pose detector creation failure during a periodic check does not clear the anchor', async () => {
      createDetectorMock.mockImplementation(
        async (_model: unknown, config?: { modelType?: string }) => {
          if (
            config?.modelType ===
            poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING
          ) {
            throw new Error('model load failed')
          }
          return { estimatePoses, dispose, reset }
        },
      )
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      // Multi-pose creation already failed eagerly, at construction (see `createMoveNetDetector`'s
      // doc comment) -- `multiPoseDetector` is permanently `null` for this detector instance's
      // whole lifetime, no retry. Acquisition falls back to the ordinary single-pose call
      // (task 2.2), which succeeds and seeds the anchor normally.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      for (let i = 0; i < REVERIFICATION_INTERVAL_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(i + 1, 1280, 720)),
        )
      }

      // Periodic re-verification is due, but the cached creation failure means no multi-pose
      // call is even attempted -- must fall through using the EXISTING anchor/framing unchanged,
      // not the acquisition/reacquisition creation-failure path's `clearAnchor()`.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )

      expect(frame).not.toBeNull()
      expectCropCall(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        ) // still crop mode -- anchor preserved, not cleared
    })
  })

  describe('steady-state anchor continuity gate', () => {
    /**
     * Leaves the detector in steady FULL-FRAME tracking (tracking-crop stays at its disabled
     * default) with LARGE_CANDIDATE_KEYPOINTS's box as its anchor, at t = 1.0s.
     *
     * The settle-in window that follows acquisition forces its calls into crop mode regardless of
     * `TrackingCropConfig.enabled`, so those calls are fed
     * `CROP_SPACE_LARGE_ANCHOR_KEYPOINTS` -- the exact canvas-space inverse of the anchor -- which
     * round-trips back to the same box and leaves the anchor untouched when the window expires.
     */
    async function detectorAnchoredOnLargeSubject() {
      const detector = await createMoveNetDetector()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      for (let i = 0; i < POST_ACQUISITION_SETTLE_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_LARGE_ANCHOR_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo((i + 1) * 0.05, 1280, 720)),
        )
      }

      return detector
    }

    it('rejects a confidently detected bystander at a very different scale, and still returns its frame', async () => {
      const detector = await detectorAnchoredOnLargeSubject()
      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length

      // The reported failure's shape: a real, usable, confident detection of a much smaller,
      // more distant person. Its center is well within the anchor's speed bound, so position
      // continuity alone would let it through -- scale is what catches it.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(makeVideo(1, 1280, 720)),
      )

      // The gate governs the ANCHOR, not whether a frame is emitted.
      expect(frame).not.toBeNull()
      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')?.x).toBe(
        100,
      )
      // Critically, the loss counter was NOT reset -- that reset is what made a stolen anchor
      // permanent before this gate existed.
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)
    })

    it('leaves the anchor pointing at the original subject after a rejection, so the next crop still frames them', async () => {
      // Tracking-crop ON here specifically so the anchor is directly observable: every
      // steady-state call's crop rect is derived from it. This is the assertion that actually
      // discriminates the gate from its absence -- without it, the bystander below becomes the
      // anchor and the very next crop reframes onto them, which is the reported bug.
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      // Steady crop-mode call: the canvas-space inverse of the anchor, so the anchor is unchanged.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_LARGE_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0.05, 1280, 720)))
      expect(fakeCtx.drawImage).toHaveBeenLastCalledWith(
        expect.anything(),
        LARGE_ANCHOR_CROP_RECT.x,
        LARGE_ANCHOR_CROP_RECT.y,
        LARGE_ANCHOR_CROP_RECT.side,
        LARGE_ANCHOR_CROP_RECT.side,
        0,
        0,
        192,
        192,
      )

      // A confident but much smaller detection inside that same crop -- a bystander deeper in the
      // scene. Canvas box 15x40 remaps to ~56x150 video px, ~4% of the anchor's area.
      estimatePoses.mockResolvedValueOnce([
        {
          keypoints: CROP_SPACE_LARGE_ANCHOR_KEYPOINTS.map((k) => ({
            ...k,
            x: 20 + (k.x - 45.33) * 0.15,
            y: 20 + (k.y - 26.67) * 0.25,
          })),
          score: 0.9,
        },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0.1, 1280, 720)))

      // The next call still crops around the ORIGINAL subject, not the bystander.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_LARGE_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0.15, 1280, 720)))

      expect(fakeCtx.drawImage).toHaveBeenLastCalledWith(
        expect.anything(),
        LARGE_ANCHOR_CROP_RECT.x,
        LARGE_ANCHOR_CROP_RECT.y,
        LARGE_ANCHOR_CROP_RECT.side,
        LARGE_ANCHOR_CROP_RECT.side,
        0,
        0,
        192,
        192,
      )
    })

    it('rejects a same-scale detection that neither overlaps the anchor nor is reachable within the speed bound', async () => {
      const detector = await detectorAnchoredOnLargeSubject()

      // Same size as the anchor (so scale continuity passes), displaced 500px in x -- past the
      // anchor's 380px width, so IoU is 0, and past 3 sides/s x 600px x 0.05s = 90px.
      estimatePoses.mockResolvedValueOnce([
        {
          keypoints: LARGE_CANDIDATE_KEYPOINTS.map((k) => ({
            ...k,
            x: k.x - 500,
          })),
          score: 0.9,
        },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(1.05, 1280, 720)))

      // Rejected: the next call still crops around the ORIGINAL anchor during reacquisition
      // scoring, so a further loss streak (not an immediate re-anchor) is what follows.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      const recovered = await detector.estimatePose(
        videoFrameSource(makeVideo(1.1, 1280, 720)),
      )

      // The real subject, back where the anchor still says they are, is accepted immediately.
      expect(
        recovered?.keypoints.find((k) => k.name === 'left_shoulder')?.x,
      ).toBe(600)
    })

    it('accepts ordinary frame-to-frame motion, resetting the counters exactly as before the gate existed', async () => {
      const detector = await detectorAnchoredOnLargeSubject()
      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length

      // A realistic per-frame step: 20px across 0.05s, overlapping the anchor heavily.
      for (let i = 0; i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold + 2; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          {
            keypoints: LARGE_CANDIDATE_KEYPOINTS.map((k) => ({
              ...k,
              x: k.x + 20 * (i + 1),
            })),
            score: 0.9,
          },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(1 + i * 0.05, 1280, 720)),
        )
      }

      // Never went stale, so no reacquisition was ever dispatched.
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)
    })

    it('reaches reacquisitionLossThreshold under sustained rejection and dispatches a multi-pose reacquisition', async () => {
      const detector = await detectorAnchoredOnLargeSubject()
      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length

      // `mockResolvedValue`, not `...Once`: with the gate disabled none of these count as losses,
      // so the run never goes stale and the extra call below lands on the single-pose path
      // instead. Keeping the queue non-empty makes that case fail on the assertion rather than
      // crash on an exhausted mock.
      estimatePoses.mockResolvedValue([
        { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      multiPoseEstimatePoses.mockResolvedValue([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])

      for (
        let i = 0;
        i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold;
        i += 1
      ) {
        await detector.estimatePose(
          videoFrameSource(makeVideo(1 + i * 0.05, 1280, 720)),
        )
      }
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)

      // The anchor is now stale -- this call is a reacquisition dispatch, scored by continuity
      // against the last known box rather than by whatever single-pose saliency lands on.
      await detector.estimatePose(videoFrameSource(makeVideo(2, 1280, 720)))

      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(
        multiPoseCallsBefore + 1,
      )
    })

    it('a periodic re-verification match claiming continuity at an implausible scale is a strict no-op', async () => {
      // The second failure found live (2026-08-16): `pickBestCandidate`'s continuity test is
      // IoU/proximity only, with no scale term, so an overlapping-but-far-smaller candidate scores
      // `continuous: true` and replaces the anchor with its own collapsed box. Measured on the
      // reproduction clip: a single 6 164 px^2 candidate replaced a healthy 37 465 px^2 anchor.
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      for (let i = 0; i < REVERIFICATION_INTERVAL_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_LARGE_ANCHOR_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo((i + 1) * 0.05, 1280, 720)),
        )
      }

      // Overlaps the anchor heavily (so `continuous` is true) but is a fraction of its area --
      // a partial or adjacent detection, not plausibly the same person one frame later.
      const collapsed = LARGE_CANDIDATE_KEYPOINTS.map((k) => ({
        ...k,
        x: 700 + (k.x - 600) * 0.2,
        y: 300 + (k.y - 100) * 0.2,
      }))
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: collapsed, score: 0.9 },
      ])
      // The check falls through to an ordinary single-pose call for this same frame (review F2's
      // shape), so that call needs its own queued result.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_LARGE_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo((REVERIFICATION_INTERVAL_FRAMES + 1) * 0.05, 1280, 720),
        ),
      )

      // The anchor survived: the next call still crops around the original subject. Without this
      // guard it would crop around the collapsed box instead, and the steady-state gate would then
      // start rejecting the real subject for being discontinuous with it.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_LARGE_ANCHOR_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo((REVERIFICATION_INTERVAL_FRAMES + 2) * 0.05, 1280, 720),
        ),
      )

      expect(fakeCtx.drawImage).toHaveBeenLastCalledWith(
        expect.anything(),
        LARGE_ANCHOR_CROP_RECT.x,
        LARGE_ANCHOR_CROP_RECT.y,
        LARGE_ANCHOR_CROP_RECT.side,
        LARGE_ANCHOR_CROP_RECT.side,
        0,
        0,
        192,
        192,
      )
    })

    it('continuityGate.enabled: false restores pre-gate acceptance while leaving multi-pose dispatch on', async () => {
      const detector = await createMoveNetDetector(undefined, undefined, {
        ...DEFAULT_PERSON_OF_INTEREST_CONFIG,
        continuityGate: {
          ...DEFAULT_PERSON_OF_INTEREST_CONFIG.continuityGate,
          enabled: false,
        },
      })

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: LARGE_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))
      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length

      // The same wildly discontinuous detection the gate rejects above, repeated well past the
      // loss threshold: with the gate off every one of them is accepted as the anchor, so the
      // loss counter never climbs and no reacquisition is ever dispatched.
      for (
        let i = 0;
        i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold + 2;
        i += 1
      ) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(1 + i * 0.05, 1280, 720)),
        )
      }

      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)
    })
  })

  describe('keypoint-smoothing timestamp', () => {
    it('passes the frame timestamp in milliseconds on the steady-state full-frame call', async () => {
      // CROP_ON so this is NOT the combined kill-switch path (which stays byte-identical and
      // passes no timestamp), while the cold-start call itself still runs full-frame -- nothing
      // is anchored yet.
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      estimatePoses.mockResolvedValue([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(2.5, 1280, 720)))

      // Without this argument MoveNet's built-in one-euro keypoint filter never runs for a source
      // that has no `currentTime` of its own -- which is every frame the sequential-decode sampler
      // produces (it draws into a reusable canvas).
      expectFullFrameCall(
        estimatePoses.mock.calls[0],
        makeVideo(2.5, 1280, 720),
      )
      expect(estimatePoses.mock.calls[0][2]).toBe(2500)
    })
  })

  describe('dispose', () => {
    it('also disposes the multi-pose detector -- already created eagerly at construction, before any estimatePose call', async () => {
      const detector = await createMoveNetDetector()

      // No `estimatePose` call at all -- eager, parallel creation (see `createMoveNetDetector`'s
      // doc comment) means the multi-pose detector already exists by the time this line runs.
      detector.dispose()

      expect(dispose).toHaveBeenCalledTimes(1)
      expect(multiPoseDispose).toHaveBeenCalledTimes(1)
    })

    it('does not touch the multi-pose detector when personOfInterest.enabled: false skipped creating it', async () => {
      const detector = await createMoveNetDetector(
        undefined,
        undefined,
        POI_OFF,
      )

      detector.dispose()

      expect(dispose).toHaveBeenCalledTimes(1)
      expect(multiPoseDispose).not.toHaveBeenCalled()
      // Confirms the skip happened at construction, not just that dispose() didn't find anything:
      // only the single-pose detector was ever created.
      expect(createDetectorMock).toHaveBeenCalledTimes(1)
    })

    // The "dispose an in-flight multi-pose detector creation" scenario the pre-eager-creation
    // version of this suite covered no longer applies: `createMoveNetDetector`'s eager, parallel
    // creation (see its doc comment) means both detectors are fully created -- or definitively
    // failed to create -- before `createMoveNetDetector`'s own promise resolves, so there is no
    // longer any way for a caller to hold a `PoseDetector` handle while multi-pose creation is
    // still pending.
  })
})

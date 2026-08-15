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

function makeVideo(
  currentTime: number,
  videoWidth = 1280,
  videoHeight = 720,
): HTMLVideoElement {
  return { currentTime, videoWidth, videoHeight } as HTMLVideoElement
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

      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
      expect(estimatePoses.mock.calls[1]).toHaveLength(1)
      expect(fakeCtx.drawImage).not.toHaveBeenCalled()
    })

    it('cold start: calls estimatePoses with the video directly, not a canvas', async () => {
      estimatePoses.mockResolvedValue([])
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      await detector.estimatePose(videoFrameSource(makeVideo(0)))

      expect(estimatePoses).toHaveBeenCalledWith(makeVideo(0))
      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
    })

    it('engages crop mode on the call after a usable detection, cropping/upscaling the tracked bbox', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      // Call 1: cold start, full-frame, engages tracking off a high-confidence detection.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const video1 = makeVideo(0, 1280, 720)
      await detector.estimatePose(videoFrameSource(video1))

      expect(estimatePoses.mock.calls[0]).toEqual([video1])

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
      expect(estimatePoses.mock.calls[stillCropCallIndex]).toHaveLength(3)

      // The 5th not-usable frame (above) tripped reacquisition loss, so this next call falls
      // back to full-frame.
      estimatePoses.mockResolvedValueOnce([])
      const fallbackCallIndex = estimatePoses.mock.calls.length
      await detector.estimatePose(videoFrameSource(makeVideo(101)))
      expect(estimatePoses.mock.calls[fallbackCallIndex]).toHaveLength(1)
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

      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
      expect(estimatePoses.mock.calls[1]).toHaveLength(1)
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
      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
      expect(estimatePoses.mock.calls[1]).toHaveLength(1)
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
      expect(estimatePoses.mock.calls[5]).toHaveLength(1)

      // Steady full-frame run: no more resets.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(6)))
      expect(reset).toHaveBeenCalledTimes(2)
      expect(estimatePoses.mock.calls[6]).toHaveLength(1)
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
      expect(estimatePoses.mock.calls[1]).toHaveLength(3)

      // Run 2: a different clip loaded into this same cached detector instance (this app never
      // recreates the detector between clips, see design.md) -- playback starts again near 0,
      // well past run 1's tracked currentTime (8.5).
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(0, 1280, 720)))

      expect(estimatePoses.mock.calls[2]).toHaveLength(1)
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

      expect(estimatePoses.mock.calls[1]).toHaveLength(3)
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
      expect(lastCall).toHaveLength(3) // still crop mode, not fallen back to full-frame
    })

    it('off-screen start/end sequence: cold start -> engage -> steady track -> reacquisition loss -> stays full-frame, no oscillation', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON, POI_OFF)

      // 1. Absent at start: two calls with nobody detected.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(1)))
      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
      expect(estimatePoses.mock.calls[1]).toHaveLength(1)

      // 2. Enters frame: a full-confidence detection engages tracking for the next call.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const enterFrame = await detector.estimatePose(
        videoFrameSource(makeVideo(2)),
      )
      expect(estimatePoses.mock.calls[2]).toHaveLength(1)
      expect(enterFrame).not.toBeNull()

      // 3. Steady crop-mode tracking for a couple of calls.
      for (let i = 0; i < 2; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        const frame = await detector.estimatePose(
          videoFrameSource(makeVideo(3 + i)),
        )
        expect(estimatePoses.mock.calls[3 + i]).toHaveLength(3)
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
        expect(estimatePoses.mock.calls[lossStart + i]).toHaveLength(3)
        expect(frame).not.toBeNull()
      }

      // 5. Falls back to full-frame and stays there -- doesn't oscillate back into crop mode.
      const fallbackStart = estimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(20)))
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(21)))
      expect(estimatePoses.mock.calls[fallbackStart]).toHaveLength(1)
      expect(estimatePoses.mock.calls[fallbackStart + 1]).toHaveLength(1)
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

      expect(estimatePoses).toHaveBeenCalledWith(makeVideo(0))
      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')).toEqual({
        name: 'left_shoulder',
        x: 360,
        y: 160,
        score: 0.95,
      })
    })

    it('caches a multi-pose detector creation failure for the run instead of retrying the fetch every frame', async () => {
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

      // Three consecutive frames, each failing to seed an anchor via the single-pose fallback too
      // (so every one of them independently re-evaluates "should I attempt multi-pose
      // acquisition again").
      for (let i = 0; i < 3; i += 1) {
        estimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(videoFrameSource(makeVideo(i)))
      }

      // createDetectorMock: once for the raw single-pose detector at construction, plus exactly
      // ONE attempt at the multi-pose detector -- not one per frame.
      expect(createDetectorMock).toHaveBeenCalledTimes(2)
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
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
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
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
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
      expect(estimatePoses).toHaveBeenCalledWith(makeVideo(200, 1280, 720))
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
      expect(estimatePoses).toHaveBeenCalledWith(makeVideo(200, 1280, 720))
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
        expect(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        ).toHaveLength(3)
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
      expect(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
      ).toHaveLength(1)
    })

    it('also engages after a successful reacquisition', async () => {
      const detector = await detectorWithSeededAnchor()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: SMALL_DISTANT_MOVED_CANDIDATE_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(100, 1280, 720)))

      for (let i = 0; i < POST_ACQUISITION_SETTLE_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(101 + i, 1280, 720)),
        )
        expect(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        ).toHaveLength(3)
      }

      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(videoFrameSource(makeVideo(200, 1280, 720)))
      expect(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
      ).toHaveLength(1)
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
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(1, 1280, 720)))
      expect(reset).toHaveBeenCalledTimes(1)
      expect(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
      ).toHaveLength(3)

      // Run well past the settle-in window's own budget while steady-state crop-mode tracking
      // continues -- no extra resets, still crop mode throughout, entirely explained by
      // `trackingCropConfig.enabled` alone; the settle window has nothing extra to force.
      for (let i = 0; i < POST_ACQUISITION_SETTLE_FRAMES + 2; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        await detector.estimatePose(
          videoFrameSource(makeVideo(2 + i, 1280, 720)),
        )
        expect(
          estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
        ).toHaveLength(3)
      }
      expect(reset).toHaveBeenCalledTimes(1)
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
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
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
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 2, 1280, 720),
        ),
      )
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore)
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
      for (let i = 0; i < REVERIFICATION_INTERVAL_FRAMES; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: SMALL_DISTANT_CANDIDATE_KEYPOINTS, score: 0.9 },
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
      expect(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
      ).toHaveLength(3)
    })

    it('an empty periodic check is a strict no-op: does not touch the anchor and does not retrigger every subsequent call', async () => {
      const detector = await detectorDueForReverification()

      multiPoseEstimatePoses.mockResolvedValueOnce([])
      const emptyCheck = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )
      expect(emptyCheck).toBeNull()

      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      const next = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 2, 1280, 720),
        ),
      )
      expect(next).not.toBeNull()
      expect(multiPoseEstimatePoses).toHaveBeenCalledTimes(multiPoseCallsBefore) // no new multi-pose call
      expect(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
      ).toHaveLength(3) // ordinary crop-mode tracking, unaffected by the failed check
    })

    it('raw candidates but none usable during a periodic check is also a strict no-op', async () => {
      const detector = await detectorDueForReverification()

      multiPoseEstimatePoses.mockResolvedValueOnce([
        {
          keypoints: [{ name: 'left_shoulder', x: 10, y: 10, score: 0.9 }],
          score: 0.4,
        },
      ])
      const frame = await detector.estimatePose(
        videoFrameSource(
          makeVideo(REVERIFICATION_INTERVAL_FRAMES + 1, 1280, 720),
        ),
      )
      expect(frame).not.toBeNull() // still returns a frame (the invariant), just not a trustworthy anchor

      const multiPoseCallsBefore = multiPoseEstimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
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

      // Acquisition itself fails to get a multi-pose detector -- falls back to the ordinary
      // single-pose call (task 2.2), which succeeds and seeds the anchor normally. The failure is
      // cached for the rest of this run (`multiPoseCreationFailedThisRun`).
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
      expect(
        estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1],
      ).toHaveLength(3) // still crop mode -- anchor preserved, not cleared
    })
  })

  describe('dispose', () => {
    it('also disposes the multi-pose detector once it has been created', async () => {
      const detector = await createMoveNetDetector()
      multiPoseEstimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(videoFrameSource(makeVideo(0)))

      detector.dispose()

      expect(dispose).toHaveBeenCalledTimes(1)
      expect(multiPoseDispose).toHaveBeenCalledTimes(1)
    })

    it('does not touch the multi-pose detector if it was never created', async () => {
      const detector = await createMoveNetDetector(
        undefined,
        undefined,
        POI_OFF,
      )

      detector.dispose()

      expect(dispose).toHaveBeenCalledTimes(1)
      expect(multiPoseDispose).not.toHaveBeenCalled()
    })

    it('disposes an in-flight multi-pose detector creation once it resolves', async () => {
      let resolveCreation!: (detector: unknown) => void
      const pendingCreation = new Promise((resolve) => {
        resolveCreation = resolve
      })
      createDetectorMock.mockImplementation(
        async (_model: unknown, config?: { modelType?: string }) => {
          if (
            config?.modelType ===
            poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING
          ) {
            return pendingCreation
          }
          return { estimatePoses, dispose, reset }
        },
      )
      const detector = await createMoveNetDetector()

      multiPoseEstimatePoses.mockResolvedValueOnce([])
      const estimatePromise = detector.estimatePose(
        videoFrameSource(makeVideo(0)),
      )

      detector.dispose()
      expect(multiPoseDispose).not.toHaveBeenCalled() // creation hasn't resolved yet

      resolveCreation({
        estimatePoses: multiPoseEstimatePoses,
        dispose: multiPoseDispose,
        reset: multiPoseReset,
      })
      await estimatePromise
      // Let the fire-and-forget disposal `.then()`, chained off the same creation promise, run.
      await Promise.resolve()
      await Promise.resolve()

      expect(multiPoseDispose).toHaveBeenCalledTimes(1)
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { estimatePoses, dispose, reset, createDetectorMock } = vi.hoisted(() => ({
  estimatePoses: vi.fn(),
  dispose: vi.fn(),
  reset: vi.fn(),
  createDetectorMock: vi.fn(),
}))

vi.mock('@tensorflow/tfjs-backend-webgl', () => ({}))

vi.mock('@tensorflow/tfjs-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tensorflow/tfjs-core')>()
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
import { stubCanvas2DContext } from '../../test/canvasTestUtils'
import type { FakeCanvasRenderingContext2D } from '../../test/canvasTestUtils'

/**
 * Crop-mode tests opt in explicitly: the shipped default is `enabled: false` (see
 * DEFAULT_TRACKING_CROP_CONFIG's doc comment for the A/B evidence behind that).
 */
const CROP_ON: TrackingCropConfig = { ...DEFAULT_TRACKING_CROP_CONFIG, enabled: true }

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
const CROP_SPACE_LOW_CONFIDENCE_KEYPOINTS = CROP_SPACE_CONFIDENT_KEYPOINTS.map((k) => ({
  ...k,
  score: 0.1,
}))

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
  createDetectorMock.mockReset()
  createDetectorMock.mockResolvedValue({ estimatePoses, dispose, reset })
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

    const detector = await createMoveNetDetector()
    const frame = await detector.estimatePose(video)

    expect(estimatePoses).toHaveBeenCalledWith(video)
    expect(frame?.timestamp).toBe(12.5)
    expect(frame?.keypoints.map((k) => k.name)).toEqual([
      ...COMMON_KEYPOINT_NAMES,
    ])
    expect(
      frame?.keypoints.find((k) => k.name === 'left_shoulder'),
    ).toEqual({
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

    const detector = await createMoveNetDetector()
    const frame = await detector.estimatePose(video)

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

    const detector = await createMoveNetDetector()
    const frame = await detector.estimatePose(video)

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
    expect(frame?.keypoints.find((k) => k.name === 'right_foot_index')).toEqual({
      name: 'right_foot_index',
      x: 0,
      y: 0,
      score: 0,
    })
  })

  it('returns null when estimatePoses finds no one in frame', async () => {
    estimatePoses.mockResolvedValue([])
    const video = { currentTime: 3 } as HTMLVideoElement

    const detector = await createMoveNetDetector()
    const frame = await detector.estimatePose(video)

    expect(frame).toBeNull()
  })

  it('dispose delegates to the underlying TF.js detector', async () => {
    const detector = await createMoveNetDetector()
    detector.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  describe('tracking-crop preprocessing', () => {
    it('is disabled by default: repeated usable detections never leave the full-frame path', async () => {
      const detector = await createMoveNetDetector()

      estimatePoses.mockResolvedValue([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(0))
      await detector.estimatePose(makeVideo(1))

      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
      expect(estimatePoses.mock.calls[1]).toHaveLength(1)
      expect(fakeCtx.drawImage).not.toHaveBeenCalled()
    })

    it('cold start: calls estimatePoses with the video directly, not a canvas', async () => {
      estimatePoses.mockResolvedValue([])
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      await detector.estimatePose(makeVideo(0))

      expect(estimatePoses).toHaveBeenCalledWith(makeVideo(0))
      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
    })

    it('engages crop mode on the call after a usable detection, cropping/upscaling the tracked bbox', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      // Call 1: cold start, full-frame, engages tracking off a high-confidence detection.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const video1 = makeVideo(0, 1280, 720)
      await detector.estimatePose(video1)

      expect(estimatePoses.mock.calls[0]).toEqual([video1])

      // Call 2: crop mode. The fixture carries 15 common keypoints, but nose/ears are excluded
      // from bbox derivation (BBOX_EXCLUDED_KEYPOINT_NAMES), so the box comes from the 12
      // limb/torso points: {minX:250, minY:160, maxX:390, maxY:480}; padded (x1.75), floored
      // (256), clamped to the 1280x720 frame: side 560, position (40, 40).
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      const video2 = makeVideo(1, 1280, 720)
      await detector.estimatePose(video2)

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
      const detector = await createMoveNetDetector('thunder', CROP_ON)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(0, 1280, 720))

      // Same bbox/crop-rect math as the Lightning case above (crop-rect geometry doesn't depend
      // on model resolution) -- only the destination size differs.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      const video2 = makeVideo(1, 1280, 720)
      await detector.estimatePose(video2)

      expect(fakeCtx.drawImage).toHaveBeenCalledWith(video2, 40, 40, 560, 560, 0, 0, 256, 256)
      expect(estimatePoses.mock.calls[1][2]).toBe(video2.currentTime * 1000)
    })

    it('coordinate round-trip: remaps a canvas-space keypoint back to video-pixel space', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

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
      await detector.estimatePose(makeVideo(0, 800, 600))

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
      const frame = await detector.estimatePose(makeVideo(1, 800, 600))

      expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')).toEqual({
        name: 'left_shoulder',
        x: 112.5,
        y: 287.5,
        score: 0.9,
      })
    })

    it('reacquisition: keeps crop mode through reacquisitionLossThreshold - 1 not-usable frames, drops it on the next', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(0))

      // reacquisitionLossThreshold defaults to 5 -- feed 4 (threshold - 1) not-usable frames.
      for (let i = 0; i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold - 1; i += 1) {
        estimatePoses.mockResolvedValueOnce([])
        await detector.estimatePose(makeVideo(i + 1))
      }

      // Still crop mode: this call is itself the 5th not-usable frame, and since the drop only
      // takes effect starting the *next* call, it still runs in crop mode.
      estimatePoses.mockResolvedValueOnce([])
      const stillCropCallIndex = estimatePoses.mock.calls.length
      await detector.estimatePose(makeVideo(100))
      expect(estimatePoses.mock.calls[stillCropCallIndex]).toHaveLength(3)

      // The 5th not-usable frame (above) tripped reacquisition loss, so this next call falls
      // back to full-frame.
      estimatePoses.mockResolvedValueOnce([])
      const fallbackCallIndex = estimatePoses.mock.calls.length
      await detector.estimatePose(makeVideo(101))
      expect(estimatePoses.mock.calls[fallbackCallIndex]).toHaveLength(1)
    })

    it('enabled: false is a total kill-switch -- always calls estimatePoses with the video directly', async () => {
      const config: TrackingCropConfig = { ...DEFAULT_TRACKING_CROP_CONFIG, enabled: false }
      const detector = await createMoveNetDetector(undefined, config)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(0))

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(1))

      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
      expect(estimatePoses.mock.calls[1]).toHaveLength(1)
      expect(reset).not.toHaveBeenCalled()
    })

    it('reset() call-timing: only on mode-transition calls, never mid-steady-tracking or during a full-frame-only run', async () => {
      const config: TrackingCropConfig = {
        ...CROP_ON,
        reacquisitionLossThreshold: 1,
      }
      const detector = await createMoveNetDetector(undefined, config)

      // Cold start: no reset.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(0))
      expect(reset).toHaveBeenCalledTimes(0)

      // Engage (still a full-frame call itself -- no reset).
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(1))
      expect(reset).toHaveBeenCalledTimes(0)

      // Crop mode, transition in: reset fires once.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(2))
      expect(reset).toHaveBeenCalledTimes(1)

      // Crop mode, steady tracking: NOT a mode transition, so no reset -- a same-size square
      // crop canvas needs no reset to stay a geometric no-op call-to-call (see design.md), and
      // resetting here would only cost MoveNet's own one-euro smoothing continuity for nothing.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(3))
      expect(reset).toHaveBeenCalledTimes(1)

      // Crop mode, this frame is not usable -- with reacquisitionLossThreshold: 1, tracking
      // drops after this call, but this call itself still ran in (non-transition) crop mode, so
      // still no reset.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(4))
      expect(reset).toHaveBeenCalledTimes(1)

      // Transition out: reset fires exactly once.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(5))
      expect(reset).toHaveBeenCalledTimes(2)
      expect(estimatePoses.mock.calls[5]).toHaveLength(1)

      // Steady full-frame run: no more resets.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(6))
      expect(reset).toHaveBeenCalledTimes(2)
      expect(estimatePoses.mock.calls[6]).toHaveLength(1)
    })

    it('resets tracking state when a new analysis run starts (video.currentTime drops back near 0)', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      // Run 1: engage tracking near the end of a clip.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(8, 1280, 720))

      // Confirm tracking actually engaged: the next call, still within run 1, uses the crop
      // canvas.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(8.5, 1280, 720))
      expect(estimatePoses.mock.calls[1]).toHaveLength(3)

      // Run 2: a different clip loaded into this same cached detector instance (this app never
      // recreates the detector between clips, see design.md) -- playback starts again near 0,
      // well past run 1's tracked currentTime (8.5).
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(0, 1280, 720))

      expect(estimatePoses.mock.calls[2]).toHaveLength(1)
    })

    it('does not treat ordinary small backward jitter within a run as a new run', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(5, 1280, 720))

      // A 0.2s backward step -- well within the new-run drop threshold -- must not be treated as
      // a new run; tracking should still be active.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(4.8, 1280, 720))

      expect(estimatePoses.mock.calls[1]).toHaveLength(3)
    })

    it("reentrancy guard: a stale, late-resolving call does not clobber a newer call's tracking state", async () => {
      const config: TrackingCropConfig = {
        ...CROP_ON,
        reacquisitionLossThreshold: 1,
      }
      const detector = await createMoveNetDetector(undefined, config)

      // Call 1: engage tracking.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(0, 1280, 720))

      // Call 2 (crop mode) stalls -- its detection promise doesn't resolve yet, simulating
      // `sampleClip`'s timeout moving on without cancelling the underlying detector call.
      let resolveStale!: (value: unknown) => void
      const stalePromise = new Promise((resolve) => {
        resolveStale = resolve
      })
      estimatePoses.mockReturnValueOnce(stalePromise)
      const stalePoseCall = detector.estimatePose(makeVideo(1, 1280, 720))

      // Call 3 starts on the same detector instance before call 2 resolves, and succeeds.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      const freshFrame = await detector.estimatePose(makeVideo(2, 1280, 720))
      expect(freshFrame).not.toBeNull()

      // Call 2 finally resolves -- with a *low-confidence* ("not usable") result. Were this
      // allowed to mutate shared state, `reacquisitionLossThreshold: 1` would immediately drop
      // tracking.
      resolveStale([{ keypoints: CROP_SPACE_LOW_CONFIDENCE_KEYPOINTS, score: 0.2 }])
      const staleFrame = await stalePoseCall
      expect(staleFrame).not.toBeNull() // still returns whatever it detected

      // Tracking must still be active, reflecting call 3's progress -- not dropped by call 2's
      // stale, late-arriving "not usable" result.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
      ])
      await detector.estimatePose(makeVideo(3, 1280, 720))
      const lastCall = estimatePoses.mock.calls[estimatePoses.mock.calls.length - 1]
      expect(lastCall).toHaveLength(3) // still crop mode, not fallen back to full-frame
    })

    it('off-screen start/end sequence: cold start -> engage -> steady track -> reacquisition loss -> stays full-frame, no oscillation', async () => {
      const detector = await createMoveNetDetector(undefined, CROP_ON)

      // 1. Absent at start: two calls with nobody detected.
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(0))
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(1))
      expect(estimatePoses.mock.calls[0]).toHaveLength(1)
      expect(estimatePoses.mock.calls[1]).toHaveLength(1)

      // 2. Enters frame: a full-confidence detection engages tracking for the next call.
      estimatePoses.mockResolvedValueOnce([
        { keypoints: MOVENET_RAW_KEYPOINTS, score: 0.9 },
      ])
      const enterFrame = await detector.estimatePose(makeVideo(2))
      expect(estimatePoses.mock.calls[2]).toHaveLength(1)
      expect(enterFrame).not.toBeNull()

      // 3. Steady crop-mode tracking for a couple of calls.
      for (let i = 0; i < 2; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_CONFIDENT_KEYPOINTS, score: 0.9 },
        ])
        const frame = await detector.estimatePose(makeVideo(3 + i))
        expect(estimatePoses.mock.calls[3 + i]).toHaveLength(3)
        expect(frame).not.toBeNull()
      }

      // 4. Degrading confidence over reacquisitionLossThreshold (5) calls -- still returns a
      // frame each time (usability only controls tracking state, never what's returned), and
      // all 5 still run in crop mode (the loss only takes effect starting the call after).
      const lossStart = estimatePoses.mock.calls.length
      for (let i = 0; i < DEFAULT_TRACKING_CROP_CONFIG.reacquisitionLossThreshold; i += 1) {
        estimatePoses.mockResolvedValueOnce([
          { keypoints: CROP_SPACE_LOW_CONFIDENCE_KEYPOINTS, score: 0.2 },
        ])
        const frame = await detector.estimatePose(makeVideo(5 + i))
        expect(estimatePoses.mock.calls[lossStart + i]).toHaveLength(3)
        expect(frame).not.toBeNull()
      }

      // 5. Falls back to full-frame and stays there -- doesn't oscillate back into crop mode.
      const fallbackStart = estimatePoses.mock.calls.length
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(20))
      estimatePoses.mockResolvedValueOnce([])
      await detector.estimatePose(makeVideo(21))
      expect(estimatePoses.mock.calls[fallbackStart]).toHaveLength(1)
      expect(estimatePoses.mock.calls[fallbackStart + 1]).toHaveLength(1)
    })
  })
})

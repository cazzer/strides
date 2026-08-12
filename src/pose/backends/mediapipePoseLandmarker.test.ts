import { beforeEach, describe, expect, it, vi } from 'vitest'

const { forVisionTasksMock, createFromOptionsMock, detectForVideo, close } = vi.hoisted(() => ({
  forVisionTasksMock: vi.fn(),
  createFromOptionsMock: vi.fn(),
  detectForVideo: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: forVisionTasksMock },
  PoseLandmarker: { createFromOptions: createFromOptionsMock },
}))

import { createMediaPipePoseLandmarkerDetector } from './mediapipePoseLandmarker'
import { COMMON_KEYPOINT_NAMES } from '../types'

/** 33 landmarks, index-ordered per MediaPipe Pose's fixed topology. left_shoulder is index 11. */
function makeLandmarks() {
  return Array.from({ length: 33 }, (_, i) => ({ x: 0.1 * i, y: 0.2 * i, z: 0, visibility: 0.8 }))
}

beforeEach(() => {
  forVisionTasksMock.mockReset()
  createFromOptionsMock.mockReset()
  detectForVideo.mockReset()
  close.mockReset()
  forVisionTasksMock.mockResolvedValue({ wasm: 'fileset' })
  createFromOptionsMock.mockResolvedValue({ detectForVideo, close })
})

describe('createMediaPipePoseLandmarkerDetector', () => {
  it('initializes the landmarker in video mode, single pose, GPU delegate', async () => {
    await createMediaPipePoseLandmarkerDetector()

    expect(forVisionTasksMock).toHaveBeenCalledWith(
      expect.stringContaining('@mediapipe/tasks-vision'),
    )
    expect(createFromOptionsMock).toHaveBeenCalledWith(
      { wasm: 'fileset' },
      expect.objectContaining({
        runningMode: 'VIDEO',
        numPoses: 1,
        baseOptions: expect.objectContaining({ delegate: 'GPU' }),
      }),
    )
  })

  it('maps a single-frame estimate to a PoseFrame, denormalizing by video dimensions', async () => {
    detectForVideo.mockReturnValue({ landmarks: [makeLandmarks()], worldLandmarks: [] })
    const video = { currentTime: 12.5, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(video)

    expect(detectForVideo).toHaveBeenCalledWith(video, 12500)
    expect(frame?.timestamp).toBe(12.5)
    expect(frame?.keypoints.map((k) => k.name)).toEqual([...COMMON_KEYPOINT_NAMES])
    expect(frame?.keypoints.find((k) => k.name === 'left_shoulder')).toEqual({
      name: 'left_shoulder',
      x: 0.1 * 11 * 640,
      y: 0.2 * 11 * 480,
      score: 0.8,
    })
  })

  it('returns null when no pose is detected', async () => {
    detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] })
    const video = { currentTime: 3, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(video)

    expect(frame).toBeNull()
  })

  it('dispose delegates to the landmarker', async () => {
    const detector = await createMediaPipePoseLandmarkerDetector()
    detector.dispose()

    expect(close).toHaveBeenCalledTimes(1)
  })
})

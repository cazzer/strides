import { beforeEach, describe, expect, it, vi } from 'vitest'

const { estimatePoses, dispose, createDetectorMock } = vi.hoisted(() => ({
  estimatePoses: vi.fn(),
  dispose: vi.fn(),
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

beforeEach(() => {
  estimatePoses.mockReset()
  dispose.mockReset()
  createDetectorMock.mockReset()
  createDetectorMock.mockResolvedValue({ estimatePoses, dispose })
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
})

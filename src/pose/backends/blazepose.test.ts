import { beforeEach, describe, expect, it, vi } from 'vitest'

const { estimatePoses, dispose, createDetectorMock } = vi.hoisted(() => ({
  estimatePoses: vi.fn(),
  dispose: vi.fn(),
  createDetectorMock: vi.fn(),
}))

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
import { createBlazePoseDetector } from './blazepose'
import { BLAZEPOSE_RAW_KEYPOINTS } from './__fixtures__/blazepose-keypoints.fixture'
import { COMMON_KEYPOINT_NAMES } from '../types'
import { videoFrameSource } from '../detector'

beforeEach(() => {
  estimatePoses.mockReset()
  dispose.mockReset()
  createDetectorMock.mockReset()
  createDetectorMock.mockResolvedValue({ estimatePoses, dispose })
})

describe('createBlazePoseDetector', () => {
  it('initializes BlazePose on the TFJS runtime, full variant', async () => {
    await createBlazePoseDetector()

    expect(createDetectorMock).toHaveBeenCalledWith(
      poseDetection.SupportedModels.BlazePose,
      { runtime: 'tfjs', modelType: 'full' },
    )
  })

  it('maps a single-frame estimate to a PoseFrame, dropping non-common landmarks', async () => {
    estimatePoses.mockResolvedValue([
      { keypoints: BLAZEPOSE_RAW_KEYPOINTS, score: 0.9 },
    ])
    const video = { currentTime: 12.5 } as HTMLVideoElement

    const detector = await createBlazePoseDetector()
    const frame = await detector.estimatePose(videoFrameSource(video))

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

  it('passes through x/y/score for the newly widened foot keypoints (fixture already carried this data since #30)', async () => {
    estimatePoses.mockResolvedValue([
      { keypoints: BLAZEPOSE_RAW_KEYPOINTS, score: 0.9 },
    ])
    const video = { currentTime: 12.5 } as HTMLVideoElement

    const detector = await createBlazePoseDetector()
    const frame = await detector.estimatePose(video)

    expect(frame?.keypoints.find((k) => k.name === 'left_heel')).toEqual({
      name: 'left_heel',
      x: 362,
      y: 495,
      score: 0.83,
    })
  })

  it('returns null when estimatePoses finds no one in frame', async () => {
    estimatePoses.mockResolvedValue([])
    const video = { currentTime: 3 } as HTMLVideoElement

    const detector = await createBlazePoseDetector()
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(frame).toBeNull()
  })

  it('dispose delegates to the underlying TF.js detector', async () => {
    const detector = await createBlazePoseDetector()
    detector.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

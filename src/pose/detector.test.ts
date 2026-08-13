import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMoveNetDetectorMock,
  createBlazePoseDetectorMock,
  createPoseNetDetectorMock,
  createMediaPipePoseLandmarkerDetectorMock,
} = vi.hoisted(() => ({
  createMoveNetDetectorMock: vi.fn(),
  createBlazePoseDetectorMock: vi.fn(),
  createPoseNetDetectorMock: vi.fn(),
  createMediaPipePoseLandmarkerDetectorMock: vi.fn(),
}))

vi.mock('./backends/movenet', () => ({
  createMoveNetDetector: createMoveNetDetectorMock,
}))

vi.mock('./backends/blazepose', () => ({
  createBlazePoseDetector: createBlazePoseDetectorMock,
}))

vi.mock('./backends/posenet', () => ({
  createPoseNetDetector: createPoseNetDetectorMock,
}))

vi.mock('./backends/mediapipePoseLandmarker', () => ({
  createMediaPipePoseLandmarkerDetector: createMediaPipePoseLandmarkerDetectorMock,
}))

import { createDetector } from './detector'
import type { PoseDetector } from './detector'
import { DEFAULT_TRACKING_CROP_CONFIG } from './backends/trackingCropConfig'

beforeEach(() => {
  createMoveNetDetectorMock.mockReset()
  createBlazePoseDetectorMock.mockReset()
  createPoseNetDetectorMock.mockReset()
  createMediaPipePoseLandmarkerDetectorMock.mockReset()
})

describe('createDetector', () => {
  it('resolves a MoveNet-backed detector for backend: "movenet"', async () => {
    const fakeDetector: PoseDetector = {
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    }
    createMoveNetDetectorMock.mockResolvedValue(fakeDetector)

    const detector = await createDetector({ backend: 'movenet' })

    expect(detector).toBe(fakeDetector)
    expect(createMoveNetDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('passes movenetModelType through to createMoveNetDetector', async () => {
    createMoveNetDetectorMock.mockResolvedValue({
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    })

    await createDetector({ backend: 'movenet', movenetModelType: 'thunder' })

    expect(createMoveNetDetectorMock).toHaveBeenCalledWith('thunder', undefined)
  })

  it('defaults to the movenet backend when no config is given', async () => {
    const fakeDetector: PoseDetector = {
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    }
    createMoveNetDetectorMock.mockResolvedValue(fakeDetector)

    const detector = await createDetector()

    expect(detector).toBe(fakeDetector)
  })

  it('resolves a BlazePose-backed detector for backend: "blazepose"', async () => {
    const fakeDetector: PoseDetector = {
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    }
    createBlazePoseDetectorMock.mockResolvedValue(fakeDetector)

    const detector = await createDetector({ backend: 'blazepose' })

    expect(detector).toBe(fakeDetector)
    expect(createBlazePoseDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('resolves a PoseNet-backed detector for backend: "posenet"', async () => {
    const fakeDetector: PoseDetector = {
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    }
    createPoseNetDetectorMock.mockResolvedValue(fakeDetector)

    const detector = await createDetector({ backend: 'posenet' })

    expect(detector).toBe(fakeDetector)
    expect(createPoseNetDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('resolves a MediaPipe-PoseLandmarker-backed detector for backend: "mediapipePoseLandmarker"', async () => {
    const fakeDetector: PoseDetector = {
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    }
    createMediaPipePoseLandmarkerDetectorMock.mockResolvedValue(fakeDetector)

    const detector = await createDetector({ backend: 'mediapipePoseLandmarker' })

    expect(detector).toBe(fakeDetector)
    expect(createMediaPipePoseLandmarkerDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('throws synchronously for an unknown backend', () => {
    expect(() =>
      createDetector({ backend: 'unknown' as unknown as 'movenet' }),
    ).toThrow(/unknown pose detector backend/i)
    expect(createMoveNetDetectorMock).not.toHaveBeenCalled()
    expect(createBlazePoseDetectorMock).not.toHaveBeenCalled()
    expect(createPoseNetDetectorMock).not.toHaveBeenCalled()
    expect(createMediaPipePoseLandmarkerDetectorMock).not.toHaveBeenCalled()
  })

  it('passes trackingCrop through to createMoveNetDetector', async () => {
    createMoveNetDetectorMock.mockResolvedValue({
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    })
    const trackingCrop = { ...DEFAULT_TRACKING_CROP_CONFIG, enabled: false }

    await createDetector({ backend: 'movenet', trackingCrop })

    expect(createMoveNetDetectorMock).toHaveBeenCalledWith(undefined, trackingCrop)
  })

  it('passes both movenetModelType and trackingCrop through to createMoveNetDetector', async () => {
    createMoveNetDetectorMock.mockResolvedValue({
      estimatePose: vi.fn(),
      dispose: vi.fn(),
    })
    const trackingCrop = { ...DEFAULT_TRACKING_CROP_CONFIG, enabled: false }

    await createDetector({ backend: 'movenet', movenetModelType: 'thunder', trackingCrop })

    expect(createMoveNetDetectorMock).toHaveBeenCalledWith('thunder', trackingCrop)
  })
})

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

const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_HIP = 23
const RIGHT_HIP = 24

/**
 * Normalized image landmarks whose torso is exactly 120px tall at videoHeight 480: shoulders at
 * y = 0.25, hips at y = 0.5, both midpoints at x = 0.5 so the torso is purely vertical.
 */
function makeTorsoLandmarks() {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.8 }))
  landmarks[LEFT_SHOULDER] = { x: 0.5, y: 0.25, z: 0, visibility: 0.8 }
  landmarks[RIGHT_SHOULDER] = { x: 0.5, y: 0.25, z: 0, visibility: 0.8 }
  landmarks[LEFT_HIP] = { x: 0.5, y: 0.5, z: 0, visibility: 0.8 }
  landmarks[RIGHT_HIP] = { x: 0.5, y: 0.5, z: 0, visibility: 0.8 }
  return landmarks
}

/**
 * World landmarks (metres, hip-centred) whose shoulder-mid sits at (0, -0.3, 0.4) relative to a
 * hip-mid at the origin — a 3D torso of exactly hypot(0.3, 0.4) = 0.5 m, but an xy-projected torso
 * of only 0.3 m. That gap is deliberate: it is what makes 240 px/m (3D) distinguishable from
 * 400 px/m (xy) in the assertions below.
 */
function makeWorldTorsoLandmarks() {
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }))
  world[LEFT_SHOULDER] = { x: 0, y: -0.3, z: 0.4 }
  world[RIGHT_SHOULDER] = { x: 0, y: -0.3, z: 0.4 }
  world[LEFT_HIP] = { x: 0, y: 0, z: 0 }
  world[RIGHT_HIP] = { x: 0, y: 0, z: 0 }
  return world
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

  it('derives pixelsPerMeter from the 3D world torso, not its xy projection', async () => {
    detectForVideo.mockReturnValue({
      landmarks: [makeTorsoLandmarks()],
      worldLandmarks: [makeWorldTorsoLandmarks()],
    })
    const video = { currentTime: 1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(video)

    // 120px torso / 0.5m 3D torso. The xy-projected torso (0.3m) would give 400 instead.
    expect(frame?.pixelsPerMeter).toBe(240)
  })

  it('omits pixelsPerMeter entirely when world landmarks are unavailable', async () => {
    detectForVideo.mockReturnValue({ landmarks: [makeTorsoLandmarks()], worldLandmarks: [] })
    const video = { currentTime: 1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(video)

    // `in`, not `toBeUndefined`: a present-but-undefined key would still change the frame's shape
    // for `toStrictEqual` and `JSON.stringify`, which the scale-less backends must not see.
    expect(frame !== null && 'pixelsPerMeter' in frame).toBe(false)
  })

  it('omits pixelsPerMeter for a degenerate (zero-length) world torso rather than emitting Infinity', async () => {
    const world = makeWorldTorsoLandmarks()
    world[LEFT_SHOULDER] = { x: 0, y: 0, z: 0 }
    world[RIGHT_SHOULDER] = { x: 0, y: 0, z: 0 }
    detectForVideo.mockReturnValue({
      landmarks: [makeTorsoLandmarks()],
      worldLandmarks: [world],
    })
    const video = { currentTime: 1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(video)

    expect(frame !== null && 'pixelsPerMeter' in frame).toBe(false)
  })

  it('dispose delegates to the landmarker', async () => {
    const detector = await createMediaPipePoseLandmarkerDetector()
    detector.dispose()

    expect(close).toHaveBeenCalledTimes(1)
  })
})

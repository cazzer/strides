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
import { videoFrameSource } from '../detector'

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
    const frame = await detector.estimatePose(videoFrameSource(video))

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

  it('keeps detectForVideo timestamps strictly increasing when the video clock restarts', async () => {
    // A cached landmarker replays the clip from 0 on every re-analysis (the scale pass path);
    // MediaPipe rejects any non-increasing timestamp and the instance never recovers, so the
    // backend must remap a backwards clock jump rather than pass it through (#40 M5).
    detectForVideo.mockReturnValue({ landmarks: [makeLandmarks()], worldLandmarks: [] })
    const video = { currentTime: 12.5, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    await detector.estimatePose(videoFrameSource(video))

    // Clip replayed from the start on the same instance.
    ;(video as { currentTime: number }).currentTime = 0
    const restartFrame = await detector.estimatePose(videoFrameSource(video))
    ;(video as { currentTime: number }).currentTime = 0.1
    const nextFrame = await detector.estimatePose(videoFrameSource(video))

    const emitted = detectForVideo.mock.calls.map((call) => call[1] as number)
    expect(emitted[0]).toBe(12500)
    // Strictly increasing across the restart, and the second run's intra-run spacing (100ms)
    // survives the remap.
    expect(emitted[1]).toBeGreaterThan(emitted[0])
    expect(emitted[2] - emitted[1]).toBe(100)
    // PoseFrame timestamps stay on the raw video clock — downstream sorting/robustness reasons
    // about media time, not MediaPipe's internal timeline.
    expect(restartFrame?.timestamp).toBe(0)
    expect(nextFrame?.timestamp).toBe(0.1)
  })

  it('maps landmark indices 0/7/8 to nose/left_ear/right_ear, denormalized like every other point', async () => {
    detectForVideo.mockReturnValue({ landmarks: [makeLandmarks()], worldLandmarks: [] })
    const video = { currentTime: 12.5, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(frame?.keypoints.find((k) => k.name === 'nose')).toEqual({
      name: 'nose',
      x: 0.1 * 0 * 640,
      y: 0.2 * 0 * 480,
      score: 0.8,
    })
    expect(frame?.keypoints.find((k) => k.name === 'left_ear')).toEqual({
      name: 'left_ear',
      x: 0.1 * 7 * 640,
      y: 0.2 * 7 * 480,
      score: 0.8,
    })
    expect(frame?.keypoints.find((k) => k.name === 'right_ear')).toEqual({
      name: 'right_ear',
      x: 0.1 * 8 * 640,
      y: 0.2 * 8 * 480,
      score: 0.8,
    })
  })

  it('returns null when no pose is detected', async () => {
    detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] })
    const video = { currentTime: 3, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(frame).toBeNull()
  })

  it('derives pixelsPerMeter from the 3D world torso, not its xy projection', async () => {
    detectForVideo.mockReturnValue({
      landmarks: [makeTorsoLandmarks()],
      worldLandmarks: [makeWorldTorsoLandmarks()],
    })
    const video = { currentTime: 1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(videoFrameSource(video))

    // 120px torso / 0.5m 3D torso. The xy-projected torso (0.3m) would give 400 instead.
    expect(frame?.pixelsPerMeter).toBe(240)
  })

  it('omits pixelsPerMeter entirely when world landmarks are unavailable', async () => {
    detectForVideo.mockReturnValue({ landmarks: [makeTorsoLandmarks()], worldLandmarks: [] })
    const video = { currentTime: 1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(videoFrameSource(video))

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
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(frame !== null && 'pixelsPerMeter' in frame).toBe(false)
  })

  it('dispose delegates to the landmarker', async () => {
    const detector = await createMediaPipePoseLandmarkerDetector()
    detector.dispose()

    expect(close).toHaveBeenCalledTimes(1)
  })
})

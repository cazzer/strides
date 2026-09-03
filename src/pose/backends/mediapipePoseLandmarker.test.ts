import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { forVisionTasksMock, createFromOptionsMock, detectForVideo, close, fetchModelAssetMock } =
  vi.hoisted(() => ({
    forVisionTasksMock: vi.fn(),
    createFromOptionsMock: vi.fn(),
    detectForVideo: vi.fn(),
    close: vi.fn(),
    fetchModelAssetMock: vi.fn(),
  }))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: forVisionTasksMock },
  PoseLandmarker: { createFromOptions: createFromOptionsMock },
}))

// The `.task` is now fetched by us rather than by MediaPipe, so this backend has a network call
// of its own to stub. Without it every test here reaches undici through jsdom's relative BASE_URL.
vi.mock('../modelAssetCache', () => ({ fetchModelAsset: fetchModelAssetMock }))

import {
  MODEL_ASSET_PATH,
  POSE_LANDMARKER_MODEL_VERSION,
  createMediaPipePoseLandmarkerDetector,
} from './mediapipePoseLandmarker'
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
  fetchModelAssetMock.mockReset()
  forVisionTasksMock.mockResolvedValue({ wasm: 'fileset' })
  createFromOptionsMock.mockResolvedValue({ detectForVideo, close })
  fetchModelAssetMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
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

  it('hands the landmarker model BYTES, from the shared cache, not a path to fetch itself', async () => {
    // The whole point of `strides-utn.3`: GitHub Pages serves this 9.4 MB asset with
    // `cache-control: max-age=600` and we cannot change that header, so the bytes have to come
    // through our own cache. Passing `modelAssetPath` would hand the fetch back to MediaPipe and
    // lose both the cache and the progress reading.
    const bytes = new Uint8Array([7, 7, 7])
    fetchModelAssetMock.mockResolvedValue(bytes)

    await createMediaPipePoseLandmarkerDetector()

    const [spec] = fetchModelAssetMock.mock.calls[0]
    expect(spec.url).toContain('models/pose_landmarker_full.task')
    // The cache identity is stable and the version token is non-empty — a blank token would key
    // every model revision to the same entry.
    expect(spec.id).toBe(spec.url)
    expect(spec.version).toBeTruthy()

    const [, landmarkerOptions] = createFromOptionsMock.mock.calls[0]
    expect(landmarkerOptions.baseOptions.modelAssetBuffer).toBe(bytes)
    expect(landmarkerOptions.baseOptions.modelAssetPath).toBeUndefined()
  })

  it('forwards its progress sink to the asset fetch', async () => {
    const onAssetProgress = vi.fn()

    await createMediaPipePoseLandmarkerDetector({ onAssetProgress })

    expect(fetchModelAssetMock.mock.calls[0][1]).toBe(onAssetProgress)
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

  it('maps landmark indices 29/30/31/32 to left_heel/right_heel/left_foot_index/right_foot_index, denormalized like every other point', async () => {
    detectForVideo.mockReturnValue({ landmarks: [makeLandmarks()], worldLandmarks: [] })
    const video = { currentTime: 12.5, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

    const detector = await createMediaPipePoseLandmarkerDetector()
    const frame = await detector.estimatePose(videoFrameSource(video))

    expect(frame?.keypoints.find((k) => k.name === 'left_heel')).toEqual({
      name: 'left_heel',
      x: 0.1 * 29 * 640,
      y: 0.2 * 29 * 480,
      score: 0.8,
    })
    expect(frame?.keypoints.find((k) => k.name === 'right_heel')).toEqual({
      name: 'right_heel',
      x: 0.1 * 30 * 640,
      y: 0.2 * 30 * 480,
      score: 0.8,
    })
    expect(frame?.keypoints.find((k) => k.name === 'left_foot_index')).toEqual({
      name: 'left_foot_index',
      x: 0.1 * 31 * 640,
      y: 0.2 * 31 * 480,
      score: 0.8,
    })
    expect(frame?.keypoints.find((k) => k.name === 'right_foot_index')).toEqual({
      name: 'right_foot_index',
      x: 0.1 * 32 * 640,
      y: 0.2 * 32 * 480,
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

/**
 * `strides-8w2`. The `.task`'s Cache Storage entry is keyed on `POSE_LANDMARKER_MODEL_VERSION`, a
 * value nothing else in the app derives — so replacing `public/models/pose_landmarker_full.task`
 * without editing that line serves every returning visitor the OLD model's 9.4 MB forever, from a
 * page that ships the new file. The failure looks like nothing at all: analysis completes and the
 * numbers are self-consistent, they are simply the previous model's.
 *
 * This is the same discipline `movenetModelAssets.test.ts` applies to `MOVENET_MODEL_URLS` — a
 * mirrored value asserted against its source of truth — except that a checked-in binary has no
 * upstream constant to compare against, so its own bytes are the source of truth.
 */
describe('POSE_LANDMARKER_MODEL_VERSION', () => {
  /**
   * Resolved THROUGH `MODEL_ASSET_PATH` rather than re-typed, so a moved or renamed asset makes
   * this read throw (naming the path it looked for) instead of quietly hashing a file the app
   * stopped loading and passing forever.
   */
  function readCheckedInModelBytes(): Buffer {
    const base = import.meta.env.BASE_URL
    expect(
      MODEL_ASSET_PATH.startsWith(base),
      `MODEL_ASSET_PATH ${MODEL_ASSET_PATH} is not under BASE_URL ${base}; this test can no longer locate the file it is meant to hash`,
    ).toBe(true)
    // Leading separators stripped because `resolve` treats an absolute segment as a new root, and
    // BASE_URL is '/' here but '/strides/' in the app — the slice leaves no leading slash either
    // way today, and this keeps that from being load-bearing.
    const publicRelativePath = MODEL_ASSET_PATH.slice(base.length).replace(/^\/+/, '')
    // `path.resolve` rather than `new URL(..., import.meta.url)`: vite rewrites the latter into an
    // asset-glob lookup when its first argument is not a literal, and a template with a runtime
    // value resolves to the STRING "undefined" instead of a path (hit for real writing this test).
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    return readFileSync(resolve(repoRoot, 'public', publicRelativePath))
  }

  it("equals the checked-in .task file's own MD5", () => {
    const digest = createHash('md5').update(readCheckedInModelBytes()).digest('hex')

    expect(
      POSE_LANDMARKER_MODEL_VERSION,
      'public/models/pose_landmarker_full.task and POSE_LANDMARKER_MODEL_VERSION disagree. If you replaced the model, set the constant in mediapipePoseLandmarker.ts to the expected value below; a stale token serves the OLD model from Cache Storage to every returning visitor.',
    ).toBe(`md5-${digest}`)
  })

  it('is a non-empty token, so every model revision cannot collide onto one cache entry', () => {
    // `fetchModelAsset` keys on `encodeURIComponent(version)`; an empty or whitespace token is a
    // legal string that keys two different models to the same entry, which is the same defect
    // this file guards against arriving by a different route.
    expect(POSE_LANDMARKER_MODEL_VERSION.trim()).not.toBe('')
  })
})

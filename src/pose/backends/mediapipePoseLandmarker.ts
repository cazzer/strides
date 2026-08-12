import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PoseDetector } from '../detector'
import type { PoseFrame } from '../types'
import type { RawKeypoint } from './common'
import { toPoseFrame } from './common'

/**
 * Pinned to the installed package version — floating on a CDN "latest" tag would let the WASM
 * runtime drift out from under a pinned npm dependency.
 */
const WASM_BASE_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

/** 'full' to match the (currently broken) tfjs BlazePose backend's variant — see GitHub #25. */
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'

/**
 * `PoseLandmarkerResult#landmarks` is a plain `NormalizedLandmark[]` with no `.name` field —
 * MediaPipe Pose's landmark topology is fixed and index-ordered, not named by the library
 * itself. This is the standard, documented 33-point order (same topology
 * `@tensorflow-models/pose-detection`'s BlazePose support uses internally).
 */
const MEDIAPIPE_POSE_LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye',
  'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right', 'left_shoulder',
  'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_pinky',
  'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb', 'left_hip',
  'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_heel',
  'right_heel', 'left_foot_index', 'right_foot_index',
]

/**
 * Indices into MEDIAPIPE_POSE_LANDMARK_NAMES for the four points forming the torso segment.
 * Kept as raw indices (not name lookups) because `worldLandmarks` is a parallel, index-aligned
 * array with no names of its own — the index IS the join key between the two arrays.
 */
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_HIP = 23
const RIGHT_HIP = 24

interface Point3 {
  x: number
  y: number
  z: number
}

function midpoint3(a: Point3, b: Point3): Point3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

/**
 * Pixels per real-world meter for one frame: the torso (shoulder-mid → hip-mid) measured in the
 * already-denormalized pixel space, divided by the same torso measured in `worldLandmarks`
 * (meters). Torso is the same segment `estimateBodyScale` normalizes by downstream, so the two
 * agree about what "body scale" means.
 *
 * The world distance is 3D (x, y, z), NOT the xy projection. MediaPipe's world z is noisy, and it
 * is tempting to drop it for that reason — but measured across real clips the xy-projected torso
 * was the LEAST stable of the variants tried (epic #27's investigation), because dropping z means
 * the measured length shrinks and grows with the torso's rotation toward/away from the camera,
 * which is a much larger effect than the z noise it avoids. The full 3D length is rotation-
 * invariant by construction and came out stable (CV 2.3-2.7%).
 *
 * `worldLandmarks` are used for SCALE ONLY, never as a positional signal: they are hip-centered,
 * i.e. the model has removed translation, so the body's actual movement through space (the thing
 * vertical oscillation measures) is identically zero in that space.
 *
 * `landmark.visibility` deliberately does not gate this: it would introduce a threshold to tune,
 * and would make the output depend on a confidence value that this backend's otherwise
 * bit-deterministic path is free of. A geometrically degenerate measurement is rejected on its own
 * merits below instead.
 *
 * Returns `undefined` — never 0/NaN/Infinity — when the measurement can't be trusted, so
 * `toPoseFrame` omits the key entirely for that frame.
 */
function computePixelsPerMeter(
  rawKeypoints: RawKeypoint[],
  worldLandmarks: Point3[] | undefined,
): number | undefined {
  if (!worldLandmarks || worldLandmarks.length <= RIGHT_HIP) return undefined
  if (rawKeypoints.length <= RIGHT_HIP) return undefined

  const pixelMidX = (a: RawKeypoint, b: RawKeypoint) => (a.x + b.x) / 2
  const pixelMidY = (a: RawKeypoint, b: RawKeypoint) => (a.y + b.y) / 2
  // 2D in pixel space: the pixel keypoints have no z, and the series this scale later converts
  // (hip-mid image y) lives in that same 2D space.
  const torsoPx = Math.hypot(
    pixelMidX(rawKeypoints[LEFT_SHOULDER], rawKeypoints[RIGHT_SHOULDER]) -
      pixelMidX(rawKeypoints[LEFT_HIP], rawKeypoints[RIGHT_HIP]),
    pixelMidY(rawKeypoints[LEFT_SHOULDER], rawKeypoints[RIGHT_SHOULDER]) -
      pixelMidY(rawKeypoints[LEFT_HIP], rawKeypoints[RIGHT_HIP]),
  )

  const worldShoulderMid = midpoint3(
    worldLandmarks[LEFT_SHOULDER],
    worldLandmarks[RIGHT_SHOULDER],
  )
  const worldHipMid = midpoint3(worldLandmarks[LEFT_HIP], worldLandmarks[RIGHT_HIP])
  const torsoMeters = Math.hypot(
    worldShoulderMid.x - worldHipMid.x,
    worldShoulderMid.y - worldHipMid.y,
    worldShoulderMid.z - worldHipMid.z,
  )

  if (!Number.isFinite(torsoPx) || !Number.isFinite(torsoMeters)) return undefined
  if (torsoMeters <= 0) return undefined

  const pixelsPerMeter = torsoPx / torsoMeters
  return Number.isFinite(pixelsPerMeter) && pixelsPerMeter > 0
    ? pixelsPerMeter
    : undefined
}

/**
 * A distinct runtime from `blazepose.ts`: this runs on MediaPipe's own WASM/GPU-delegate
 * pipeline via `@mediapipe/tasks-vision`, not through `@tensorflow-models/pose-detection`'s
 * `tfjs-core` op graph — a different execution path entirely, deliberately, to sidestep whatever
 * is producing the NaN output on the tfjs BlazePose path (see CLAUDE.md's "Known issue"). Not to
 * be confused with the older, deprecated `@mediapipe/pose` package this repo already stubs out
 * dead in `backends/__shims__/mediapipe-pose.ts` — that's a different, unrelated package.
 */
export async function createMediaPipePoseLandmarkerDetector(): Promise<PoseDetector> {
  const wasmFileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)
  const landmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
    baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
  })

  return {
    async estimatePose(video: HTMLVideoElement): Promise<PoseFrame | null> {
      const result = landmarker.detectForVideo(video, Math.round(video.currentTime * 1000))
      const landmarks = result.landmarks[0]
      if (!landmarks) return null

      const rawKeypoints: RawKeypoint[] = landmarks.map((landmark, i) => ({
        name: MEDIAPIPE_POSE_LANDMARK_NAMES[i],
        x: landmark.x * video.videoWidth,
        y: landmark.y * video.videoHeight,
        score: landmark.visibility,
      }))
      return toPoseFrame(
        rawKeypoints,
        video.currentTime,
        // `?.` rather than `[0]`: the type says worldLandmarks is always an array, but this is a
        // WASM boundary — an older/newer runtime that simply doesn't populate it should degrade to
        // "no scale on this backend", not throw on every frame.
        computePixelsPerMeter(rawKeypoints, result.worldLandmarks?.[0]),
      )
    },
    dispose(): void {
      landmarker.close()
    },
  }
}

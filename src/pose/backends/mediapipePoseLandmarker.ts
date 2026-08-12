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
      return toPoseFrame(rawKeypoints, video.currentTime)
    },
    dispose(): void {
      landmarker.close()
    },
  }
}

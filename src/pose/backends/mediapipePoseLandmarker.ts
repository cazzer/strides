import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { DetectorCreationOptions, PoseDetector, PoseFrameSource } from '../detector'
import { fetchModelAsset } from '../modelAssetCache'
import type { PoseFrame } from '../types'
import type { RawKeypoint } from './common'
import { toPoseFrame } from './common'

/**
 * Pinned to the installed package version — floating on a CDN "latest" tag would let the WASM
 * runtime drift out from under a pinned npm dependency.
 *
 * Deliberately NOT routed through `fetchModelAsset`, on measurement (`strides-utn.2`): jsdelivr
 * already serves it `public, max-age=31536000, immutable` and it transfers 0 bytes on a warm
 * visit, while Cache Storage stores the DECODED body — so caching a 3.12 MB wire payload would
 * occupy 11.76 MB of quota to save nothing. `FilesetResolver` also exposes no progress hook, so
 * this fetch is indeterminate whatever we do with it.
 */
const WASM_BASE_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

/**
 * 'full' to match the (currently broken) tfjs BlazePose backend's variant — see GitHub #25.
 *
 * Self-hosted (public/models/) rather than fetched from
 * `storage.googleapis.com/mediapipe-models/.../latest/` because the bucket's `latest` tag floats
 * (its bytes already differ from the only published numbered version, `/1/`), so a remote fetch
 * could silently change the model — and with it every VO-cm number — under a pinned npm
 * dependency. The checked-in file is byte-identical (MD5 5a9ad88919b2231d02b1fdf4a54090ec) to the
 * `latest` bytes every 2026-08-13 verification ran against. `BASE_URL` prefix because the app
 * deploys under a subpath (vite.config.ts `base`).
 *
 * That byte-pinning is the whole of the rationale. This comment used to add a caching one — "the
 * bucket serves `cache-control: max-age=3600`, while same-origin hosting rides our own deploy's
 * caching" — and it was wrong twice over, which is why `strides-utn.3` exists. The deploy is
 * GitHub Pages: its response headers are not ours to set, so there is no "our own deploy's
 * caching" to ride. And measured live, the file comes back `cache-control: max-age=600` — six
 * times WORSE than the bucket it replaced, not better. Ten minutes is not caching, and no header
 * change can fix it, so the bytes are kept client-side instead: see `modelAssetCache.ts`.
 */
const MODEL_ASSET_PATH = `${import.meta.env.BASE_URL}models/pose_landmarker_full.task`

/**
 * The cache-key version token for the asset above — the checked-in file's own MD5, which is the
 * identity this repo already records for it.
 *
 * ⚠️ Replacing `public/models/pose_landmarker_full.task` MUST update this constant. A cached
 * client keys on it, so leaving it stale serves the OLD model's bytes from Cache Storage forever,
 * on a page that ships the new file — a failure that looks like nothing at all.
 */
const POSE_LANDMARKER_MODEL_VERSION = 'md5-5a9ad88919b2231d02b1fdf4a54090ec'

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
/**
 * How far past the last emitted timestamp a backwards-jumping video clock lands. Any positive
 * gap satisfies MediaPipe's strictly-increasing requirement; one nominal frame keeps the
 * remapped timeline at frame-like spacing across the seam.
 */
const TIMESTAMP_RESTART_GAP_MS = 33

export async function createMediaPipePoseLandmarkerDetector(
  options: DetectorCreationOptions = {},
): Promise<PoseDetector> {
  const wasmFileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)
  // `modelAssetBuffer` rather than `modelAssetPath` so the 9.4 MB `.task` is fetched by us: that
  // is what makes it observable (byte progress) and cacheable across page loads. MediaPipe accepts
  // the bytes directly (`BaseOptions.modelAssetBuffer`), so this needs no loader shim — it is
  // simply which of two documented inputs we hand it.
  const modelAssetBuffer = await fetchModelAsset(
    {
      id: MODEL_ASSET_PATH,
      url: MODEL_ASSET_PATH,
      version: POSE_LANDMARKER_MODEL_VERSION,
    },
    options.onAssetProgress,
  )
  const landmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
    baseOptions: { modelAssetBuffer, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
  })

  // MediaPipe's VIDEO running mode requires strictly increasing timestamps for the lifetime of
  // the landmarker instance, but this detector outlives a single playback: the scale pass's
  // cached instance replays the clip from 0 on every re-analysis (a mediapipe-primary override
  // run does the same). Feeding the restarted clock through verbatim permanently poisons the
  // instance — every later call rejects with a packet-timestamp-mismatch error, which is how
  // every post-first analysis on a page silently lost its VO-cm graft (issue #40's M5 probe).
  // Remap instead: whenever the video clock fails to advance, shift everything after it so the
  // emitted timeline keeps climbing. PoseFrame timestamps stay on the raw video clock.
  let timestampOffsetMs = 0
  let lastEmittedMs = -1

  return {
    async estimatePose(source: PoseFrameSource): Promise<PoseFrame | null> {
      const rawMs = Math.round(source.timestampSec * 1000)
      if (rawMs + timestampOffsetMs <= lastEmittedMs) {
        timestampOffsetMs = lastEmittedMs + TIMESTAMP_RESTART_GAP_MS - rawMs
      }
      const timestampMs = rawMs + timestampOffsetMs
      lastEmittedMs = timestampMs
      const result = landmarker.detectForVideo(source.image, timestampMs)
      const landmarks = result.landmarks[0]
      if (!landmarks) return null

      const rawKeypoints: RawKeypoint[] = landmarks.map((landmark, i) => ({
        name: MEDIAPIPE_POSE_LANDMARK_NAMES[i],
        x: landmark.x * source.width,
        y: landmark.y * source.height,
        score: landmark.visibility,
      }))
      return toPoseFrame(
        rawKeypoints,
        source.timestampSec,
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

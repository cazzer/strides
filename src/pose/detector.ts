import { createMoveNetDetector } from './backends/movenet'
import type { MoveNetModelType } from './backends/movenet'
import { createBlazePoseDetector } from './backends/blazepose'
import { createPoseNetDetector } from './backends/posenet'
import { createMediaPipePoseLandmarkerDetector } from './backends/mediapipePoseLandmarker'
import type { PoseFrame } from './types'

export type PoseBackendId = 'movenet' | 'blazepose' | 'posenet' | 'mediapipePoseLandmarker'

export interface PoseDetectorConfig {
  backend: PoseBackendId
  /** Only meaningful when backend: 'movenet'. Defaults to 'lightning'. */
  movenetModelType?: MoveNetModelType
}

export interface PoseDetector {
  estimatePose(video: HTMLVideoElement): Promise<PoseFrame | null>
  dispose(): void
}

const backends: Record<PoseBackendId, (config: PoseDetectorConfig) => Promise<PoseDetector>> = {
  movenet: (config) => createMoveNetDetector(config.movenetModelType),
  blazepose: () => createBlazePoseDetector(),
  posenet: () => createPoseNetDetector(),
  mediapipePoseLandmarker: () => createMediaPipePoseLandmarkerDetector(),
}

// Intentionally not `async`: an async function can never throw synchronously to its
// caller (the throw would become a rejected Promise instead), and an unknown backend
// should fail fast, synchronously, before any async work begins.
export function createDetector(
  config: PoseDetectorConfig = { backend: 'movenet' },
): Promise<PoseDetector> {
  const createBackendDetector = backends[config.backend]
  if (!createBackendDetector) {
    throw new Error(`Unknown pose detector backend: ${config.backend}`)
  }
  return createBackendDetector(config)
}

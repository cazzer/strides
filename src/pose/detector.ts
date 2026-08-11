import { createMoveNetDetector } from './backends/movenet'
import type { PoseFrame } from './types'

export type PoseBackendId = 'movenet' // add 'blazepose' when that backend ships

export interface PoseDetectorConfig {
  backend: PoseBackendId
}

export interface PoseDetector {
  estimatePose(video: HTMLVideoElement): Promise<PoseFrame | null>
  dispose(): void
}

const backends: Record<PoseBackendId, () => Promise<PoseDetector>> = {
  movenet: createMoveNetDetector,
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
  return createBackendDetector()
}

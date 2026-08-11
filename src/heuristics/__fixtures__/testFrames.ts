import { COMMON_KEYPOINT_NAMES } from '../../pose/types'
import type { KeypointName } from '../../pose/types'
import type {
  KeypointStatus,
  RobustKeypoint,
  RobustPoseFrame,
} from '../../pose/robustness/types'

export interface PointSpec {
  x: number
  y: number
  status?: KeypointStatus
}

/**
 * Hand-builds a `RobustPoseFrame` for unit tests, specifying only the keypoints a test actually
 * cares about — every unspecified keypoint defaults to `'unrecoverable'` (null x/y), keeping each
 * test's intent narrow instead of every test needing to fill out all 12 points.
 */
export function buildFrame(
  points: Partial<Record<KeypointName, PointSpec | null>>,
  timestamp = 0,
): RobustPoseFrame {
  const keypoints: RobustKeypoint[] = COMMON_KEYPOINT_NAMES.map((name) => {
    const spec = points[name]
    if (spec == null) {
      return { name, x: null, y: null, score: 0, status: 'unrecoverable' }
    }
    const status = spec.status ?? 'detected'
    if (status === 'unrecoverable') {
      // Matches the real robustness-layer contract: unrecoverable keypoints are always null,
      // never a fabricated coordinate.
      return { name, x: null, y: null, score: 0, status }
    }
    return {
      name,
      x: spec.x,
      y: spec.y,
      score: status === 'interpolated' ? 0.5 : 0.9,
      status,
    }
  })
  return { timestamp, keypoints, source: 'detected' }
}

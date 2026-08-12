import type { RobustKeypoint, RobustPoseFrame } from '../../pose/robustness/types'
import { COMMON_KEYPOINT_NAMES } from '../../pose/types'

/** Fixed torso length, matching the synthetic-gait fixture's own constant. */
export const TORSO_LENGTH_PX = 150

/**
 * Minimal fully-detected frames carrying an arbitrary hip-y trace, with shoulders held a rigid
 * TORSO_LENGTH_PX above the hips so `estimateBodyScale` always resolves to exactly that. Used where
 * the point of the test is the shape of the hip signal itself (noise, a sub-cycle clip), which the
 * parametric gait fixture can't express. Shared by `verticalOscillation.test.ts`, `cadence.test.ts`
 * and `hipBounce.test.ts` — all three read the same hip-mid signal (see `hipBounce.ts`), so they
 * need the identical fixture shape to exercise it.
 */
export function framesFromHipTrace(
  samples: Array<{ t: number; y: number }>,
): RobustPoseFrame[] {
  return samples.map(({ t, y }) => {
    const keypoints: RobustKeypoint[] = COMMON_KEYPOINT_NAMES.map((name) => {
      const isHip = name === 'left_hip' || name === 'right_hip'
      const isShoulder = name === 'left_shoulder' || name === 'right_shoulder'
      return {
        name,
        x: 200,
        y: isHip ? y : isShoulder ? y - TORSO_LENGTH_PX : y + 50,
        score: 0.9,
        status: 'detected' as const,
      }
    })
    return { timestamp: t, keypoints, source: 'detected' as const, pixelsPerMeter: null }
  })
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededNormals(seed: number, count: number): number[] {
  const random = mulberry32(seed)
  const out: number[] = []
  while (out.length < count) {
    const u1 = Math.max(random(), 1e-12)
    const u2 = random()
    const radius = Math.sqrt(-2 * Math.log(u1))
    out.push(radius * Math.cos(2 * Math.PI * u2))
    out.push(radius * Math.sin(2 * Math.PI * u2))
  }
  return out.slice(0, count)
}

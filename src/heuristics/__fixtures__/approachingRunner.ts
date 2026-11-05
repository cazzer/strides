import type { RobustPoseFrame } from '../../pose/robustness/types'
import { seededNormals } from './hipTraceFrames'
import { buildFrame } from './testFrames'

/**
 * A runner approaching the camera — the shape `bounceSpectrum.ts`'s scale-normalized pass exists
 * for. The on-screen torso grows as `s(t) = s0 / (1 − αt)` (a constant approach speed seen through
 * a pinhole), the hip-mid descends with that growth (`c·s(t)`, perspective), and the bounce rides on
 * it at a fixed fraction of the torso (`A_rel·s(t)·sin(2π·f·t)`), so its PIXEL amplitude grows with
 * the runner exactly as it does on real approach footage. Shoulders sit one torso above the hips
 * and both pairs straddle a fixed x at ±0.3·s, so `torsoLengthAt` reads `s(t)` on every frame.
 *
 * Shared by `hipBounce.test.ts`, `cadence.test.ts` and `verticalOscillation.test.ts`, which all
 * read the same hip-mid signal and so need the identical clip.
 */
export const APPROACH = {
  fps: 60,
  durationSec: 2.5,
  bounceHz: 3,
  /** Torso length at t = 0, px. */
  initialTorsoPx: 40,
  /** `1 / (1 − α·durationSec)` = 6: the runner ends six times the size they started. */
  alphaPerSec: 1 / 3,
  /** Hip-mid descent per pixel of torso growth. */
  descentPerTorsoPx: 0.75,
  /** Bounce half-amplitude as a fraction of torso — so the true torso-normalized peak-to-peak
   * (`verticalOscillation`'s value) is twice this. */
  relativeAmplitude: 0.05,
  /** Gaussian keypoint jitter, px, applied per hip/shoulder coordinate. */
  noisePx: 0.5,
} as const

export function torsoAt(t: number): number {
  return APPROACH.initialTorsoPx / (1 - APPROACH.alphaPerSec * t)
}

/** Hip-mid y of the approach clip at `t`, before keypoint jitter. */
export function approachHipY(t: number): number {
  const s = torsoAt(t)
  return (
    300 +
    APPROACH.descentPerTorsoPx * s +
    APPROACH.relativeAmplitude * s * Math.sin(2 * Math.PI * APPROACH.bounceHz * t)
  )
}

export function generateApproachingRunner({
  withShoulders = true,
}: { withShoulders?: boolean } = {}): RobustPoseFrame[] {
  const count = Math.round(APPROACH.fps * APPROACH.durationSec)
  const noise = seededNormals(9349, count * 4)
  const frames: RobustPoseFrame[] = []
  for (let i = 0; i < count; i += 1) {
    const t = i / APPROACH.fps
    const s = torsoAt(t)
    const hipY = approachHipY(t)
    const jitter = (k: number) => APPROACH.noisePx * noise[i * 4 + k]
    frames.push(
      buildFrame(
        {
          left_hip: { x: 500 - 0.3 * s, y: hipY + jitter(0) },
          right_hip: { x: 500 + 0.3 * s, y: hipY + jitter(1) },
          ...(withShoulders
            ? {
                left_shoulder: { x: 500 - 0.3 * s, y: hipY - s + jitter(2) },
                right_shoulder: { x: 500 + 0.3 * s, y: hipY - s + jitter(3) },
              }
            : {}),
        },
        t,
      ),
    )
  }
  return frames
}

import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig } from './types'
import { resolveMidpoint } from './keypoints'

function isPresent(frame: RobustPoseFrame): boolean {
  return (
    resolveMidpoint(frame, 'left_shoulder', 'right_shoulder') !== null &&
    resolveMidpoint(frame, 'left_hip', 'right_hip') !== null
  )
}

/**
 * Trims `frames` to the span between the first and last frame belonging to a run of at least
 * `config.presenceMinConsecutiveFrames` consecutive frames where the subject is trackable
 * (shoulder-mid and hip-mid both resolvable — the same check `estimateBodyScale` uses). Frames
 * outside that window aren't a tracking failure to penalize `frameCoverage` for; there was
 * nothing there to track at all (the subject hasn't entered frame yet, or has already left).
 *
 * Only meant for the frames handed to `computeFormHeuristics` — callers that need the full,
 * untrimmed clip (the skeleton overlay, `computeAnalysisDiagnostics`) should keep using the
 * original `RobustPoseFrame[]`, not this function's output.
 */
export function trimToPresenceWindow(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): RobustPoseFrame[] {
  const minRun = config.presenceMinConsecutiveFrames
  const present = frames.map(isPresent)

  let windowStart = -1
  let windowEnd = -1

  let runStart = -1
  for (let i = 0; i <= frames.length; i += 1) {
    const isPresentHere = i < frames.length && present[i]
    if (isPresentHere) {
      if (runStart === -1) runStart = i
      continue
    }
    // Run just ended at i - 1 (or there was no run running into this index).
    if (runStart !== -1) {
      const runEnd = i - 1
      if (runEnd - runStart + 1 >= minRun) {
        if (windowStart === -1) windowStart = runStart
        windowEnd = runEnd
      }
      runStart = -1
    }
  }

  if (windowStart === -1) return []
  return frames.slice(windowStart, windowEnd + 1)
}

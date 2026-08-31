import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { MetricExemplar } from './types'
import {
  cropDerivable,
  cropKeypoints,
  pairQuality,
  scoreExemplarInstant,
  selectOppositeSidePair,
} from './exemplars'
import type { ExemplarDistribution } from './exemplars'

/**
 * The opposite-foot-pair-or-single exemplar construction shared by the two step-width metrics,
 * `stepWidth.ts` (hip-width ratio) and `stepWidthCm.ts` (real-world centimetres).
 *
 * **Extracted because the copies diverged and nothing caught it.** The two modules each carried a
 * private, line-for-line identical `buildExemplars`, and `stepWidthCm`'s had silently lost the two
 * lines that emit `measuredSide`/`pairedMeasuredSide`. That is not a cosmetic omission: with both
 * absent and no pair-level `side` (deliberately — see below), `resolveInstantSide`
 * (`evidenceFrames.ts`) resolves `null` for both halves of the pair, and `buildStepWidthMarks`
 * (`evidenceAnnotations.ts`) returns on `side === null` BEFORE it reaches `builder.caliper` — so
 * the ankle-offset caliper, the one mark that depicts the measurement itself, was never drawn on a
 * `stepWidthCm` pair. The hip-width segment and the hip-midline plumb still drew, so the image
 * looked deliberate rather than broken. One construction, called by both metrics, is what makes
 * that class of divergence structurally impossible rather than merely fixed once.
 *
 * The two metrics genuinely share this: they measure the same event (a footstrike against the hip
 * midline) from the same keypoints, and differ only in the UNIT their `value` carries. Everything
 * about which instants to depict, and how to describe them, is unit-independent.
 */

/** The striking foot's ankle, per side. */
export const STEP_WIDTH_ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

/** One footstrike's measurement, in whichever unit the calling metric reports. */
export interface StepWidthStrikeSample {
  frame: RobustPoseFrame
  side: 'left' | 'right'
  value: number
  /** The caller's `outwardSign` guard fell through to its `|| 1` fallback at this strike,
   * inventing a polarity. Fine for a median over many strikes; not something to put a picture
   * under. */
  degenerate: boolean
}

/** The points the metric itself reads at a strike: the striking foot, against the hip midline. */
function seedFor(sample: StepWidthStrikeSample): KeypointName[] {
  return [STEP_WIDTH_ANKLE_NAME[sample.side], 'left_hip', 'right_hip']
}

/**
 * One ghosted pair of OPPOSITE-foot plants, or a single strike when the clip never puts two
 * opposite plants next to each other.
 *
 * The pair is CONSTRUCTED, not read off: these metrics measure each strike independently against
 * the hip midline, and `detectFootstrikes` merges both legs into one timestamp-ordered list whose
 * consecutive entries need not alternate. A ghost of two opposite feet at their respective plants
 * is exactly what "step width" means, which is why it is worth building — see
 * `selectOppositeSidePair`.
 *
 * Strikes whose outward polarity was invented by the `|| 1` fallback are gated out here rather
 * than ranked: a picture captioned "landed on its own side" has to be of a strike where which
 * side that was is actually known.
 */
export function buildStepWidthExemplars(
  samples: StepWidthStrikeSample[],
  distribution: ExemplarDistribution,
): MetricExemplar[] {
  const eligible = samples.filter(
    (sample) => !sample.degenerate && cropDerivable(sample.frame, seedFor(sample)),
  )
  const instant = (sample: StepWidthStrikeSample) => ({
    frame: sample.frame,
    seed: seedFor(sample),
    value: sample.value,
  })

  const pair = selectOppositeSidePair(eligible, distribution)
  if (pair !== null) {
    const [first, second] = pair
    const firstQuality = scoreExemplarInstant(instant(first), 'representative', distribution)
    const secondQuality = scoreExemplarInstant(instant(second), 'representative', distribution)
    if (firstQuality !== null && secondQuality !== null) {
      // Base is whichever plant sits closer to the reported median — the one the number is most
      // directly about; the other is the ghost that turns it into a width.
      const base =
        Math.abs(first.value - distribution.median) <=
        Math.abs(second.value - distribution.median)
          ? first
          : second
      const ghost = base === first ? second : first
      return [
        {
          kind: 'stepWidthStrike',
          timestamp: base.frame.timestamp,
          pairedTimestamp: ghost.frame.timestamp,
          // No `side`: the two instants are deliberately opposite feet, so naming one would be
          // wrong about the other. Each instant names its OWN foot instead — which is exactly the
          // fact a per-instant consumer needs and the one `side` structurally cannot carry here.
          // Both fields are load-bearing, not descriptive: `buildStepWidthMarks` draws each half's
          // caliper from the ankle that half was measured from, and draws neither without them.
          measuredSide: base.side,
          pairedMeasuredSide: ghost.side,
          quality: pairQuality(firstQuality, secondQuality),
          label: 'Opposite-foot plants either side of the hip midline',
          cropKeypoints: cropKeypoints(
            [...seedFor(base), ...seedFor(ghost)],
            [],
            [base.frame, ghost.frame],
          ),
        },
      ]
    }
  }

  // Demoted: one strike against the hip midline is one whole measurement, so a single frame is
  // still honest here — unlike the range metrics, which have nothing to say from one instant.
  const singles: MetricExemplar[] = []
  for (const sample of eligible) {
    const quality = scoreExemplarInstant(instant(sample), 'representative', distribution)
    if (quality === null) continue
    singles.push({
      kind: 'stepWidthStrike',
      timestamp: sample.frame.timestamp,
      side: sample.side,
      quality,
      label: `Footstrike measured against the hip midline (${sample.side} foot)`,
      cropKeypoints: cropKeypoints(
        seedFor(sample),
        [STEP_WIDTH_ANKLE_NAME[sample.side === 'left' ? 'right' : 'left']],
        [sample.frame],
      ),
    })
  }
  singles.sort((a, b) => b.quality - a.quality)
  return singles.slice(0, 1)
}

import type { MetricId } from '../heuristics/types'

/**
 * What each metric measures, in the reader's terms — one sentence or three, and never a verdict.
 *
 * Moved here verbatim from `MetricsPanel.tsx` (guided-results-view, strides-kgi.5) so that both
 * results views read the SAME copy. The alternative was a second thirteen-string table in the guided
 * view, and two tables of prose that are meant to say the same thing drift the first time someone
 * edits one of them — with nothing failing, because both still render a sentence. `MetricsPanel`
 * renders exactly the DOM it rendered before the move; its own test suite is the proof.
 */
export const METRIC_DESCRIPTIONS: Record<MetricId, string> = {
  verticalOscillation:
    'How much your hips bounce up and down with each step, as a percentage of your own torso length — the denominator is your body, so it compares across runners of different heights.',
  verticalRatio:
    "How much you bounce up and down for every unit of distance each stride carries you — the denominator is your stride length. Same concept a running watch calls 'vertical ratio', though this figure hasn't been validated against a watch reading.",
  verticalOscillationCm:
    "How much your hips bounce up and down with each step, in real centimetres — no denominator at all. This is the same raw quantity a running watch reports as 'vertical oscillation', though this figure hasn't been validated against a watch reading. It needs a real-world scale measurement from the clip, so it isn't always available.",
  trunkLean:
    'How far your torso leans forward or backward relative to your direction of travel.',
  overstriding:
    'How far your foot lands ahead of your hips at footstrike, relative to your torso length — a proxy for braking-force risk. Measured at the footstrike instant this pipeline can detect, which tends to trail true ground contact — not a precise touchdown measurement; the note on this card says how to read the value.',
  cadence: 'How many steps per minute you take, both feet combined.',
  kneeFlexion:
    'How much your knee bends during the swing phase of your stride, both legs combined.',
  footStrikePattern:
    'Whether your foot tends to land heel-, midfoot-, or forefoot-first — approximated from ankle position relative to the knee at footstrike, not a direct foot-angle measurement.',
  stepWidth:
    "How far your foot lands from your body's midline at footstrike, as a percentage of your hip width. Positive means it lands on its own side; negative means it crosses toward or past the midline — sometimes called a crossover gait, a pattern some runners work on for stability, not a diagnosis.",
  stepWidthCm:
    "How far to the side of your hip midline your foot lands at each footstrike, in real centimetres. Positive means it lands on its own side; negative means it crosses toward or past the midline — sometimes called a crossover gait, a pattern some runners work on for stability, not a diagnosis. It needs a real-world scale measurement from the clip, so it isn't always available.",
  kneeDrive:
    'How high you lift your thigh at the peak of each stride — the angle between your thigh and vertical, both legs combined. A movement-amplitude measurement from the video only: it says how far the knee comes up, not how much force is behind it. Distinct from knee flexion, which measures how much the knee bends.',
  armSwingAmplitude:
    'How far your wrists travel up and down through one arm swing, as a percentage of your torso length, averaged across both arms. A movement-amplitude measurement from the video only: it says how big the swing is, not what it contributes to your stride.',
  swingFootLateralExcursion:
    'Sideways ankle travel relative to the same-side knee during early-to-mid swing, as a percentage of hip width. This describes the foot path seen from front or rear video, not heel rotation or a diagnosis.',
}

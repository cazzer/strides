import type { EvidenceFramePlan } from './evidenceFrames'
import { METRIC_LABELS } from './metricConfidence'

/**
 * The words that go around an evidence image, wherever it renders.
 *
 * Lifted out of `EvidenceGallery.tsx` unchanged (inline-annotated-evidence, `strides-ac9.2`) so
 * that the metric card and that component would caption the same picture with the same sentence
 * rather than each growing its own copy. The component was then deleted (`strides-ac9.3`); these
 * strings were not, and the spec's migration note keeps them "verbatim in intent", so they live
 * here rather than in the component that went away. The card is the only caller today.
 */

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)} s`
}

/**
 * The caption a reader actually needs: what the picture shows, and when in the clip it happened.
 *
 * `plan.label` is the metric's own words for the instant (it already names the side where the
 * measurement has one), so the caption never re-derives what a metric measured from its id — and
 * never restates the card's own number, which the honesty requirement forbids: what is drawn is a
 * per-instant measurement, not the aggregate the card reports.
 *
 * A ghosted pair gets no sentence disclaiming that it is one runner rather than two people. Every
 * paired label this repo emits already says one instant is *ghosted against* another, which names a
 * single subject at two moments; the disclaimer restated it at four times the length, under an image
 * that is now a thumbnail in a card rather than the standalone figure it was written for. `altFor`
 * below keeps the framing, because alt text is read with none of that card around it.
 */
export function captionFor(plan: EvidenceFramePlan): string {
  const parts = [`${plan.label}.`]
  if (plan.ghost !== null) {
    parts.push(
      `${formatSeconds(plan.base.timestamp)} and ${formatSeconds(plan.ghost.timestamp)} into the clip.`,
    )
  } else if (plan.demotedFromPair) {
    parts.push(
      'Shown as one frame: the paired instant was too similar to tell apart.',
      `${formatSeconds(plan.base.timestamp)} into the clip.`,
    )
  } else {
    parts.push(`A single frame, ${formatSeconds(plan.base.timestamp)} into the clip.`)
  }
  return parts.join(' ')
}

/** Standalone description for the canvas, which carries no text of its own. Names the metric
 * because alt text is read out of context, unlike the caption sitting under its section heading.
 *
 * A blended image is not symmetric and has not been since `weight-evidence-ghost-below-base`: the
 * photograph is weighted toward its base instant and the base's annotation marks are drawn solid
 * against the ghost's faded ones. A sighted reader gets "this one is the subject" twice over, from
 * the weighting and from the marks. Neither reaches a reader who cannot see the image, so the shape
 * sentence says which of the two the card's measurement is about. Every paired `label` this repo
 * emits is "X, ghosted against Y" with the base first — see `bounceInstants`, `kneeFlexion`,
 * `overstriding`, `trunkLean` — so naming the first instant is general, not a per-metric claim. */
export function altFor(plan: EvidenceFramePlan): string {
  const side = plan.side === undefined ? '' : ` (${plan.side} side)`
  const shape =
    plan.ghost === null
      ? 'A single frame from the clip.'
      : 'Two frames of the same runner blended into one image: the first instant named above is ' +
        'shown solid, the second faded behind it.'
  return `${METRIC_LABELS[plan.metric]}${side}: ${plan.label}. ${shape}`
}

/**
 * Which clip an image came from, or `null` on a single-clip session where the question does not
 * arise. `multi-clip-analysis/spec.md` requires this be sayable wherever evidence renders, and a
 * metric's evidence legitimately comes from a different clip than its neighbour's.
 */
export function provenanceFor(clipIndex: number, clipCount: number): string | null {
  return clipCount > 1 ? `From clip ${clipIndex + 1} of ${clipCount}.` : null
}

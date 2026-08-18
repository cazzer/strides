import type { EvidenceFramePlan } from './evidenceFrames'
import { METRIC_LABELS } from './metricConfidence'

/**
 * The words that go around an evidence image, wherever it renders.
 *
 * Lifted out of `EvidenceGallery.tsx` unchanged (inline-annotated-evidence, `strides-ac9.2`) so the
 * metric card and the gallery caption the same picture with the same sentence rather than each
 * growing its own copy. The gallery is scheduled for deletion (`strides-ac9.3`); these strings are
 * not, and the spec's migration note keeps them "verbatim in intent", so they live here rather than
 * in the component that goes away.
 */

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)} s`
}

/**
 * The caption a reader actually needs: what the picture shows, and — for a ghost — the fact that
 * the two overlapping bodies are ONE runner at two instants. That sentence is not decoration: a
 * double exposure of a person against themself is trivially misread as two people, and this
 * feature's whole claim is "here is your own run", not "here is a crowd".
 *
 * `plan.label` is the metric's own words for the instant (it already names the side where the
 * measurement has one), so the caption never re-derives what a metric measured from its id — and
 * never restates the card's own number, which the honesty requirement forbids: what is drawn is a
 * per-instant measurement, not the aggregate the card reports.
 */
export function captionFor(plan: EvidenceFramePlan): string {
  const parts = [`${plan.label}.`]
  if (plan.ghost !== null) {
    parts.push(
      'The two overlapping positions are the same runner at two instants of the same run, blended into one image — not two people.',
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
 * because alt text is read out of context, unlike the caption sitting under its section heading. */
export function altFor(plan: EvidenceFramePlan): string {
  const side = plan.side === undefined ? '' : ` (${plan.side} side)`
  const shape =
    plan.ghost === null
      ? 'A single frame from the clip.'
      : 'Two frames of the same runner blended into one image.'
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

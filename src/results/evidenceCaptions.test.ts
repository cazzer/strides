import { describe, expect, it } from 'vitest'

import { altFor, captionFor, provenanceFor } from './evidenceCaptions'
import type { EvidenceFramePlan, EvidenceInstantPlan } from './evidenceFrames'
import type { MetricId } from '../heuristics/types'

/**
 * `altFor` and `captionFor` had no direct test until `strides-zfk`. They were covered only
 * transitively, through one `getByRole('img', { name: … })` assertion in `MetricsPanel.test.tsx`,
 * which pins the rendered string but exercises neither function's branching: the single-frame
 * shape, the demoted-pair shape and the per-side clause were all unasserted anywhere.
 */

function instant(timestamp: number, opacity = 1): EvidenceInstantPlan {
  return { timestamp, opacity, keypoints: [], outwardSign: null, side: null }
}

function framePlan(
  metric: MetricId,
  overrides: Partial<EvidenceFramePlan> = {},
): EvidenceFramePlan {
  return {
    metric,
    kind: 'footStrike',
    quality: 0.8,
    label: 'heel-like footstrike, left foot',
    side: 'left',
    base: instant(0.4),
    ghost: null,
    crop: { x: 0, y: 0, side: 200 },
    travelDirection: 1,
    demotion: null,
    cropGrowth: null,
    ...overrides,
  }
}

describe('altFor', () => {
  it('names which blended instant is the subject, since the weighting that says so is invisible', () => {
    const alt = altFor(
      framePlan('trunkLean', {
        side: undefined,
        label: 'Most forward trunk lean, ghosted against the most upright frame',
        base: instant(0.2),
        ghost: instant(0.6, 0.35),
      }),
    )

    // The point of the ticket: a sighted reader learns which instant is the subject twice over --
    // from the 65/35 photographic weighting and from the solid-vs-faded marks. Neither reaches a
    // reader who cannot see the image, so the sentence has to carry it.
    expect(alt).toContain('the first instant named above is shown solid, the second faded behind it')
  })

  it('does not claim an emphasis a single-frame image cannot have', () => {
    const alt = altFor(framePlan('footStrikePattern'))

    expect(alt).toContain('A single frame from the clip.')
    expect(alt).not.toContain('faded behind it')
    expect(alt).not.toContain('blended')
  })

  it('describes a pair demoted to its base as a single frame, not as a blend', () => {
    // A demoted pair carries ghost: null, so nothing is blended and there is no second instant to
    // point at. Claiming one would describe an image that is not on screen.
    const alt = altFor(framePlan('kneeFlexion', { ghost: null, demotion: 'collapsed-pair' }))

    expect(alt).toContain('A single frame from the clip.')
    expect(alt).not.toContain('faded behind it')
  })

  it('names the metric and the side, because alt text is read with no card around it', () => {
    expect(altFor(framePlan('footStrikePattern', { side: 'right' }))).toContain('(right side)')
    expect(altFor(framePlan('trunkLean', { side: undefined }))).not.toContain('side)')
  })
})

describe('captionFor', () => {
  it('gives both timestamps for a blend and never disclaims that it is one runner', () => {
    const caption = captionFor(
      framePlan('trunkLean', {
        side: undefined,
        label: 'Most forward trunk lean, ghosted against the most upright frame',
        base: instant(0.2),
        ghost: instant(0.6, 0.35),
      }),
    )

    expect(caption).toContain('0.20 s and 0.60 s into the clip')
    // The label already says one instant is *ghosted against* another, which names a single subject
    // at two moments; the spec forbids a second sentence restating it.
    expect(caption).not.toMatch(/not two people/i)
    expect(caption).not.toMatch(/same runner/i)
  })

  it('says why a demoted pair shows one frame, rather than silently showing one', () => {
    const caption = captionFor(framePlan('kneeFlexion', { ghost: null, demotion: 'collapsed-pair' }))

    expect(caption).toContain('the paired instant was too similar to tell apart')
  })

  it('does not caption a far-apart demotion as a near-identical one', () => {
    // The exact inversion `strides-ddj` is about: a pair a full step apart on a 4K side view is
    // the OPPOSITE of "too similar", and one boolean could only ever say one of the two. The
    // negative assertion is the load-bearing half — a reason that fell through to the collapsed
    // sentence would still contain a plausible-sounding explanation.
    const caption = captionFor(
      framePlan('overstriding', { ghost: null, demotion: 'far-apart-pair' }),
    )

    expect(caption).toContain('the paired instant was too far away to share a legible crop')
    expect(caption).not.toContain('too similar')
  })

  it('states the far-apart guard in spatial terms, never in elapsed time', () => {
    // `EVIDENCE_MAX_PAIR_CROP_GROWTH` explicitly rejects elapsed time as the measure at this end
    // of the range — a stationary subject seconds apart ghosts perfectly. A caption that blamed
    // the clock would describe a criterion the code does not apply.
    const caption = captionFor(
      framePlan('trunkLean', { ghost: null, demotion: 'far-apart-pair' }),
    )

    expect(caption).not.toMatch(/too (long|far apart in time)|seconds apart|later in the clip/i)
  })
})

describe('provenanceFor', () => {
  it('is null on a single-clip session, where the question does not arise', () => {
    expect(provenanceFor(0, 1)).toBeNull()
  })

  it('is one-based, so it reads as a person would count clips', () => {
    expect(provenanceFor(1, 3)).toBe('From clip 2 of 3.')
  })
})

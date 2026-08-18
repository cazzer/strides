import { describe, expect, it } from 'vitest'
import {
  clipHostsLiveElement,
  describeClipStripStatus,
  type ClipStripCondition,
  type ClipStripStatusInput,
} from './clipStripStatus'
import type { ScalePassStatus } from './types'

function input(overrides: Partial<ClipStripStatusInput> = {}): ClipStripStatusInput {
  return {
    videoStatus: 'ready',
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    scalePassStatus: 'idle',
    isActiveClip: false,
    ...overrides,
  }
}

describe('describeClipStripStatus', () => {
  it('reports each clip’s own phase and progress', () => {
    expect(describeClipStripStatus(input({ phase: 'sampling', progress: 0.42 }))).toMatchObject({
      condition: 'sampling',
      percent: 42,
      caption: '42%',
      announcement: 'Analyzing… 42%',
    })
    expect(describeClipStripStatus(input({ phase: 'processing' })).condition).toBe('processing')
    expect(describeClipStripStatus(input({ phase: 'ready' })).condition).toBe('ready')
    expect(describeClipStripStatus(input({ phase: 'error' })).condition).toBe('error')
  })

  it('distinguishes queued from a clip that is about to start, by which one holds the detector', () => {
    // The whole reason `queued` is derived rather than a `phase`: `'idle'` means both things, and
    // only the session knows which clip `nextActiveClipIndex` currently points at.
    const queued = describeClipStripStatus(input({ isActiveClip: false }))
    const next = describeClipStripStatus(input({ isActiveClip: true }))

    expect(queued.condition).toBe('queued')
    expect(next.condition).toBe('idle')
    expect(queued.caption).not.toBe(next.caption)
    expect(queued.announcement).toMatch(/queued.*waiting for another clip/i)
  })

  it('reads a queued clip differently from an actively-sampling one', () => {
    const queued = describeClipStripStatus(input({ isActiveClip: false }))
    const sampling = describeClipStripStatus(
      input({ phase: 'sampling', progress: 0.5, isActiveClip: true }),
    )

    expect(queued.condition).not.toBe(sampling.condition)
    expect(queued.caption).not.toBe(sampling.caption)
    expect(queued.glyph).not.toBe(sampling.glyph)
    expect(queued.announcement).not.toBe(sampling.announcement)
  })

  it('gives every condition a distinct caption, so none is told apart by colour alone', () => {
    const byCondition: Record<ClipStripCondition, ClipStripStatusInput> = {
      loading: input({ videoStatus: 'loading' }),
      'load-error': input({ videoStatus: 'error' }),
      idle: input({ isActiveClip: true }),
      queued: input(),
      sampling: input({ phase: 'sampling', progress: 0.5 }),
      processing: input({ phase: 'processing' }),
      ready: input({ phase: 'ready' }),
      error: input({ phase: 'error' }),
    }

    const captions = new Set<string>()
    for (const [condition, args] of Object.entries(byCondition)) {
      const status = describeClipStripStatus(args)
      expect(status.condition).toBe(condition)
      captions.add(status.caption)
    }
    // 'error' and 'load-error' deliberately share the word "Failed" — they are the same fact to a
    // reader glancing at a thumbnail, and their announcements say which one it is.
    expect(captions.size).toBe(7)
  })

  it('carries the paused hint, on both phases that can be paused', () => {
    expect(
      describeClipStripStatus(
        input({ phase: 'sampling', progress: 0.2, isPausedMidAnalysis: true }),
      ).announcement,
    ).toMatch(/paused, resume playback to continue analyzing/i)
    expect(
      describeClipStripStatus(input({ phase: 'processing', isPausedMidAnalysis: true }))
        .announcement,
    ).toMatch(/paused/i)
    expect(
      describeClipStripStatus(input({ phase: 'sampling', progress: 0.2 })).announcement,
    ).not.toMatch(/paused/i)
  })

  it('never says "analysis complete" — that phrase belongs to the one session line', () => {
    // Not a style rule: `e2e/multiPersonAcquisition.spec.ts` and
    // `scripts/ab-person-selection.mjs` both wait on `getByText(/analysis complete/i)`, which is
    // strict. A second node carrying it turns their wait into a strict-mode violation.
    for (const args of Object.values({
      ready: input({ phase: 'ready' }),
      readyActive: input({ phase: 'ready', isActiveClip: true }),
    })) {
      const status = describeClipStripStatus(args)
      expect(`${status.caption} ${status.announcement}`).not.toMatch(/analysis complete/i)
    }
  })

  it('lets a real phase win over the video source behind it', () => {
    // A clip whose source errored but whose analysis somehow errored too reads as an analysis
    // failure, and a clip mid-analysis never reads as "loading".
    expect(describeClipStripStatus(input({ videoStatus: 'error', phase: 'error' })).condition).toBe(
      'error',
    )
    expect(
      describeClipStripStatus(input({ videoStatus: 'loading', phase: 'sampling', progress: 0.1 }))
        .condition,
    ).toBe('sampling')
    expect(describeClipStripStatus(input({ videoStatus: 'error' })).condition).toBe('load-error')
    expect(describeClipStripStatus(input({ videoStatus: 'empty' })).condition).toBe('loading')
  })

  it('survives a progress value the sampler should never have produced', () => {
    expect(describeClipStripStatus(input({ phase: 'sampling', progress: NaN })).percent).toBe(0)
    expect(describeClipStripStatus(input({ phase: 'sampling', progress: -1 })).percent).toBe(0)
    expect(describeClipStripStatus(input({ phase: 'sampling', progress: 4 })).percent).toBe(100)
  })
})

describe('clipHostsLiveElement', () => {
  it('is true for the whole primary run', () => {
    expect(clipHostsLiveElement('sampling', 'idle')).toBe(true)
    expect(clipHostsLiveElement('processing', 'idle')).toBe(true)
  })

  it('stays true past `ready` for as long as the scale pass is still reading the element', () => {
    // The scale pass replays and re-samples the SAME canonical element on the playback path
    // (`useVideoAnalysis`'s scale-pass block), after `phase` has already reached 'ready'.
    // Concealing at 'ready' would hand that pass the same ~20% loss the primary run was spared.
    expect(clipHostsLiveElement('ready', 'pending')).toBe(true)
    expect(clipHostsLiveElement('ready', 'running')).toBe(true)
  })

  it('is false once nothing is reading frames off it', () => {
    for (const terminal of ['done', 'failed', 'skipped'] satisfies ScalePassStatus[]) {
      expect(clipHostsLiveElement('ready', terminal)).toBe(false)
    }
    expect(clipHostsLiveElement('idle', 'idle')).toBe(false)
    expect(clipHostsLiveElement('error', 'idle')).toBe(false)
  })
})

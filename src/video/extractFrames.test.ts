import { describe, expect, it, vi } from 'vitest'
import type { MetricId } from '../heuristics/types'
import type {
  ClipEvidencePlan,
  EvidenceFramePlan,
} from '../results/evidenceFrames'
import {
  EVIDENCE_BASE_OPACITY,
  EVIDENCE_GHOST_OPACITY,
} from '../results/evidenceFrames'
import { stubCanvas2DContext } from '../test/canvasTestUtils'
import type { FakeCanvasRenderingContext2D } from '../test/canvasTestUtils'
import { makeVideoSeekable } from '../test/videoTestUtils'
import { stubRequestVideoFrameCallback } from '../test/videoFrameCallbackTestUtils'
import {
  EVIDENCE_OUTPUT_MAX_SIDE_PX,
  extractClipEvidence,
  extractPlannedFrames,
  extractSessionEvidence,
  waitForPresentedFrame,
} from './extractFrames'

/**
 * A WIRING smoke test, deliberately: everything decidable about evidence frames is decided in
 * `evidenceFrames.ts` and unit-tested there against no DOM at all. What is left here is that the
 * plan reaches real draw calls — the right timestamps seeked, the right rectangle passed, the
 * right opacities in force — plus the failure paths that must degrade to a named reason rather
 * than a hung promise.
 *
 * **Never pixels.** jsdom ships no canvas and this repo refuses the `canvas` npm package
 * (`canvasTestUtils.ts`), so the context here is a bag of `vi.fn()`s. Whether the composite
 * actually LOOKS like one runner at two instants is #68's live-browser job.
 */

const ALL_METRICS: MetricId[] = [
  'verticalOscillation',
  'verticalRatio',
  'verticalOscillationCm',
  'trunkLean',
  'overstriding',
  'cadence',
  'kneeFlexion',
  'armSwingSymmetry',
  'footStrikePattern',
  'stepWidth',
  'stepWidthCm',
]

const PAIR: EvidenceFramePlan = {
  metric: 'trunkLean',
  kind: 'trunkLeanRange',
  quality: 0.82,
  label: 'Most forward lean, ghosted against most upright',
  base: { timestamp: 1.5, opacity: EVIDENCE_BASE_OPACITY },
  ghost: { timestamp: 2.25, opacity: EVIDENCE_GHOST_OPACITY },
  crop: { x: 412, y: 130, side: 900 },
  demotedFromPair: false,
}

const SINGLE: EvidenceFramePlan = {
  metric: 'footStrikePattern',
  kind: 'footStrike',
  side: 'left',
  quality: 0.7,
  label: 'Left footstrike',
  base: { timestamp: 0.75, opacity: EVIDENCE_BASE_OPACITY },
  ghost: null,
  crop: { x: 0, y: 0, side: 320 },
  demotedFromPair: true,
}

/** Every metric no-evidence, then whatever the caller wants planned laid over the top — the plan
 * type is a total record and a missing key would be a different kind of bug. */
function planWith(
  items: Partial<Record<MetricId, EvidenceFramePlan[]>>,
): ClipEvidencePlan {
  const plan = {} as ClipEvidencePlan
  for (const metric of ALL_METRICS) {
    const planned = items[metric]
    plan[metric] = planned
      ? { status: 'planned', items: planned }
      : { status: 'no-evidence', reason: 'not-emitted' }
  }
  return plan
}

/**
 * A `<video>` that behaves enough like a real one to drive the extractor: `currentTime` assignment
 * dispatches `seeked` (`makeVideoSeekable`), and the repo's `requestVideoFrameCallback` stub is
 * wrapped to fire itself on the next microtask rather than waiting for a manual `fire()` — the
 * extractor awaits that callback inline, so a test that had to interleave with it would be
 * asserting on its own pump loop.
 *
 * `presentFrames: false` is the interesting arm, not a degenerate one: it is exactly what real
 * Chromium does after a PAUSED seek, where `requestVideoFrameCallback` never fires at all (#59).
 */
function seekableVideo({ presentFrames = true } = {}): {
  video: HTMLVideoElement
  registrationCount: () => number
} {
  const video = document.createElement('video')
  makeVideoSeekable(video)
  const controller = stubRequestVideoFrameCallback(video)
  const register = video.requestVideoFrameCallback.bind(video)
  video.requestVideoFrameCallback = ((callback: VideoFrameRequestCallback) => {
    const handle = register(callback)
    if (presentFrames) queueMicrotask(() => controller.fire(video.currentTime))
    return handle
  }) as HTMLVideoElement['requestVideoFrameCallback']
  return { video, registrationCount: controller.registrationCount }
}

/** Records `globalAlpha` as it stood at each `drawImage`, which is the only way to observe it —
 * the fake context is a plain object and the property is overwritten before the next call. */
function recordAlphas(ctx: FakeCanvasRenderingContext2D): number[] {
  const alphas: number[] = []
  ctx.drawImage.mockImplementation(() => {
    alphas.push(ctx.globalAlpha)
  })
  return alphas
}

describe('extractPlannedFrames', () => {
  it('blends a pair into one canvas at the plan opacities, through the plan crop rect', async () => {
    const ctx = stubCanvas2DContext()
    const alphas = recordAlphas(ctx)
    const { video, registrationCount } = seekableVideo()

    const evidence = await extractPlannedFrames(
      video,
      planWith({ trunkLean: [PAIR] }),
    )

    expect(evidence.trunkLean).toEqual({
      status: 'extracted',
      items: [{ plan: PAIR, canvas: expect.any(HTMLCanvasElement) }],
    })
    // Two frames composited into the ONE canvas the single returned item carries.
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
    expect(alphas).toEqual([EVIDENCE_BASE_OPACITY, EVIDENCE_GHOST_OPACITY])

    // Nine-argument form: only the crop rect is read, and the destination is the display crop —
    // never a full-frame canvas (design R3).
    const expectedArgs = [
      video,
      PAIR.crop.x,
      PAIR.crop.y,
      PAIR.crop.side,
      PAIR.crop.side,
      0,
      0,
      EVIDENCE_OUTPUT_MAX_SIDE_PX,
      EVIDENCE_OUTPUT_MAX_SIDE_PX,
    ]
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, ...expectedArgs)
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, ...expectedArgs)
    // One `requestVideoFrameCallback` per seek: `seeked` says the seek completed, not that the
    // new frame is composited (design D11).
    expect(registrationCount()).toBe(2)
  })

  it('seeks each planned instant, offset by the calibration hook and nothing else', async () => {
    stubCanvas2DContext()
    const { video } = seekableVideo()
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    await extractPlannedFrames(video, planWith({ trunkLean: [PAIR] }), {
      seekOffsetSeconds: 0.033,
    })

    expect(seeked).toEqual([
      PAIR.base.timestamp + 0.033,
      PAIR.ghost!.timestamp + 0.033,
    ])
  })

  it('draws a single-instant exemplar once, and sizes the canvas to the crop when it is smaller than the cap', async () => {
    const ctx = stubCanvas2DContext()
    const alphas = recordAlphas(ctx)
    const { video } = seekableVideo()

    const evidence = await extractPlannedFrames(
      video,
      planWith({ footStrikePattern: [SINGLE] }),
    )

    expect(evidence.footStrikePattern.status).toBe('extracted')
    expect(alphas).toEqual([EVIDENCE_BASE_OPACITY])
    // 320 < 640: the crop is never upscaled to reach the cap.
    expect(ctx.drawImage).toHaveBeenCalledWith(
      video,
      0,
      0,
      320,
      320,
      0,
      0,
      320,
      320,
    )
  })

  it('passes a metric that planned nothing through with its own reason', async () => {
    stubCanvas2DContext()
    const evidence = await extractPlannedFrames(
      seekableVideo().video,
      planWith({ trunkLean: [PAIR] }),
    )
    expect(evidence.cadence).toEqual({
      status: 'no-evidence',
      reason: 'not-emitted',
    })
  })

  it('degrades to extraction-failed when a seek never fires seeked', async () => {
    stubCanvas2DContext()
    // A plain jsdom `<video>`: assigning `currentTime` dispatches nothing, so the seek can only
    // resolve via its timeout fallback — the "clip that never seeks" case, at 5ms instead of 2s.
    const video = document.createElement('video')
    let currentTime = 0
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value
      },
    })

    const evidence = await extractPlannedFrames(
      video,
      planWith({ trunkLean: [PAIR] }),
      { seekTimeoutMs: 5 },
    )

    expect(evidence.trunkLean).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
  })

  it('still draws when requestVideoFrameCallback never fires after the seek', async () => {
    const ctx = stubCanvas2DContext()
    const { video, registrationCount } = seekableVideo({ presentFrames: false })

    const evidence = await extractPlannedFrames(
      video,
      planWith({ trunkLean: [PAIR] }),
    )

    // The #59 regression, in one assertion: this is real Chromium's paused-seek behaviour, and
    // gating the draw on that callback failed EVERY metric on EVERY clip.
    expect(evidence.trunkLean.status).toBe('extracted')
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
    // The signal is still asked for first — it is a fallback chain, not a deletion.
    expect(registrationCount()).toBe(2)
  })

  it('still draws in a browser with no requestVideoFrameCallback at all', async () => {
    const ctx = stubCanvas2DContext()
    const video = document.createElement('video')
    makeVideoSeekable(video)
    expect(video.requestVideoFrameCallback).toBeUndefined()

    const evidence = await extractPlannedFrames(
      video,
      planWith({ footStrikePattern: [SINGLE] }),
    )

    expect(evidence.footStrikePattern.status).toBe('extracted')
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
  })

  it('draws an already-there instant without waiting for a frame that can never arrive', async () => {
    const ctx = stubCanvas2DContext()
    const { video, registrationCount } = seekableVideo({ presentFrames: false })
    // Park the element on the planned instant, so `seekTo` short-circuits to `'already-there'`.
    video.currentTime = SINGLE.base.timestamp

    const evidence = await extractPlannedFrames(
      video,
      planWith({ footStrikePattern: [SINGLE] }),
      // Long enough that reaching the backstop would blow vitest's own timeout — the assertion
      // that the wait is SKIPPED rather than merely survived.
      { presentationTimeoutMs: 30_000 },
    )

    expect(evidence.footStrikePattern.status).toBe('extracted')
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    // No seek means no new frame is coming, so no presentation signal is even asked for.
    expect(registrationCount()).toBe(0)
  })
})

describe('waitForPresentedFrame', () => {
  it('resolves on the presentation callback when the browser actually fires one', async () => {
    const { video } = seekableVideo()
    // The stub answers on the next microtask — ahead of any animation frame, so the real signal
    // wins the race wherever it works, which is the whole reason the arm is still here.
    await expect(waitForPresentedFrame(video, 30_000)).resolves.toBe(
      'video-frame-callback',
    )
  })

  it('falls through to an animation frame when the callback never fires', async () => {
    const { video } = seekableVideo({ presentFrames: false })
    // 30s backstop: only the animation-frame arm can resolve this inside the test timeout.
    await expect(waitForPresentedFrame(video, 30_000)).resolves.toBe(
      'animation-frame',
    )
  })

  it('cancels the pending frame callback once another arm has won', async () => {
    const { video } = seekableVideo({ presentFrames: false })
    const cancel = vi.spyOn(video, 'cancelVideoFrameCallback')
    await waitForPresentedFrame(video, 30_000)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('resolves on its own backstop when nothing paints', async () => {
    const { video } = seekableVideo({ presentFrames: false })
    // A document that never paints — a backgrounded tab throttles rAF to nothing, and without the
    // backstop this wait would simply never settle.
    vi.stubGlobal('requestAnimationFrame', undefined)
    try {
      await expect(waitForPresentedFrame(video, 5)).resolves.toBe('timed-out')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('extractClipEvidence', () => {
  it('degrades every planned metric when the clip has no source bytes', async () => {
    const plan = planWith({ trunkLean: [PAIR], footStrikePattern: [SINGLE] })
    const evidence = await extractClipEvidence({ sourceBlob: null, plan })

    expect(evidence.trunkLean).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
    expect(evidence.footStrikePattern).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
    expect(evidence.cadence).toEqual({
      status: 'no-evidence',
      reason: 'not-emitted',
    })
  })

  it('owns its object URL and revokes it even when the element never decodes', async () => {
    stubCanvas2DContext()
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:evidence')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    // jsdom never fires `loadeddata`, so this exercises the load-timeout path.
    const evidence = await extractClipEvidence(
      { sourceBlob: new Blob(['x']), plan: planWith({ trunkLean: [PAIR] }) },
      { loadTimeoutMs: 5 },
    )

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).toHaveBeenCalledWith('blob:evidence')
    expect(evidence.trunkLean).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })

    createSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('extracts clips strictly one at a time', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const results = await extractSessionEvidence(
      [
        { sourceBlob: null, plan: planWith({ trunkLean: [PAIR] }) },
        { sourceBlob: null, plan: planWith({ stepWidth: [SINGLE] }) },
      ],
      { loadTimeoutMs: 5 },
    )

    expect(results).toHaveLength(2)
    expect(results[0].trunkLean.status).toBe('no-evidence')
    expect(results[1].stepWidth.status).toBe('no-evidence')
    revokeSpy.mockRestore()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetricId } from '../heuristics/types'
import type {
  ClipEvidencePlan,
  EvidenceFramePlan,
  EvidenceInstantPlan,
} from '../results/evidenceFrames'
import {
  EVIDENCE_BASE_OPACITY,
  EVIDENCE_GHOST_BLEND_ALPHA,
} from '../results/evidenceFrames'
import { stubCanvas2DContext } from '../test/canvasTestUtils'
import type { FakeCanvasRenderingContext2D } from '../test/canvasTestUtils'
import { makeVideoSeekable } from '../test/videoTestUtils'
import { stubRequestVideoFrameCallback } from '../test/videoFrameCallbackTestUtils'
const { resolveEvidenceSeekOffsetSecondsMock } = vi.hoisted(() => ({
  resolveEvidenceSeekOffsetSecondsMock: vi.fn(),
}))

// The derivation itself is tested against controlled containers in `evidenceSeekOffset.test.ts`;
// mocked here so this file keeps asserting WIRING (does the derived number reach the seek) rather
// than re-testing edit-list parsing through a fake blob that carries no container at all.
vi.mock('./evidenceSeekOffset', () => ({
  resolveEvidenceSeekOffsetSeconds: resolveEvidenceSeekOffsetSecondsMock,
}))

import {
  DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS,
  EVIDENCE_OUTPUT_MAX_SIDE_PX,
  extractClipEvidence,
  extractPlannedFrames,
  extractSessionEvidence,
  waitForPresentedFrame,
} from './extractFrames'

beforeEach(() => {
  resolveEvidenceSeekOffsetSecondsMock.mockReset()
  resolveEvidenceSeekOffsetSecondsMock.mockResolvedValue(0)
})

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

/**
 * The annotation inputs a plan carries. This module reads NONE of them — it seeks, crops and
 * composites, and every mark drawn from these is the annotation layer's job — but they are
 * required fields, so the fixtures carry realistic ones rather than empty stand-ins that could
 * never come out of `planExemplarFrames`.
 */
const HIP_KEYPOINTS: EvidenceInstantPlan['keypoints'] = [
  { name: 'left_hip', status: 'detected', x: 800, y: 540 },
  { name: 'right_hip', status: 'interpolated', x: 900, y: 545 },
]
const HIP_SIGNS: EvidenceInstantPlan['outwardSign'] = { left: -1, right: 1 }

const PAIR: EvidenceFramePlan = {
  metric: 'trunkLean',
  kind: 'trunkLeanRange',
  quality: 0.82,
  label: 'Most forward lean, ghosted against most upright',
  base: {
    timestamp: 1.5,
    opacity: EVIDENCE_BASE_OPACITY,
    keypoints: HIP_KEYPOINTS,
    outwardSign: HIP_SIGNS,
    side: null,
  },
  ghost: {
    timestamp: 2.25,
    opacity: EVIDENCE_GHOST_BLEND_ALPHA,
    keypoints: HIP_KEYPOINTS,
    outwardSign: HIP_SIGNS,
    side: null,
  },
  crop: { x: 412, y: 130, side: 900 },
  travelDirection: 1,
  demotedFromPair: false,
}

const SINGLE: EvidenceFramePlan = {
  metric: 'footStrikePattern',
  kind: 'footStrike',
  side: 'left',
  quality: 0.7,
  label: 'Left footstrike',
  base: {
    timestamp: 0.75,
    opacity: EVIDENCE_BASE_OPACITY,
    keypoints: [
      { name: 'left_ankle', status: 'detected', x: 120, y: 900 },
      { name: 'left_knee', status: 'unrecoverable' },
    ],
    outwardSign: null,
    side: 'left',
  },
  ghost: null,
  crop: { x: 0, y: 0, side: 320 },
  travelDirection: -1,
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

interface RecordedDraw {
  call: 'drawImage' | 'clearRect' | 'fill'
  alpha: number
  /** Which instant this call drew, read off the element at draw time. */
  sourceTime: number
  composite: string
}

/**
 * An ordered log of the calls that put pixels on the canvas, each stamped with the context state in
 * force at the time — the only way to observe that state, since the fake context is a plain object
 * whose properties are overwritten before the next call.
 *
 * The log, rather than a list of alphas: alphas alone say nothing about ORDER, and reversing the two
 * photographic draws does not change them while changing the image completely — a base drawn last
 * at full opacity ERASES the ghost rather than reweighting it. `clearRect`/`fill` are logged so an
 * erase inserted between the two draws breaks the photographic prefix instead of hiding behind it.
 */
function recordDraws(
  ctx: FakeCanvasRenderingContext2D,
  video: HTMLVideoElement,
): RecordedDraw[] {
  const draws: RecordedDraw[] = []
  const record = (call: RecordedDraw['call']) => () => {
    draws.push({
      call,
      alpha: ctx.globalAlpha,
      sourceTime: video.currentTime,
      composite: ctx.globalCompositeOperation,
    })
  }
  ctx.drawImage.mockImplementation(record('drawImage'))
  ctx.clearRect.mockImplementation(record('clearRect'))
  ctx.fill.mockImplementation(record('fill'))
  return draws
}

/**
 * The weight each drawn instant ends up carrying in the finished image, by replaying the log through
 * `source-over` onto a transparent canvas: `out = α·src + (1 − α)·dst`.
 *
 * Test-local on purpose. The draw path does not use a reducer — it issues canvas calls — so a shared
 * helper would be a second model of the same thing, free to drift from the one that ships. What this
 * models is verified against the real compositor by live PSNR, not here
 * (`openspec/changes/weight-evidence-ghost-below-base/design.md` D4).
 */
function compositeWeights(draws: RecordedDraw[]): Map<number, number> {
  const weights = new Map<number, number>()
  for (const draw of draws.filter((d) => d.call === 'drawImage')) {
    // The reducer models one compositing mode. Under `'copy'` the same log really yields 100% of
    // the last draw, so replaying it as source-over would report a split that never happened.
    if (draw.composite !== 'source-over') {
      throw new Error(`compositeWeights models source-over, got ${draw.composite}`)
    }
    for (const [time, weight] of weights) {
      weights.set(time, weight * (1 - draw.alpha))
    }
    weights.set(
      draw.sourceTime,
      (weights.get(draw.sourceTime) ?? 0) + draw.alpha,
    )
  }
  return weights
}

/**
 * The `currentTime` an instant is drawn at, derived the way `drawInstant` derives its seek target
 * rather than assumed equal to the timestamp. The two coincide only while the default offset is
 * zero; hard-coding the bare timestamp would break these assertions the day it isn't, for a reason
 * that has nothing to do with what they test.
 */
function drawnTimeOf(instant: EvidenceInstantPlan): number {
  return Math.max(0, instant.timestamp + DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS)
}

describe('extractPlannedFrames', () => {
  it('blends a pair into one canvas at the plan opacities, through the plan crop rect', async () => {
    const ctx = stubCanvas2DContext()
    const { video, registrationCount } = seekableVideo()
    const draws = recordDraws(ctx, video)

    const evidence = await extractPlannedFrames(
      video,
      planWith({ trunkLean: [PAIR] }),
    )

    expect(evidence.trunkLean).toEqual({
      status: 'extracted',
      items: [{ plan: PAIR, canvas: expect.any(HTMLCanvasElement) }],
    })
    // Two frames composited into the ONE canvas the single returned item carries — the base first
    // and opaque, the ghost over it, both compositing rather than replacing. Everything after this
    // prefix belongs to the annotation layer.
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
    expect(draws.slice(0, 2)).toEqual([
      {
        call: 'drawImage',
        alpha: EVIDENCE_BASE_OPACITY,
        sourceTime: drawnTimeOf(PAIR.base),
        composite: 'source-over',
      },
      {
        call: 'drawImage',
        alpha: EVIDENCE_GHOST_BLEND_ALPHA,
        sourceTime: drawnTimeOf(PAIR.ghost!),
        composite: 'source-over',
      },
    ])

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

  it('composites a ghosted pair to a 65/35 split of the two instants', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const draws = recordDraws(ctx, video)

    await extractPlannedFrames(video, planWith({ trunkLean: [PAIR] }))

    const weights = compositeWeights(draws)
    expect(Object.fromEntries(weights)).toEqual({
      [drawnTimeOf(PAIR.base)]: 1 - EVIDENCE_GHOST_BLEND_ALPHA,
      [drawnTimeOf(PAIR.ghost!)]: EVIDENCE_GHOST_BLEND_ALPHA,
    })
    // Sums to one: nothing of the canvas is left unpainted, and neither draw was dropped.
    expect([...weights.values()].reduce((sum, weight) => sum + weight, 0)).toBe(1)
  })

  it('composites the base instant at strictly more weight than the ghost', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const draws = recordDraws(ctx, video)

    await extractPlannedFrames(video, planWith({ trunkLean: [PAIR] }))

    // The invariant this weighting exists for, asserted independently of the number that satisfies
    // it: the caption names one instant as the subject and the annotation draws that instant's
    // marks solid, so the photograph underneath must not pick the other one — or nobody
    // (`strides-c37`). Flattening the emphasis means deleting a test that says why not to.
    const weights = compositeWeights(draws)
    expect(weights.get(drawnTimeOf(PAIR.base))!).toBeGreaterThan(
      weights.get(drawnTimeOf(PAIR.ghost!))!,
    )
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
    const { video } = seekableVideo()
    const draws = recordDraws(ctx, video)

    const evidence = await extractPlannedFrames(
      video,
      planWith({ footStrikePattern: [SINGLE] }),
    )

    expect(evidence.footStrikePattern.status).toBe('extracted')
    // An unghosted exemplar is untouched by the ghost's blend weight: one opaque draw.
    expect(draws.slice(0, 1)).toEqual([
      {
        call: 'drawImage',
        alpha: EVIDENCE_BASE_OPACITY,
        sourceTime: SINGLE.base.timestamp,
        composite: 'source-over',
      },
    ])
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

  /**
   * Makes EVERY `<video>` — including the detached one `extractClipEvidence` mints for itself,
   * which no test can reach to patch individually — report decoded data and dispatch `seeked` on
   * a `currentTime` assignment. The per-element `makeVideoSeekable` above cannot serve here for
   * exactly that reason: the element under test is created inside the function under test.
   */
  function makeAllVideosSeekable(): { seeked: number[]; restore: () => void } {
    const proto = HTMLMediaElement.prototype
    const originals = (['readyState', 'currentTime'] as const).map((key) => ({
      key,
      descriptor: Object.getOwnPropertyDescriptor(proto, key),
    }))
    const times = new WeakMap<HTMLMediaElement, number>()
    // Recorded in the setter, not from a `seeked` listener: the element is detached, so its events
    // never reach `document` and there is no handle on it to listen to directly.
    const seeked: number[] = []
    Object.defineProperty(proto, 'readyState', {
      configurable: true,
      get: () => 2, // HAVE_CURRENT_DATA — short-circuits `waitForDecodedData`.
    })
    Object.defineProperty(proto, 'currentTime', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return times.get(this) ?? 0
      },
      set(this: HTMLMediaElement, value: number) {
        times.set(this, value)
        seeked.push(value)
        this.dispatchEvent(new Event('seeked'))
      },
    })
    const restore = () => {
      for (const { key, descriptor } of originals) {
        if (descriptor === undefined) delete (proto as unknown as Record<string, unknown>)[key]
        else Object.defineProperty(proto, key, descriptor)
      }
    }
    return { seeked, restore }
  }

  /**
   * The seek calibration is DERIVED from the clip's own bytes, not read off a constant (gh #69):
   * the value is per clip (its own edit list) and per sampler (0 whenever the `<video>` path ran),
   * so no single number can be right. This asserts the derived value actually reaches the seek.
   */
  it('seeks by the offset derived from this clip, not by a constant', async () => {
    stubCanvas2DContext()
    const { seeked, restore } = makeAllVideosSeekable()
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    resolveEvidenceSeekOffsetSecondsMock.mockResolvedValue(-0.08)

    try {
      const sourceBlob = new Blob(['x'])
      const evidence = await extractClipEvidence({
        sourceBlob,
        plan: planWith({ trunkLean: [PAIR] }),
      })

      expect(resolveEvidenceSeekOffsetSecondsMock).toHaveBeenCalledWith(sourceBlob)
      expect(evidence.trunkLean.status).toBe('extracted')
      expect(seeked).toEqual([
        PAIR.base.timestamp - 0.08,
        PAIR.ghost!.timestamp - 0.08,
      ])
    } finally {
      restore()
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    }
  })

  it('lets an explicit offset win, and never derives one it was handed', async () => {
    stubCanvas2DContext()
    const { seeked, restore } = makeAllVideosSeekable()
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    try {
      await extractClipEvidence(
        { sourceBlob: new Blob(['x']), plan: planWith({ trunkLean: [PAIR] }) },
        { seekOffsetSeconds: 0 },
      )

      expect(resolveEvidenceSeekOffsetSecondsMock).not.toHaveBeenCalled()
      expect(seeked).toEqual([PAIR.base.timestamp, PAIR.ghost!.timestamp])
    } finally {
      restore()
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    }
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

/**
 * The decoder's whole lifetime, bracketed: an object URL is minted before the element exists and
 * revoked after it is torn down, so an interleaved log is direct evidence of overlap. Same
 * instrument `posterFrame.test.ts` uses on `posterQueue`, pointed at `evidenceQueue`.
 */
function bracketDecoders(): {
  log: string[]
  minted: () => number
  restore: () => void
} {
  const log: string[] = []
  let minted = 0
  const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    minted += 1
    log.push(`open:${minted}`)
    return `blob:evidence-${minted}`
  })
  const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    log.push(`close:${String(url).replace('blob:evidence-', '')}`)
  })
  return {
    log,
    minted: () => minted,
    restore: () => {
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    },
  }
}

function clip(plan = planWith({ trunkLean: [PAIR] })) {
  return { sourceBlob: new Blob(['x']), plan }
}

describe('extractSessionEvidence', () => {
  it('opens one detached decoder at a time across SEPARATE overlapping passes', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()

    // The bug this guards: the gallery starts a whole new pass whenever its input signature
    // changes, which it legitimately does mid-session when the scale pass grafts
    // `verticalOscillationCm` in. Each pass's own `for await` orders only its OWN clips, so
    // nothing stopped the passes from doubling up — measured at three concurrent 4K decoders.
    await Promise.all([
      extractSessionEvidence([clip()], { loadTimeoutMs: 5 }),
      extractSessionEvidence([clip()], { loadTimeoutMs: 5 }),
    ])

    // Strictly paired, never nested: `open:2` cannot appear before `close:1`. Serialized by
    // construction inside `extractClipEvidence`, so no caller had to arrange it.
    expect(decoders.log).toEqual(['open:1', 'close:1', 'open:2', 'close:2'])
    decoders.restore()
  })

  it('interleaves multi-clip passes one clip at a time rather than doubling up', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()

    await Promise.all([
      extractSessionEvidence([clip(), clip()], { loadTimeoutMs: 5 }),
      extractSessionEvidence([clip(), clip()], { loadTimeoutMs: 5 }),
    ])

    // Which pass owns which slot is not the claim — "never two open at once" is. Every close
    // lands before the next open, whichever pass minted it.
    expect(decoders.log).toHaveLength(8)
    let open = 0
    let peak = 0
    for (const entry of decoders.log) {
      open += entry.startsWith('open:') ? 1 : -1
      peak = Math.max(peak, open)
    }
    expect(peak).toBe(1)
    expect(open).toBe(0)
    decoders.restore()
  })

  it('opens no decoder at all for a pass abandoned before it starts', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()
    const controller = new AbortController()
    controller.abort()

    const results = await extractSessionEvidence([clip(), clip()], {
      loadTimeoutMs: 5,
      signal: controller.signal,
    })

    expect(decoders.log).toEqual([])
    // Abandonment is a verdict, not a rejection or an empty list.
    expect(results).toHaveLength(2)
    expect(results[0].trunkLean).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
    expect(results[0].cadence).toEqual({ status: 'no-evidence', reason: 'not-emitted' })
    decoders.restore()
  })

  it('stops opening decoders for the clips behind an abandoned pass', async () => {
    stubCanvas2DContext()
    const controller = new AbortController()
    const log: string[] = []
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      log.push('open')
      // Abandoned the instant the first clip's decoder exists — a superseded pass must not go on
      // decoding the clips behind it for results already destined to be dropped on arrival.
      controller.abort()
      return 'blob:evidence'
    })
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      log.push('close')
    })

    await extractSessionEvidence([clip(), clip(), clip()], {
      loadTimeoutMs: 5,
      signal: controller.signal,
    })

    // One decoder opened, and released — not three, and not one held open.
    expect(log).toEqual(['open', 'close'])
    createSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('does not wedge the queue behind an abandoned pass', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()
    const controller = new AbortController()
    controller.abort()

    await extractSessionEvidence([clip()], {
      loadTimeoutMs: 5,
      signal: controller.signal,
    })
    // The pass that supersedes it still gets its turn — the whole point of abandoning the first.
    const results = await extractSessionEvidence([clip()], { loadTimeoutMs: 5 })

    expect(decoders.log).toEqual(['open:1', 'close:1'])
    expect(results[0].trunkLean).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
    decoders.restore()
  })
})

describe('abandoning an in-flight clip', () => {
  it('abandons the WHOLE clip at the next image boundary, never a partial one', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const controller = new AbortController()
    let drawn = 0
    ctx.drawImage.mockImplementation(() => {
      drawn += 1
      if (drawn === 1) controller.abort()
    })

    const evidence = await extractPlannedFrames(
      video,
      planWith({ trunkLean: [PAIR], footStrikePattern: [SINGLE] }),
      { signal: controller.signal },
    )

    // The pair whose base drew was already in flight and finishes its ghost — the check is per
    // IMAGE — but it is reported as failed rather than shipped: a half-extracted clip wearing an
    // `'extracted'` shape is a partial answer nothing downstream could tell apart from a whole one.
    expect(drawn).toBe(2)
    expect(evidence.trunkLean).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
    expect(evidence.footStrikePattern).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
    // A metric that never planned anything keeps the reason the plan gave it.
    expect(evidence.cadence).toEqual({ status: 'no-evidence', reason: 'not-emitted' })
  })

  it('changes nothing when no signal is supplied', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const draws = recordDraws(ctx, video)

    const evidence = await extractPlannedFrames(
      video,
      planWith({ trunkLean: [PAIR], footStrikePattern: [SINGLE] }),
    )

    expect(
      draws.filter((draw) => draw.call === 'drawImage').map((draw) => draw.alpha),
    ).toEqual([
      EVIDENCE_BASE_OPACITY,
      EVIDENCE_GHOST_BLEND_ALPHA,
      EVIDENCE_BASE_OPACITY,
    ])
    expect(evidence.trunkLean.status).toBe('extracted')
    expect(evidence.footStrikePattern.status).toBe('extracted')
  })
})

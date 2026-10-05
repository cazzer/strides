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
const { resolveEvidenceSeekCalibrationMock } = vi.hoisted(() => ({
  resolveEvidenceSeekCalibrationMock: vi.fn(),
}))

// The derivation itself is tested against controlled containers in `evidenceSeekOffset.test.ts`;
// mocked here so this file keeps asserting WIRING (do the derived numbers reach the seek) rather
// than re-testing edit-list parsing through a fake blob that carries no container at all.
vi.mock('./evidenceSeekOffset', () => ({
  resolveEvidenceSeekCalibration: resolveEvidenceSeekCalibrationMock,
}))

import {
  DEFAULT_EVIDENCE_MIDPOINT_OFFSET_SECONDS,
  DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS,
  EVIDENCE_OUTPUT_MAX_SIDE_PX,
  extractClipEvidence,
  extractPlannedFrames,
  extractSessionEvidence,
} from './extractFrames'

beforeEach(() => {
  resolveEvidenceSeekCalibrationMock.mockReset()
  resolveEvidenceSeekCalibrationMock.mockResolvedValue({
    offsetSeconds: 0,
    midpointOffsetSeconds: 0,
  })
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
  demotion: null,
  cropGrowth: 1.4,
  focusOffset: null,
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
  cropGrowth: null,
  demotion: 'collapsed-pair',
  focusOffset: null,
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
  return Math.max(
    0,
    instant.timestamp +
      DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS +
      DEFAULT_EVIDENCE_MIDPOINT_OFFSET_SECONDS,
  )
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

  it('composes the edit-list shift and the midpoint into one seek', async () => {
    stubCanvas2DContext()
    const { video } = seekableVideo()
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    await extractPlannedFrames(video, planWith({ footStrikePattern: [SINGLE] }), {
      seekOffsetSeconds: -0.5,
      midpointOffsetSeconds: 0.25,
    })

    expect(seeked).toEqual([SINGLE.base.timestamp - 0.25])
  })

  it('seeks INSIDE the frame the plan names, not to a boundary a whole microsecond cannot express', async () => {
    // `park-side-landscape.mp4`, measured: 15360 timescale, 60 fps, `elst media_time` 512, and a
    // sampler timestamp truncated to six decimals. Chromium truncates `currentTime` to integer
    // microseconds (measured: assigning 3.049999666666667 reads back 3.049999), so the old
    // boundary target floored into the PREVIOUS frame and drew an airborne foot. Half a frame
    // later lands mid-interval, correct under truncation and under round-to-nearest alike.
    stubCanvas2DContext()
    const { video } = seekableVideo()
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    const strike = (timestamp: number) => ({
      ...SINGLE,
      base: { ...SINGLE.base, timestamp },
    })

    await extractPlannedFrames(
      video,
      planWith({ footStrikePattern: [strike(3.083333), strike(3.433333)] }),
      { seekOffsetSeconds: -(512 / 15360), midpointOffsetSeconds: 1 / 120 },
    )

    // Asserted in the microsecond domain Chromium actually quantises to, not as an exact double:
    // the three-term sum carries a ulp (3.4083330000000003) that the quantisation erases, and
    // pinning the double would fail on arithmetic that is not the thing under test.
    expect(seeked.map((t) => Math.trunc(t * 1e6))).toEqual([3058333, 3408333])
    // Both land strictly inside their frame's interval — [3050000, 3066667) and
    // [3400000, 3416667) µs. Without the midpoint the target quantises to 3049999 µs, one
    // microsecond BELOW the boundary, which is the whole defect.
    expect(Math.trunc((3.083333 - 512 / 15360) * 1e6)).toBe(3049999)
  })

  it('never seeks before zero, whatever the offsets sum to', async () => {
    stubCanvas2DContext()
    const { video } = seekableVideo()
    // Parked away from zero first, so seeking to the clamped 0 is a real seek rather than
    // `seekTo`'s `'already-there'` short-circuit — which would make this assert nothing.
    video.currentTime = 1
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    await extractPlannedFrames(
      video,
      planWith({
        footStrikePattern: [{ ...SINGLE, base: { ...SINGLE.base, timestamp: 0 } }],
      }),
      { seekOffsetSeconds: -0.08, midpointOffsetSeconds: 1 / 120 },
    )

    expect(seeked).toEqual([0])
  })

  it('clamps the final frame to the clip end rather than seeking past it', async () => {
    stubCanvas2DContext()
    const { video } = seekableVideo()
    // The idiom `useVideoSource.test.ts` uses — jsdom's own `duration` is a read-only NaN.
    Object.defineProperty(video, 'duration', { configurable: true, value: 3.85 })
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    await extractPlannedFrames(
      video,
      planWith({
        footStrikePattern: [{ ...SINGLE, base: { ...SINGLE.base, timestamp: 3.848 } }],
      }),
      { seekOffsetSeconds: 0, midpointOffsetSeconds: 1 / 120 },
    )

    expect(seeked).toEqual([3.85])
  })

  it('declines to clamp against a duration the element does not really report', async () => {
    stubCanvas2DContext()
    // jsdom reports NaN; a live webcam recording reports Infinity. Comparing against either would
    // poison the target or never fire, so the browser's own clamp is left to do it.
    for (const duration of [Number.NaN, Infinity]) {
      const { video } = seekableVideo()
      Object.defineProperty(video, 'duration', { configurable: true, value: duration })
      const seeked: number[] = []
      video.addEventListener('seeked', () => seeked.push(video.currentTime))

      await extractPlannedFrames(
        video,
        planWith({
          footStrikePattern: [{ ...SINGLE, base: { ...SINGLE.base, timestamp: 9.5 } }],
        }),
        { seekOffsetSeconds: 0, midpointOffsetSeconds: 0.25 },
      )

      expect(seeked).toEqual([9.75])
    }
  })

  it('seeks the plan unchanged when handed an element and no options at all', async () => {
    // This entry point has a `<video>`, not a blob, so it has nothing to derive from — both terms
    // fall back to their zero defaults rather than being guessed.
    stubCanvas2DContext()
    const { video } = seekableVideo()
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    await extractPlannedFrames(video, planWith({ trunkLean: [PAIR] }))

    expect(seeked).toEqual([PAIR.base.timestamp, PAIR.ghost!.timestamp])
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

// `waitForPresentedFrame`'s own four tests moved to `videoElement.test.ts` with the function, and
// are unchanged there. What stays here is how THIS module uses it: that a real seek waits for a
// presentation signal and an `'already-there'` short-circuit does not (above).

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
  it('seeks by the calibration derived from this clip, not by a constant', async () => {
    stubCanvas2DContext()
    const { seeked, restore } = makeAllVideosSeekable()
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    resolveEvidenceSeekCalibrationMock.mockResolvedValue({
      offsetSeconds: -0.08,
      midpointOffsetSeconds: 0.02,
    })

    try {
      const sourceBlob = new Blob(['x'])
      const evidence = await extractClipEvidence({
        sourceBlob,
        plan: planWith({ trunkLean: [PAIR] }),
      })

      expect(resolveEvidenceSeekCalibrationMock).toHaveBeenCalledWith(sourceBlob)
      // One derivation per clip, not one per instant: the container parse is the expensive part.
      expect(resolveEvidenceSeekCalibrationMock).toHaveBeenCalledTimes(1)
      expect(evidence.trunkLean.status).toBe('extracted')
      expect(seeked).toEqual([
        PAIR.base.timestamp - 0.06,
        PAIR.ghost!.timestamp - 0.06,
      ])
    } finally {
      restore()
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    }
  })

  it('seeks the plan exactly when the clip yields no calibration — every WebM and webcam blob', async () => {
    stubCanvas2DContext()
    const { seeked, restore } = makeAllVideosSeekable()
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    try {
      await extractClipEvidence({
        sourceBlob: new Blob(['x']),
        plan: planWith({ trunkLean: [PAIR] }),
      })

      expect(seeked).toEqual([PAIR.base.timestamp, PAIR.ghost!.timestamp])
    } finally {
      restore()
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    }
  })

  it('lets explicit offsets win, and never derives ones it was handed', async () => {
    stubCanvas2DContext()
    const { seeked, restore } = makeAllVideosSeekable()
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    try {
      await extractClipEvidence(
        { sourceBlob: new Blob(['x']), plan: planWith({ trunkLean: [PAIR] }) },
        { seekOffsetSeconds: 0, midpointOffsetSeconds: 0 },
      )

      expect(resolveEvidenceSeekCalibrationMock).not.toHaveBeenCalled()
      expect(seeked).toEqual([PAIR.base.timestamp, PAIR.ghost!.timestamp])
    } finally {
      restore()
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    }
  })

  it('pins one term without pinning the other', async () => {
    // The two answer different questions, so a caller silencing the edit-list shift has said
    // nothing about the microsecond lattice — and would previously have lost both.
    stubCanvas2DContext()
    const { seeked, restore } = makeAllVideosSeekable()
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    resolveEvidenceSeekCalibrationMock.mockResolvedValue({
      offsetSeconds: -0.08,
      midpointOffsetSeconds: 0.02,
    })

    try {
      await extractClipEvidence(
        { sourceBlob: new Blob(['x']), plan: planWith({ trunkLean: [PAIR] }) },
        { seekOffsetSeconds: 0 },
      )

      expect(resolveEvidenceSeekCalibrationMock).toHaveBeenCalledTimes(1)
      expect(seeked).toEqual([
        PAIR.base.timestamp + 0.02,
        PAIR.ghost!.timestamp + 0.02,
      ])
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

    // The bug this guards: `useSessionEvidence` starts a whole new pass whenever its input signature
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
  it('abandons the WHOLE clip at the next SEEK, never a partial one', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const controller = new AbortController()
    let drawn = 0
    ctx.drawImage.mockImplementation(() => {
      drawn += 1
      if (drawn === 1) controller.abort()
    })
    const onMetricExtracted = vi.fn()

    const evidence = await extractPlannedFrames(
      video,
      planWith({ trunkLean: [PAIR], footStrikePattern: [SINGLE] }),
      { signal: controller.signal },
      { onMetricExtracted },
    )

    // The abort landed between the pair's two seeks, and the ghost's seek is never started: the
    // check is per SEEK (`strides-zm8`), so an abandoned pass pays for at most the one in flight.
    // On a 4K clip that second seek was ~470 ms of decode spent on an image already destined for
    // the bin, with the superseding pass queued behind it.
    expect(drawn).toBe(1)
    expect(video.currentTime).toBe(drawnTimeOf(PAIR.base))
    // And nothing half-done is reported as finished, through either channel.
    expect(onMetricExtracted).not.toHaveBeenCalled()
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

  it('never mistakes an image the abort cut short for a seek that timed out', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const controller = new AbortController()
    // Aborted on the LAST draw of a metric's last image: the metric is not finished in the sense
    // a caller may keep, because the pass was abandoned before it could be reported.
    ctx.drawImage.mockImplementation(() => controller.abort())
    const onMetricExtracted = vi.fn()

    const evidence = await extractPlannedFrames(
      video,
      planWith({ footStrikePattern: [SINGLE] }),
      { signal: controller.signal },
      { onMetricExtracted },
    )

    // Its one image drew in full, and is still not offered: the abort arrived before the metric
    // could be reported, and "drawn" is not "finished" until the pass that drew it says so.
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    expect(onMetricExtracted).not.toHaveBeenCalled()
    expect(evidence.footStrikePattern).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
  })

  it('reports each metric the moment it finishes, and not the one the abort lands in', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const controller = new AbortController()
    let drawn = 0
    ctx.drawImage.mockImplementation(() => {
      drawn += 1
      // SINGLE (footStrikePattern) is one draw; abort on the base of the PAIR that follows.
      if (drawn === 2) controller.abort()
    })
    const finished: Array<[MetricId, unknown]> = []

    // Plan key order is `ALL_METRICS`'s: trunkLean precedes footStrikePattern, so this plan puts
    // the single first by naming it under a metric that comes earlier.
    await extractPlannedFrames(
      video,
      planWith({ verticalOscillation: [SINGLE], trunkLean: [PAIR] }),
      { signal: controller.signal },
      { onMetricExtracted: (metric, evidence) => finished.push([metric, evidence]) },
    )

    // The single finished whole before the abort, so the caller may keep it even though this
    // pass's own verdict is all-failed; the pair it was abandoned inside is not offered.
    expect(finished).toEqual([
      [
        'verticalOscillation',
        { status: 'extracted', items: [{ plan: SINGLE, canvas: expect.any(HTMLCanvasElement) }] },
      ],
    ])
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

describe('reusing evidence the caller already holds (strides-zm8)', () => {
  it('offers a metric for keeping only when every planned image was produced', async () => {
    stubCanvas2DContext()
    const { video } = seekableVideo()
    // A second footstrike whose seek never completes: `seeked` is withheld for its instant only.
    const LATE: EvidenceFramePlan = { ...SINGLE, base: { ...SINGLE.base, timestamp: 3 } }
    const descriptor = Object.getOwnPropertyDescriptor(video, 'currentTime')!
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: descriptor.get,
      set: (value: number) => {
        if (value === drawnTimeOf(LATE.base)) return
        descriptor.set!.call(video, value)
      },
    })
    const onMetricExtracted = vi.fn()

    const evidence = await extractPlannedFrames(
      video,
      planWith({ verticalOscillation: [SINGLE], footStrikePattern: [SINGLE, LATE] }),
      { seekTimeoutMs: 5 },
      { onMetricExtracted },
    )

    // The pass's own verdict keeps the image it got — that part is unchanged ...
    expect(evidence.footStrikePattern.status).toBe('extracted')
    expect(
      evidence.footStrikePattern.status === 'extracted' && evidence.footStrikePattern.items,
    ).toHaveLength(1)
    // ... but only the whole metric is offered for reuse, so a later pass retries the timeout.
    expect(onMetricExtracted.mock.calls.map(([metric]) => metric)).toEqual([
      'verticalOscillation',
    ])
  })

  it('draws nothing when the abort lands during a seek', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const controller = new AbortController()
    const descriptor = Object.getOwnPropertyDescriptor(video, 'currentTime')!
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: descriptor.get,
      set: (value: number) => {
        controller.abort()
        descriptor.set!.call(video, value)
      },
    })

    await extractPlannedFrames(video, planWith({ footStrikePattern: [SINGLE] }), {
      signal: controller.signal,
    })

    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('passes a reused metric through by reference and never seeks it', async () => {
    const ctx = stubCanvas2DContext()
    const { video } = seekableVideo()
    const draws = recordDraws(ctx, video)
    const held = {
      status: 'extracted' as const,
      items: [{ plan: PAIR, canvas: document.createElement('canvas') }],
    }
    const onMetricExtracted = vi.fn()

    const evidence = await extractPlannedFrames(
      video,
      planWith({ trunkLean: [PAIR], footStrikePattern: [SINGLE] }),
      {},
      { reuse: { trunkLean: held }, onMetricExtracted },
    )

    // The SAME object, so the same canvas element — not an equivalent re-decode.
    expect(evidence.trunkLean).toBe(held)
    // Only the metric that was not held reached the decoder: one draw, at the single's instant.
    expect(draws.filter((draw) => draw.call === 'drawImage').map((draw) => draw.sourceTime)).toEqual([
      drawnTimeOf(SINGLE.base),
    ])
    expect(evidence.footStrikePattern.status).toBe('extracted')
    // A held metric is not news to the caller that handed it over.
    expect(onMetricExtracted.mock.calls.map(([metric]) => metric)).toEqual(['footStrikePattern'])
  })

  it('merges in plan key order, identical in shape to a full extraction', async () => {
    stubCanvas2DContext()
    const plan = planWith({ trunkLean: [PAIR], footStrikePattern: [SINGLE] })
    const full = await extractPlannedFrames(seekableVideo().video, plan)

    stubCanvas2DContext()
    const partial = await extractPlannedFrames(seekableVideo().video, plan, {}, {
      reuse: { trunkLean: full.trunkLean },
    })

    expect(Object.keys(partial)).toEqual(Object.keys(full))
    expect(partial.trunkLean).toBe(full.trunkLean)
    expect(partial).toEqual(full)
  })

  it('ignores a reused entry for a metric the plan did not ask images of', async () => {
    stubCanvas2DContext()
    const stale = {
      status: 'extracted' as const,
      items: [{ plan: SINGLE, canvas: document.createElement('canvas') }],
    }

    const evidence = await extractPlannedFrames(
      seekableVideo().video,
      planWith({ trunkLean: [PAIR] }),
      {},
      { reuse: { cadence: stale } },
    )

    // The plan's own verdict stands: a picture for a metric the plan says has none would be an
    // image of something this run never measured.
    expect(evidence.cadence).toEqual({ status: 'no-evidence', reason: 'not-emitted' })
  })

  it('opens no decoder for a clip whose every planned metric is held', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()
    const held = {
      status: 'extracted' as const,
      items: [{ plan: PAIR, canvas: document.createElement('canvas') }],
    }

    const [evidence] = await extractSessionEvidence(
      [{ ...clip(), reuse: { trunkLean: held } }],
      { loadTimeoutMs: 5 },
    )

    expect(decoders.log).toEqual([])
    expect(evidence.trunkLean).toBe(held)
    decoders.restore()
  })

  it('keeps held metrics when the clip itself cannot be decoded', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()
    const held = {
      status: 'extracted' as const,
      items: [{ plan: PAIR, canvas: document.createElement('canvas') }],
    }

    // jsdom never decodes, so `loadTimeoutMs` expires and the clip is undecodable.
    const [evidence] = await extractSessionEvidence(
      [
        {
          ...clip(planWith({ trunkLean: [PAIR], footStrikePattern: [SINGLE] })),
          reuse: { trunkLean: held },
        },
      ],
      { loadTimeoutMs: 5 },
    )

    expect(decoders.log).toEqual(['open:1', 'close:1'])
    // Only what needed THIS decoder failed with it; an image already held is not un-made by it.
    expect(evidence.trunkLean).toBe(held)
    expect(evidence.footStrikePattern).toEqual({
      status: 'no-evidence',
      reason: 'extraction-failed',
    })
    decoders.restore()
  })
})

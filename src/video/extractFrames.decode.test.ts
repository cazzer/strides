import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetricId } from '../heuristics/types'
import type {
  ClipEvidencePlan,
  EvidenceFramePlan,
  EvidenceInstantPlan,
} from '../results/evidenceFrames'
import { EVIDENCE_BASE_OPACITY, EVIDENCE_GHOST_BLEND_ALPHA } from '../results/evidenceFrames'
import { stubPerCanvas2DContexts } from '../test/canvasTestUtils'
import type { DecodedFrameSource, DecodePassOutcome } from './decodedFrames'
import { presentationTimeline, sampleTimestampUs } from './decodedFrames'
import type { DemuxedTrack } from './mp4Demux'

/**
 * The forward-decode driver (`strides-6i6.4`): the same plan, drawn from `VideoFrame`s instead of
 * seeks. WIRING tests, like `extractFrames.test.ts` — which frame, which crop, which alpha, which
 * order reached `drawImage`. Pixel identity with the seek path is a live-browser measurement
 * (recorded on the bead), never something jsdom can see.
 */

const { calibrationMock, openSourceMock, decodeMock } = vi.hoisted(() => ({
  calibrationMock: vi.fn(),
  openSourceMock: vi.fn(),
  decodeMock: vi.fn(),
}))

vi.mock('./evidenceSeekOffset', () => ({
  resolveEvidenceSeekCalibration: calibrationMock,
}))

vi.mock('./decodedFrames', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./decodedFrames')>()
  return {
    ...actual,
    openDecodedFrameSource: openSourceMock,
    decodeFramesForward: decodeMock,
  }
})

import { extractClipEvidence } from './extractFrames'

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
  'kneeDrive',
  'armSwingAmplitude',
  'swingFootLateralExcursion',
]

function instant(timestamp: number, opacity: number): EvidenceInstantPlan {
  return {
    timestamp,
    opacity,
    keypoints: [{ name: 'left_hip', status: 'detected', x: 800, y: 540 }],
    outwardSign: null,
    side: null,
  }
}

function pair(base: number, ghost: number): EvidenceFramePlan {
  return {
    metric: 'trunkLean',
    kind: 'trunkLeanRange',
    quality: 0.8,
    label: 'pair',
    base: instant(base, EVIDENCE_BASE_OPACITY),
    ghost: instant(ghost, EVIDENCE_GHOST_BLEND_ALPHA),
    crop: { x: 412, y: 130, side: 900 },
    travelDirection: 1,
    demotion: null,
    cropGrowth: 1.4,
    focusOffset: null,
  }
}

function single(timestamp: number): EvidenceFramePlan {
  return {
    metric: 'footStrikePattern',
    kind: 'footStrike',
    side: 'left',
    quality: 0.7,
    label: 'single',
    base: instant(timestamp, EVIDENCE_BASE_OPACITY),
    ghost: null,
    crop: { x: 0, y: 0, side: 320 },
    travelDirection: -1,
    cropGrowth: null,
    demotion: null,
    focusOffset: null,
  }
}

function planWith(items: Partial<Record<MetricId, EvidenceFramePlan[]>>): ClipEvidencePlan {
  const plan = {} as ClipEvidencePlan
  for (const metric of ALL_METRICS) {
    const planned = items[metric]
    plan[metric] = planned
      ? { status: 'planned', items: planned }
      : { status: 'no-evidence', reason: 'not-emitted' }
  }
  return plan
}

/** A clip of twelve quarter-second frames, presented from 0, on a 1920x1080 track. */
const FRAME_SECONDS = 0.25
const TRACK: DemuxedTrack = {
  codec: 'avc1.640034',
  description: undefined,
  width: 1920,
  height: 1080,
  fps: 4,
  durationSec: 3,
  matrix: [],
  samples: Array.from({ length: 12 }, (_, index) => ({
    data: new Uint8Array(),
    ptsSec: index * FRAME_SECONDS,
    durationSec: FRAME_SECONDS,
    isKeyframe: index === 0,
  })),
}
const SOURCE: DecodedFrameSource = {
  track: TRACK,
  timeline: presentationTimeline(TRACK, 0, 3)!,
}
/** The decoder key of the frame starting at `seconds`. */
const keyAt = (seconds: number) => sampleTimestampUs(seconds)

interface FakeFrame {
  key: number
  displayWidth: number
  displayHeight: number
}

/** Delivers every wanted frame in presentation order, recording each pass's wanted set. */
function deliverAll(passes: number[][], size = { width: 1920, height: 1080 }) {
  decodeMock.mockImplementation(
    async (
      track: DemuxedTrack,
      wanted: ReadonlySet<number>,
      onFrame: (frame: VideoFrame, key: number) => void,
    ): Promise<DecodePassOutcome> => {
      passes.push([...wanted].sort((a, b) => a - b))
      for (const sample of track.samples) {
        const key = sampleTimestampUs(sample.ptsSec)
        if (!wanted.has(key)) continue
        const frame: FakeFrame = { key, displayWidth: size.width, displayHeight: size.height }
        try {
          onFrame(frame as unknown as VideoFrame, key)
        } catch {
          return 'failed'
        }
      }
      return 'completed'
    },
  )
}

interface Draw {
  canvas: HTMLCanvasElement
  alpha: number
  frameKey: number | null
  args: unknown[]
}

function recordAllDraws(): Draw[] {
  const draws: Draw[] = []
  stubPerCanvas2DContexts((ctx, canvas) => {
    ctx.drawImage.mockImplementation((...args: unknown[]) => {
      const source = args[0] as Partial<FakeFrame>
      draws.push({ canvas, alpha: ctx.globalAlpha, frameKey: source.key ?? null, args })
    })
  })
  return draws
}

/** Every `<video>` reports decoded data and answers a seek, recording each target. */
function makeAllVideosSeekable(): { seeked: number[]; restore: () => void } {
  const proto = HTMLMediaElement.prototype
  const originals = (['readyState', 'currentTime'] as const).map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(proto, key),
  }))
  const times = new WeakMap<HTMLMediaElement, number>()
  const seeked: number[] = []
  Object.defineProperty(proto, 'readyState', { configurable: true, get: () => 2 })
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
  return {
    seeked,
    restore: () => {
      for (const { key, descriptor } of originals) {
        if (descriptor === undefined) delete (proto as unknown as Record<string, unknown>)[key]
        else Object.defineProperty(proto, key, descriptor)
      }
    },
  }
}

const HALF_FRAME = FRAME_SECONDS / 2

beforeEach(() => {
  calibrationMock.mockReset()
  // Mid-frame targets, the way the real calibration makes them.
  calibrationMock.mockResolvedValue({ offsetSeconds: 0, midpointOffsetSeconds: HALF_FRAME })
  openSourceMock.mockReset()
  openSourceMock.mockResolvedValue(SOURCE)
  decodeMock.mockReset()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('extracting evidence from decoded frames (strides-6i6.4)', () => {
  it('draws each instant from the frame its seek would show, through the same crop, opening no <video>', async () => {
    const passes: number[][] = []
    deliverAll(passes)
    const draws = recordAllDraws()
    const createElement = vi.spyOn(document, 'createElement')

    const evidence = await extractClipEvidence({
      sourceBlob: new Blob(['x']),
      plan: planWith({ trunkLean: [pair(1.5, 2.25)], footStrikePattern: [single(0.75)] }),
    })

    expect(createElement.mock.calls.some(([tag]) => tag === 'video')).toBe(false)
    expect(passes).toEqual([[keyAt(0.75), keyAt(1.5), keyAt(2.25)]])
    const photographic = draws.filter((draw) => draw.frameKey !== null)
    expect(photographic.map((draw) => [draw.frameKey, draw.alpha])).toEqual([
      [keyAt(0.75), EVIDENCE_BASE_OPACITY],
      [keyAt(1.5), EVIDENCE_BASE_OPACITY],
      [keyAt(2.25), EVIDENCE_GHOST_BLEND_ALPHA],
    ])
    // The nine-argument crop the seek path issues, verbatim, with the frame as its source.
    expect(photographic[1].args.slice(1)).toEqual([412, 130, 900, 900, 0, 0, 640, 640])
    expect(evidence.trunkLean.status).toBe('extracted')
    expect(evidence.footStrikePattern.status).toBe('extracted')
  })

  it('draws a ghost that comes BEFORE its base in a second pass, never ahead of the base', async () => {
    const passes: number[][] = []
    deliverAll(passes)
    const draws = recordAllDraws()

    const evidence = await extractClipEvidence({
      sourceBlob: new Blob(['x']),
      plan: planWith({ trunkLean: [pair(2.25, 1.5)] }),
    })

    expect(passes).toEqual([[keyAt(1.5), keyAt(2.25)], [keyAt(1.5)]])
    const photographic = draws.filter((draw) => draw.frameKey !== null)
    expect(photographic.map((draw) => [draw.frameKey, draw.alpha])).toEqual([
      [keyAt(2.25), EVIDENCE_BASE_OPACITY],
      [keyAt(1.5), EVIDENCE_GHOST_BLEND_ALPHA],
    ])
    expect(new Set(photographic.map((draw) => draw.canvas)).size).toBe(1)
    expect(evidence.trunkLean.status).toBe('extracted')
  })

  it('hands the whole clip to the seek path, before drawing anything, for a target it will not map', async () => {
    const passes: number[][] = []
    deliverAll(passes)
    recordAllDraws()
    const { seeked, restore } = makeAllVideosSeekable()
    // No midpoint: every target sits exactly on a frame boundary, inside the guard band.
    calibrationMock.mockResolvedValue({ offsetSeconds: 0, midpointOffsetSeconds: 0 })

    try {
      const evidence = await extractClipEvidence(
        { sourceBlob: new Blob(['x']), plan: planWith({ trunkLean: [pair(1.5, 2.25)] }) },
        { presentationTimeoutMs: 1 },
      )
      expect(passes).toEqual([])
      expect(seeked).toEqual([1.5, 2.25])
      expect(evidence.trunkLean.status).toBe('extracted')
    } finally {
      restore()
    }
  })

  it('falls back to seeking only what a failed pass had not finished, keeping what it had', async () => {
    const passes: number[][] = []
    // The first pass delivers the earliest frame, then the decoder dies.
    decodeMock.mockImplementation(
      async (
        _track: DemuxedTrack,
        wanted: ReadonlySet<number>,
        onFrame: (frame: VideoFrame, key: number) => void,
      ): Promise<DecodePassOutcome> => {
        passes.push([...wanted])
        const key = keyAt(0.75)
        onFrame({ key, displayWidth: 1920, displayHeight: 1080 } as unknown as VideoFrame, key)
        return 'failed'
      },
    )
    recordAllDraws()
    const { seeked, restore } = makeAllVideosSeekable()
    const reported: MetricId[] = []

    try {
      const evidence = await extractClipEvidence(
        {
          sourceBlob: new Blob(['x']),
          plan: planWith({ trunkLean: [pair(1.5, 2.25)], footStrikePattern: [single(0.75)] }),
          onMetricExtracted: (metric) => reported.push(metric),
        },
        { presentationTimeoutMs: 1 },
      )
      expect(passes).toHaveLength(1)
      expect(seeked).toEqual([1.5 + HALF_FRAME, 2.25 + HALF_FRAME])
      expect(reported).toEqual(['footStrikePattern', 'trunkLean'])
      expect(evidence.footStrikePattern.status).toBe('extracted')
      expect(evidence.trunkLean.status).toBe('extracted')
    } finally {
      restore()
    }
  })

  it('keeps a pass that drew every image even when the decoder fails afterwards, and seeks nothing', async () => {
    const passes: number[][] = []
    decodeMock.mockImplementation(
      async (
        track: DemuxedTrack,
        wanted: ReadonlySet<number>,
        onFrame: (frame: VideoFrame, key: number) => void,
      ): Promise<DecodePassOutcome> => {
        passes.push([...wanted])
        for (const sample of track.samples) {
          const key = sampleTimestampUs(sample.ptsSec)
          if (wanted.has(key)) {
            onFrame({ key, displayWidth: 1920, displayHeight: 1080 } as unknown as VideoFrame, key)
          }
        }
        return 'failed'
      },
    )
    recordAllDraws()
    const { seeked, restore } = makeAllVideosSeekable()
    try {
      const evidence = await extractClipEvidence(
        { sourceBlob: new Blob(['x']), plan: planWith({ footStrikePattern: [single(0.75)] }) },
        { presentationTimeoutMs: 1 },
      )
      expect(passes).toHaveLength(1)
      expect(seeked).toEqual([])
      expect(evidence.footStrikePattern.status).toBe('extracted')
    } finally {
      restore()
    }
  })

  it('refuses a decoded frame of a different size, and seeks instead', async () => {
    const passes: number[][] = []
    deliverAll(passes, { width: 1920, height: 1088 })
    recordAllDraws()
    const { seeked, restore } = makeAllVideosSeekable()
    try {
      const evidence = await extractClipEvidence(
        { sourceBlob: new Blob(['x']), plan: planWith({ footStrikePattern: [single(0.75)] }) },
        { presentationTimeoutMs: 1 },
      )
      expect(passes).toHaveLength(1)
      expect(seeked).toEqual([0.75 + HALF_FRAME])
      expect(evidence.footStrikePattern.status).toBe('extracted')
    } finally {
      restore()
    }
  })

  it('abandons the whole clip on an abort mid-pass, and seeks nothing', async () => {
    const controller = new AbortController()
    decodeMock.mockImplementation(
      async (
        _track: DemuxedTrack,
        _wanted: ReadonlySet<number>,
        onFrame: (frame: VideoFrame, key: number) => void,
      ): Promise<DecodePassOutcome> => {
        const key = keyAt(1.5)
        controller.abort()
        onFrame({ key, displayWidth: 1920, displayHeight: 1080 } as unknown as VideoFrame, key)
        return 'aborted'
      },
    )
    recordAllDraws()
    const { seeked, restore } = makeAllVideosSeekable()
    const reported: MetricId[] = []
    try {
      const evidence = await extractClipEvidence(
        {
          sourceBlob: new Blob(['x']),
          plan: planWith({ trunkLean: [pair(1.5, 2.25)] }),
          onMetricExtracted: (metric) => reported.push(metric),
        },
        { signal: controller.signal },
      )
      expect(seeked).toEqual([])
      expect(reported).toEqual([])
      expect(evidence.trunkLean).toEqual({ status: 'no-evidence', reason: 'extraction-failed' })
    } finally {
      restore()
    }
  })

  it('seeks as before wherever the clip cannot be opened for decoding', async () => {
    openSourceMock.mockResolvedValue(null)
    recordAllDraws()
    const { seeked, restore } = makeAllVideosSeekable()
    try {
      await extractClipEvidence(
        { sourceBlob: new Blob(['x']), plan: planWith({ footStrikePattern: [single(0.75)] }) },
        { presentationTimeoutMs: 1 },
      )
      expect(decodeMock).not.toHaveBeenCalled()
      expect(seeked).toEqual([0.75 + HALF_FRAME])
    } finally {
      restore()
    }
  })
})

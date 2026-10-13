import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubCanvas2DContext } from '../test/canvasTestUtils'
import type { DecodedFrameSource, DecodePassOutcome } from './decodedFrames'
import { presentationTimeline, sampleTimestampUs } from './decodedFrames'
import type { DemuxedTrack } from './mp4Demux'
import type { VideoMetadata } from './types'

/**
 * The poster's forward-decode path (`strides-6i6.4`): the frame a seek to the midpoint shows,
 * drawn whole into the same-sized canvas, with no `<video>` opened. Pixel identity with the seek
 * path is a live-browser measurement, recorded on the bead.
 */

const { openSourceMock, decodeMock } = vi.hoisted(() => ({
  openSourceMock: vi.fn(),
  decodeMock: vi.fn(),
}))

vi.mock('./decodedFrames', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./decodedFrames')>()
  return { ...actual, openDecodedFrameSource: openSourceMock, decodeFramesForward: decodeMock }
})

import { deriveClipPoster } from './posterFrame'

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
    ptsSec: index * 0.25,
    durationSec: 0.25,
    isKeyframe: index === 0,
  })),
}
const SOURCE: DecodedFrameSource = { track: TRACK, timeline: presentationTimeline(TRACK, 0, 3)! }

function metadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return { durationSec: 2.9, width: 1920, height: 1080, frameRate: null, ...overrides }
}

function deliver(size = { width: 1920, height: 1080 }) {
  const asked: number[][] = []
  decodeMock.mockImplementation(
    async (
      _track: DemuxedTrack,
      wanted: ReadonlySet<number>,
      onFrame: (frame: VideoFrame, key: number) => void,
    ): Promise<DecodePassOutcome> => {
      asked.push([...wanted])
      for (const key of wanted) {
        try {
          onFrame({ key, displayWidth: size.width, displayHeight: size.height } as unknown as VideoFrame, key)
        } catch {
          return 'failed'
        }
      }
      return 'completed'
    },
  )
  return asked
}

beforeEach(() => {
  openSourceMock.mockReset()
  openSourceMock.mockResolvedValue(SOURCE)
  decodeMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('deriving a poster from decoded frames (strides-6i6.4)', () => {
  it('draws the midpoint frame whole into the poster canvas, opening no <video>', async () => {
    const ctx = stubCanvas2DContext()
    const asked = deliver()
    const createElement = vi.spyOn(document, 'createElement')

    const poster = await deriveClipPoster(new Blob(['x']), metadata())

    expect(createElement.mock.calls.some(([tag]) => tag === 'video')).toBe(false)
    // Midpoint 1.45 s lies in the frame presented over [1.25, 1.5).
    expect(asked).toEqual([[sampleTimestampUs(1.25)]])
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    const [source, ...rest] = ctx.drawImage.mock.calls[0]
    expect((source as { key: number }).key).toBe(sampleTimestampUs(1.25))
    expect(rest).toEqual([0, 0, 240, 135])
    expect(poster).toMatchObject({ width: 240, height: 135, timestamp: 1.45 })
  })

  it('seeks instead when the decoded frame is not the size the element reports', async () => {
    stubCanvas2DContext()
    deliver({ width: 1920, height: 1088 })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const createElement = vi.spyOn(document, 'createElement')

    // jsdom never decodes, so the seek path ends at its load timeout.
    const poster = await deriveClipPoster(new Blob(['x']), metadata(), { loadTimeoutMs: 5 })

    expect(createElement.mock.calls.some(([tag]) => tag === 'video')).toBe(true)
    expect(poster).toBeNull()
  })

  it('leaves a clip with no usable duration to the seek path untouched', async () => {
    stubCanvas2DContext()
    deliver()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await deriveClipPoster(new Blob(['x']), metadata({ durationSec: Infinity }), {
      loadTimeoutMs: 5,
    })

    expect(openSourceMock).not.toHaveBeenCalled()
    expect(decodeMock).not.toHaveBeenCalled()
  })

  it('leaves a clip it cannot open for decoding to the seek path', async () => {
    stubCanvas2DContext()
    openSourceMock.mockResolvedValue(null)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const createElement = vi.spyOn(document, 'createElement')

    await deriveClipPoster(new Blob(['x']), metadata(), { loadTimeoutMs: 5 })

    expect(decodeMock).not.toHaveBeenCalled()
    expect(createElement.mock.calls.some(([tag]) => tag === 'video')).toBe(true)
  })
})

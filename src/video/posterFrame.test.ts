import { describe, expect, it, vi } from 'vitest'
import { stubCanvas2DContext } from '../test/canvasTestUtils'
import { makeVideoSeekable } from '../test/videoTestUtils'
import { stubRequestVideoFrameCallback } from '../test/videoFrameCallbackTestUtils'
import type { VideoMetadata } from './types'
import {
  POSTER_MAX_SIDE_PX,
  POSTER_TIMESTAMP_MAX_SECONDS,
  choosePosterTimestamp,
  computePosterSize,
  deriveClipPoster,
  drawPosterFrame,
  releaseClipPoster,
} from './posterFrame'

/**
 * Everything decidable about a poster — its size and which instant it comes from — is decided by
 * the two pure functions below, and those are tested against no DOM at all. jsdom ships no canvas
 * and this repo refuses the `canvas` npm package (`canvasTestUtils.ts`), so the draw tests are
 * WIRING tests: the right dimensions reached the right calls. Never pixels.
 */

function metadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return { durationSec: 10, width: 1920, height: 1080, frameRate: null, ...overrides }
}

/** A `<video>` that behaves enough like a real one to drive the draw: assigning `currentTime`
 * dispatches `seeked`, and the frame callback fires itself rather than waiting to be pumped. */
function seekableVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  makeVideoSeekable(video)
  const controller = stubRequestVideoFrameCallback(video)
  const register = video.requestVideoFrameCallback.bind(video)
  video.requestVideoFrameCallback = ((callback: VideoFrameRequestCallback) => {
    const handle = register(callback)
    queueMicrotask(() => controller.fire(video.currentTime))
    return handle
  }) as HTMLVideoElement['requestVideoFrameCallback']
  return video
}

describe('computePosterSize', () => {
  it('caps the longer side of a landscape clip and keeps its aspect ratio', () => {
    expect(computePosterSize({ width: 1920, height: 1080 }, 240)).toEqual({
      width: 240,
      height: 135,
    })
  })

  it('caps the longer side of a portrait clip — height, not width', () => {
    // Demo 2 is portrait 4K (2160x3840): a rule that always capped WIDTH would leave this 4267 px
    // tall, which is the whole reason the cap is on the longer side.
    expect(computePosterSize({ width: 2160, height: 3840 }, 240)).toEqual({
      width: 135,
      height: 240,
    })
  })

  it('never upscales a clip already smaller than the cap', () => {
    expect(computePosterSize({ width: 160, height: 90 }, 240)).toEqual({
      width: 160,
      height: 90,
    })
  })

  it('leaves a square clip square', () => {
    expect(computePosterSize({ width: 500, height: 500 }, 240)).toEqual({
      width: 240,
      height: 240,
    })
  })

  it('floors an extreme aspect ratio at one pixel rather than collapsing it to zero', () => {
    // 4000x3 scales to a height of 0.18 px. A zero-height canvas is not a thumbnail.
    expect(computePosterSize({ width: 4000, height: 3 }, 240)).toEqual({
      width: 240,
      height: 1,
    })
  })

  it('defaults its cap to POSTER_MAX_SIDE_PX', () => {
    expect(computePosterSize({ width: 4000, height: 4000 })).toEqual({
      width: POSTER_MAX_SIDE_PX,
      height: POSTER_MAX_SIDE_PX,
    })
  })

  it('refuses dimensions that cannot describe an image', () => {
    // Every one of these is something a real `<video>` reports before, or after failing, a load.
    expect(computePosterSize({ width: 0, height: 1080 })).toBeNull()
    expect(computePosterSize({ width: 1920, height: 0 })).toBeNull()
    expect(computePosterSize({ width: -1920, height: 1080 })).toBeNull()
    expect(computePosterSize({ width: Number.NaN, height: 1080 })).toBeNull()
    expect(computePosterSize({ width: 1920, height: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('refuses a cap that is not a usable number of pixels', () => {
    expect(computePosterSize({ width: 1920, height: 1080 }, 0)).toBeNull()
    expect(computePosterSize({ width: 1920, height: 1080 }, Number.NaN)).toBeNull()
  })
})

describe('choosePosterTimestamp', () => {
  it('takes a frame a tenth of the way in, never the clip’s leader frame', () => {
    expect(choosePosterTimestamp(8)).toBeCloseTo(0.8, 10)
  })

  it('caps at POSTER_TIMESTAMP_MAX_SECONDS on a long clip', () => {
    expect(choosePosterTimestamp(600)).toBe(POSTER_TIMESTAMP_MAX_SECONDS)
  })

  it('stays strictly inside a very short clip', () => {
    const t = choosePosterTimestamp(0.5)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThan(0.5)
  })

  it('falls back to the first frame for a duration a video element cannot report', () => {
    // `Infinity` is what a still-loading or unseekable stream reports, and jsdom's default is NaN.
    expect(choosePosterTimestamp(null)).toBe(0)
    expect(choosePosterTimestamp(undefined)).toBe(0)
    expect(choosePosterTimestamp(Number.NaN)).toBe(0)
    expect(choosePosterTimestamp(Number.POSITIVE_INFINITY)).toBe(0)
    expect(choosePosterTimestamp(0)).toBe(0)
    expect(choosePosterTimestamp(-4)).toBe(0)
  })
})

describe('drawPosterFrame', () => {
  it('seeks the chosen instant and draws the whole frame into a canvas of the computed size', async () => {
    const ctx = stubCanvas2DContext()
    const video = seekableVideo()
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    const poster = await drawPosterFrame(video, metadata({ durationSec: 8 }))

    expect(seeked).toEqual([0.8])
    expect(poster).not.toBeNull()
    expect(poster!.timestamp).toBeCloseTo(0.8, 10)
    expect(poster!.width).toBe(240)
    expect(poster!.height).toBe(135)
    expect(poster!.canvas.width).toBe(240)
    expect(poster!.canvas.height).toBe(135)
    // Five-argument form: the whole frame, scaled — the aspect ratio is preserved by the size, so
    // there is no crop for a renderer to undo.
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 240, 135)
  })

  it('honours a caller-supplied cap', async () => {
    const ctx = stubCanvas2DContext()

    const poster = await drawPosterFrame(seekableVideo(), metadata(), { maxSidePx: 64 })

    expect(poster).toMatchObject({ width: 64, height: 36 })
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 64, 36)
  })

  it('draws nothing when the clip reports no usable dimensions', async () => {
    const ctx = stubCanvas2DContext()

    const poster = await drawPosterFrame(seekableVideo(), metadata({ width: 0, height: 0 }))

    expect(poster).toBeNull()
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('yields no poster rather than a wrong frame when the seek never completes', async () => {
    const ctx = stubCanvas2DContext()
    // A plain jsdom element: assigning `currentTime` does nothing and `seeked` never fires.
    const poster = await drawPosterFrame(document.createElement('video'), metadata(), {
      seekTimeoutMs: 5,
    })

    expect(poster).toBeNull()
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})

describe('deriveClipPoster', () => {
  it('has nothing to derive without bytes or metadata', async () => {
    expect(await deriveClipPoster(null, metadata())).toBeNull()
    expect(await deriveClipPoster(new Blob(['x']), null)).toBeNull()
  })

  it('owns its object URL and revokes it even when the detached element never decodes', async () => {
    stubCanvas2DContext()
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    // jsdom never fires `loadeddata`, so this exercises the load-timeout path.
    const poster = await deriveClipPoster(new Blob(['x']), metadata(), { loadTimeoutMs: 5 })

    expect(poster).toBeNull()
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).toHaveBeenCalledWith('blob:poster')

    createSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('never touches a caller-owned element — the decoder it uses is its own', async () => {
    stubCanvas2DContext()
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const canonical = seekableVideo()
    const seeked = vi.fn()
    canonical.addEventListener('seeked', seeked)

    await deriveClipPoster(new Blob(['x']), metadata(), { loadTimeoutMs: 5 })

    // The whole non-disturbance argument in one assertion: `deriveClipPoster` is handed bytes, not
    // an element, so no element anyone else holds can be seeked by it.
    expect(seeked).not.toHaveBeenCalled()
    expect(canonical.currentTime).toBe(0)
    revokeSpy.mockRestore()
  })
})

describe('releaseClipPoster', () => {
  it('drops the backing store and is safe to call twice, or on nothing', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 135
    const poster = { canvas, width: 240, height: 135, timestamp: 0.8 }

    releaseClipPoster(poster)

    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    // The recorded dimensions survive, so a caller can still reserve the right aspect ratio.
    expect(poster.width).toBe(240)
    expect(poster.height).toBe(135)

    expect(() => releaseClipPoster(poster)).not.toThrow()
    expect(() => releaseClipPoster(null)).not.toThrow()
    expect(() => releaseClipPoster(undefined)).not.toThrow()
  })
})

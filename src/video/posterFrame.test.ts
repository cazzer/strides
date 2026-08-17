import { describe, expect, it, vi } from 'vitest'
import { stubCanvas2DContext } from '../test/canvasTestUtils'
import { makeVideoSeekable } from '../test/videoTestUtils'
import { stubRequestVideoFrameCallback } from '../test/videoFrameCallbackTestUtils'
import type { VideoMetadata } from './types'
import {
  POSTER_MAX_SIDE_PX,
  POSTER_TIMESTAMP_FALLBACK_SECONDS,
  choosePosterTimestamps,
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
  return withSelfFiringFrameCallback(video)
}

/**
 * The same, but seeks past `limit` never complete — `currentTime` moves and no `seeked` ever
 * arrives, which is what a clip shorter than the requested instant, or one whose later positions
 * are not seekable at all, looks like from `seekTo`'s side.
 */
function seekableUpTo(limit: number): HTMLVideoElement {
  const video = document.createElement('video')
  let currentTime = 0
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value
      if (value <= limit) video.dispatchEvent(new Event('seeked'))
    },
  })
  return withSelfFiringFrameCallback(video)
}

function withSelfFiringFrameCallback(video: HTMLVideoElement): HTMLVideoElement {
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

describe('choosePosterTimestamps', () => {
  it('takes the middle frame, never the clip’s leader frame', () => {
    const [first, ...rest] = choosePosterTimestamps(8)
    expect(first).toBeCloseTo(4, 10)
    // A computed position needs no fallback — see the "no second candidate" case below.
    expect(rest).toEqual([])
  })

  it('does not cap the midpoint on a long clip', () => {
    // The midpoint is the whole point: clamping a 600s clip to a fixed ceiling would put every
    // clip longer than a couple of seconds back near its opening, which is what the fraction
    // exists to avoid.
    expect(choosePosterTimestamps(600)).toEqual([300])
  })

  it('stays strictly inside a very short clip', () => {
    const [t] = choosePosterTimestamps(0.5)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThan(0.5)
  })

  it('still targets a real offset — never frame 0 — for a duration a video cannot report', () => {
    // `Infinity` is what a MediaRecorder WebM reports for its whole life, so this is every
    // webcam-recorded clip in the app, not a rare edge: clamping it to 0 would poster every
    // recorded run at the frame that is routinely a fade-in, a black leader, or the runner still
    // walking back from the camera. `null`/`NaN` are what a still-loading or failed element gives.
    for (const unusable of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -4]) {
      expect(choosePosterTimestamps(unusable)).toEqual([POSTER_TIMESTAMP_FALLBACK_SECONDS, 0])
    }
  })

  it('offers frame 0 only as the fallback behind that offset, never as the first choice', () => {
    // The distinction the two branches turn on: an offset guessed without a duration degrades to
    // frame 0 rather than to no poster at all, but a position computed FROM a duration does not —
    // there, an unreachable seek means a broken decoder, and frame 0 would be a substitution.
    for (const unusable of [null, Number.POSITIVE_INFINITY]) {
      expect(choosePosterTimestamps(unusable).indexOf(0)).toBe(1)
    }
    for (const usable of [0.5, 8, 600]) {
      expect(choosePosterTimestamps(usable)).not.toContain(0)
      expect(choosePosterTimestamps(usable)).toHaveLength(1)
    }
  })

  it('never offers nothing to try', () => {
    for (const duration of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -4, 0.5, 8]) {
      expect(choosePosterTimestamps(duration).length).toBeGreaterThan(0)
    }
  })
})

describe('drawPosterFrame', () => {
  it('seeks the chosen instant and draws the whole frame into a canvas of the computed size', async () => {
    const ctx = stubCanvas2DContext()
    const video = seekableVideo()
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    const poster = await drawPosterFrame(video, metadata({ durationSec: 8 }))

    expect(seeked).toEqual([4])
    expect(poster).not.toBeNull()
    expect(poster!.timestamp).toBeCloseTo(4, 10)
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

  it('seeks a webcam clip’s unreadable duration to the fixed offset, not to frame 0', async () => {
    stubCanvas2DContext()
    const video = seekableVideo()
    const seeked: number[] = []
    video.addEventListener('seeked', () => seeked.push(video.currentTime))

    // Exactly what `useVideoSource` copies out of a MediaRecorder WebM element.
    const poster = await drawPosterFrame(
      video,
      metadata({ durationSec: Number.POSITIVE_INFINITY }),
    )

    expect(seeked).toEqual([POSTER_TIMESTAMP_FALLBACK_SECONDS])
    expect(poster!.timestamp).toBe(POSTER_TIMESTAMP_FALLBACK_SECONDS)
  })

  it('degrades to frame 0 — rather than to no poster — when that offset cannot be reached', async () => {
    const ctx = stubCanvas2DContext()
    // Half a second of recording, and a duration the element will not admit to: the offset is past
    // the end and its seek never completes, so the fallback is what keeps the clip picturable.
    const poster = await drawPosterFrame(
      seekableUpTo(0.5),
      metadata({ durationSec: Number.POSITIVE_INFINITY }),
      { seekTimeoutMs: 5 },
    )

    expect(poster).not.toBeNull()
    expect(poster!.timestamp).toBe(0)
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
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

  it('opens one detached decoder at a time, however many clips ask at once', async () => {
    stubCanvas2DContext()
    // The decoder's whole lifetime, bracketed: an object URL is minted before the element exists
    // and revoked after it is torn down, so an interleaved log is direct evidence of overlap.
    const log: string[] = []
    let minted = 0
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      minted += 1
      log.push(`open:${minted}`)
      return `blob:poster-${minted}`
    })
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      log.push(`close:${String(url).replace('blob:poster-', '')}`)
    })

    // One `addClip` per file, all in one tick — what `FileUpload`'s `multiple` picker does with a
    // four-file selection, and what mounts four `useClipPoster`s in a single flush.
    await Promise.all([
      deriveClipPoster(new Blob(['a']), metadata(), { loadTimeoutMs: 5 }),
      deriveClipPoster(new Blob(['b']), metadata(), { loadTimeoutMs: 5 }),
      deriveClipPoster(new Blob(['c']), metadata(), { loadTimeoutMs: 5 }),
      deriveClipPoster(new Blob(['d']), metadata(), { loadTimeoutMs: 5 }),
    ])

    // Strictly paired, never nested: `open:2` cannot appear before `close:1`. Serialized by
    // construction inside `deriveClipPoster`, so no caller had to arrange it.
    expect(log).toEqual([
      'open:1',
      'close:1',
      'open:2',
      'close:2',
      'open:3',
      'close:3',
      'open:4',
      'close:4',
    ])

    createSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('takes no place in the queue when there is nothing to decode', async () => {
    stubCanvas2DContext()
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    // Queued behind a real derivation, but resolves without waiting for it: no bytes means no
    // decoder, so there is nothing for it to be serialized against.
    const real = deriveClipPoster(new Blob(['a']), metadata(), { loadTimeoutMs: 50 })
    const settled: string[] = []
    void real.then(() => settled.push('real'))
    await deriveClipPoster(null, metadata()).then(() => settled.push('nothing'))

    expect(settled).toEqual(['nothing'])
    await real
    expect(settled).toEqual(['nothing', 'real'])

    createSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('does not wedge the queue when a derivation fails outright', async () => {
    stubCanvas2DContext()
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementationOnce(() => {
        throw new Error('no object URL for you')
      })
      .mockReturnValue('blob:poster')

    await expect(deriveClipPoster(new Blob(['a']), metadata())).rejects.toThrow('no object URL')
    // The clip behind it still gets its turn — the tail is deliberately never left rejected.
    await expect(
      deriveClipPoster(new Blob(['b']), metadata(), { loadTimeoutMs: 5 }),
    ).resolves.toBeNull()

    createSpy.mockRestore()
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

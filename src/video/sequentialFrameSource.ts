import type { DemuxedTrack } from './mp4Demux'

/** One decoded frame the caller's selector chose to keep, in presentation order. `index` counts
 * every decoded frame the decoder has output so far (selected or not) — its position in the full
 * presentation-ordered stream, not its position among selections — so a consumer can reason about
 * "frame 47 of the clip" even while most frames are being skipped. */
export interface SelectedVideoFrame {
  frame: VideoFrame
  index: number
  ptsSec: number
}

export interface SequentialFrameSource {
  /** Presentation-ordered, selected-only. Exactly one `SelectedVideoFrame` is live (open) at a
   * time from this iterable's point of view — see the module doc for the full lifecycle
   * contract; the consumer must close `frame` before pulling the next one. */
  frames: AsyncIterable<SelectedVideoFrame>
  /** Stops feeding the decoder, closes it, and closes/releases any frame still sitting in the
   * internal queue unconsumed. Safe to call at any point, including after `frames` has already
   * finished; idempotent. */
  stop: () => void
}

/**
 * Hard cap on selected-but-not-yet-consumed frames sitting in this module's own queue. Kept
 * small (not "1", to leave slack for the async round-trip between a frame being queued and the
 * feed loop's next backpressure check noticing) because the consumer
 * (`sampleClipSequential.ts`) is required to close each frame immediately after drawing it and
 * before starting the next detection — see that file's own lifecycle discipline doc. This queue
 * existing at all is about smoothing the handoff between the decoder's own async callback and the
 * consumer's async pull, not about buffering ahead.
 */
const MAX_QUEUED_FRAMES = 2

/** Hard cap on chunks handed to `decoder.decode()` before the decoder has finished processing
 * them (`decoder.decodeQueueSize`) — bounds how many `VideoFrame`s can still land in `output()`
 * after the feed loop's last backpressure check, on top of `MAX_QUEUED_FRAMES` itself. */
const MAX_DECODE_QUEUE_SIZE = 2

/**
 * A small async push/pull bridge between `VideoDecoder`'s synchronous, callback-driven `output`
 * and a `for await` consumer. `push` (called from `output`) can never block — WebCodecs gives no
 * way to pause an in-flight decode from inside its own output callback — so backpressure here is
 * necessarily applied upstream, via `waitForRoom` gating how many chunks the feed loop hands to
 * `decoder.decode()` in the first place (see `MAX_DECODE_QUEUE_SIZE`/`MAX_QUEUED_FRAMES` above).
 */
class SelectedFrameQueue {
  private pending: SelectedVideoFrame[] = []
  private waitingConsumer: ((result: IteratorResult<SelectedVideoFrame>) => void) | null = null
  private waitingProducer: (() => void) | null = null
  private done = false
  private error: Error | null = null

  push(item: SelectedVideoFrame): void {
    if (this.done) {
      // A push after stop()/finish() would leak — the queue is no longer being drained.
      item.frame.close()
      return
    }
    if (this.waitingConsumer) {
      const resolve = this.waitingConsumer
      this.waitingConsumer = null
      resolve({ value: item, done: false })
      return
    }
    this.pending.push(item)
  }

  size(): number {
    return this.pending.length
  }

  /** Resolves once `size() < maxSize` (immediately, if already true) — how the feed loop applies
   * backpressure without polling. */
  waitForRoom(maxSize: number): Promise<void> {
    if (this.pending.length < maxSize || this.done) return Promise.resolve()
    return new Promise((resolve) => {
      this.waitingProducer = resolve
    })
  }

  private wakeProducer(): void {
    if (this.waitingProducer) {
      const resolve = this.waitingProducer
      this.waitingProducer = null
      resolve()
    }
  }

  next(): Promise<IteratorResult<SelectedVideoFrame>> {
    const item = this.pending.shift()
    if (item) {
      this.wakeProducer()
      return Promise.resolve({ value: item, done: false })
    }
    if (this.error) return Promise.reject(this.error)
    if (this.done) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve) => {
      this.waitingConsumer = resolve
    })
  }

  /** Marks no more items will ever arrive — a pending/future `next()` call resolves `done: true`. */
  finish(): void {
    this.done = true
    this.wakeProducer()
    if (this.waitingConsumer) {
      const resolve = this.waitingConsumer
      this.waitingConsumer = null
      resolve({ value: undefined, done: true })
    }
  }

  /** Same as `finish()`, but a pending/future `next()` call rejects instead. */
  fail(error: Error): void {
    this.error = error
    this.done = true
    this.wakeProducer()
    if (this.waitingConsumer) {
      const resolve = this.waitingConsumer
      this.waitingConsumer = null
      // The consumer's `next()` promise was already handed out with a resolve function, not a
      // reject one — surface the error through a rejected value's `done: true` is not an option,
      // so reject by throwing from within the resolved iteration is handled by the caller
      // instead: `frames`' async generator below checks `error` after every `finish()`-triggered
      // `done: true` and throws if one was recorded.
      resolve({ value: undefined, done: true })
    }
  }

  /** Closes every frame still sitting in the queue, unconsumed — `stop()`'s cleanup. */
  drainAndCloseAll(): void {
    for (const item of this.pending) {
      item.frame.close()
    }
    this.pending = []
  }

  readError(): Error | null {
    return this.error
  }
}

function encodedChunkType(isKeyframe: boolean): EncodedVideoChunkType {
  return isKeyframe ? 'key' : 'delta'
}

const MICROSECONDS_PER_SECOND = 1_000_000

/**
 * Opens a `VideoDecoder` configured for `track`'s codec and feeds it every demuxed sample in
 * decode order, applying `selectFrame` to each decoded frame's presentation timestamp as it comes
 * back out — the frame-rate-aware stride from `sequentialSamplingStep.ts`'s `createFrameSelector`
 * lives one layer up, in `sampleClipSequential.ts`; this module is handed the resulting predicate
 * rather than a config object so the close-vs-keep decision can happen synchronously inside
 * `output()`, immediately, which is the only way to avoid every unselected frame briefly existing
 * as an open `VideoFrame` (see the module-level memory discipline notes above `SelectedFrameQueue`).
 *
 * Rejects if the codec isn't decodable in this browser (`VideoDecoder.isConfigSupported`) rather
 * than opening a decoder doomed to error — lets the caller (`sampleClipSequential.ts`, reached
 * only after `webCodecsSupport.ts`'s own feasibility probe already said yes) fail fast and
 * distinctly from a mid-decode error.
 */
export async function openSequentialFrameSource(
  track: DemuxedTrack,
  selectFrame: (ptsSec: number) => boolean,
): Promise<SequentialFrameSource> {
  const config: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: track.width,
    codedHeight: track.height,
    ...(track.description ? { description: track.description } : {}),
  }

  const support = await VideoDecoder.isConfigSupported(config)
  if (!support.supported) {
    throw new Error(`VideoDecoder does not support codec "${track.codec}" in this browser.`)
  }

  const queue = new SelectedFrameQueue()
  let outputIndex = 0
  let stopped = false

  const decoder = new VideoDecoder({
    output: (frame) => {
      const index = outputIndex
      outputIndex += 1
      const ptsSec = frame.timestamp / MICROSECONDS_PER_SECOND
      if (stopped || !selectFrame(ptsSec)) {
        frame.close()
        return
      }
      queue.push({ frame, index, ptsSec })
    },
    error: (err) => {
      queue.fail(err instanceof Error ? err : new Error(String(err)))
    },
  })
  decoder.configure(config)

  // Indirection around `decoder.state === 'closed'` is deliberate, not stylistic: `state` can
  // change asynchronously underneath this loop (the decoder closes itself on a fatal error, or
  // `stop()` closes it from outside), but TypeScript's control-flow narrowing doesn't know that
  // and, having seen one `=== 'closed'` guard return early, treats every *later* comparison in
  // this function as provably false — a real compile error (TS2367), not a lint nit. A function
  // call is opaque to that narrowing, which is exactly what's needed here since the property
  // genuinely can flip between calls.
  const isDecoderClosed = () => decoder.state === 'closed'

  const feed = async () => {
    try {
      for (const sample of track.samples) {
        if (stopped || isDecoderClosed()) return
        // Backpressure on two independent resources: the decoder's own internal queue (chunks
        // handed to decode() but not yet output) and this module's selected-frame queue (output
        // frames the consumer hasn't pulled yet). Either one filling up means "don't feed more
        // yet" — see MAX_DECODE_QUEUE_SIZE/MAX_QUEUED_FRAMES's docs above.
        while (
          !stopped &&
          !isDecoderClosed() &&
          (decoder.decodeQueueSize >= MAX_DECODE_QUEUE_SIZE || queue.size() >= MAX_QUEUED_FRAMES)
        ) {
          // Only race a wait actually tied to whichever resource is over-full right now — NOT
          // both unconditionally. `queue.waitForRoom()` resolves immediately whenever the queue
          // already has room (by design, for callers that only sometimes need to wait), so
          // including it here while the decoder's own queue is the actual bottleneck would make
          // `Promise.race` settle on every loop iteration without ever really waiting for the
          // decoder to catch up — a tight, non-yielding microtask loop that starves the event
          // loop entirely (confirmed live: the page became fully unresponsive, not just slow).
          const waiters: Promise<void>[] = []
          if (decoder.decodeQueueSize >= MAX_DECODE_QUEUE_SIZE) {
            waiters.push(
              new Promise<void>((resolve) => {
                decoder.addEventListener('dequeue', () => resolve(), { once: true })
              }),
            )
          }
          if (queue.size() >= MAX_QUEUED_FRAMES) {
            waiters.push(queue.waitForRoom(MAX_QUEUED_FRAMES))
          }
          await Promise.race(waiters)
        }
        if (stopped || isDecoderClosed()) return

        decoder.decode(
          new EncodedVideoChunk({
            type: encodedChunkType(sample.isKeyframe),
            timestamp: Math.round(sample.ptsSec * MICROSECONDS_PER_SECOND),
            duration: Math.round(sample.durationSec * MICROSECONDS_PER_SECOND),
            data: sample.data,
          }),
        )
      }
      if (!stopped && !isDecoderClosed()) {
        await decoder.flush()
      }
    } catch (err) {
      queue.fail(err instanceof Error ? err : new Error(String(err)))
    } finally {
      queue.finish()
      if (!isDecoderClosed()) decoder.close()
    }
  }

  void feed()

  async function* frames(): AsyncGenerator<SelectedVideoFrame, void, void> {
    while (true) {
      const result = await queue.next()
      if (result.done) {
        const error = queue.readError()
        if (error) throw error
        return
      }
      yield result.value
    }
  }

  return {
    frames: { [Symbol.asyncIterator]: frames },
    stop: () => {
      if (stopped) return
      stopped = true
      queue.finish()
      queue.drainAndCloseAll()
      if (!isDecoderClosed()) decoder.close()
    },
  }
}

import { probeContainerTiming } from './containerTiming'
import type { ContainerTimingProbe } from './containerTiming'
import { demuxMp4 } from './mp4Demux'
import type { DemuxedTrack } from './mp4Demux'

/**
 * One read and one demux of a clip's bytes per session, shared by every stage that needs them
 * (`strides-dt9`).
 *
 * Before this existed a single MP4 clip was read whole with `blob.arrayBuffer()` four times and
 * demuxed three: the sequential-decode feasibility probe (`webCodecsSupport.ts`), the primary
 * sampler and the background scale pass (both `sampleClipSequential.ts`), plus the evidence seek
 * calibration's container probe (`evidenceSeekOffset.ts`) and its own call back into the
 * feasibility probe. A Blob's bytes never change, so every one of those re-derived the same
 * answer.
 *
 * Two caches, both keyed by the `Blob` itself so a clip that leaves the session takes its entries
 * with it:
 *
 * - the demuxed track — the expensive one, since `demuxMp4` retains the whole compressed
 *   bitstream. Held only while a pass may still sample it; `releaseClipDemux` drops it.
 * - the container-timing probe — a few numbers per track, kept for the clip's lifetime. Seeded
 *   from the SAME bytes the demux reads, so evidence calibration never reads the blob again.
 *
 * Sharing one `ArrayBuffer` between the two parses is safe because mp4box copies its input
 * (`MP4BoxBuffer.fromArrayBuffer` allocates a fresh buffer and `set`s the bytes into it), so
 * neither parse can see the other's state. Samples stay reusable across passes because
 * `EncodedVideoChunk` copies `data` on construction and `sequentialFrameSource.ts` only reads the
 * track.
 *
 * Lives in its own module rather than inside `mp4Demux.ts` so a test that mocks `./mp4Demux`
 * still intercepts the demux reached through here.
 */

/** Where one `demuxClip` call's time went. On a cache hit the read and container-probe stages
 * are `0` — that call did neither — and `demuxMs` is the time spent waiting on the shared result,
 * which is `~0` once it has settled. */
export interface ClipDemuxTimings {
  arrayBufferMs?: number
  containerProbeMs?: number
  demuxMs?: number
}

let demuxes = new WeakMap<Blob, Promise<DemuxedTrack>>()
let containerProbes = new WeakMap<Blob, Promise<ContainerTimingProbe>>()

/** Converts a synchronous throw into a rejection while still starting the read immediately. */
async function readClipBytes(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer()
}

/** Caches `probe` for `blob`, evicting it if it rejects so a later call can retry — but only
 * while the map still holds this same promise, never a newer one. */
function cacheContainerProbe(
  blob: Blob,
  probe: Promise<ContainerTimingProbe>,
): Promise<ContainerTimingProbe> {
  containerProbes.set(blob, probe)
  probe.catch(() => {
    if (containerProbes.get(blob) === probe) containerProbes.delete(blob)
  })
  return probe
}

async function readAndDemux(
  read: Promise<ArrayBuffer>,
  seededProbe: Promise<ContainerTimingProbe> | null,
  timings: ClipDemuxTimings | undefined,
): Promise<DemuxedTrack> {
  const readStartedAt = performance.now()
  const bytes = await read
  const probeStartedAt = performance.now()
  if (timings) timings.arrayBufferMs = probeStartedAt - readStartedAt
  // Settled before the demux starts so the two parses never hold their copies of the bytes at
  // the same time.
  if (seededProbe !== null) await seededProbe
  const demuxStartedAt = performance.now()
  if (timings) timings.containerProbeMs = demuxStartedAt - probeStartedAt
  const track = await demuxMp4(bytes)
  if (timings) timings.demuxMs = performance.now() - demuxStartedAt
  return track
}

/**
 * The clip's demuxed video track, read and demuxed at most once while cached. Concurrent callers
 * share one promise and resolve to the identical `DemuxedTrack`. A rejection (unreadable blob,
 * not an MP4) is not cached: the next call tries again.
 */
export async function demuxClip(blob: Blob, timings?: ClipDemuxTimings): Promise<DemuxedTrack> {
  const cached = demuxes.get(blob)
  if (cached !== undefined) {
    const waitStartedAt = performance.now()
    try {
      return await cached
    } finally {
      if (timings) {
        timings.arrayBufferMs = 0
        timings.containerProbeMs = 0
        timings.demuxMs = performance.now() - waitStartedAt
      }
    }
  }

  const read = readClipBytes(blob)
  const seededProbe = containerProbes.has(blob)
    ? null
    : cacheContainerProbe(blob, read.then(probeContainerTiming))
  const pending = readAndDemux(read, seededProbe, timings)
  demuxes.set(blob, pending)
  pending.catch(() => {
    if (demuxes.get(blob) === pending) demuxes.delete(blob)
  })
  return pending
}

/**
 * The clip's container-timing probe: the one `demuxClip` already took from the same bytes when
 * there was one, otherwise a read of its own (a WebM, a blob over the sequential size cap, or a
 * session where the sequential plane is switched off). Rejects only when the blob cannot be
 * read, and that rejection is not cached.
 */
export function probeClipContainerTiming(blob: Blob): Promise<ContainerTimingProbe> {
  const cached = containerProbes.get(blob)
  if (cached !== undefined) return cached
  return cacheContainerProbe(blob, readClipBytes(blob).then(probeContainerTiming))
}

/** Drops the clip's demuxed track — the large entry — once no pass will sample it again. The
 * container probe stays. A later `demuxClip` reads and demuxes afresh. */
export function releaseClipDemux(blob: Blob): void {
  demuxes.delete(blob)
}

export function __resetForTests(): void {
  demuxes = new WeakMap()
  containerProbes = new WeakMap()
}

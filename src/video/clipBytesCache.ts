import { probeContainerTiming } from './containerTiming'
import type { ContainerTimingProbe } from './containerTiming'
import { demuxMp4 } from './mp4Demux'
import type { DemuxedTrack } from './mp4Demux'
import { logPerfTimings, roundMs } from '../results/perfTimings'

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
 * - the container-timing probe — a few numbers per track, kept for the clip's lifetime. Taken
 *   from the SAME bytes the demux read, so evidence calibration never reads the blob again — but
 *   only after the demux has settled and its waiting callers have resumed, because nothing needs
 *   it before evidence and the feasibility probe gating auto-start should not wait on it. Its time
 *   is reported on its own `[perf-timings]` line, stage `container-probe`.
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

/** Where one `demuxClip` call's time went. On a cache hit the read stage is `0` — that call did
 * no read — and `demuxMs` is the time spent waiting on the shared result, which is `~0` once it
 * has settled. */
export interface ClipDemuxTimings {
  arrayBufferMs?: number
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
  timings: ClipDemuxTimings | undefined,
): Promise<DemuxedTrack> {
  const readStartedAt = performance.now()
  const bytes = await read
  const demuxStartedAt = performance.now()
  if (timings) timings.arrayBufferMs = demuxStartedAt - readStartedAt
  const track = await demuxMp4(bytes)
  if (timings) timings.demuxMs = performance.now() - demuxStartedAt
  return track
}

async function probeAndReport(
  blob: Blob,
  bytes: ArrayBuffer,
  source: 'demux-read' | 'own-read',
): Promise<ContainerTimingProbe> {
  const startedAt = performance.now()
  const probe = await probeContainerTiming(bytes)
  logPerfTimings('container-probe', {
    bytes: blob.size,
    source,
    containerProbeMs: roundMs(performance.now() - startedAt),
  })
  return probe
}

/** The container probe for a clip `demuxClip` is reading: the same bytes, parsed once the demux
 * has settled either way (so the two mp4box parses never run at once), and one macrotask later
 * still, so every caller awaiting the track resumes before this parse takes the thread. */
async function probeAfterDemux(
  blob: Blob,
  read: Promise<ArrayBuffer>,
  demuxed: Promise<DemuxedTrack>,
): Promise<ContainerTimingProbe> {
  const bytes = await read
  await demuxed.catch(() => undefined)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return probeAndReport(blob, bytes, 'demux-read')
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
        timings.demuxMs = performance.now() - waitStartedAt
      }
    }
  }

  const read = readClipBytes(blob)
  const pending = readAndDemux(read, timings)
  demuxes.set(blob, pending)
  pending.catch(() => {
    if (demuxes.get(blob) === pending) demuxes.delete(blob)
  })
  // Cached now, not once the demux settles, so a probe asked for mid-read or mid-demux shares
  // this read instead of starting another.
  if (!containerProbes.has(blob)) cacheContainerProbe(blob, probeAfterDemux(blob, read, pending))
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
  return cacheContainerProbe(
    blob,
    readClipBytes(blob).then((bytes) => probeAndReport(blob, bytes, 'own-read')),
  )
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

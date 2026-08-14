import type { PoseDetector } from '../pose/detector'
import type { PoseSample } from '../pose/robustness/types'
import { sampleClip } from './sampleClip'
import type { SampleClipHandle, SampleClipOptions } from './sampleClip'
import { sampleClipSequential } from './sampleClipSequential'
import type { SequentialSamplingConfig } from './sequentialSamplingStep'

/**
 * The single shared entry point both sampling call sites (the primary analysis run and the
 * background MediaPipe scale pass, both in `useVideoAnalysis.ts`) use — dispatches to the
 * WebCodecs sequential-decode sampler (`sampleClipSequential.ts`) or the existing
 * `<video>`-playback sampler (`sampleClip.ts`).
 *
 * The dispatch signal is `sourceBlob` itself, not a separate boolean parameter: by the time this
 * is called, the caller has already resolved `webCodecsSupport.ts`'s `canUseSequentialDecode`
 * probe (see `useVideoAnalysis.ts`'s notes on why that resolution has to happen before this call,
 * not inside it — the autoplay-policy timing constraint on the primary run's synchronous,
 * click-derived `start()`) and passes the real blob only when the probe said yes.
 * `sourceBlob: null` unconditionally means "use the playback path" — whether because no blob was
 * available at all, or because the probe rejected this one — so there is no separate boolean to
 * disagree with whether a blob was actually handed in.
 */
export function sampleClipAdaptive(
  video: HTMLVideoElement,
  sourceBlob: Blob | null,
  detector: PoseDetector,
  durationSec: number,
  opts: SampleClipOptions,
  sequentialSamplingConfig: SequentialSamplingConfig,
): { promise: Promise<PoseSample[]>; handle: SampleClipHandle } {
  if (sourceBlob !== null) {
    return sampleClipSequential(sourceBlob, detector, durationSec, opts, sequentialSamplingConfig)
  }
  return sampleClip(video, detector, durationSec, opts)
}

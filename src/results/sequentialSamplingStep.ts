/**
 * The WebCodecs sequential-decode path's sampling-density knob. Lives here, next to the pure
 * selector logic that's its only consumer — `samplingRobustnessConfig.ts` imports this type
 * to fold it into the sampling/robustness plane alongside `RobustnessConfig`, the same way that
 * file already imports `RobustnessConfig` from its own primary module rather than declaring it
 * itself.
 */
export interface SequentialSamplingConfig {
  /**
   * Master switch for the whole WebCodecs sequential-decode path (`sampleClipAdaptive.ts`'s
   * dispatch, gated in `useVideoAnalysis.ts`). Default **`false`** — same "ship the new pipeline
   * plane off by default" precedent as `ScalePassConfig`/tracking-crop (see this repo's
   * CLAUDE.md), and for the same kind of reason: a pre-registered live A/B (design.md's D7)
   * measured the sequential path taking `view` detection confidence to 0 on 3/3 trials of one of
   * only two reference clips — a real, measured regression, not a hypothetical one. Off means the
   * feasibility probe (`webCodecsSupport.ts`) never even runs — `sampleClipAdaptive.ts` always
   * dispatches to the existing, proven `<video>`-playback path (`sampleClip.ts`), unchanged from
   * before this plane existed. Flip via the dev-only `__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__`
   * window override (see `samplingRobustnessConfig.ts`) to A/B it.
   */
  enabled: boolean
  /** Target decoded-frame sampling rate in frames/sec. `null` means "every decoded frame" —
   * matching `sampleClip.ts`'s existing playback-path behavior of sampling whatever the detector
   * can keep up with, rather than a fixed rate. Meaningless while `enabled` is `false`. */
  targetSamplesPerSecond: number | null
}

/**
 * Builds a stateful frame-selection predicate for the WebCodecs sequential-decode path: call it
 * once per decoded frame, in presentation order (increasing `ptsSec`), and it returns whether
 * that frame should be sampled.
 *
 * PTS-bucket based, not index-modulo (`i % everyNth`): a fixed frame-index stride is only correct
 * on constant-frame-rate content — on variable-frame-rate content (a real possibility for
 * uploaded/phone-recorded clips, see this repo's CLAUDE.md notes on container metadata lying
 * about frame counts) a fixed index stride drifts against wall-clock time as the source frame
 * spacing changes, silently biasing sample density toward whichever stretches of the clip happen
 * to have denser frames. Bucketing directly on presentation time is immune to that: frame N is
 * selected iff it's the first decoded frame to land in a new `floor(ptsSec * targetSamplesPerSecond)`
 * bucket, so selected timestamps land at a roughly even cadence in real time regardless of how the
 * source frames were spaced.
 *
 * `targetSamplesPerSecond: null` means "every decoded frame" — the selector always returns
 * `true`, matching `sampleClip.ts`'s existing behavior of sampling whatever the detector can keep
 * up with rather than a fixed target rate.
 *
 * When `targetSamplesPerSecond` meets or exceeds the source's actual frame rate, every (or
 * nearly every) frame lands in its own new bucket, so this degrades gracefully to "select
 * everything" rather than needing a separate code path.
 */
export function createFrameSelector(
  config: SequentialSamplingConfig,
): (ptsSec: number) => boolean {
  const { targetSamplesPerSecond } = config

  if (targetSamplesPerSecond === null) {
    return () => true
  }

  let lastSelectedBucket: number | null = null

  return (ptsSec: number): boolean => {
    const bucket = Math.floor(ptsSec * targetSamplesPerSecond)
    if (lastSelectedBucket !== null && bucket <= lastSelectedBucket) {
      return false
    }
    lastSelectedBucket = bucket
    return true
  }
}

/**
 * The WebCodecs sequential-decode path's sampling-density knob. Lives here, next to the pure
 * selector logic that's its only consumer — `samplingRobustnessConfig.ts` imports this type
 * to fold it into the sampling/robustness plane alongside `RobustnessConfig`, the same way that
 * file already imports `RobustnessConfig` from its own primary module rather than declaring it
 * itself.
 */
export interface SequentialSamplingConfig {
  /** Target decoded-frame sampling rate in frames/sec. `null` means "every decoded frame" —
   * matching `sampleClip.ts`'s existing playback-path behavior of sampling whatever the detector
   * can keep up with, rather than a fixed rate. */
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

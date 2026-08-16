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
   * dispatch, gated in `useVideoAnalysis.ts`). Default **`true`** as of 2026-08-16 — deliberately
   * accepts a known, unresolved regression: a pre-registered live A/B (design.md's D7) measured
   * the sequential path taking `view` detection confidence to 0 on 3/3 trials of one of only two
   * reference clips (side-view/MoveNet), and VO-cm anchors reading 8-14% low on both clips. Root
   * cause not isolated — working theory is MoveNet detecting worse on WebCodecs canvas-drawn
   * `VideoFrame`s than on natively-played `<video>` frames for that specific clip; ruled out:
   * rendering bug, non-determinism, `video.play()` GPU contention. See design.md D7 before
   * trusting confidence/VO-cm values on side-view MoveNet runs. `false` restores the previous
   * default (`<video>`-playback path, `sampleClip.ts`, real-time sampling, the
   * device/run-to-run nondeterminism this plane exists to fix). Flip via the dev-only
   * `__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__` window override (see
   * `samplingRobustnessConfig.ts`).
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

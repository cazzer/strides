import type { ContainerTimingProbe, ContainerVideoTrackTiming } from './containerTiming'

/**
 * Detects raw (device-native, container-level) slow-motion footage from `containerTiming.ts`'s
 * parsed timing metadata -- e.g. an iPhone slo-mo clip whose 240fps capture is presented at a
 * stretched, slower rate. Motivation (GitHub #42): this pipeline's cadence/vertical-oscillation
 * estimators search a fixed 1.2-4.0 Hz bounce-frequency band
 * (`HeuristicsConfig.spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`,
 * `src/heuristics/types.ts`) -- correct for real running cadence, but a true 180 spm cadence
 * filmed at 8x slow-motion plays back at 22.5 spm (0.375 Hz), BELOW the grid's floor entirely.
 * Today that clip either returns a `null` cadence with a generic "clip too short" caveat, or (see
 * below) a specific, actionable one -- either way, silently wrong is the failure mode this module
 * exists to catch, not to fix: it is detect-only. Nothing here rescales frame timestamps or
 * feeds a corrected fps back into the pipeline; see this module's write-up in this worktree's
 * CLAUDE.md ("Slow-motion clip detection investigation") for why that is a deliberate scope
 * boundary, not a deferred follow-up.
 *
 * ## The predicate: a conjunction, not either signal alone
 *
 * `detected` requires BOTH:
 * 1. **Native capture-rate**: `nominalFps >= config.minNativeFps` (default 100). Clears ordinary
 *    24/25/30/60fps content with wide margin, sits below iPhone's 120/240fps slo-mo tiers.
 * 2. **Retiming**: `containerTiming.ts`'s `stretchFactor >= config.minStretchFactor` (default
 *    1.5x) -- an edit list that measurably stretches presentation duration beyond ordinary-trim
 *    noise, whether that number came from an explicit rate declaration or was inferred from
 *    comparing durations (see `ContainerVideoTrackTiming.stretchFactor`'s doc).
 *
 * Neither alone is safe: fps-alone false-positives on legitimate high-fps capture that was never
 * retimed (e.g. footage shot at 120fps and simply played back at 120fps -- fast motion, not slow
 * motion). Elst-presence-alone false-positives on ordinary trimmed clips: most NLE exports and
 * even un-trimmed encoder output carry a UNITY-rate edit list as a matter of course (verified on
 * this repo's own `park-approach.mp4` demo clip during this spike -- see the CLAUDE.md write-up
 * -- its edit list exists purely as a ~2-frame priming offset, not a retime). Requiring both, at
 * a real stretch magnitude, is what separates "this container mentions an edit list" from "this
 * container is presenting media slower than it was natively sampled."
 *
 * ## Confidence tiers
 *
 * `'high'`: predicate holds AND the winning `stretchFactor` came from `containerTiming.ts`'s
 * direct-rate path -- the container explicitly declares its own playback-rate change, nothing
 * inferred. `'medium'`: predicate holds but the winning `stretchFactor` came from the
 * duration-ratio path -- still a real, thresholded signal, just one inferential step further
 * from an explicit declaration. `'none'`: predicate does not hold, for any reason (see `reason`)
 * -- includes every parse failure, since this fails closed on anything it cannot confidently
 * read (`ContainerTimingProbe.parseStatus !== 'ok'`).
 *
 * ## Known reach limit, found empirically during this spike
 *
 * `containerTiming.ts`'s module doc documents the specific finding in full, but the headline
 * matters here too: the one retiming tool actually available to build a test fixture with
 * (ffmpeg's `-itsscale`) produces a shape this predicate CANNOT detect -- it rewrites `stts`
 * sample deltas directly (so `nominalFps` reads the already-slowed rate, failing signal 1) rather
 * than stretching an edit list against an unchanged native `stts` (the shape signal 2 targets).
 * This predicate is verified, by construction, against the shape it is DESIGNED to catch (a
 * hand-built fixture modeling "native high stts rate + a separately stretched edit list" -- see
 * `src/video/__fixtures__/`) -- but whether any real device's native slow-motion recording
 * actually produces that shape, versus ffmpeg's shape, versus something else entirely (Apple's
 * proprietary slow-motion metadata track), is UNVERIFIED. Zero real iPhone slow-motion clips were
 * available to this spike. Treat a `'none'` result as "no known raw-slow-motion signature found,"
 * not as "this clip is confirmed normal-speed."
 *
 * ## ⚠️ This predicate structurally cannot fire on real user input, and something else now covers
 * the motivating case
 *
 * The reach limit above turned out to be the whole story rather than a fixture inconvenience. **iOS
 * BAKES the retiming in when a clip leaves Photos**: an upload from the camera roll arrives at 30
 * nominal fps with a unity-rate edit list, `stretchFactor` ≈ 1.00003, and no capture rate recorded
 * anywhere in the container — the same shape `-itsscale` produces, and the shape signal 1 rejects.
 * Confirmed on all three of this repo's demo clips, one of which (`park-side-portrait.mp4`) really
 * is ~7-8x slow motion: `TAG:encoder=Lavc… libx264`, `handler_name=Core Media Video`, zero
 * `com.apple.quicktime` tags. The in-app recording path (`getUserMedia`, `WebcamCapture.tsx`)
 * cannot produce slow motion at all. So `nominalFps >= 100` has nothing to match on any input this
 * app can actually receive.
 *
 * The motivating case is instead covered from the CONTENT side, which is the only side that can
 * see it: `src/heuristics/bounceSpectrum.ts` fits the hip bounce a second time on a disjoint grid
 * below the human-gait floor, and a confident fit there IS the retiming signal — no container
 * metadata required, and no slowdown factor recovered or needed (`cadence.ts`, "Why a sub-floor
 * rhythm withholds this metric and only this metric").
 *
 * **This module is deliberately left exactly as it is**: not wired to anything, not extended, not
 * deleted. It has no callers, and that is the honest state — the predicate is correct for the shape
 * it targets and remains the right starting point if a real device-native slow-motion container
 * ever turns up. Its `'none'` on a genuinely retimed clip is a true negative about CONTAINERS, not
 * a bug to fix by loosening `minNativeFps`.
 */
export type SlowMotionConfidence = 'high' | 'medium' | 'none'

export interface SlowMotionDetectionConfig {
  /** Nominal fps at/above which a track's native sample rate counts as "camera-native slow-motion
   * tier" -- see this module's doc for why 100 (clears 24-60fps with margin, sits below
   * iPhone's 120/240fps tiers). */
  minNativeFps: number
  /** `stretchFactor` at/above which a container-declared or -inferred retime counts as
   * "measurably slower than natively sampled," rather than ordinary-trim noise. */
  minStretchFactor: number
}

export const DEFAULT_SLOW_MOTION_DETECTION_CONFIG: SlowMotionDetectionConfig = {
  minNativeFps: 100,
  minStretchFactor: 1.5,
}

export interface SlowMotionDetectionResult {
  detected: boolean
  confidence: SlowMotionConfidence
  /** The track this result describes -- the first video track in the probe, or `null` when the
   * probe carried none (or failed to parse). Only ever more than one video track exist for
   * unusual multi-angle/multi-stream files; this module evaluates the first and does not attempt
   * to reconcile disagreement across tracks -- a known simplification, not a considered design
   * choice, see the CLAUDE.md write-up's Backlog. */
  trackId: number | null
  nominalFps: number | null
  stretchFactor: number | null
  stretchFactorSource: 'direct-rate' | 'duration-ratio' | null
  /** Human-readable, developer-facing explanation of the result -- which signal(s) fired or
   * failed and why. Not user-facing copy. */
  reason: string
}

function noneResult(reason: string, track?: ContainerVideoTrackTiming | null): SlowMotionDetectionResult {
  return {
    detected: false,
    confidence: 'none',
    trackId: track?.trackId ?? null,
    nominalFps: track?.nominalFps ?? null,
    stretchFactor: track?.stretchFactor ?? null,
    stretchFactorSource: track?.stretchFactorSource ?? null,
    reason,
  }
}

/**
 * Evaluates the raw-slow-motion predicate against an already-parsed `ContainerTimingProbe` (see
 * `probeContainerTiming` in `containerTiming.ts`). Pure and synchronous -- all the async,
 * fallible work (reading the file, driving the MP4 box parser) already happened upstream.
 */
export function detectSlowMotion(
  probe: ContainerTimingProbe,
  config: SlowMotionDetectionConfig = DEFAULT_SLOW_MOTION_DETECTION_CONFIG,
): SlowMotionDetectionResult {
  if (probe.parseStatus !== 'ok') {
    return noneResult(`container timing probe did not parse cleanly: ${probe.parseStatus}`)
  }

  const track = probe.videoTracks[0]
  if (!track) {
    return noneResult('no video track found in container')
  }

  const highFps = track.nominalFps != null && track.nominalFps >= config.minNativeFps
  if (!highFps) {
    return noneResult(
      `nominal fps ${track.nominalFps ?? 'null'} below native-capture-rate threshold ${config.minNativeFps}`,
      track,
    )
  }

  if (track.elst.length === 0) {
    return noneResult('no edit list present -- high fps alone is not treated as slow-motion', track)
  }

  const stretched = track.stretchFactor != null && track.stretchFactor >= config.minStretchFactor
  if (!stretched) {
    return noneResult(
      `edit list present but stretch factor ${track.stretchFactor ?? 'null'} below threshold ${config.minStretchFactor} -- looks like an ordinary trim, not a retime`,
      track,
    )
  }

  const confidence: SlowMotionConfidence = track.stretchFactorSource === 'direct-rate' ? 'high' : 'medium'
  return {
    detected: true,
    confidence,
    trackId: track.trackId,
    nominalFps: track.nominalFps,
    stretchFactor: track.stretchFactor,
    stretchFactorSource: track.stretchFactorSource,
    reason: `nominal fps ${track.nominalFps} >= ${config.minNativeFps} AND stretch factor ${track.stretchFactor} (${track.stretchFactorSource}) >= ${config.minStretchFactor}`,
  }
}

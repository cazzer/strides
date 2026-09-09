# Detect retimed (slow-motion) clips below the gait floor

## Why

`src/video/demo-clips/park-side-portrait.mp4` is roughly 7× slow motion. Its on-screen step
frequency is ~0.39 Hz (~23 spm) against `spectralFitMinFrequencyHz` = 1.2, so the shared hip-bounce
spectral fit finds no candidate it can explain the trace with, `sinusoidR2` collapses to **0.0231**,
and `cadenceMinFitR2` / `verticalOscillationMinFitR2` (0.30) correctly reject it. Diagnosed under
`strides-aha`; the gate is behaving exactly as designed.

**The damage is not just missing data.** Because the fit fails, `footstrikes.ts` routes to the
ankle-difference FALLBACK detector, which reports **13 strikes across a window that physically
contains 4** (keyframe-confirmed: contacts at ≈1.4 / 3.9 / 6.4 / 8.9 s, a uniform ~2.5 s step
period). `overstriding` (−0.008) and `footStrikePattern` (−0.240) are computed from those wrong
instants **at confidence 1.0** and fused into the panel. That is the mechanism behind the
`strides-5hj` cross-clip disagreement.

**This is a real-user feature, not demo housekeeping.** iOS renders slow motion when a clip leaves
Photos, so an upload from the camera roll arrives with the retiming baked into `stts`: 30 fps
nominal, unity-rate `elst`, `stretchFactor` ≈ 1.00003, and no capture rate recorded anywhere.
`src/video/slowMotionDetection.ts`'s container predicate requires `nominalFps >= 100` and therefore
**structurally cannot fire on any input this app can receive**. Content-side detection is the only
mechanism that can work.

**The key asymmetry — only cadence needs the slowdown factor.** Cadence is the only `MetricId` whose
value is a RATE. `overstriding`, `footStrikePattern`, `stepWidth`, `trunkLean`, `kneeFlexion` and
`kneeDrive` are spatial and measured AT an instant; `verticalOscillation` and `armSwingAmplitude`
are ratios; `verticalOscillationCm` and `stepWidthCm` are distances; `verticalRatio` uses
`fit.frequencyHz` only for a period gate, where both sides stretch alike. So correcting the FIT
fixes contact timing and every spatial metric with no factor required, on any device.

## What changes

1. **A two-pass bounce fit.** New `src/heuristics/bounceSpectrum.ts` exports `fitBounceSpectrum`.
   Pass 1 is today's grid, unchanged. Pass 2 runs **only** when pass 1 fails to clear
   `verticalOscillationMinFitR2`, over a **disjoint** sub-floor grid
   `[spectralFitMinFrequencyHz / MAX_RETIMING_FACTOR, spectralFitMinFrequencyHz −
   spectralFitFrequencyStepHz]`, and is adopted only if it clears that same gate. Disjointness is
   the safety property: a sub-floor candidate can never displace a winning in-band peak.
2. **One boolean carrier.** `HipBounceAnalysis.subFloorRhythm`. `cadence.ts` is the only reader.
   Nothing on `FormHeuristicsResult`, no new status, no new `MetricId`, **no new threshold** — the
   human-gait floor already IS `spectralFitMinFrequencyHz`.
3. **Every factor-independent metric publishes normally** on a detected clip. This is what converts
   `park-side-portrait` from actively wrong to correct.
4. **Cadence alone is withheld**, with a caveat naming the retiming rather than the rhythm.
5. `verticalOscillationCm.calibrate` fits its per-run metre series through the same function, so the
   vertical-oscillation family cannot disagree with itself about whether a clip has a measurable
   rhythm.

`footstrikes.ts` needs no code change — a successful two-pass fit makes `isRhythmTrustworthy` pass
on its own.

## Deliberately out of scope

Inferring the slowdown factor so that a cadence could be reported (candidate route: peak ankle
velocity relative to the hip in torso-lengths/sec, which scales with `k` through an observable that
is not itself a cadence, cross-checked against the discrete capture-rate set 4/8/16/32); asking the
user to confirm the speed; motion-blur-versus-displacement detection; extending the two-pass to
`armSwing.ts`. **Widening the shipped band globally is explicitly rejected** — measured under
`strides-aha`, a 0.30 Hz floor makes this clip report a confidently-wrong 26 spm and silences
`verticalOscillationCm`'s `fit.frequencyHz × 60 == cadence.value` tripwire by making it agree.

6. **Sub-floor adoption is a significance test, not a threshold.** A pass-2 peak is adopted only if
   it clears `verticalOscillationMinFitR2` (so the downstream metrics will take it) AND is
   significant at a conventional 95% against an **AR(1) red-noise null** fitted to its own band
   (`src/heuristics/redNoiseNull.ts`). Pass 1 never consults it, so nothing that works today can
   move.

## ⚠️ Status: the blocker is closed

`design.md` §4 recorded a pre-registered negative control firing against this change: the sub-floor
pass adopted a rhythmless random walk as a "retimed rhythm" on **75–92%** of seeds at this corpus's
own sample counts, and did so on real footage — `park-side-portrait`'s background MediaPipe scale
pass adopting 0.15 Hz at R² 0.398 and rendering **46.4 cm** of vertical oscillation against a
~0.49 m torso. §4.3 showed that **no threshold on any field `SpectralFitSuccess` reports separates
the genuine detection from noise**, so a different KIND of discriminator was needed.

`strides-mc1` supplied one and `design.md` §8 carries it. Through the shipped `fitBounceSpectrum`,
300 seeds each: the random-walk adoption rate falls **91.7% → 4.3%** at the metre series' own sample
count, and the rate stays at the null's own 5% across a colour sweep from white to φ = 0.99 — where
it previously climbed to 91%. The genuine 0.39 Hz detection survives with a 3–15× margin. The
confidence level is the literature's conventional 0.95 and was **not** tuned; no second constant was
added and neither `verticalOscillationMinFitR2` nor `cadenceMinFitR2` was touched.

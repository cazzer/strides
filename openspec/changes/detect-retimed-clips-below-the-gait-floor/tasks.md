# Tasks

## 1. The two-pass fit

- [x] 1.1 New `src/heuristics/bounceSpectrum.ts`: `BounceSpectrumResult`, `fitBounceSpectrum`,
      `MAX_RETIMING_FACTOR = 8`. Module doc carries the disjointness proof, the adoption rule, why
      the gate is read here as arbitration between two fits of one series rather than as
      publish/withhold policy, and that `secondPeakRatio` on an adopted pass-2 fit is measured
      against sub-floor competitors only.
- [x] 1.2 Placed above `spectralFit.ts` and below `hipBounce.ts` — NOT inside `fitSpectralSinusoid`
      (whose doc reserves that file for well-posedness, and which `armSwing.ts` also calls), and NOT
      inline in `analyzeBounceSignal` (which cannot serve `verticalOscillationCm`'s metre-series
      fits).

## 2. Carrier and readers

- [x] 2.1 `hipBounce.ts`: `fitSpectralSinusoid` → `fitBounceSpectrum`; `HipBounceAnalysis` gains
      `subFloorRhythm: boolean` with a doc comment; module doc gains the two-pass paragraph.
- [x] 2.2 `cadence.ts`: `RETIMED_CAVEAT`; early return immediately after the `resolvedCount === 0`
      branch and BEFORE the quality gate (a sub-floor fit is a good fit and would otherwise
      publish); module-doc section "Why a sub-floor rhythm withholds this metric and only this
      metric".
- [x] 2.3 `verticalOscillationCm.ts`: `calibrate`'s per-run call → `fitBounceSpectrum`; the
      `fit.frequencyHz × 60` cross-check note amended to say the cross-check is unavailable on a
      retimed clip and that its absence is agreement, not disagreement.
- [x] 2.4 `cadence.ts` is the ONLY reader of `subFloorRhythm`. Nothing added to
      `FormHeuristicsResult`, no new status, no new `MetricId`.

## 3. Doc-only

- [x] 3.1 `types.ts`: `spectralFitMinFrequencyHz` is now also the retimed/not-retimed boundary;
      `verticalOscillationMinFitR2` is now also the pass-1/pass-2 arbitration rule; a mirror note on
      `cadenceMinFitR2` so the two are not later "unified".
- [x] 3.2 `footstrikes.ts`: `isRhythmTrustworthy` and `detectFootstrikesBetweenAnkles`'s "This path
      also runs more often…" note each gain a paragraph on the sub-floor path. No code change —
      a successful two-pass fit makes the predicate pass on its own.
- [x] 3.3 `src/video/slowMotionDetection.ts`: one paragraph recording that the container predicate
      cannot fire on baked iOS output and naming `bounceSpectrum.ts` as the mechanism that can. Not
      wired, not extended, not deleted.
- [x] 3.4 `CLAUDE.md`: correct the two stale claims in "Slow-motion clip detection investigation"
      and add a "what shipped" note.

## 4. Tests

- [x] 4.1 New `bounceSpectrum.test.ts`: bit-identity with a direct `fitSpectralSinusoid` call on an
      in-band clip; a 0.433 Hz / 30 fps / 12 s sinusoid detected within one grid step; negative
      control A (white noise); negative control B (pure quadratic drift); the adoption rule when
      neither pass clears; disjointness swept across the band; the `MAX_RETIMING_FACTOR` reach
      limit.
- [x] 4.2 `hipBounce.test.ts`: `subFloorRhythm` false on both existing fixture shapes, true on a
      sub-floor synthetic.
- [x] 4.3 `cadence.test.ts`: a sub-floor `generateSyntheticGait({ fps: 30, durationSec: 12,
      cadenceStepsPerMin: 26 })` yields `value: null`, `confidence: 0` and the retiming caveat
      (asserted NOT to be the "too irregular" wording); plus an in-band control asserting today's
      behaviour is untouched.
- [x] 4.4 `footstrikes.test.ts`: the same fixture reaches the phase path and emits one alternating
      strike per fitted step. ⚠️ **Deviation from plan**: the planned assertion that
      `detectFootstrikesBetweenAnkles` emits "materially more" on the identical frames does NOT
      hold on this fixture and was not forced — `generateSyntheticGait` emits a noiseless ankle
      trace, so the extremum scan has nothing spurious to latch onto and both paths return 5. The
      over-reporting is a real-footage property (measured live: 13 vs 4). The test asserts what the
      fixture can carry and states the limit in a comment.
- [x] 4.5 `index.test.ts`: a retimed fixture at constant `pixelsPerMeter` — `verticalOscillation.fit`
      non-null, `verticalOscillationCm.calibration.fit.frequencyHz === verticalOscillation.fit
      .frequencyHz`, `cadence.value === null` with the retiming caveat. The redefined tripwire, made
      executable.
- [x] 4.6 ⚠️ **Added, not planned**: a test asserting the KNOWN DEFECT in §4 of `design.md` — a
      rhythmless random walk is adopted as a sub-floor rhythm. Written so that fixing the adoption
      rule makes it fail loudly rather than leaving the defect as folklore.

## 5. Verification

- [x] 5.1 Keyframe ground truth on `park-side-portrait.mp4`: contacts at ≈1.4 / 3.9 / 6.4 / 8.9 s,
      a uniform ~2.5 s step period, **4 contacts** in the presence window.
- [x] 5.2 Three-clip `--evidence` A/B, 3 fresh-process trials, real GPU, identity-verified server.
      `side-landscape` and `front-approach` **0 fields moved** outside `elapsedMs`, confirmed by two
      instruments (per-trial JSON field comparison, and md5 of the elapsedMs-stripped report
      sections).
- [x] 5.3 Live probe on all three clips plus the negative control, reading both console lines.
- [x] 5.4 `ffmpeg -itsscale 2` negative control: user-visible output **bit-identical to baseline**,
      `cadence` 87.6 spm, detector does not fire on the primary pass.
- [ ] 5.5 ⚠️ **BLOCKED — see `design.md` §4 and `strides-mc1`.** The sub-floor pass adopts
      rhythmless red noise on 75–92% of seeds, and does so on real footage: `park-side-portrait`'s
      background scale pass adopts 0.15 Hz at R² 0.398 and would render 46.4 cm of vertical
      oscillation. This change must not merge until that is resolved.

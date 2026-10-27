# Slow-motion / retimed clip detection

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## Slow-motion clip detection investigation (2026-08-14)

Spike for GitHub #42, executed on branch `spike-slowmo-detection` (worktree
`strides-slowmo`) — findings, a prototype, and a recommendation, not a shipped feature.

⚠️ **Two corrections, 2026-09-09 (`strides-b4f`), neither of which un-measures anything below.**
(1) **"exist on that branch only" is STALE.** `src/video/containerTiming.ts` and
`src/video/slowMotionDetection.ts` are both in `src/` on `main` today. `containerTiming.ts` has real
callers (`evidenceSeekOffset.ts` reads the `elst` through it); **`slowMotionDetection.ts` has ZERO
callers** and is correct-but-unreachable, for a reason this section could not have known: **iOS
BAKES the retiming in when a clip leaves Photos**, so a camera-roll upload arrives at 30 nominal fps
with a unity-rate `elst` and `stretchFactor` ≈ 1.00003 — confirmed on all three demo clips, one of
which (`park-side-portrait.mp4`) really is ~7× slow motion (`TAG:encoder=Lavc… libx264`,
`handler_name=Core Media Video`, zero `com.apple.quicktime` tags). `nominalFps >= 100` therefore has
nothing to match on any input this app can receive. That is a true negative about CONTAINERS, not a
bug to fix by loosening the threshold; the module is deliberately left unwired rather than deleted.
(2) **The closing "widening the grid … rejected" parenthetical is narrower than it reads** — see the
note appended at the end of this section.

**Motivation.** This pipeline's cadence/vertical-oscillation estimators search a fixed 1.2–4.0 Hz
bounce-frequency band (`HeuristicsConfig.spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`,
`src/heuristics/types.ts`) — correct for real running cadence, wrong for a raw slow-motion clip. A
true 180 spm cadence filmed at 8x slow-motion plays back at 22.5 spm (0.375 Hz), below the grid's
floor entirely. The concern: does the pipeline currently produce a plausible-looking but wrong
number on such a clip ("silently wrong"), and if so, can container-level metadata detect that
case before the user sees it?

**What was tried.**

*Parsing (`containerTiming.ts`).* Added `mp4box@2.4.1` as a direct dependency — self-contained,
not shared with the parallel `webcodecs-sampling` worktree (see Backlog). `probeContainerTiming`
drives `mp4box`'s `createFile()`/`appendBuffer()`/`onReady`, synchronously for a single fully-
buffered `ArrayBuffer`, and reduces its box tree to: per-video-track `mediaTimescaleHz` (from
`mdia/mdhd`), `movieTimescaleHz` (from `moov/mvhd`), `nominalFps` (1 / weighted-median `stts`
sample delta — the median, not `nb_samples / duration`, since a stretched duration would corrupt
that ratio), raw `edts/elst` entries verbatim, and a `stretchFactor` with a `stretchFactorSource`
tag (`'direct-rate'` when an entry's `media_rate_integer`/`media_rate_fraction` combine to a
non-unity, non-dwell rate; `'duration-ratio'`, inferred by comparing the edit list's total
presentation duration against the `stts`-implied native duration, otherwise). Fails closed via
`parseStatus: 'ok' | 'unsupported-container' | 'parse-error'` — a non-MP4 buffer (garbage bytes,
empty buffer) never throws, it resolves `'unsupported-container'`.

*Policy (`slowMotionDetection.ts`).* `detectSlowMotion` requires the conjunction the plan
specified: (1) `nominalFps >= 100` (native-capture-rate tier, clears 24–60fps with margin, sits
below iPhone's 120/240fps slo-mo tiers) AND (2) `stretchFactor >= 1.5` (both defaults, in
`DEFAULT_SLOW_MOTION_DETECTION_CONFIG` — **not tuned against any real-world sample**, see
Findings). Confidence is `'high'` when the winning `stretchFactor` came from the direct-rate path,
`'medium'` from duration-ratio, `'none'` on any parse failure, missing video track, or predicate
miss. Neither signal alone is trusted: real evidence for why is in the Findings below.

*Fixtures (`src/video/__fixtures__/`).* Built via `mp4box`'s OWN `BoxParser.box[fourcc]`/
`BoxParser.sampleEntry[fourcc]` constructors + `write()` — a genuinely minimal box tree
(`ftyp` + `moov(mvhd, trak(tkhd, [edts(elst)], mdia(mdhd, hdlr, minf(stbl(stsd(avc1), stts)))))`,
no `mdat`, no `vmhd`/`dinf`/`stco`/`stsz`/`stsc`) verified empirically to round-trip through
`mp4box`'s own parser to `onReady` before committing to it — those extra boxes turned out to be
unnecessary for `mp4box`'s parser specifically, not for ISO-BMFF conformance in general. One
gotcha found the hard way, and corrected in review round 1 (see the addendum at the end of this
section — the paragraph below states the corrected understanding, not the original, wrong one):
`media_rate_integer`/`media_rate_fraction` are together ONE signed 32-bit 16.16 fixed-point value,
but `mp4box` reads/writes each 16-bit half separately via `readInt16()`/`writeInt16()` (both
signed) — so `0.5`'s spec-correct fraction encoding, bits `0x8000`, reads back as a NEGATIVE
`mediaRateFraction` (`-32768`), not `32768`. This is a READ-side sign-reinterpretation issue, not
a write-side overflow — `writeInt16(32768)` and `writeInt16(-32768)` emit identical bytes either
way. Fixtures use the real, correctly-signed on-wire values (e.g. `-32768` for `0.5`) directly.
Eight fixture modules, one per predicate branch plus three extra: `normalFps`, `highFpsNoElst`,
`highFpsUnityRateElstNoStretch` (the ordinary-trim trap), `highFpsStretchingElstDirectRate` (high
confidence), `highFpsFastPlaybackDirectRate` (1.5x FAST playback — the false-positive regression
the sign bug produced, added in review round 1),
`highFpsStretchingElstDurationRatio` (medium confidence, bonus coverage beyond the plan's four
branches), `highFpsStretchingElstFfmpegShape` (models the real empirical finding below as a
regression — as of review round 1, with the REAL multi-run `stts` shape, straggler sample
included, not an idealized single uniform run — see addendum), `nonMp4Bytes` (garbage bytes +
empty buffer), plus two more added in review round 1: `webmBytes` (a real, tiny ffmpeg-generated
WebM file) and `corruptedMp4` (a truncated buffer and a deliberately-corrupted `moov`) — see the
addendum for why. `tsc -b` clean; `eslint` clean on every new/touched file; exact test counts are
in the review round 1 addendum below (grew from the original pass).

*Live pipeline (Step 3).* Generated the slow-motion-shaped fixture exactly as specified:
`ffmpeg -itsscale 8 -i src/video/demo-clips/park-approach.mp4 -c copy /tmp/park-approach-8x-slowmo-shaped.mp4`
(stream copy, ~12MB, not committed — regenerate from this command). Temporarily imported
`probeContainerTiming`/`detectSlowMotion` into `useVideoAnalysis.ts`'s existing dev-diagnostics
effect, logged under `[slowmo-probe]`, drove the app via headless Chromium (real GPU —
`ANGLE Metal Renderer: Apple M4 Pro`, confirmed via `WEBGL_debug_renderer_info`, not
SwiftShader), Upload tab + the shaped clip, captured both `[analysis-diagnostics]` and
`[slowmo-probe]`, then reverted the instrumentation (`git checkout -- src/results/useVideoAnalysis.ts`
— the only change that file had; a clean revert, confirmed via `git diff`).

**Findings.**

*Does `-itsscale` produce an `elst`, or rewrite `stts`/`mdhd` directly? Rewrites `stts` directly —
confirmed by inspecting both files' raw boxes with `containerTiming.ts`'s own parser* (also
cross-checked by hand against the un-rescaled source first). The source clip
(`park-approach.mp4`, 60000Hz media timescale, 1000Hz movie timescale) already carries an
edit list even untouched — `elst: [{segment_duration: 1652, media_time: 2002, media_rate: 1}]`,
a ~2-frame priming offset with a UNITY rate, `stts` uniform at 1001 ticks/sample (59.94fps) — real,
independent evidence that an ordinary, non-slow-motion file commonly carries a unity-rate edit
list, exactly the trap the conjunction predicate exists to avoid. After `-itsscale 8`: `stts` was
rewritten from a uniform 1001-tick delta to two runs — 98 samples @ 8008 ticks (`1001 × 8`, exactly
scaled) + 1 sample left at 1001 ticks (an ffmpeg rounding/edge artifact on the last sample) —
`mdhd.timescale` stayed unchanged at 60000Hz (the tick *rate* was never touched, only the tick
*values*). The pre-existing `elst` was scaled in lockstep: `segment_duration` 1652 → 13097 ticks
(movie timescale, matching the new `mvhd.duration`), `media_time` 2002 → 16016 (exactly `× 8`),
`media_rate` **stayed unity** throughout. Nothing in the rescaled container disagrees with
anything else — ffmpeg kept every duration and tick value mutually consistent under the new,
slower rate.

*Measured pipeline behavior on the shaped clip, live, real GPU (95/95 frames detected, full
sampling coverage — this is not a data-starvation problem):*
```json
{"probe":{"parseStatus":"ok","videoTracks":[{"trackId":1,"mediaTimescaleHz":60000,
"movieTimescaleHz":1000,"nominalFps":7.492507492507492,
"elst":[{"segmentDuration":13097,"mediaTime":16016,"mediaRateInteger":1,"mediaRateFraction":0}],
"stretchFactor":1.0000445414458152,"stretchFactorSource":"duration-ratio"}]},
"result":{"detected":false,"confidence":"none","trackId":1,"nominalFps":7.492507492507492,
"stretchFactor":1.0000445414458152,"stretchFactorSource":"duration-ratio",
"reason":"nominal fps 7.492507492507492 below native-capture-rate threshold 100"}}
```
`cadence.value: null`, `caveat: "Hip position was tracked, but the step rhythm was too irregular
to measure."` — `verticalOscillation` carries the identical shape of result with its own version
of that same generic message. Both come from `cadence.ts`'s below-quality-gate branch
(`fit.sinusoidR2 < cadenceMinFitR2`), not from `isNearGridEdge`'s caveat text ("sits at the edge
of the range this analysis can measure") — confirmed by exact string match against
`cadence.ts`'s source, and by the message being a single standalone sentence rather than the
multi-caveat `join(' ')` format a returned-but-marginal value would carry.

**The pre-registered grid-edge-caveat hypothesis is REFUTED, not confirmed.** The spectral fit
does not land near either edge of the 1.2–4.0 Hz grid with a passing-but-marginal R² (which would
have produced the "may fall outside it" caveat) — it finds NO candidate frequency in that band
that fits the (now extremely slow, 8x-stretched) hip trace well at all, so `sinusoidR2` falls
below the 0.30 gate everywhere in the searched range and the metric returns `null` with a fully
generic message that gives no indication the clip's own timing is the actual problem. This is
arguably a worse outcome than the hypothesis predicted, not a better one: "may fall outside the
measurable range" would at least point a user in the right direction; "too irregular to measure"
does not. This confirms the motivating "silently/confusingly wrong" problem more starkly than
expected, on the one concrete piece of evidence available — while also showing the SPECIFIC
predicate this spike built cannot detect the ONE concrete slow-motion-shaped file it was possible
to generate and test end-to-end.

**Recommendation: detect-and-caveat, not detect-and-rescale — and not shipped this pass.**
Evaluated against the four pre-registered criteria:
- **Exactness of stretch factor.** Even setting aside whether the predicate fires at all, this
  spike found the one real container-rewrite mechanism available for testing (`ffmpeg -itsscale`)
  destroys the very information a rescale would need — there is no recoverable "how much slower
  than native" number left in the container once `-itsscale` has run. A rescale path would only
  ever activate on the *hypothesized*, unverified real-device shape (native `stts` + a separately
  stretched `elst`), for which no real sample exists to confirm the recovered factor is even
  correct.
- **Asymmetry of failure cost.** A wrong caveat over- or under-warns — mildly annoying, never
  misleading about the numbers shown. A wrong rescale multiplies every timestamp by a number that
  might be wrong and then presents a *confidently displayed*, normal-looking metric value — this
  is strictly worse than today's status quo (null-with-generic-caveat stays honestly unhelpful; it
  never becomes actively deceptive).
- **Validation sample size.** n=0 real iPhone (or any real device) slow-motion clips were
  available to this spike, and none were found. Every fixture is hand-built or ffmpeg-shaped
  synthetic data. `DEFAULT_SLOW_MOTION_DETECTION_CONFIG`'s two thresholds (100fps, 1.5x) are
  untuned defaults, not calibrated against any real distribution of real-vs-slow-motion clips.
  This is a thin evidence base for shipping ANY user-facing behavior change, and a much thinner
  one for a change that alters computed metric values.
- **Blast radius.** Detect-and-caveat only ever adds an informational banner; it can never change
  a computed number, so its worst-case failure (a false-positive banner on a legitimate high-fps
  clip that happens to carry an unusual edit list) is cosmetic. Detect-and-rescale's worst case is
  a corrupted metric on a clip the user did nothing wrong with.
- **Does caveat-only already solve the stated motivation?** Yes. The motivating complaint is
  "silently/confusingly wrong," and the measured finding above shows the pipeline today gives a
  generic, timing-agnostic caveat with no hint that the clip's own timing might be the cause. A
  slow-motion-specific banner — even at `'medium'` confidence, even imperfectly recalled — directly
  converts "confusingly wrong" into "clearly explained," which is the actual problem. Solving
  "recover the true absolute timing and rescale" is a substantially harder, differently-scoped
  problem this spike found no reliable way to validate.

(Widening the spectral-fit search grid itself, rather than detecting-and-warning, was considered
and rejected as a direction: without a trustworthy rescale, a widened grid would happily fit *some*
frequency to the stretched signal and report a plausible-looking wrong cadence instead of `null`
— actively worse than today, not better.)

**Not filed as an openspec change this pass.** `detect-raw-slowmo-clips` would be the name if/when
it is — the plan pre-authorized filing it if the recommendation "crystallizes into something
concrete enough to ship in this same pass." It has not: the banner's exact placement, copy, and
which confidence tier(s) surface it (`'high'` only, or `'medium'` too) are real UI/UX decisions
this spike did not make, and shipping a detection predicate with zero real-device validation
behind a live user-facing banner deserves a decision point of its own rather than riding in on a
spike's momentum.

### What was built instead, and where it got to (2026-09-09, `strides-b4f`)

⚠️ **The parenthetical above — "widening the spectral-fit search grid itself … rejected as a
direction" — is REFUTED only for the thing it actually measured**, which is *reporting cadence off a
widened grid*. That remains true and was re-confirmed independently: with the floor simply dropped
to 0.30 Hz, `park-side-portrait.mp4` reports a confidently-wrong ~26 spm at R² ~0.95 (`strides-aha`).
What it does NOT rule out is a widened grid used as a **detector** rather than as a source of a
reported rate, which is what `openspec/changes/detect-retimed-clips-below-the-gait-floor` builds:
`src/heuristics/bounceSpectrum.ts`'s `fitBounceSpectrum` runs today's grid first and, only on
failure, a **disjoint** sub-floor grid `[min/8, min − step]`; adoption is reported as
`HipBounceAnalysis.subFloorRhythm`; `cadence` alone is withheld with a caveat naming the retiming,
because it is the only `MetricId` whose value is a RATE, while every spatial/ratio/distance metric
publishes normally.

**Measured on `park-side-portrait.mp4` (primary MoveNet pass): it works.** Pass 1 fits 1.24 Hz at
R² **0.0231**; pass 2 fits **0.39 Hz at R² 0.7561**, `secondPeakRatio` 0.035, against a
keyframe-derived ground truth of 0.40 Hz (contacts at ≈1.4 / 3.9 / 6.4 / 8.9 s, uniform 2.5 s).
`detectFootstrikes` flips from the ankle fallback to the bounce-phase path, **13 strikes → 4**,
alternating sides, uniformly 2.567 s apart, and `overstriding` goes **−0.008 → +0.478**,
`footStrikePattern` **−0.240 → +0.097**, `verticalOscillation` `null` → **0.171**, `verticalRatio`
`null` → **0.0299**. `side-landscape` and `front-approach` are **bit-identical outside `elapsedMs`**
(0 fields moved, confirmed by two instruments), and an `ffmpeg -itsscale 2` real-footage negative
control at 87 spm is bit-identical to baseline on every value.

🛑 **It is NOT merged, and the reason is worth knowing before anyone tries this again: the sub-floor
band is where RED noise lives.** A rhythmless random walk (`v[k] = v[k−1] + U(−0.5,0.5)`) is adopted
as a "retimed rhythm" on **75–92% of 300 seeds** at this corpus's own sample counts, at a median
`sinusoidR2` of ~0.52. `verticalOscillationMinFitR2`'s calibration is explicitly a **WHITE**-noise
floor (its own doc: "2000-seed pure-noise floor, p95 ≈ 0.22 at n=50"), and integrated white noise is
red noise — so the gate offers no protection in the one band the second pass searches. It bites
hardest on `verticalOscillationCm.calibrate`, whose series is a **cumulative integral of per-frame
deltas**, i.e. a random walk by construction: on `park-side-portrait` the background MediaPipe scale
pass adopts **0.15 Hz at R² 0.398** and would render **46.4 cm** of vertical oscillation against a
0.494 m torso.

**No threshold on any field `SpectralFitSuccess` reports separates the two** — the genuine detection
sits at the noise distribution's own p95 on all three: `sinusoidR2` 0.756 vs p95 0.788;
`observedCycles` 3.81 vs p95 3.81; `secondPeakRatio` 0.0354 vs p05 0.037. Same shape of result as
the 4K area floor: the endpoints overlap, so **do not go looking for a better number**. A fix needs a
different KIND of discriminator — the F-test against residual degrees of freedom that
`verticalOscillationMinFitR2`'s doc already names as the n-invariant upgrade, a red-noise null
model, or cross-validating the two passes' independent series against each other. Filed as
`strides-mc1`; full tables in that change's `design.md` §4, and the behaviour is pinned by a
deliberately-failing-when-fixed test in `bounceSpectrum.test.ts`.

✅ **RESOLVED (`strides-mc1`, 2026-09-09) — the discriminator is an AR(1) RED-NOISE NULL, and two of
the three candidates named above are refuted.** `src/heuristics/redNoiseNull.ts`: fit the AR(1)
shape to the sub-floor band's OWN periodogram (robust L1-in-log scan over φ), take the median of the
flattened values as the background level, and adopt only if the peak clears the χ²₂ quantile at a
conventional **95%**, corrected for the number of INDEPENDENT frequencies the span resolves. Both
conditions are required — the family gate decides "will the metrics take this fit", the null decides
"is this peak distinguishable from this series' own noise". `verticalOscillationMinFitR2` and
`cadenceMinFitR2` are untouched, pass 1 never consults the null, and 0.95 was fixed before the
genuine detection was tested (which clears it by 3–15×, not marginally).

Adoption rates through the shipped `fitBounceSpectrum`, 300 seeds each: random walk at 288 @ 30 fps
**91.7% → 4.3%**, at 280 @ 30 fps **92.3% → 5.7%**, at 138 @ 30 fps **74.7% → 3.7%**, at 106 @ 60 fps
12.3% → **0.0%**; and across a rhythmless colour sweep the rate now sits at the null's own 5% at
every φ (0/0/0/4.0/6.0% for φ = 0/0.3/0.6/0.9/0.99, against 0/0/0/33.3/91.0% before).

⚠️ **Four things measured under `strides-mc1` that should not be re-derived.** (1) **Confining the
two-pass to the pixel path is refuted** — the primary hip-POSITION series is red too (φ 0.795–0.936,
slope ≈ −1.5 on all three clips, against white controls at φ ≈ −0.2 / slope ≈ +0.5), so the colour
gap between the two consumers is too small to build on. (2) **An F-test does not fix this** — against
a random walk a low-frequency sinusoid genuinely explains large variance, so F is large too; it fixes
n-dependence, not noise colour. (3) **Cross-pass agreement is not a validator** — on the only
genuinely retimed clip the two passes disagree (primary 0.390 Hz, scale pass 0.150 Hz), so it would
reject the CORRECT detection along with the wrong one. (4) **Naive φ measurement is confounded** — a
quadratic detrend alone gives φ 0.88–0.98 on every series, because at 60 fps a clean 2.9 Hz sinusoid
by itself produces lag-1 ≈ 0.95; the shipped estimator therefore reads colour off the SPECTRUM,
where a peak is one point among many, never off a residual. Also: the theoretical variance-normalized
null does NOT work here (33.7% of walks still adopted), because the fit's own `c + d·t + e·t²`
detrend guts the f→0 power that normalization is tied to — the background has to be estimated from
the band. Full tables: that change's `design.md` §8.

⚠️ **Anything measuring this defect needs a LONG clip.** A clip shorter than 1/0.15 = **6.67 s**
structurally cannot complete a sub-floor cycle (`observedCycles >= 1` rejects the pass), so
`side-landscape` (1.75 s) and `front-approach` (1.63 s) are **uninformative** — a three-clip A/B
reading only those two reads green straight through it.

Also established in passing: **`observedCycles >= 1` does NOT prune the low end of a widened grid to
inertness**, which was the stated safety argument for capping the retiming factor at 8 — at 0.15 Hz
over a 10.1 s window the winner completes 1.515 cycles and clears the rule comfortably. Exposure
grows with clip length; the two short clips are safe only because their spans cannot complete a
sub-floor cycle.

**Risk notes.**
- **Overlapping-caveat coordination.** The grid-edge caveat does NOT already fire on this clip
  (see Findings — hypothesis refuted), and neither `cadence` nor `verticalOscillation`'s existing
  caveat text mentions timing at all. There is no existing per-metric caveat machinery to
  coordinate with or risk duplicating today. This makes the architecture recommendation easy to
  follow: a **video-level banner shown independently by `VideoInputPanel`/`ResultsView`**, gated
  on `detectSlowMotion`'s result, rather than re-plumbing `HeuristicsConfig`/`cadence.ts`'s
  per-metric caveat machinery to know about container-level facts it currently has no access to.
  That re-plumbing is a real cost and is explicitly flagged as unsolved future work, not attempted
  here.
- **Confidence-tier UI question**, unresolved: should a `'medium'`-confidence (duration-ratio)
  detection surface the same banner as `'high'`, a softer one, or none at all? No data exists yet
  to inform that call.
- **Multi-video-track files**: `detectSlowMotion` evaluates only `probe.videoTracks[0]` and never
  reconciles disagreement across tracks. A known simplification (unusual for consumer video),
  not a considered design choice.

**Backlog.**
- **mp4box de-dup with `webcodecs-sampling`** once both land — that worktree is implementing a
  parallel MP4-parsing need at the same time; this spike deliberately did not attempt to share
  code with it per instruction, but the two `mp4box` integrations should be reconciled into one
  before both merge to `main`.
- **File `detect-raw-slowmo-clips` as an openspec change** once the banner UI/UX decision above is
  made — proposal, spec delta, design, and tasks, following this repo's usual openspec flow.
- **A real device-native slow-motion clip.** The single highest-value next step: without one,
  whether real slow-motion footage produces the `containerTiming.ts`-detectable shape this
  predicate targets, the `-itsscale`-shape this spike found and confirmed is NOT detectable, or a
  third mechanism entirely (Apple's proprietary slow-motion metadata, unexamined here) remains
  completely unknown. Everything about detection accuracy in this write-up is conditional on that
  gap.
- **Threshold calibration** (`minNativeFps: 100`, `minStretchFactor: 1.5`) against a real
  distribution of clips, once real slow-motion samples exist to calibrate against.

**Review round 1 fixes (2026-08-14).** Four issues found reviewing the first pass, all fixed on a
follow-up commit (same branch, not amended):

1. **MUST-FIX — a real false-positive bug in `elstEntryRate` (`containerTiming.ts`).**
   `media_rate_integer`/`media_rate_fraction` are together one signed 32-bit 16.16 fixed-point
   value, but `mp4box` reads each 16-bit half separately via `readInt16()` (signed) — so a real
   0.5x rate (fraction bits `0x8000`) reads back as `mediaRateFraction: -32768`, and the original
   `integer + fraction / 65536` naively SUBTRACTED instead of adding. Concretely: a real 0.5x
   slow-motion rate computed as `-0.5` (silently fell through to the duration-ratio path instead
   of being read directly), and — worse — a real 1.5x FAST-playback rate computed as `0.5`,
   indistinguishable from an actual 0.5x slowdown, which would have reported `detected: true,
   confidence: 'high'` on a clip playing faster than native, not slower. Fixed by reinterpreting
   the fraction as unsigned before combining (`(mediaRateFraction & 0xffff) / 65536`), which is
   also correct for genuinely negative/reverse-play rates since the two halves are one
   two's-complement value regardless. Also collapsed the `find()` + ternary that had been
   evaluating `elstEntryRate` twice for the winning entry into a single pass. Regression fixture:
   `highFpsFastPlaybackDirectRate.ts` (1.5x fast playback, must NOT detect) — new test in
   `slowMotionDetection.test.ts` asserts this explicitly. The original write-up above (What was
   tried / Fixtures) had this bug BACKWARDS — claiming `mp4box` "silently overflows" a spec-legal
   `32768` **on write** — which is wrong on both counts (`32768` is not the correct on-wire
   encoding of `0.5` in the first place; `writeInt16(32768)` and `writeInt16(-32768)` emit
   identical bytes, nothing overflows on write). That paragraph and
   `highFpsStretchingElstDirectRate.ts`'s doc comment are corrected in place, above, to describe
   the real bug (a read-side sign misinterpretation) rather than left as a wrong historical claim.

2. **SHOULD-FIX — the ffmpeg-shape fixture had idealized away the real measured shape.**
   `highFpsStretchingElstFfmpegShape.ts` modeled the `-itsscale` finding as a single uniform `stts`
   run (`[[240, 800]]`), despite its own doc comment claiming to model what was ACTUALLY measured
   — the real dump earlier in this write-up (98 samples @ 8008 ticks + 1 straggler sample @ 1001
   ticks, 60000Hz timescale) is multi-run. Replaced with the exact real shape (`sttsRuns: [[98,
   8008], [1, 1001]]`, `mediaTimescaleHz: 60000`, matching real `elst` values). This reproduces the
   exact live numbers already quoted above (`nominalFps ≈ 7.492507492507492`, `stretchFactor ≈
   1.0000445414458152`) — both now asserted precisely in `containerTiming.test.ts` — and gives
   `weightedMedianSampleDeltaTicks` its first exercise with more than one run. Also asserted
   explicitly, per the review's request: a naive sample-count-weighted MEAN over the same two runs
   (`785785 ticks / 99 samples ≈ 7937.22 ticks` → `≈ 7.559fps`) differs measurably from the CORRECT
   median (`8008 ticks` → `≈ 7.49fps`, anchored to the dominant run) — the straggler pulls a naive
   mean upward; the median correctly ignores it.

3. **SHOULD-FIX — the documented `parseStatus` mapping was backwards for the single most likely
   real non-MP4 input.** The original doc claimed WebM/non-ISO-BMFF input maps to
   `'unsupported-container'` and a corrupt-but-recognized MP4 maps to `'parse-error'`. Verified
   against `mp4box` directly (a real ffmpeg-generated WebM file; a deliberately mdhd-corrupted
   valid fixture; a truncated valid fixture) — actual behavior is close to inverted: WebM's EBML
   header gets actively misparsed as a bogus box and rejected via `mp4box`'s own `onError` →
   `'parse-error'`, WITH an error message. A structurally-plausible-but-broken `moov` (e.g. an
   unrecognized box where `mdhd` should be) doesn't throw during the box walk itself, but `mp4box`'s
   internal `getInfo()` unconditionally dereferences fields like `trak.mdia.mdhd.timescale` while
   preparing the `Movie` object and throws a `TypeError` reading a property off `undefined` — caught
   by the outer `appendBuffer`/`flush` `try`/`catch` → `'unsupported-container'`, WITH an error
   message. Only genuinely unrecognizable input (truncated buffers, garbage bytes, empty buffers)
   reaches `'unsupported-container'` with NO error message — nothing ever throws and neither
   `onReady` nor `onError` fires. `containerTiming.ts`'s doc comments (`probeContainerTiming`'s
   module doc, the trailing fallback comment, and `ContainerTimingProbe.error`'s doc, which
   incorrectly claimed `error` is present "only on `'parse-error'`") are corrected in place to this
   verified mapping. Two new fixtures lock it in: `webmBytes.ts` (a real, tiny ffmpeg-generated
   WebM, base64-embedded) and `corruptedMp4.ts` (`buildTruncatedMp4`, `buildCorruptedMoovMp4`, both
   built by slicing/corrupting `mp4BoxFixture.ts`'s own valid output rather than hand-rolled bytes).

4. **SHOULD-FIX — the duration-ratio path double-counted empty/dwell edits.**
   `computeStretchFactor`'s Path 2 summed `segmentDuration` across every `elst` entry, including
   empty edits (`mediaTime === -1`, a presentation gap backed by no media) and dwell edits (rate
   `0`) — both inflate the ratio in the false-positive direction without a matching native-duration
   contribution. Fixed with a one-line filter (`entry.mediaTime >= 0 && elstEntryRate(entry) > 0`)
   before the sum.

Net effect on fixture/test counts: 8 fixture modules → 11 (added
`highFpsFastPlaybackDirectRate.ts`, `webmBytes.ts`, `corruptedMp4.ts` — the last exports two
builders; the ffmpeg-shape fixture was corrected in place, not added). Full suite still green
after the fix — exact pass counts are in the commit that made these changes, not duplicated here
to avoid this write-up drifting out of sync with the test files again.


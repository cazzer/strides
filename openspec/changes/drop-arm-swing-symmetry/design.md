# Design — dropping arm swing symmetry

## D1. What a deletion has to protect

The risk in this change is not removing too little. It is removing a metric whose test file was the
**only** cover for large parts of a module that survives.

`src/heuristics/armSwing.ts` is 506 lines of shared code with **no test file of its own**. Every
assertion about its scale-stabilization ladder, its exemplar builder and its failure wording lived
in `armSwingSymmetry.test.ts`, because symmetry was the metric that happened to exist when the
shared module was extracted. That naming is precisely what made the coverage look deletable
alongside the metric.

Twelve of that file's 26 cases were shared-module coverage. They move to a new
`src/heuristics/armSwing.test.ts` that calls `computeSideSwing`, `buildSideExemplar` and
`caveatForFailure` directly. The repo already tests shared primitives this way
(`bounceInstants.test.ts`, `exemplars.test.ts`, `extrema.test.ts`, `spectralFit.test.ts`).

## D2. Why the migrated tests do NOT route through `armSwingAmplitude`

Two of the twelve assert an **exact** no-op with `toBe`:

- `MIN_SCALE_TREND_SAMPLES` (12) — below it the scale factor is the literal constant `1`
- `FLAT_TREND_LOG_RANGE` — a numerically-flat fitted trend snaps to the literal constant `1`

Both compared the metric's value against a raw-pixel recomputation, via a `rawPixelRatio` helper
that is a `min/max` ratio. `armSwingAmplitude` has no bit-exact analogue: it divides by
`estimateBodyScale`'s clip-median torso length, itself scale-dependent. Routing these through the
amplitude metric would have forced re-deriving the expectation and would very likely have degraded
`toBe` to `toBeCloseTo` — **destroying the exactness the tests exist for**. The original's own
comment makes the point: a `1 ± 1e-15` factor still passes any `toBeCloseTo`, and dividing constant
values by `exp(~1e-14)` is enough to turn a motionless-arm clip's honest `'degenerate-signal'`
reading into a spurious below-gate one.

Against the shared module the fix is clean: `rawPixelRatio` became a per-side `rawPixelAmplitude`,
and each side's `computeSideSwing(...).fit.peakToPeakAmplitude` is asserted `toBe` a raw-pixel
`fitSpectralSinusoid` of the same series. That is **stronger** than the original, which only pinned
the ratio of the two.

## D3. The step-1 discipline: both suites green side by side

The migrated cases were written and run **while `armSwingSymmetry.ts` still existed**, with both
files passing together (51 tests, then 53 after the two ports). That is the only moment at which
the migrated assertion and the original are provably testing the same thing. Deleting first and
migrating after would have made every migrated test unfalsifiable against its own origin.

## D4. Coverage the deletion would otherwise have opened a hole in

Two cases were ported into `armSwingAmplitude.test.ts` rather than dropped:

| ported case | why it is not redundant |
|---|---|
| ambiguous-view gating | The surviving view requirement states the `0.2` ambiguous row and had **no scenario for it**; the amplitude suite touched `'ambiguous'` only inside a never-NaN loop, asserting neither the cap nor the caveat. A scenario is added to the spec to match. |
| the noise-arm fixture route | The existing gate case tightens `armSwingMinFitR2` to 0.9 via config. This one drives a genuinely unfittable arm (`rightAmplitudePx: 0, rightJitterPx: 20`) into the **default** gate — proof that a real noise arm reaches it, not just a moved threshold. |

Two test files were **re-pointed rather than deleted**, because they cover surviving code and the
obvious fix (delete the line) silently drops it:

- `viewPlausibility.test.ts` — the only witness to `resolveViewFitTable`'s **front-primary** blend
  path (`0.84`, `0.375`). `armSwingAmplitude`'s row is byte-identical to the deleted one, so every
  expected number is unchanged.
- `index.test.ts` — the `propagate-view-confidence-to-metric-gating` regressions, which exist
  because "multiplying confidence by that low number would delete" a front-primary metric.

## D5. Why one requirement is REMOVED **and** re-ADDED

`Arm swing symmetry's exemplar pair spans one fitted half-swing` carries two paragraphs. The first
(derive the pair from the fitted phase) is already stated by the amplitude requirement. The second
is **the only spec-level statement of the image-y sign convention**:

> the fitted MAXIMUM is the wrist at its LOWEST on screen; the system SHALL name the pair by body
> position rather than by extremum kind, so that a caption cannot state the opposite of the truth.

It governs `armSwing.ts`'s `maximumIs: 'lowest'`, which `armSwingAmplitude` still executes on every
clip, and which a migrated test still asserts. Removing it outright would leave the code keeping
the behaviour, the test still asserting it, and **no requirement asking for it**. It is re-added
metric-neutrally, stated of the shared exemplar builder rather than of any one consumer.

## D6. Two spec claims that stopped being true, and were restated rather than deleted

- **The shared gate.** The amplitude requirement justified `armSwingMinFitR2` being a single key by
  saying "the two arm metrics can never disagree". With one arm metric that is vacuous — but the
  underlying rule is real and `armSwing.ts:25-31` documents it as a deliberately deleted bug class.
  It is restated as a **shared-module-ownership** rule: never a second, separately-tunable gate on
  the same fitted signal, so a future second consumer inherits the gate rather than choosing its
  own. Dropping the sentence would have silently deleted the only spec-level record of that rule.
- **Mean, not min.** `armSwingAmplitude.ts`'s doc argued the min was redundant "with the symmetry
  ratio `r` published beside a mean `m`", since the weaker side is recoverable as
  `2·m·r / (1 + r)`. With `r` withdrawn the per-side amplitudes are **no longer recoverable** from
  the card. The comment now says so, rather than quietly keeping a consolation that no longer
  holds; the mean stands on its primary ground ("the mean answers how big") alone.

## D7. The harmonic scenario — kept, not dropped

`Scenario: Amplitude survives a swing trace carrying a step-rate harmonic` sat under a REMOVED
requirement, but its claim is a property of the **shared** `computeSideSwing` (the `strides-gzl`
fit-versus-extrema-scan mechanism), not of the ratio. Migrated test #11 asserts exactly it.

It is re-stated on the surviving amplitude requirement, reworded from the ratio to the per-side
fitted amplitude. The alternative — migrating the test with no spec home — would have left an
assertion no requirement asks for, which is the same defect D5 exists to avoid.

## D8. Verification

**A/B gate**: `scripts/ab-person-selection.mjs --arm 'base={}' --clips
side-landscape,side-portrait,front-approach --trials 3 --evidence`, fresh Chromium per trial, real
GPU (`ANGLE Metal Renderer: Apple M4 Pro`), dev server started and identity-verified by each run on
the derived port 5256.

With `armSwingSymmetry.*` rows and `elapsedMs` excluded, before and after are **byte-identical**:
587 lines each, md5 `e564476577ea6c8d8d01c559f1be7ae1` both sides. Zero `armSwingSymmetry` rows
survive in the after run. Verified by hashing rather than by reading a diff, per `strides-ef5` —
this machine's `diff` wrapper has twice reported "Files are identical" for files with different
MD5s, and it fails in the safe-looking direction.

**`armSwingAmplitude` is untouched on the clip it renders on.** `front-approach`, after:

| field | value |
|---|---|
| `value` | 0.233555 |
| `confidence` | 0.412742 |
| `viewFit` | `primary` |
| evidence `status` | `planned` |
| exemplars | **2** — `side: left` (t 0.917583 ↔ 0.583917) and `side: right` (t 0.583917 ↔ 0.917583), both `kind: armSwingCycle`, `quality` 1, `cropSidePx` 320, `demotion` null |

Every one of those rows is inside the byte-identical set, so the two per-side images are not merely
present — they are unchanged to full precision.

Note `armSwingSymmetry`'s own before-run rows confirm the premise this change rests on: `value`
`null` on both side clips, and `0.518197` at confidence `0.412742` off `sampleSize` 2 on
`front-approach` — one caveated number on one clip of three.

**Static**: `npx tsc -b` clean but for the pre-existing `vite.config.ts(10,1)` (`strides-3rp`);
`npm run lint` clean; full unit suite 1477 passed / 90 files.

## D9. What this change deliberately did not do

- **Did not hoist the shared arm-swing fixture.** `buildArmSwingFrames` + `makeJitter` + the
  geometry constants are now duplicated in three test files. Hoisting into `__fixtures__/` is a
  refactor, not a deletion — filed separately.
- **Did not add an `armSwingAmplitude` bullet** to results-view's annotation requirement. One
  arguably belongs there on the merits (its value spans both images and a clip-median denominator
  in neither), but it is not listed today, so that is a pre-existing gap this change did not open.
  The `armSwingSymmetry` bullet is deleted and nothing else in that block moves. Filed separately.
  Deleting it does **not** orphan `Scenario: A ratio between two images is labelled on neither` —
  that scenario is generic and still backed by the surviving `verticalRatio` bullet.
- **Did not change any behaviour in `armSwing.ts`.** Its diff is comments only, verified by
  filtering the diff to non-comment lines (empty).

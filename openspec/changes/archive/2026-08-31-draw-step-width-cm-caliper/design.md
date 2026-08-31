# Design

## D1. The diagnosis, confirmed rather than inherited

The bead was written from a code read during another ticket's measurement pass, so it was re-derived
here from scratch, in three independent ways.

**Static trace.** `stepWidthCm.ts`'s paired branch sets `kind`, `timestamp`, `pairedTimestamp`,
`quality`, `label`, `cropKeypoints` — and no side of any kind. `resolveInstantSide`
(`evidenceFrames.ts:556`) is `measured ?? exemplar.side ?? null`, so both halves resolve `null`.
`buildStepWidthMarks` (`evidenceAnnotations.ts:793`) draws `hipWidthSegment` and `hipMidlinePlumb`
first, then:

```ts
const side = instant.side
if (side === null) return          // ← returns here
const ankle = builder.point(index, ANKLE_NAME[side])
if (ankle === null) return
builder.caliper('ankleOffsetCaliper', ...)   // ← never reached
```

The two context marks are drawn *before* the bail, which is exactly why this is hard to see: the
image is not blank, it is missing one mark.

**Mechanical diff.** Comments stripped, the two `buildExemplars` bodies are 62 and 60 code lines and
the diff is precisely:

```
<           measuredSide: base.side,
<           pairedMeasuredSide: ghost.side,
```

Nothing else. Not a related bug — *the* bug, isolated.

**Behavioural reproduction.** One synthetic front-view fixture, driven through the real
`planMetricEvidence` → `planEvidenceAnnotations` path:

| | `hipWidthSegment` | `hipMidlinePlumb` | `ankleOffsetCaliper` |
|---|---|---|---|
| `stepWidth` | ✓ | ✓ | **2** (base + ghost) |
| `stepWidthCm` | ✓ | ✓ | **0** |

**Independent corroboration.** `evidenceAnnotations.ts`'s `GRAFTED_METRICS` doc already claims the
behaviour this change restores — "this suppresses `stepWidthCm`'s caliper POLARITY (the caliper
still draws, as the unsigned lateral span it honestly is)". It does not draw. That comment was
written by someone who believed the caliper was there, which is the same belief the spec encodes.

## D2. Why the fix is the dedup, not the two lines

The instruction was to deduplicate only if genuinely low-risk, and not to force a refactor to look
thorough. The deciding observation is what the *minimal* fix leaves behind.

Adding two lines to `stepWidthCm` makes the two `buildExemplars` **100% identical** — 62 lines of
duplicated logic, in two files, with no test comparing them and no import linking them. That is a
strictly more fragile end state than today's, because today at least the divergence exists and is
findable; after a minimal fix the two are perfectly parallel and the next edit to either is
unconstrained. The bug already happened once in exactly that configuration.

Risk was assessed rather than asserted:

- **The extraction is provably behaviour-preserving.** The shared body was transplanted from
  `stepWidth.ts` — the *correct* copy — and verified byte-identical to its original after only the
  symbol renames, by string comparison against the pre-edit source, not by reading it. So the ratio
  metric, which does render live (Demo 2), cannot have changed. `stepWidthCm` gains exactly the two
  lines it was missing.
- **Nothing is parameterised.** The two metrics differ only in the *unit* their `value` carries;
  every decision in this construction — eligibility, pair selection, which instant is base, the
  labels, the crop set — is unit-independent. The helper takes no flags and has no branches per
  caller, so there is no "shared function that is really two functions" hazard.
- **The blast radius is two callers, both with unit tests, one covered live.**

`strides-zp6` closed with the judgement that the dedup was worth doing on its own merits *because*
of this divergence, while measuring that the select-then-score shape the two share costs no clip an
exemplar today. Both remain true: this change deduplicates, and deliberately does **not** touch the
select-then-score shape, which is a separate, measured, closed question.

The helper lives in a new `stepWidthExemplars.ts` rather than in `exemplars.ts`. `exemplars.ts`
holds primitives shared across many metrics (`selectOppositeSidePair`, `scoreExemplarInstant`,
`pairQuality`); this is one whole construction belonging to one family of metrics, which is the
shape `bounceInstants.ts`'s `buildBounceCycleExemplar` already set a precedent for. It also keeps
the change additive at the module level, touching no file another concurrent change is likely to be
in.

## D3. Why the primary evidence is a unit test

`stepWidthCm` is tier-3 (`metric-excluded`) on Demo 1, Demo 2 and `multiperson-track.mp4` — measured
again during this change's live verification, before and after. `planMetricEvidence` returns
`'metric-excluded'` before it ever reads the exemplars, so no image is planned and none can be
inspected. A screenshot cannot show this fix.

So the test is the evidence, and it was mutation-checked in both directions rather than merely
written:

| | `stepWidthCm` new test | `stepWidth` existing test |
|---|---|---|
| fix present | pass | pass |
| fix reverted | **fail** — `expected undefined not to be undefined` | **fail** — `expected [ undefined, undefined ] to deeply equal [ 'right', 'left' ]` |

The second column is the dedup doing its job: after this change the two metrics share one fate, and
a regression in the construction cannot pass one suite while failing the other.

A test can fail for the wrong reason, so the caliper assertion was mutation-checked **in isolation**
as well, with the three metric-layer assertions in front of it temporarily suppressed. It still
fails, and on its own terms:

```
AssertionError: expected [] to deeply equal [ 'base', 'ghost' ]
```

Zero calipers, where two are required. The assertion is load-bearing, not carried by the ones
before it.

**Seeing it live was attempted and is structurally blocked — and the mechanism is now known.** A
unit test reaches tier 1 easily (`metricTier` = `normal`, value −18.75 cm, confidence 1.0,
`viewFit: 'primary'` on the synthetic front-view fixture), which is what makes the assertion above
possible. On real footage it cannot be reached, and not for the reason the bead assumed.

`stepWidthCm` needs per-frame `pixelsPerMeter`, which only MediaPipe measures, so it can only be
tier-1/2 on a clip **MediaPipe** classifies as front. Driving Demo 2 — the front-approach clip, and
the one clip where the ratio sibling `stepWidth` *does* render — with
`__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: 'mediapipePoseLandmarker' }` produces a perfectly
good measurement and still no card:

```
VIEW      {"view":"ambiguous","confidence":0.3,
           "diagnostics":{"bilateralSpreadRatio":0.523,"sagittalExcursionRatio":1.591}}
stepWidthCm {"value":4.530871004704217,"confidence":0.2,"viewFit":"unsuitable","sampleSize":5,
             "frameCoverage":1,"caveat":"…not reliable from a ambiguous view."}
```

The value is real — 4.53 cm over 5 strikes at full frame coverage. It is `viewFit: 'unsuitable'`
that makes `metricTier` return `'excluded'`, because **MediaPipe classifies Demo 2 as `ambiguous`
where MoveNet classifies it as `front`**. The same run shows `stepWidth` newly excluded too, for the
identical reason, having been `planned` on the MoveNet run.

That also explains the default path without needing a second experiment: the background scale pass
*is* MediaPipe, so its own view verdict on Demo 2 is `ambiguous`, and the grafted `stepWidthCm`
arrives already `unsuitable`. Its sibling `verticalOscillationCm` survives the same graft only
because it is view-**tolerant**, while step width is hard-gated to front. So `stepWidthCm` is
tier-3 on this repo's footage through the view gate, not through scale availability — and no config
lever exposed today moves it, since `HeuristicsConfig` has no runtime override point (a standing
backlog item) and the view verdict is computed from the frames.

**One fixture detail that matters.** On the undrifted fixture both metrics' pairs are demoted to a
single instant by `isNearIdenticalPair` — the two opposite-foot plants sit at near-identical crops.
The defect is still visible there (1 caliper vs 0), but only the base half is exercised. Translating
the body 1 px per frame keeps both instants while staying far under
`EVIDENCE_MAX_PAIR_CROP_GROWTH`, so the test asserts `['base', 'ghost']` rather than a single mark.
Measured across drift values 0…20 px/frame: 0 demotes, every value ≥1 keeps the pair.

## D4. What this deliberately does not fix

**`strides-3a1` — grafted exemplars carry the scale pass's instants but the primary pass's frames.**
`stepWidthCm` is in `GRAFTED_METRICS`, so its caliper's *geometry* resolves off a MoveNet frame
snapped within tolerance, not the MediaPipe frame that measured it. That seam decides **where** the
caliper lands; this change decides **whether it is drawn at all**. They are independent, and the
existing mitigation is already correct for the part it covers: `polaritySource` withholds the
polarity for grafted metrics, so the restored caliper draws **unoriented** — a span without a
direction indicator, exactly as `GRAFTED_METRICS`'s own doc describes. Nothing here re-enables a
polarity that was deliberately suppressed.

Concretely, the fix does not make `3a1` worse: before it, the caliper was absent and its
misregistration was unobservable; after it, the caliper is present and any misregistration becomes
*visible* on a clip where `stepWidthCm` renders — which is the correct direction for a known open
seam to move.

**The `MIN_EXEMPLAR_QUALITY`, `EVIDENCE_CROP_MIN_SIDE_PX`, `EVIDENCE_MAX_PAIR_CROP_GROWTH` and 3-MAD
constants are untouched**, as is the select-then-score shape (`strides-zp6`, measured and closed).

## D5. Why the spec delta is shaped the way it is

The `form-heuristics` contract **already required** the per-instant side, including a scenario ("An
opposite-side pair states each instant's own side") that covers this case exactly. `stepWidthCm` was
non-conformant. So there is no new metric-layer rule to write, and inventing one would misrepresent
a conformance failure as a gap.

What the requirement *did* get wrong is its own enumeration: "**Two** metrics are in this position",
naming "step width" and "overstriding". Three `MetricId`s have the shape. Counting the two
step-width metrics as one is precisely the ambiguity that let the third module be overlooked — twice,
once when the copy was made and once when the requirement was written. The MODIFIED block corrects
that count, names both step-width metrics explicitly as separate emitters, and adds the obligation
that metrics sharing this construction share one implementation of it. It is a **strict superset**:
all seven original scenarios and every scenario bullet survive verbatim, with one scenario added.

The genuinely unspecified thing is the *consequence*, and it is what makes this defect a defect
rather than a missing field: nothing said a per-instant side is a **precondition for drawing the
measurement mark**, so its absence silently degraded the image to a partial one. The `results-view`
addition states that, and states the part that made it survive review — that the suppression must be
a **visible** absence, observable in coverage a test can assert, rather than an image that keeps its
context marks and quietly drops the measurement. It is ADDED rather than MODIFIED so it cannot
clobber concurrent work in the annotation layer.

## D6. Live verification

Real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), fresh Chromium per trial, derived port 5222 with
server identity verified by the harness's nonce check, 2 trials per clip.

| clip | images / sections | `stepWidthCm` |
|---|---|---|
| Demo 1 | **8 / 7** | `metric-excluded` |
| Demo 2 | **5 / 4** | `metric-excluded` |
| multiperson | **8 / 7** | `metric-excluded` |

Demo 1 and Demo 2 match their expected figures exactly. multiperson came in at 8/7 against a briefed
7/6, so rather than assume, the **same clip was re-measured on clean `main`** with the working tree
stashed: baseline is also **8/7**, metric for metric (`footStrikePattern` 2, `kneeFlexion` 1,
`overstriding` 1, `trunkLean` 1, `verticalOscillation` 1, `verticalOscillationCm` 1, `verticalRatio`
1). The 7/6 figure predates today's footstrike-phase change. Not a regression, and not this change's
doing — which the exclusion status already implied, since a metric excluded before planning cannot
alter coverage either way.

Anchor: Demo 1 `cadence.value` **91.2**, both trials, no spread. `verticalOscillationCm.value` reads
`null` on the primary `[analysis-diagnostics]` line by design — on a MoveNet-primary run it is
grafted after `phase: 'ready'` — and is `planned` in evidence coverage on all three clips.

# Metric frame evidence

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## Metric frame evidence — inline, annotated, measured live (2026-08-17/18, epic #59 and `strides-ac9`)

**Each metric card carries its own evidence, inline.** For every metric the app re-pulls the frames
it actually measured out of the clip after analysis and renders them as small **annotated
thumbnails inside that metric's own card**, ghosting two instants into one image where the metric's
meaning is a delta. The picture and the number it explains are on screen together.

**The ghost is NOT half the picture — 65/35, and two constants, since 2026-08-19 (`strides-c37`).**
The photograph was a symmetric `0.5·base + 0.5·ghost` (measured, PSNR peak at exactly 50/50) while
the caption and the annotation both named the base as the subject, so the picture contradicted its
own labels and the solid skeleton could read as sitting on the wrong body. `EVIDENCE_GHOST_OPACITY`
split into **`EVIDENCE_GHOST_BLEND_ALPHA = 0.35`** (photograph, `evidenceFrames.ts` only —
`source-over` makes that a 65/35 split toward the base) and **`EVIDENCE_GHOST_MARK_OPACITY = 0.5`**
(annotation marks, `evidenceAnnotations.ts` only, unchanged in value). The archived
`metric-frame-evidence`/`inline-annotated-evidence` designs still state the symmetric 50/50 intent
and are stale on this point. Number chosen by a five-arm sweep judged at the real 144 px size on all
three clips: `openspec/changes/weight-evidence-ghost-below-base/design.md`.

**The standalone gallery is gone.** There is no "What the analysis looked at" section below the
results, and no deep link from a card to one — `EvidenceGallery.tsx` was deleted (`strides-ac9.3`).
Ignore any older note below or elsewhere that describes a gallery section, a gallery figure, or a
"See evidence" link. The `src/` doc comments that still said "gallery" were swept on 2026-08-31
(`strides-hcm`); the word now survives in `src/` only where a comment names `EvidenceGallery.tsx`
as a deleted component it inherited code or discipline from — plus one test title in
`evidenceSeekOffset.test.ts`, left alone because renaming it is a code change, not a comment fix.

Current modules: `evidenceFrames.ts` plans purely, `evidenceAnnotations.ts` derives every annotation
mark's geometry purely, `extractFrames.ts` produces pixels, `drawEvidenceAnnotations.ts` paints the
marks, `EvidenceCanvas.tsx` renders, `useSessionEvidence.ts` drives extraction for the session,
`evidenceCaptions.ts` writes the captions, `evidenceSeekOffset.ts` calibrates the seek.

Everything below was measured in headless Chromium on real GPU
(`ANGLE Metal Renderer: Apple M4 Pro`, never SwiftShader), 3 trials per clip, across Demo 1, Demo 2
and `e2e/fixtures/multiperson-track.mp4`, plus two-clip sessions. Full tables:
`openspec/changes/archive/2026-08-17-metric-frame-evidence/design.md` **D14** and
`openspec/changes/archive/2026-08-17-inline-annotated-evidence/design.md`.

**Evidence images ARE annotated now — and the ban that survived is the one that matters.** The
images are no longer plain photographic crops: they carry the **detected joints** and the
**per-metric measurement geometry** (the actual construction each metric measured — calipers,
stride ticks, arcs, hip-mid crosses, travel-direction arrowheads). The earlier prohibition on
drawing *any* annotation over an extracted image was **deliberately reversed** for the runner's own
detected and measured geometry. **The adjacent ban survives and was strengthened**: an annotation
SHALL NOT overlay a reference or ideal posture — the only delta shown is the runner against
themself. That distinction is the whole point, so keep the two apart when reading the spec: drawing
what *was measured* is now required; drawing what *should have happened* is still forbidden.
Requirements: "Evidence thumbnails annotate the runner's own measured geometry and never a reference
posture" and "An annotation depicts what was measured at the depicted instant, never the card's
reported value" in `openspec/specs/results-view/spec.md`.

Annotation geometry is decided in the **pure** layer, not in a draw call — the unit suite runs where
`getContext('2d')` returns `null` by deliberate choice, so any geometry decided inside a draw call is
geometry no test can reach. There is **no text** in any annotation: no `fillText`/`strokeText`/
`measureText`/`font` in any annotation or extraction module, and zero text visible across ~15
inspected images.

**Legibility, measured by looking at every image at its real inline size.** The cyan joint layer and
the amber measurement layer are cleanly distinguishable at the 112 px inline size, and the joints
land on the right body throughout. Honest limit: the VO/VO_cm bounce delta (two guides 15-20 px
apart on a 640 px canvas, so ~3 px displayed) and the arc/caliper end-ticks **do not resolve** at
112 px — the gestalt reads, the fine marks do not. Best image on any clip was judged to be
`verticalRatio`'s `stridePair` — **that nomination is RETIRED**; see correction (2) immediately
below, and the `verticalRatio` bullet under "Coverage re-measured 2026-08-31" for why that image
was never as good as it looked.

⚠️ **Two corrections to the paragraph above, neither of which un-measures it** (2026-08-31). (1)
**The inline size is no longer 112 px**: `0325943` widened the thumbnail to `w-36` — 144 CSS px
nominal, **142 measured** (`strides-c37` recorded the 1.4% gap and deliberately left the design's
144 alone). Every "at 112 px" reading here is therefore a floor; the ~3 px bounce-guide separation
scales to roughly 4 px, still marginal rather than resolved. (2) **`verticalRatio`'s `stridePair`
is not produced any more** on any clip, and that is CORRECT rather than a regression
(`strides-mjw`) — the pair demanded a crop wider than the frame, and pre-`4fac355` the guard was
comparing two clamped numbers, so the nominated image was drawn through a crop that could not
contain both instants it was captioned for. Full measurement in the `verticalRatio` bullet under
"Coverage re-measured 2026-08-31" below.

**A third dev-only console line, `[evidence-coverage]`.** Same contract as the two
`[analysis-diagnostics]` lines — `import.meta.env.DEV`-gated, `JSON.parse`able, matched exclusively
on `startsWith('[evidence-coverage]')`, and it carries **nothing image-shaped** (no canvas, `Blob`,
object URL or data URI — verified by scanning 38 captured lines). It reports, per clip:
`frameCount`, and per metric either `{status:'planned', exemplars:[{kind, side?, quality, timestamp,
pairedTimestamp, demotion, cropSidePx, cropGrowth, focusOffset}]}` or `{status:'no-evidence', reason}`
where reason is
`not-emitted | no-candidates | below-quality-gate | undrawable | metric-excluded |
frames-unavailable | extraction-failed`. Plus
`sourceIndices`, the per-metric winning clip index.

⚠️ **`demotion` REPLACED the `demotedFromPair` boolean on 2026-09-01 (`strides-ddj`)** — a contract
break, so a `before.txt` captured before that date diffs against a later one with one deleted and
one added row per exemplar (a `--evidence` A/B measured 20 removed, 21 added). It is
`'collapsed-pair' | 'far-apart-pair' | null`: the caption has to say WHICH, because "the paired
instant was too similar to tell apart" is the exact inverse of what a far-apart demotion did.
`scripts/ab-person-selection.mjs` needed no change — `flatten` walks whatever keys exist. Note
`cropGrowth` is still `null` on a demoted plan, so **the reading that CAUSED a far-apart demotion is
not on this line**; re-checking `EVIDENCE_MAX_PAIR_CROP_GROWTH`'s bracket against a rejected pair
still needs a probe.

⚠️ **`focusOffset` was ADDED on 2026-09-05 (`strides-dxd`)** — the same kind of contract widening,
one ADDED row per exemplar on every clip and no removals, so a `before.txt` captured earlier diffs
against a later one on those rows by design. It is how far the joint the card reports on ended up
from the middle of its image (Chebyshev, as a fraction of the crop side; `0` dead centre, `0.5` on
an edge), `null` where the exemplar named no focus joint or that joint did not resolve at the base
instant. On the line for `cropGrowth`'s stated reason — it is the quantity that placement rule's
criterion is stated in, so re-checking it should not need a probe patch. **`crop.x` / `crop.y` are
still NOT on this line**, so `subjectCentredCropRect`'s placement remains invisible to a harness;
see "How a crop gets PLACED" below.

⚠️ **`all-gated-out` was REPLACED by three reasons on 2026-09-05 (`strides-tj5`)** — a contract
break of the same KIND as `demotion`'s (`strides-ddj`), though not the same shape and not in that
field, which is untouched: `demotion` added and removed *rows* (20 / 21), whereas this changes a
*value* on two existing rows and adds none — which is why `scripts/ab-person-selection.mjs` needed
no edit either time, since `flatten` walks whatever keys exist. A tiny break: `all-gated-out`
occurred on **exactly two rows** in the whole three-clip corpus, both `overstriding`'s, on the two
side clips. It is now
`no-candidates` (the metric offered this layer no exemplar at all) | `below-quality-gate` (offered,
and every one under `MIN_EXEMPLAR_QUALITY` when the plan layer re-asserts it) | `undrawable`
(cleared the gate, and this layer's own resolution/framing rules rejected every one). The old single
verdict did not merely generalise, it **misdirected**: its own doc said "candidates existed and none
survived the quality gate or this layer's own resolution rules", and in the case that produced the
split no candidate existed and not one of `resolveExemplarFrames` / `frameCropBox` /
`isNearIdenticalPair` / `isTooCloseInTimePair` / `isTooFarApartPair` / `computeEvidenceCropRect` ever
ran. Read `no-candidates` as **"stop looking at the crop constants — go read the metric's own
exemplar scoring"**. Nothing else moved: `status` is still `'no-evidence'`, `exemplars` still `[]`,
no metric value or image changed, and `EvidenceUnavailableReason` still has no reader in the UI.

⚠️ **The MARGIN is still not on this line** (`strides-ehr`). The reason names the layer, not how
close the gate came. `selectExemplars` returns `undefined` rather than reporting what it dropped, so
`no-candidates` cannot distinguish "the metric formed no candidate" from "the metric's own gate kept
them all" — and the numbers that would settle it (overstriding's best pair quality **0.36723** on
`side-landscape` and **0.43044** on `side-portrait`, against 0.5) still need a probe.

⚠️ **`overstriding` renders a number on both side clips and an image on NEITHER, and on
`side-landscape` that is STRUCTURAL** (`strides-tj5`, measured 2026-09-05; follow-up `strides-6gd`).
Its exemplar is an EXTREME pair, so clearing 0.5 needs an instant ≥ 1.5 MADs from the median on
**each** side — and that clip's maximum over all five strikes is **1.3234 MADs**, so not one instant
clears it, unreachable at any `detectionFactor`. `side-portrait` reaches 1.8070 on its low side and
1.2913 on its high side, failing on the high side alone. **Three things the bead guessed and the
measurement refuted**, worth not re-deriving: `detectionFactor` is **1.0** on every strike of both
clips (which `interpolatedFraction: 0` already implies — a zero fraction means all three seed
keypoints resolved `'detected'`); the distribution is **`usable: true`** on both, so the flat-`0.5`
fallback never fires; and that fallback would have **PASSED** the gate anyway, since `0.5 >= 0.5`.
Note `strides-ddj` had already put `overstrideRange` in `SINGLE_INSTANT_KINDS` *because the card
reports a MEDIAN* — a median-reporting card with an extreme-pair picture is the mismatch
`strides-6gd` carries, alongside `strides-9uj` and `strides-n66`. **Do not reach for
`MIN_EXEMPLAR_QUALITY`**: `overstriding` and `trunkLean` sit at exactly 0.500 where they DO emit, so
shaving the ramp trades this coverage for theirs.

`[analysis-diagnostics]` is untouched — same six
top-level keys, ~5.5-5.6 kB, no exemplar data — and `vite build` output contains **zero** occurrences
of any of these prefixes. **This contract survived the move to inline annotated evidence unchanged**
and was re-verified on four clips: still the same six top-level keys, still no canvas/blob/dataUrl/
exemplar/crop, and the shipped JS still carries zero dev-only prefixes. It is still the right way to
read coverage — do not screen-scrape the cards.

**Take the LAST `[evidence-coverage]` line, not the first.** The design says "once per run"; that is
not what happens. On a MoveNet-primary run the background MediaPipe scale pass grafts
`verticalOscillationCm` into the fused heuristics *after* `phase: 'ready'`, which changes the
evidence input signature, correctly triggers a re-extraction, and emits a second line. Observed on
Demo 1: line 1 has `verticalOscillationCm: metric-excluded`, line 2 has it `planned`. Whether a
harness sees one line or two is a race against the scale pass.

⚠️ **The "take the LAST line" rule still stands, but a second line no longer implies a second
decode** (2026-08-31, `strides-3ui`). The graft still supersedes the run and still emits a second
line; what changed is that `useSessionEvidence` now decides reuse by comparing the recomputed
**plan** (plus the source blob) against the cached one, rather than by the identity of the
`heuristics` object the graft rebuilds. Where the plan is unchanged the whole clip is reused, no
decoder opens, and the second line arrives **~4 ms** after
`[analysis-diagnostics:scale-pass] status=done` instead of ~800 ms — measured on a 13.2 s clip,
twice. Where the plan genuinely moves (Demo 1's `metric-excluded` → `planned`) a real second
extraction still runs. So do not time the gap between the two lines and read it as extraction cost,
and do not infer from a fast second line that the graft did not happen.

Also fixed there: the cards no longer blank while a re-extraction runs. `SessionEvidenceState`'s
`extracting` now carries the previous pass's sections, and `MultiClipVideoSession` renders sections
from both non-idle states, so only `idle` means "no imagery". **The demo clips cannot observe either
the old bug or the fix** — the scale pass finishes before the first extraction settles on both
(Demo 1 2.1 s vs 3.8 s, Demo 2 1.6 s vs 3.3 s), so the first run is superseded before it ever
paints. Reproducing needs a clip long enough to invert that ordering; the one used was
`park-approach.mp4` concatenated 8× (`ffmpeg -f concat -c copy`, 13.2 s), uploaded through the
Upload tab, with a 100 ms DOM poll counting `main canvas`.

**Coverage** (✅ = images produced; count is images, a ghosted pair being 1). ⚠️ **The table
immediately below is the 2026-08-17/18 reading and is NO LONGER the number to check a regression
against** — jump to "Coverage re-measured 2026-08-31" a few paragraphs down for the current one.
It is kept because the per-metric reasons it records are still the explanation for how the current
figures were reached. As measured then, Demo 1 and Demo 2 were **exact and reproduced on every
trial**, re-confirmed independently by both epics' live verification, and **multiperson was NOT** —
see the caveat under the table:

| metric | Demo 1 | Demo 2 | multiperson |
|---|---|---|---|
| `verticalOscillation` | ✅ 1 | ✅ 1 | ✅ 1 |
| `verticalRatio` | ✅ 2 | excluded | ✅ 2 |
| `verticalOscillationCm` | ✅ 1 (post-graft) | ✅ 1 | ✅ 1 |
| `trunkLean` | **`all-gated-out`** | excluded | **`all-gated-out`** |
| `overstriding` | **`all-gated-out`** | excluded | **`all-gated-out`** |
| `cadence` | `not-emitted` by design | `not-emitted` | `not-emitted` |
| `kneeFlexion` | ✅ 1 | excluded | ✅ 1 |
| `armSwingSymmetry` ⚠️ RETIRED, now `armSwingAmplitude` | excluded | ✅ 2 | excluded |
| `footStrikePattern` | ✅ 2 | excluded | ✅ 2 |
| `stepWidth` | excluded | ✅ 1 | excluded |
| `stepWidthCm` | excluded | excluded | excluded |
| **totals** | **7 images / 5 sections** | **5 / 4** | **range, see below** |

**`trunkLean` on multiperson is now correctly `all-gated-out`, not ✅ 1.** It is rejected by the
far-apart-pair guard (`EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5`, `evidenceFrames.ts`) — its pair's crop
growth is **3.375**, and the ghost it used to produce was unreadable. Gated out on all 3 trials.

**Record multiperson as a RANGE, not a number: observed 7/5, 4/3, 4/3 across trials.** That clip's
analysis is **not run-to-run deterministic**, so its coverage totals move between trials. The
per-metric multiperson column above is the highest-coverage trial (7 images / 5 sections); the
lower trials drop further metrics, and which ones is not pinned per-metric here. `trunkLean`'s
`all-gated-out` is the one multiperson cell confirmed identical on every trial. Do not treat a 4/3
reading there as a regression without checking against this range first.

⚠️ **"multiperson is not run-to-run deterministic" does NOT survive the fresh-process regime**
(addendum 2026-08-29, `strides-b0y` — the 7/5, 4/3, 4/3 observation above is left exactly as
measured). Two independent 8-trial `--evidence` invocations at the default (fresh) regime, 16
trials, returned a **bit-identical `[evidence-coverage]` payload every time** on multiperson:
same per-metric status, same exemplar `timestamp`/`pairedTimestamp`/`quality`/`cropSidePx`/
`cropGrowth` to full precision. Eleven further fresh trials of the primary line show zero spread
on every multiperson field. Under `--reuse-browser` the same clip splits into two states the
moment it runs first in the process (`detectedFrames` 103 cold vs 127 warm) — that split, not the
clip, is what the 7/5–4/3 range was recording. Caveat: this is today's `main`, several evidence
changes downstream of the 2026-08-17/18 table, so the *values* are not comparable to the column
above — only the presence or absence of a range is. See the rewritten **Determinism caveat**.

**Coverage re-measured 2026-08-31 on `c79d307` — this is the current reference** (`strides-h4u`).
`scripts/ab-person-selection.mjs --arm 'base={}' --clips demo1,demo2,multiperson --trials 3
--evidence`, fresh Chromium process per trial, dev server started and identity-verified by the run,
real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), reading the LAST `[evidence-coverage]` line.
**Bit-identical across all three trials on all three clips** — per-metric status, exemplar
`timestamp`/`pairedTimestamp`/`quality`/`cropSidePx`/`cropGrowth` to full precision.

⚠️ **Those clip keys no longer exist and the Demo 1 column is retired footage.** Today's
equivalent invocation is `--clips side-landscape,front-approach,multiperson`; `front-approach` is
the same file this table's Demo 2 column was measured on, but `side-landscape` is DIFFERENT footage
from its Demo 1, so that column is a record rather than a target. See the harness section above.

| metric | Demo 1 | Demo 2 | multiperson |
|---|---|---|---|
| `verticalOscillation` | ✅ 1 | ✅ 1 | ✅ 1 |
| `verticalRatio` | ✅ 1 | excluded | ✅ 1 |
| `verticalOscillationCm` | ✅ 1 (post-graft) | ✅ 1 | ✅ 1 |
| `trunkLean` | ✅ 1 | excluded | ✅ 1 |
| `overstriding` | ✅ 1 | excluded | ✅ 1 |
| `cadence` | `not-emitted` by design | `not-emitted` | `not-emitted` |
| `kneeFlexion` | ✅ 1 | excluded | ✅ 1 |
| `armSwingSymmetry` ⚠️ RETIRED, now `armSwingAmplitude` | excluded | ✅ 2 | excluded |
| `footStrikePattern` | ✅ 2 | excluded | ✅ 2 |
| `stepWidth` | excluded | ✅ 1 | excluded |
| `stepWidthCm` | excluded | excluded | excluded |
| **totals** | **8 images / 7 sections** | **5 / 4** | **8 images / 7 sections** |

⚠️ **Demo 1's `overstriding` cell reached its ✅ 1 by a DIFFERENT route since `0817ca9`** (addendum
2026-09-01, `strides-ddj`; the table is left exactly as measured). `strides-1mt`'s collapsed-ankle
gate cut that metric's sample to two surviving strikes, leaving exactly one possible pair
(`alternates: 0`) at crop growth **2.881** against the untouched 2.5 threshold — so between the two
changes the card showed **nothing at all**. It renders again, but as a **demoted single**, not the
ghosted pair the table above recorded: `demotion 'far-apart-pair'`, `pairedTimestamp null`,
`cropGrowth null`, `timestamp` **4.84**, `cropSidePx` **912.197**, quality still 0.500. The image
count is unchanged at 8 / 7. Everything else on all three clips is bit-identical across that pair of
changes.

⚠️ **Demo 2 reads 7 images / 5 sections since `add-arm-swing-amplitude-metric`** (addendum
2026-09-02; the table is left exactly as measured) — the two added rows are `armSwingAmplitude`'s
deliberately reused `armSwingCycle` exemplars, instants bit-equal to `armSwingSymmetry`'s pair, so
7/5 against the table's 5 / 4 is expected drift, not a regression.

**multiperson is a single number again, and the "record it as a RANGE" instruction above is
retired.** Read that paragraph as a record of what the reused-browser regime produced, not as
advice: under the fresh-process default this clip reads 8/7 on every trial. What is *not*
comparable across the two tables is the **values** — several evidence changes land in between — so
do not read a per-metric difference as a regression without checking it against this table first.

**Four cells moved, and every one of them is expected drift from named changes:**
- **`trunkLean` and `overstriding` now emit on Demo 1 and on multiperson**, where the old table
  records `all-gated-out` on both clips. `edb3f07` (fall back to the next-best croppable exemplar
  pair), `9fa169c` (rank exemplar candidates by quality rather than scoring only the argmax) and
  `4fac355` (judge a pair on the crop it demands, before the frame cap clamps it) are exactly the
  fixes the old table's own follow-up **#70** predicted would move these cells. Measured qualities:
  Demo 1 `trunkLean` 0.567 (crop 1687.4 px, growth 1.866), Demo 1 `overstriding` 0.500 (crop 2160 px
  — the frame cap — growth 2.428), multiperson `trunkLean` 0.692 (crop 732.6 px, growth 2.289),
  multiperson `overstriding` 0.500 (crop 696.1 px, growth 2.175).
- **So `trunkLean` on multiperson is no longer `all-gated-out`**, and the note above explaining that
  cell is superseded: `EVIDENCE_MAX_PAIR_CROP_GROWTH` is untouched at 2.5, but the pair it now
  chooses demands 2.289 rather than the 3.375 the old pair demanded. The guard did not weaken; a
  better pair became reachable.
- **`verticalRatio` drops from ✅ 2 to ✅ 1 on Demo 1 and on multiperson — CAUSE ISOLATED, and the
  drop is CORRECT** (`strides-mjw`, 2026-08-31). Its one surviving exemplar is the `bounceCycle`.
  **Neither of the two suspects this bullet used to name is responsible** — not `ceee2dc`'s
  fitted-step-period gate, not `strides-cjl`'s footstrike re-timing. `verticalRatio` still EMITS
  the stride pair, at **quality 1.0**, the ceiling; `MAX_EXEMPLARS_PER_METRIC` and
  `MIN_EXEMPLAR_QUALITY` are both uninvolved. It is dropped inside planning by
  `isTooFarApartPair`, and the constant did not move — the MEASUREMENT did.
  **`4fac355`** ("Measure a ghosted pair's crop growth before the frame cap clamps it") swapped
  `evidencePairCropGrowth`'s numerator from `computeCropRect(...).side`, capped at
  `min(frameWidth, frameHeight)` = 2160 on Demo 1's 3840×2160, to the uncapped
  `evidenceCropSideDemand`. Both readings, measured on the identical pair (t = 4.84 ↔ 6.16) in one
  run: **clamped 2.3679** (passed, pre-`4fac355`) vs **unclamped 4.5306** (fails, today), against
  `EVIDENCE_MAX_PAIR_CROP_GROWTH` = 2.5 throughout.
  The pair demands a union crop side of **4132.8 px on a 3840 px-wide frame** — wider than the
  video. The old image was therefore drawn through a crop that could not contain both instants it
  was captioned for, the same failure the `trunkLean`-on-multiperson bullet records. There is no
  fallback: the probe reports `alternates: 0`, since `buildStridePairExemplar` emits exactly one
  pair (the median-displacement one, which *is* `strideLengthPx`).
  **The kind is structurally unreachable for this metric, not unlucky on one clip.** A stride pair
  spans a full stride of subject translation by definition, and `verticalRatio` is side-view-gated
  — the one camera angle where that translation is fully in-plane and therefore maximal. Every
  stride pair on this clip has the same shape. Recovering the image needs a different construction
  (a wide letterboxed crop, or a composed side-by-side rather than a ghost), which is a product
  decision, not a threshold — filed as `strides-nrg`. **Do not raise
  `EVIDENCE_MAX_PAIR_CROP_GROWTH`** (4.53 is not marginal, and admitting it re-admits
  `trunkLean`'s 6.1–6.8 pairs on the same clip), and **do not demote the pair to its base**
  (`isTooFarApartPair` refuses demotion on purpose, and a label reading "One stride: consecutive
  left-foot strikes, ghosted together" is exactly a claim one frame cannot make).
  ⚠️ **RE-SCOPED 2026-09-01 (`strides-ddj`) — still correct FOR `stridePair`, no longer a blanket
  rule.** `isTooFarApartPair` does not refuse demotion any more: a far-apart pair routes through the
  same `SINGLE_INSTANT_KINDS` classification a collapsed one does, and `overstrideRange` /
  `trunkLeanRange` joined that set because both cards report a MEDIAN of per-instant measurements.
  `stridePair` did not, and the reason is mechanical rather than a judgement call: its only
  measurement mark, `strideCaliper`, spans the two hip midpoints and is drawn only when
  `plan.ghost !== null`, so a demoted stride pair would lose exactly the mark that IS the
  measurement — on top of the label problem above. **`EVIDENCE_MAX_PAIR_CROP_GROWTH` is untouched at
  2.5 and the criterion is unchanged**; only what happens to a rejected pair now depends on the
  metric. `strides-nrg` is unaffected.
  This retires the "best image on any clip is `verticalRatio`'s `stridePair`" claim recorded under
  Legibility above.
- **Demo 2 is unchanged at 5 / 4**, cell for cell, and its `armSwingSymmetry` pair still sits on
  the `EVIDENCE_CROP_MIN_SIDE_PX` floor at `cropSidePx` 320 — now centred on the subject, see the
  bystander bullet below.

`excluded` = `metric-excluded`, the tier-3 gate (the metric has no card, so there is nothing to hang
evidence on) — not the exemplar gate. **Zero `extraction-failed` on any run.** `cadence` deliberately
never emits (design D7). `stepWidthCm` produced nothing anywhere, for a reason outside this feature:
it is tier-3 on all three clips.

**The PTS drift was real and it is now FIXED — a per-clip, per-sampler offset ships.** The
measurement below stands as the diagnosis; the conclusion that followed it ("stays 0, do not fix it
by picking a number") does not. `sequentialSampling` defaults on, so most
MP4s sample through WebCodecs, where `robustFrames[].timestamp` is raw `sample.cts / sample.timescale`
(`mp4Demux.ts:174`) with **no edit-list adjustment**, while `HTMLVideoElement.currentTime` **is**
adjusted. Ground-truthed by rebuilding each exemplar's exact crop from the source with
`ffmpeg -vf "select='eq(n\,IDX)',crop=…,scale=…"` at a range of candidate frame indices (blended
50/50 for a ghosted pair) and PSNR-comparing against the app's own canvas — the argmax names the
frame actually drawn. ⚠️ **If you re-run this recipe, the blend is no longer 50/50** — since
`strides-c37` the photograph is `0.35·ghost + 0.65·base`, so a reconstruction blended 50/50 will
mis-rank candidates. The measurements in the table below were taken when 50/50 was correct and are
left as measured:

| clip | `elst media_time` ÷ media timescale | measured | best PSNR vs runner-up |
|---|---|---|---|
| Demo 1 (25 fps) | 2 / 25 = **0.0800 s** | **+2 frames** | 40.8 vs 21.6 dB; 34.0 vs 20.3 dB |
| Demo 2 (59.94 fps) | 2002 / 60000 = **0.033367 s** | **+2 frames** | four exemplars, +2 first in all |
| multiperson (60 fps) | 512 / 15360 = **0.033333 s** | **+2 frames** | 17.5/15.3, 22.0/20.6, 16.4/15.2 dB |

**Isolated to the WebCodecs domain, not to seeking.** The same Demo 1 clip under
`{ sequentialSampling: { enabled: false } }` measures **exactly 0** — δ=0 wins at 35.7 dB and
33.7 dB, ~15 dB clear. That path uses `requestVideoFrameCallback`'s `mediaTime`, already in
`currentTime`'s domain.

**The offset is now DERIVED PER CLIP, not configured — `src/video/evidenceSeekOffset.ts`.** The
reasoning that once argued for leaving it at 0 was right about the diagnosis and wrong about the
remedy: the correct value genuinely is per-clip (it is that clip's own edit list) **and** per-sampler
(exactly 0 for every WebM/webcam clip and every MP4 `canUseSequentialDecode` turns down), so no
single constant works — but both facts are recoverable from the clip's own bytes.
`resolveEvidenceSeekCalibration(blob)` re-derives them using the same two predicates the analysis
run itself used (`resolveSamplingRobustnessConfig().sequentialSampling.enabled` and
`canUseSequentialDecode(blob)`, both pure functions of the blob and the environment), reads the
`elst` via `containerTiming.ts`, caches per `Blob`, and returns **0** for any edit list that is not a
single constant shift. `extractFrames.ts` applies it at seek time and **never mutates
`robustFrames[].timestamp`** — that array is correct in its own domain.
`DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS` still exists and is still `0`, but it is now only the
fallback when no per-clip value is supplied.

**Why it was fixed rather than accepted: 31% of a torso.** Misregistration was measured in output
pixels — `‖p(t + offset) − p(t)‖` for every joint an annotation draws, scaled to the output canvas —
not in frames, because pixels are what decides whether a drawn skeleton floats off the body. Demo 1
came in at a **median 64.4 output px = 31% of a torso length**; Demo 2 at a median 7.2 px. Unannotated
photographs hid that; annotated ones would have looked broken while the numbers were right.
**Zero by construction after the fix.** Measured per-clip offsets, all exact: Demo 1 **−0.08**
(2/25), Demo 2 **−0.03336666666666667** (2002/60000), multiperson **−0.03333333333333333**
(512/15360). The webcam gap the assessment could not reach was later closed directly: a live
`getUserMedia` + `MediaRecorder` capture (`video/webm;codecs=vp9`, 205 samples,
`sampling.path 'playback'` — the rVFC branch that must not shift) returned **exactly 0** on both
extraction passes.

**One residual, and it is not the arithmetic: δ = −1 frame on the multiperson clip only**
(`strides-ac9.12`, **open**). δ = 0 on both demo clips. It reproduces with a **pure Chromium seek and
no app involved**, so it is not an app race: Chromium quantises to integer microseconds, and this
clip's stored timestamp sits ~1 µs above the double-subtraction result, putting the flip inside a
~0.6 µs window just above the frame's presentation timestamp. The arithmetic is correct and lands
**on** the frame boundary by construction. **Explicitly not to be fixed with an epsilon.**

⚠️ **That residual is now CLOSED, and by not aiming at the boundary at all** (2026-09-05,
`strides-5t4`, `seek-evidence-frames-to-the-frame-midpoint`). The seek target gained a SECOND
per-clip term beside the edit-list shift: **half the track's nominal frame duration**, so it asks
for the MIDDLE of a frame's presentation interval. `currentTime = t` displays the frame whose
interval *contains* `t`, so the midpoint is the semantically correct request rather than a fudge,
and it absorbs ±8.3 ms at 60 fps where the boundary absorbed nothing. Read the two terms as
different kinds of thing: the edit-list shift is a **clock conversion** (per clip AND per sampler),
the midpoint is a **targeting policy** (per clip only, and applied on *every* sampler). They stay
separate fields — `resolveEvidenceSeekOffsetSeconds` became **`resolveEvidenceSeekCalibration`**,
returning `{ offsetSeconds, midpointOffsetSeconds }` — and compose as
`timestamp + offsetSeconds + midpointOffsetSeconds`.

Three measurements worth not repeating:

- **Chromium TRUNCATES seconds→microseconds.** Assigning `3.049999666666667` reads back
  `3.049999`. Every earlier note calling the rounding mode unverified is now answered. A 60 fps
  frame on a 15360 timescale starts at `n/60` s, a whole microsecond only when `n mod 3 == 0`, so
  **two thirds of that clip's frame boundaries are unrepresentable in the seek API** and every one
  of them truncates DOWN into the previous frame.
- **Measured effect** on `park-side-landscape.mp4`, PSNR argmax against ffmpeg-reconstructed crops:
  `footStrikePattern`'s two cards moved from source frames **182 → 183** (19.19 dB, runner-up
  14.61) and **203 → 204** (20.85 dB, runner-up 15.20). Confirmed by looking: at 182/203 a
  separated shadow band with tarmac visible between sole and shadow; at 183/204 a continuous
  sole/ground line. Frame indices are ffmpeg's decoded index, which on these clips **is** the
  container's media frame index — `select='eq(n\,183)'` reports `pts_time 3.05`, and
  `-ignore_editlist 1` changes nothing, so ffmpeg does not apply the edit list at all.
- **The midpoint is a no-op on the playback path**, verified rather than assumed: six
  boundary-vs-boundary-plus-half pure-Chromium seeks across `park-side-landscape` and
  `park-approach` (the latter at the playback arm's own real planned instants) came back
  **byte-identical**. rVFC `mediaTime` is a frame start, so half a frame stays inside it. The
  playback arm on `side-landscape` cannot be checked end to end at all — every metric is
  `metric-excluded` there — so `front-approach` is the clip to use for that.

Derived values, per clip: side-landscape `1/120`, side-portrait `1/60`, front-approach
`1001/120000`. Zero for every clip with no derivable frame duration — WebM, webcam, audio-only, no
`stts` — which is exactly the seek that shipped before. Cost: every clip now pays the container
probe even with `sequentialSampling` disabled, where the old early return skipped it (25.2 ms on
the 4K clip, 8.1 ms on front-approach, cached per blob).

⚠️ **A/B gate for that change: bit-identical.** `--clips side-landscape,side-portrait,front-approach
--trials 3 --evidence`, before/after: **3 differing lines, all `elapsedMs`**, and the
elapsedMs-stripped body md5 matched exactly. Nothing in `metrics.*`, `sampling.*`,
`personSelection.*`, `view.*` or `evidence.*` moved — which is the point: this changes which pixels
an image is drawn from and no number any metric was computed from.

⚠️ **WITHDRAWN 2026-09-06 — the claim in the paragraph below is WRONG, the edit-list term is
CORRECT on all four clips, and nothing contradicts the paragraph above.** It is left as written
because its readings were honestly measured and are true; what was wrong is the frame numbering
they were checked against. **Do not act on it — read the resolution that follows it.** Original
report (`strides-09b`, filed 2026-09-05):

*On `park-side-landscape.mp4` Chromium's `currentTime` runs on the container's MEDIA clock — the
edit list is NOT applied.* `video.duration` reads **3.883333** (= 233/60, the full media
duration) rather than 3.884 (the `elst` `segment_duration` ÷ 1000); and a **pure Chromium seek with
no app involved** to `currentTime = 2.0` draws **media frame 120** at a clean unimodal PSNR peak
(21.35 dB, runner-up 20.19) where the edit-list-applied model predicts 122. Both app footstrike
images corroborate: seeking `3.049999666666667` drew media frame 182, which is
`floor(3.049999 × 60)` exactly. So the `−512/15360` term this section documents as a FIX is moving
that clip's seek **two frames early**, and after the midpoint the drawn frame is 2 frames from the
instant the metric measured rather than 0. **This does not undo the midpoint** — its effect is `+1`
frame whatever the offset is, the two terms are independent by construction, and the frame it now
lands on is the keyframe-confirmed first-contact frame. But the `+2 frames` measurement recorded in
the table above was taken on the retired Pexels Demo 1 and on `multiperson-track.mp4`, not on
`park-side-landscape.mp4` — and note those are **different files on an identical lattice** (md5
`5da45ab…` vs `106dcee…`, both 15360/512/60 fps/233 frames), so a reading on one is not a reading on
the other. Re-measuring the offset across the whole corpus is `strides-09b`; do not assume either
answer.

**RESOLUTION (2026-09-06, `strides-09b`, change `pin-the-evidence-seek-clock-conversion`) —
Chromium APPLIES the edit list on every clip in this corpus, the `−media_time/timescale` term is
correct, and it STAYS unchanged. The report above was a frame-numbering error.**

**`ffmpeg -vf "select='eq(n\,N)'"` indexes CODED PICTURES, not timeline slots**, and on all four
clips the lowest sample composition timestamp equals the `elst media_time` **exactly**:

| file | md5 | timescale | `elst media_time` | min sample CTS | frames |
|---|---|---|---|---|---|
| `park-side-landscape.mp4` | `106dcee8…` | 15360 | 512 | **512** | 233 |
| `park-side-portrait.mp4` | `e380759e…` | 15360 | 1024 | **1024** | 345 |
| `park-approach.mp4` | `36207375…` | 60000 | 2002 | **2002** | 99 |
| `multiperson-track.mp4` | `5da45ab1…` | 15360 | 512 | **512** | 233 |

(⚠️ those md5s were re-checked directly on 2026-09-06; a corpus table circulating with this ticket
had `park-side-portrait.mp4`'s and `park-approach.mp4`'s the other way round.) All four carry a
`ctts` box; this is the ordinary **B-frame priming edit**, which cancels the first picture's
composition offset so
presentation starts at zero. **No picture precedes it and none is discarded** — `-ignore_editlist 1`
yields the same 233 pictures with the same `select` indices. So ffmpeg frame `N` sits at composition
time `(media_time + N·Δ)/timescale` and presentation time `N·Δ/timescale`. Reading `media_time` as
"two frames trimmed" mis-numbers every picture in the file by exactly the quantity in dispute, so a
correct conversion reads as a two-frame error in the opposite direction.

Re-indexed, the report's own three readings CONFIRM the term: `currentTime = 2.0` → the edit-list
model predicts **120** (not 122) and 120 was measured; the two app seeks predict **182** and **203**
and those were measured. `video.duration` cannot discriminate at all — the edit segment spans the
whole media, so `3.884` is only `3883.33 ms` rounded into the 1000 Hz movie timescale, and both
models predict `3.883333`. And `-ignore_editlist 1` "changing nothing" is not evidence either:
ffmpeg does shift packet PTS (first packet `0` vs `512`) and then re-bases output start time both
ways, so `select='eq(n\,183)'` reports `pts_time 3.05` in both modes — that is frame 183's
**presentation** time; its composition time is `3.083333`, which is what the sampler reports.

**Measurement: 31 pure-Chromium seeks over all four clips** (no app, no dev server; targets chosen
as frame-interval midpoints so the two models' predictions sit exactly two frames apart; PSNR argmax
against ffmpeg-reconstructed candidates; at least one whole-microsecond and one non-whole-microsecond
target per clip). **30 of 31 matched the edit-list-applied model exactly, and NOT ONE matched the
media-clock model.** The single row that did not hit its prediction exactly is a deliberate
frame-BOUNDARY target (`121/60`, read back as `2.016665`) which landed one frame low — the
µs-truncation the midpoint term exists to absorb — and still not on the media-clock prediction.

**Answering "by file, by container detail, or misindexed?": misindexed.** `park-side-landscape.mp4`
and `multiperson-track.mp4` are the controlled pair — different footage and resolution, identical
lattice — and agree on every shared target; so do the 60000-timescale clip and the variable-rate one.

**`strides-5t4`'s acceptance criterion is CONFIRMED, not stale.** A pure-Chromium seek at the app's
own two targets (`3.058333`, `3.408333`) draws frames **183** and **204**, and looking at the
frames again: 183/204 are touchdown (sole meets ground, shadow continuous), 185/206 — what removing
the term would draw — are **mid-stance**, with the shin already rotated over the planted foot. 5t4's
D9 claim that "the drawn frame is two frames from the instant the metric measured" is **withdrawn:
the residual is zero.** Full tables:
`openspec/changes/pin-the-evidence-seek-clock-conversion/design.md`.

**The extreme-role `1.5·MAD` risk fired — and only for `overstriding`.** An extreme instant's
typicality is `|v − median| / (3·MAD)`, so clearing `MIN_EXEMPLAR_QUALITY = 0.5` needs
`|v − median| ≥ 1.5·MAD`. Measured per-instance distributions (primary MoveNet pass, **bit-identical
across all 3 trials on all 3 clips** — no spread to report, which is itself notable):

| clip | metric | n | median | MAD | max dev (MADs) | ≥1.5 MAD | most: MADs / `detectionFactor` | least | pair quality |
|---|---|---|---|---|---|---|---|---|---|
| Demo 1 | `trunkLean` | 59 | 13.297° | 3.016° | 3.526 | 18 | 2.355 / **0** | 2.476 / 1 | **0.000** |
| Demo 1 | `overstriding` | 7 | 0.2266 | 0.2403 | 3.354 | 2 | **1.010** / 1 | 2.207 / 1 | **0.337** |
| Demo 2 | `trunkLean` | 99 | 3.002° | 1.414° | 3.108 | 14 | 2.148 / 1 | 2.412 / 1 | 0.716 |
| Demo 2 | `overstriding` | 7 | −0.0435 | 0.0422 | 14.495 | 1 | 1.211 / 1 | **1.000** / 1 | **0.333** |
| multiperson | `trunkLean` | 107 | 3.427° | 2.183° | 21.038 | 31 | 2.678 / 1 | 2.776 / 1 | **0.893** |
| multiperson | `overstriding` | 11 | 0.0542 | 0.3993 | **1.389** | **0** | 1.389 / 1 | 1.366 / 1 | **0.455** |

`describeDistribution().usable` was **true in every case** — the `<5 instances`/`MAD === 0` flat-0.5
fallback never fired, so it explains nothing here.

- **`overstriding` emits on no clip, always by the ramp** (0.333/0.337/0.455), never by
  `detectionFactor` (1.0 everywhere) and never by the `3·MAD` hard reject. multiperson is the clean
  proof: `maxDevMads = 1.389`, **zero** instants ≥1.5 MAD — unreachable at any `detectionFactor`.
  Demo 2's `least` sits at exactly **1.000 MAD**, the textbook tightly-bimodal ceiling for a
  left/right-alternating footstrike distribution. `MIN_EXEMPLAR_QUALITY` was **not** touched.
- **`trunkLean` is NOT the same problem.** Its pair quality reaches 0.716/0.893 — it clears this
  gate comfortably where `overstriding` cannot. Its Demo 1 failure is `detectionFactor = 0` on the
  argmax instant (t = 4.28 s, all four torso seed keypoints interpolated), while 18 other instants
  clear 1.5 MAD. **On multiperson it now emits no image either, but for an unrelated reason** — it
  passes this quality gate at 0.893 and is then rejected by the far-apart-pair crop-growth guard
  (see the coverage table above). Do not read its `all-gated-out` there as a MAD failure.
- **Second defect, separable and cheaper to fix:** `buildExemplars` in both metrics takes the raw
  argmax among outlier-bound survivors and *then* scores it, with no fallback to the next-most-extreme
  instant. Coverage therefore hinges on one frame. Proof: the same Demo 1 clip under
  `{ sequentialSampling: { enabled: false } }` samples a different set, the argmax lands on a
  well-tracked frame, and `trunkLean` **emits at quality 0.664**. Both in follow-up **#70**.

⚠️ **The three bullets above describe a state that has been FIXED — `overstriding` and `trunkLean`
both emit on Demo 1 and on multiperson today** (addendum 2026-08-31, `strides-h4u`; the
distribution table and the bullets are left exactly as measured, because the mechanism they
describe is still how the gate works and still what a future regression would look like). #70's
"second defect" — one argmax, scored after the fact, no fallback — is what `9fa169c` (rank
candidates by quality) and `edb3f07` (fall back to the next-best croppable pair) closed, with
`4fac355` measuring a pair's crop growth before the frame cap clamps it. Measured on `c79d307`:
Demo 1 `overstriding` 0.500 and `trunkLean` 0.567, multiperson `overstriding` 0.500 and `trunkLean`
0.692 — all four at or above `MIN_EXEMPLAR_QUALITY`, which was still not touched. Note two of them
land at exactly 0.500: these metrics clear the gate, they do not clear it comfortably, so a change
that shaves the ramp will silently take `overstriding`'s coverage back out on both clips.

**Image-quality findings — all three original defects are now closed** (every image was pulled
out of the DOM and looked at, both epics, full-res and at the real inline size — **112 px when
these three were judged; the cards were widened to `w-36` afterwards and the inline size is now
144 px nominal, 142 measured**, so every "at 112 px" reading below is a floor rather than the
present-day rendering):
- **`trunkLean` on multiperson was a whole-frame crop — FIXED.** Its two extremes are 1.25 s apart,
  the runner crosses the frame between them, `computeEvidenceCropRect` unioned both torso boxes,
  squared, and hit the `min(frameWidth, frameHeight)` cap → side 1080 on a 1920×1080 clip, showing
  the runner twice and tiny at opposite edges of an image that was mostly fence and crowd.
  Annotation made it unmistakable rather than merely odd: 27 of 28 off-canvas drawn ops across all
  three clips were this one case. Closed by the far-apart-pair guard
  (`EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5`, `isTooFarApartPair`) — the pair is now gated out instead
  of ghosted, and the **largest crop on that clip is 509 px**. Note the guard is the complement of
  D12, which demotes a pair that is too *similar*.
- **`armSwingSymmetry` on Demo 2 included a bystander, every trial — FIXED** (`strides-e9b`,
  archived change `openspec/changes/archive/2026-08-30-place-floored-evidence-crop-on-subject/`).
  `EVIDENCE_CROP_MIN_SIDE_PX = 320` inflated the small limb box until it swallowed a man in a
  yellow shirt standing to the right, who read as a second body. **The 320 did not move, and the
  advice not to move it stands** — it came from display reasoning, not from this clip. What changed
  is where a floor-inflated crop is PLACED: `frameSubjectExtentBox` + `subjectCentredCropRect`
  (`evidenceFrames.ts`) re-centre a crop on the subject's own keypoint extent on any axis where the
  FLOOR, not the padding, is what made it wider than the body. Verified by looking: the bystander
  is gone, and every other image on all three clips was byte-identical to baseline. Demo 2's
  `armSwingSymmetry` exemplars still sit at `cropSidePx` 320 on `c79d307`, so the floor is still
  binding — the crop is just aimed correctly now. (The caption this bullet used to quote — the
  "not two people" disclaimer — is also gone, dropped by `aed9a84` as restating what a *ghosted
  against* label already says.)
- **A bounce ghost read as horizontal translation on a side view — materially improved.**
  `verticalOscillation` on Demo 1 is two clearly-separated horizontal positions with the vertical
  delta the smaller displacement; the same exemplar on the front-approach Demo 2 always read well.
  Annotation improved it: two dashed guides now make the vertical delta explicit. It is a
  camera-angle limit with correct frames and a correct crop, not a crop bug — but the guides are
  ~3 px apart at the 112 px inline size, so the improvement is real at full resolution and marginal
  inline.

Also confirmed by looking: joints land on the right body throughout, and the annotation painter
order is correct (hips render *under* the amber cross rather than over it).

### How a crop gets PLACED — three rules, and aiming now outranks the other two (2026-09-05, `strides-dxd`)

`computeEvidenceCropRect` sizes a square from the exemplar's `cropKeypoints` box (padding ×1.6,
`EVIDENCE_CROP_MIN_SIDE_PX` floor of 320, `min(w,h)` frame cap) and then *places* it. Three rules
can decide the placement, and **only one ever runs**:

1. **Aimed at a named joint** — `focusAimedCropRect`, if the exemplar carries `cropFocus`.
2. **Centred on the subject** — `subjectCentredCropRect` (`strides-e9b`), if not, and if the FLOOR
   (never the padding, never the cap) is what made the crop wider than the runner on one axis while
   the other axis is narrower than the crop.
3. **Centred on its own box** — `computeCropRect`'s placement, otherwise.

⚠️ **Aiming SUPERSEDES subject-centring for any exemplar naming a focus joint, and the two knee
metrics now name one.** `computeEvidenceCropRect` returns from `focusAimedCropRect` **before
`frameSubjectExtentBox` is ever computed**, so on `kneeFlexion` and `kneeDrive` the bystander guard
is not merely inactive — it is unreachable, on every clip. Two consequences worth knowing before
touching either rule:

- **`subjectCentredCropRect`'s doc still cites `kneeFlexion` on `multiperson-track.mp4`** ("riding
  66 px up the body … promotes a walking bystander into the centre of the picture") as the
  justification for its second clause. That measurement was honest and is left in place, but it no
  longer describes a path that metric can take. **The `footStrikePattern` half of the same
  paragraph — riding 104 px up and reframing a foot close-up as a whole-body shot — is still live
  and still what the clause protects.**
- **What replaces the guard is structural, not incidental**: the focus joint is one of the
  *runner's own* keypoints, so the centre of the picture is a point on the runner by construction —
  a stronger statement than "centred on the subject's midline". And at peak flexion the knee is the
  LOWEST seed, so aiming moves a knee crop DOWN the body, the opposite direction from the ride-up
  that promoted the bystander. Both pinned by unit tests on the multiperson geometry, and confirmed
  by looking at the rendered images on that clip.

**`cropFocus` names ONE joint and is absent by design on a relation** — a bounce amplitude, a
stride length, a step width are each about two positions, and aiming at either end would emphasise a
point the card is not reporting on. An exemplar naming none is framed exactly as it was before.

**Reading it from a harness**: `[evidence-coverage]`'s per-exemplar records carry **`focusOffset`**
— Chebyshev distance from the crop's centre as a fraction of its side, `0` dead centre and `0.5` on
an edge, `null` where no focus joint was named or it did not resolve. Added because the placement
is otherwise invisible: only `x`/`y` move, and the line reports `cropSidePx` but **not `crop.x` /
`crop.y`**, so `subjectCentredCropRect` remains unobservable there to this day. Do not read a
`null` as "perfectly centred" — the walk's own tie-break abstains on it for exactly that reason.

Measured knee position within its own crop, `fx`/`fy`, before → after (`0.5` is dead centre):
`side-landscape` `kneeFlexion` **0.0501/0.7626 → 0.5000/0.5000** (and its instant moves, t=3.51667
left → 2.5 right, because an even 14-peak pool tied bit-exactly and stable-sort handed it to the leg
that was two-thirds out of frame); `side-landscape` `kneeDrive` **0.0422/0.6771 → 0.5000/0.5000**
at the SAME instant; both `side-portrait` metrics reach 0.5000/0.5000 with instant, quality and
`cropSidePx` unchanged.

**N-clip provenance works.** Re-measured on a two-clip session (Demo 2 via the demo button,
multiperson added through the header add-a-clip action): **10 images / 7 sections**, and every
rendered *"From clip N of 2."* caption matched `sourceIndices` one-for-one.
`verticalOscillationCm` had a planned exemplar on both clips and correctly took the fusion winner's,
not "any clip that has it." (The pre-annotation measurement of the same check was 11 images /
8 sections, against the then-current coverage.) **Both totals move with per-clip coverage and neither
is a target** — see "Coverage re-measured 2026-08-31" below; what this check actually asserts is
that every rendered *"From clip N of 2."* caption matches `sourceIndices`, which is independent of
how many images there are.

**No analysis wall-clock regression, and evidence's own cost lands after `ready`.** Re-measured
against pre-epic baseline `2a3f009`, 6 trials/arm: **+1.4% on both demo clips** — noise, no
regression. The earlier #59 measurement agreed (baseline `896f775`, 3 trials/arm: Demo 1 5698 ms
[5539..5910] → 5747 ms [5550..6290]; Demo 2 3146 ms [3072..3157] → 3020 ms [3002..3086], noise in
both directions). Extraction then adds roughly 3.5–3.8 s (Demo 1), 3.5 s (Demo 2), 4.5 s
(multiperson) between "Analysis complete" and settled imagery, during which the results are already
fully readable.

**Regression anchor re-measured, and CLAUDE.md's own VO_cm number is stale.** The track clip now
reports **VO_cm 4.4215 cm**, not the 4.78–4.79 recorded in the "MediaPipe metric calibration" section
above. That is **not** #59's doing: `896f775` reproduces `4.421467928439415` cm, `fitHz 1.52`,
`sinusoidR2 0.42451916621964814`, `sampleCount 57`, `spanSeconds 2.24`, `torsoMeters 0.5041`,
`medianPixelsPerMeter 868.0` — **every digit identical** to this branch, Demo 2 likewise
(10.4866 cm both sides). The 4.78–4.79 figure was measured 2026-08-12 with **MediaPipe as the
PRIMARY backend**, before the background scale-pass graft path and before #54/#55's person selection;
on today's default MoveNet-primary + grafted-scale-pass path the anchor is **4.4215 cm**. The
cross-check the anchor really tests still holds exactly: `fit.frequencyHz × 60` = 91.2 ==
`cadence.value` 91.2.

**Re-confirmed 2026-08-18, after both the navbar shell and the inline-annotation epics**: the anchor
still reads `4.421467928439415` cm with `fit 1.52 × 60 = 91.2 == cadence 91.2`, and
`subjectAgreement` 52/53. Neither epic moved a number.

**Re-confirmed again 2026-08-31 on `c79d307`**, after the ghost-weight split, the arm-swing fit, the
view-confidence rescale, the subject-centred crop and the footstrike re-timing — two fresh-process
trials, every digit identical to both readings above: `verticalOscillationCm`
**`4.421467928439415`**, `fit.frequencyHz` **1.52** so `× 60 = 91.2 == cadence.value 91.2`,
`sinusoidR2` `0.42451916621964814`, `sampleCount` 57, `spanSeconds` 2.24, `torsoMeters`
`0.504143645953322`, `medianPixelsPerMeter` `868.0221516689736`, `subjectAgreement` 52/53. Note the
anchor lives on the `[analysis-diagnostics:scale-pass]` line, which
`scripts/ab-person-selection.mjs` does not capture — checking it needs a driver that waits for that
line separately, after "Analysis complete".

**Probe recipes used, if this needs re-measuring.** Both were added, measured and reverted per the
add-measure-revert cycle. (1) `[evidence-seek]`: one dev-only `console.log` in
`extractFrames.ts`'s `drawInstant`, dumping `{planned, target, outcome, currentTime, opacity, crop,
outputSide}` — note `video.currentTime` after a seek reports the *requested* target in Chromium, not
the snapped frame, so it cannot answer "which frame" on its own; the ffmpeg/PSNR comparison is what
does. (2) `[exemplar-mad]`: an `exemplarMadProbe.experimental.ts` called from `trunkLean.ts` and
`overstriding.ts` right before `selectExemplars`, dumping the distribution plus the surviving
argmax/argmin with their `devMads`/`typicality`/`detectionFactor`. Expect **two** `[exemplar-mad]`
lines per metric per run — the primary pass and the MediaPipe scale pass both compute heuristics;
the first occurrence is the primary.


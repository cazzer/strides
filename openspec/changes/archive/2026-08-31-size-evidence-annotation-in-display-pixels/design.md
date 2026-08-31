# Design — sizing evidence annotation in display pixels

Everything measured here was captured in headless Chromium with real GPU acceleration
(`ANGLE Metal Renderer: Apple M4 Pro`, asserted per invocation, never SwiftShader), a **fresh
Chromium process per clip**, against a dev server this run started and identity-verified
(`scripts/lib/harnessProvenance.mjs`). Baseline was re-taken on the same `main` this change sits on
(`73ab5b8`), *after* `strides-3a1` moved every grafted metric's crop side — an earlier baseline
taken across that commit would not be comparable.

## D1 — Contrast is measured on delivered pixels, against an exact photographic reference

The whole defect is that a downscale destroys sub-pixel detail, so a measurement taken on the
full-resolution canvas cannot see it. Every ratio below is read on the **144 CSS px element
screenshot**.

"The photograph beneath a mark" is not estimated. The build was captured twice per arm: once
normally, and once with the annotation pass skipped, giving a pixel-aligned photograph-only twin of
every image. So a mark's contrast is the delivered pixel against *exactly* what would otherwise
have been there, and "which pixels are annotation" is the set the annotation actually changed
rather than a colour guess. Classification runs at full resolution by solving each changed pixel as
`annotated = a·C + (1 − a)·reference` for each candidate colour and keeping the best fit; the
recovered `a` separates a base mark from a ghost mark from an interpolated one. The masks are then
area-averaged down to 144 px and every ratio is read there.

**Two readings are reported throughout, and they answer different questions:**

- `amberVsPhoto` — the delivered pixel at the mark's amber core versus the photograph it covers.
- `markVsPhoto` — the mark **as drawn**, its dark boundary included, versus the photograph those
  pixels cover.

`markVsPhoto` is the acceptance reading. WCAG 1.4.11 asks a component to reach 3:1 against
*adjacent* colours and explicitly allows a component to be delimited by a boundary; the halo is
that boundary. `amberVsPhoto` is reported anyway because it is the stricter reading and because its
ceiling is what makes the halo the only available answer (D2).

**Control:** all 42 annotation-free reference images were bit-identical between two independent
capture runs on two different builds. That proves the pipeline is deterministic under the
fresh-process regime *and* that this change touches nothing but the annotation layer.

## D2 — Why no amount of amber can fix this

| colour | relative luminance | reaches 3:1 only against background luminance ≤ |
|---|---|---|
| `EVIDENCE_MEASUREMENT_COLOR` `#fbbf24` | 0.5790 | 0.1597 |
| `EVIDENCE_JOINT_COLOR` `#22d3ee` | 0.5310 | 0.1437 |
| `EVIDENCE_ANNOTATION_HALO_COLOR` `#020617` | 0.0021 | — (it is the dark end) |

Against the measured 0.50-luminance path under Demo 2's `stepWidth`, amber is **1.14:1**. Against
0.30 it is 1.80:1. Both are below 3:1 and neither moves with stroke width or opacity, because
neither changes the colour. The halo composited at its own 0.6 alpha over those same backgrounds
measures **3.0:1 to 4.6:1**. That asymmetry is the whole argument: the fix is a boundary, and a
boundary only works if it is in the delivered image.

## D3 — The two sub-pixel features, and the number that fixes them

| | canvas px on a 640 canvas | display px at 144 |
|---|---|---|
| halo, per side | 3.20 | 0.72 |
| construction dash gap **after** the halo's round caps | 2.88 | 0.65 |

Both resolve to 0.65–0.72 display px on **every** canvas side the planner produces (320, 364, 377,
463, 640) — the fractions are proportional, so the display-space value is constant.

`MIN_HALO_DISPLAY_PX = MIN_DASH_GAP_DISPLAY_PX = 1.5`, not 1.0, because the downscale's phase is
not controllable: a 1.0 px feature straddling a destination-pixel boundary contributes half to each
of two pixels and neither reads as an edge. At 1.5 the worst phase still leaves one destination
pixel at least three-quarters covered.

The dash gap has to be floored on the gap that **survives**, not on the pattern given to the
canvas. A dashed construction is one path stroked twice, so the halo pass draws the same dashes at
`constructionWidth + 2·haloWidth` with round caps, extending each dash by half that width at both
ends. Visible gap = `gap − (constructionWidth + 2·haloWidth)`. At the shipped fractions that was
already only 0.65 display px; at a halo wide enough to see it goes **negative** and the halo renders
as one continuous bar with amber dashes inside it. This is not damage the halo widening did — it is
the same sub-pixel failure, in the same place, found by applying the same rule.

## D4 — The halo-width sweep

Three arms, all three clips, all 21 images, each captured in its own fresh Chromium process, each
analysed against the same annotation-free reference. The dash-gap floor is present in all three, so
the arms isolate the halo width. Cells are `markVsPhoto` pass rate (share of mark positions
reaching 3:1); only cells below 100% are listed.

| arm | cells < 100% of 21 | the shortfalls | worst minimum |
|---|---|---|---|
| baseline (no display floor) | 4 | d2-arm0 74%, d2-arm1 80%, mp-knee 82%, mp-fs1 96% | 1.62 |
| `1.0` | 5 | d2-vocm 99%, d2-arm0 79%, d2-arm1 95%, d2-sw 99%, mp-knee 96% | 1.83 |
| **`1.5`** | **2** | d2-arm0 93%, d2-arm1 97% | 2.03 |
| `2.0` | 3 | **d1-over 99%**, d2-arm0 93%, d2-arm1 98% | 1.51 |

`1.5` is a peak rather than a "more is better" ramp. `2.0` buys nothing on the two cells that are
still short and **introduces a new one**: Demo 1 `overstriding` falls to 99% with a minimum of
1.51, worse than baseline's 3.46 there, because at that width the halo starts consuming the marks
it protects. `1.0` leaves five cells short and is measurably closer to baseline on Demo 2.

This sweep is the evidence for the number. It had been asserted in a comment before it was run;
running it is what made the assertion true, and it changed the answer for `2.0`.

## D5 — Two passes, because a wide halo lets marks erase each other

Interleaving (each op laying its own halo and then its own colour) means op N+1's halo is painted
**over** op N's colour. At a 0.72-display-px halo that is invisible. At a halo the reader can see it
is not, because one exemplar's marks are neighbours by construction — a torso vector, the vertical
reference beside it, and joint dots at both ends of both.

Measured on the multiperson clip's `trunkLean`, where the subject is smallest relative to its crop.
Count of 144 px positions whose delivered colour is predominantly base amber:

| build | amber positions | `markVsPhoto` |
|---|---|---|
| baseline | 1 | 4.34 (n = 1) |
| display floor, interleaved | **0** | — |
| display floor, two passes | **17** | 6.34 / 6.10 / 5.56, 100% |

Interleaved, the amber measurement layer was gone: an image carrying joints and no visible
measurement, which is the exact collapse the two-layer requirement exists to prevent. Separating
the passes makes it structurally impossible — every halo is down before the first colour, so no
mark's halo can cover another mark's colour. Painter order within each pass is unchanged, so the
`marker`-above-joints and joints-above-segments decisions still hold, and the existing ordering
tests still pass unmodified.

Note this also *improved on baseline* rather than merely recovering it: baseline's single amber
position was itself a near-total loss on that exemplar.

## D6 — `strides-60w` is NOT closed, and this change cannot close it

`strides-60w` is about the ghost **photograph**. This change touches only the annotation layer, and
the 42 bit-identical reference images prove the photograph is unchanged to the bit. So the ghost's
photographic visibility is exactly what it was.

Looked at directly, zoomed, at 144 px: Demo 1 `kneeFlexion`'s ghost is still an amber stick with
three cyan dots over bare grass and track, with no leg visible beneath it. That is the bead's own
description of the defect, and it still reads that way. What changed is that the stick is now
cleanly legible instead of washed out — the *delta the image exists to show* survives, and reads
better than before, but the ghost is not identifiable as a **body** there.

The two remedies the bead itself names — a per-exemplar floor on measured ghost contrast, or a crop
that avoids placing the ghost over the brightest region — both live in `evidenceFrames.ts`'s
planning layer, outside this change. The third, raising `EVIDENCE_GHOST_BLEND_ALPHA`, is ruled out
by the bead and by `strides-c37`, and would be wrong anyway: the discriminator is background
luminance, which alpha cannot see. `strides-60w` stays open.

## D7 — What is still short, and why it was not forced

Demo 2 `armSwingSymmetry` reaches 3:1 on 94% and 98% of its mark positions, not 100% (minima 2.03
and 1.87). Both exemplars sit on the `EVIDENCE_CROP_MIN_SIDE_PX = 320` floor, so the marks are at
their smallest relative to a bright, low-texture background. Medians moved 4.29 → 5.63 and
3.85 → 5.08, so this is a large improvement rather than a stalemate — but it is not a clear.

It was not forced, because the sweep says the remaining tail is not a function of halo width: `2.0`
leaves those same two cells at 93%/98% and breaks Demo 1 `overstriding` doing it. Reaching them
would take a change to the crop (fenced off) or to the colours (which D2 shows cannot get there).

## D8 — Constraints held

- `EVIDENCE_GHOST_BLEND_ALPHA` unchanged at 0.35. `strides-c37`'s 65/35 weighting is intact.
- Demo 1 `kneeFlexion` did not degrade: `markVsPhoto` **7.12 → 8.18**, `amberVsPhoto` 6.26 → 6.86.
- `EVIDENCE_CROP_MIN_SIDE_PX`, `EVIDENCE_MAX_PAIR_CROP_GROWTH`,
  `EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS`, `MIN_EXEMPLAR_QUALITY` and the 3-MAD bound: untouched.
- No text: no text-drawing call and no font is named anywhere in the annotation or extraction
  modules; the `module hygiene` source scan still passes, and zero text is visible across the 21
  inspected images.
- No geometry moved into a draw call. Every weight is still resolved by the pure
  `evidenceAnnotationMetrics`, which the new tests exercise directly; the painter decides colour,
  weight, dash and cap only.
- Coverage unchanged: Demo 1 8 images / 7 sections, Demo 2 5 / 4, multiperson 8 / 7, zero
  `extraction-failed`.
- Regression anchor exact: `verticalOscillationCm` `4.421467928439415`, `fit.frequencyHz × 60` =
  91.2 = `cadence.value`, `subjectAgreement` 52/53.

## D9 — Full contrast table

`markVsPhoto` median / p10 / min, and the share of mark positions reaching 3:1, read on the
rendered 144 CSS px pixels. **bold** = below 100%.

| clip | metric | before | after |
|---|---|---|---|
| demo1 | verticalOscillation | 10.48 / 6.72 / 4.59 — 100% | 10.30 / 6.99 / 5.64 — 100% |
| demo1 | verticalRatio | 10.48 / 6.72 / 4.59 — 100% | 10.43 / 7.07 / 5.64 — 100% |
| demo1 | verticalOscillationCm | 6.76 / 5.73 / 5.29 — 100% | 9.04 / 5.80 / 4.28 — 100% |
| demo1 | trunkLean | 5.94 / 3.87 / 3.27 — 100% | 6.58 / 5.04 / 4.76 — 100% |
| demo1 | overstriding | 5.46 / 4.59 / 3.46 — 100% | 5.46 / 4.64 / 4.40 — 100% |
| demo1 | kneeFlexion | 7.12 / 4.58 / 4.46 — 100% | **8.18** / 4.63 / 4.45 — 100% |
| demo1 | footStrikePattern 0 | 8.20 / 6.59 / 5.15 — 100% | 8.20 / 6.85 / 6.44 — 100% |
| demo1 | footStrikePattern 1 | 4.78 / 4.66 / 4.53 — 100% | 5.23 / 4.66 / 4.53 — 100% |
| demo2 | verticalOscillation | 4.20 / 3.80 / 3.20 — 100% | 7.10 / 5.34 / 5.24 — 100% |
| demo2 | verticalOscillationCm | 4.05 / 3.33 / 3.22 — 100% | 7.18 / 6.48 / 4.55 — 100% |
| demo2 | armSwingSymmetry 0 | 4.29 / 1.92 / 1.62 — **74%** | 5.63 / 3.32 / 2.03 — **94%** |
| demo2 | armSwingSymmetry 1 | 3.85 / 2.42 / 1.70 — **80%** | 5.08 / 3.31 / 1.87 — **98%** |
| demo2 | stepWidth | 4.61 / 3.49 / 3.01 — 100% | 4.94 / 4.25 / 3.70 — 100% |
| multiperson | verticalOscillation | 5.34 / 4.19 / 3.93 — 100% | 5.46 / 4.67 / 3.82 — 100% |
| multiperson | verticalRatio | 5.29 / 4.25 / 4.00 — 100% | 5.46 / 4.61 / 3.82 — 100% |
| multiperson | verticalOscillationCm | 5.05 / 4.44 / 3.13 — 100% | 5.13 / 4.92 / 3.76 — 100% |
| multiperson | trunkLean | 4.34 / 4.34 / 4.34 — 100% (n = 1) | 6.34 / 6.10 / 5.56 — 100% (n = 17) |
| multiperson | overstriding | 5.54 / 4.15 / 3.19 — 100% | 6.00 / 4.38 / 3.09 — 100% |
| multiperson | kneeFlexion | 4.73 / 2.78 / 2.20 — **82%** | 6.33 / 4.39 / 3.29 — 100% |
| multiperson | footStrikePattern 0 | 4.36 / 3.50 / 3.11 — 100% | 5.39 / 4.13 / 3.43 — 100% |
| multiperson | footStrikePattern 1 | 4.22 / 3.25 / 2.82 — **96%** | 5.08 / 4.55 / 3.90 — 100% |

The stricter `amberVsPhoto` reading also improves broadly — Demo 1 `trunkLean` 3.93 → 4.00 with its
pass rate 60% → 83%, Demo 1 `kneeFlexion` 6.26 → 6.86, multiperson `verticalRatio` 3.87 → 4.62,
multiperson `trunkLean` 1.03 → 2.59 — but it stays low wherever the photograph is bright, which is
D2's point and cannot be otherwise.

## D10 — Visual sweep

All 21 images were looked at at full canvas resolution and at 144 px.

Improved and legible everywhere the numbers say so. The clearest gains, by eye: multiperson
`overstriding`'s two dashed guides over the sunlit fence (the original 1.7:1 case) now read as
dashed amber lines with a distinct dark casing; Demo 1 and Demo 2's vertical-oscillation bounce
guides now resolve as **two** separate dashed lines at 144 px, where CLAUDE.md previously recorded
them as not resolving inline; and multiperson `trunkLean` shows its amber torso vector on both
instants for the first time.

Two honest costs:

- **Marks are heavier.** A measurement stroke now carries roughly its own width of halo on each
  side rather than half of it, so annotation occludes more of the photograph. Most visible on Demo
  2 `stepWidth`, whose full-height dashed guide reads as a bolder amber-and-dark chain at 144 px
  where it used to be a fainter amber line. It is more legible and busier; the measured contrast
  went up (4.61 → 4.94 median, 3.01 → 3.70 minimum).
- **Demo 1 `verticalOscillationCm`'s two guides are close enough together** that they read as one
  thick dashed band rather than two. That is the small bounce delta on a side view, not a sizing
  regression — the same exemplar reads the same way at baseline.

Nothing else got worse. Joints still land on the right body on every image, the painter order still
puts hips under the amber cross, and no text appears anywhere.
